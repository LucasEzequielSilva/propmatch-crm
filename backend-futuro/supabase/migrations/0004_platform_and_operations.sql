-- ============================================================================
-- 0004 · Plataforma (alta manual de agencias) y Operaciones
--
-- Decisiones:
--  · Multi-tenant: toda tabla de negocio lleva agency_id y RLS por agencia.
--  · Alta manual: solo un admin de plataforma crea agencias e invita a su
--    primer administrador. No hay auto-registro.
--  · Plantillas: agency_id NULL = modelo base de la plataforma (lectura para
--    todos, escritura solo admin de plataforma). Cada agencia copia y ajusta.
--  · Auditoría append-only y documentos generados inmutables.
-- ============================================================================

-- ── 1. Correcciones al esquema base ─────────────────────────────────────────

-- Un usuario NO puede cambiarse su propio rol, agencia ni estado: con la
-- política profiles_update_self de 0001 podía ascenderse a owner.
create or replace function profiles_guard_privileged_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (new.role, new.agency_id, new.is_active)
       is distinct from (old.role, old.agency_id, old.is_active)
     and not (is_admin() and old.agency_id = current_agency_id())
     and not is_platform_admin()
  then
    raise exception 'No podés modificar rol, agencia ni estado de un perfil';
  end if;
  return new;
end;
$$;

-- ── 2. Administradores de plataforma (vos) ──────────────────────────────────

create table platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table platform_admins enable row level security;
-- Sin políticas: nadie la lee desde el cliente. Se administra con service role.

create or replace function is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from platform_admins where user_id = auth.uid()); $$;

create trigger profiles_guard
  before update on profiles
  for each row execute function profiles_guard_privileged_columns();

-- ── 3. Alta manual de agencias e invitaciones ───────────────────────────────

-- El auto-registro de 0001 queda cerrado.
revoke execute on function signup_agency(text, text) from authenticated;

create table agency_invites (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references agencies (id) on delete cascade,
  email       text not null,
  role        user_role not null default 'agente',
  invited_by  uuid references auth.users (id) on delete set null,
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index agency_invites_open_email
  on agency_invites (agency_id, lower(email)) where accepted_at is null;
alter table agency_invites enable row level security;

create policy agency_invites_admin on agency_invites for all
  using (agency_id = current_agency_id() and is_admin())
  with check (agency_id = current_agency_id() and is_admin());

-- El admin de plataforma crea la agencia y deja invitado a su administrador.
create or replace function provision_agency(
  p_agency_name text,
  p_admin_email text,
  p_city        text default null,
  p_province    text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_agency_id uuid;
  v_slug      text;
begin
  if not is_platform_admin() then
    raise exception 'Solo un administrador de plataforma puede crear agencias';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(trim(p_agency_name)), '[^a-z0-9]+', '-', 'g'));
  if exists (select 1 from agencies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into agencies (name, slug, city, province)
  values (trim(p_agency_name), v_slug, p_city, p_province)
  returning id into v_agency_id;

  insert into agency_invites (agency_id, email, role, invited_by)
  values (v_agency_id, lower(trim(p_admin_email)), 'owner', auth.uid());

  return v_agency_id;
end;
$$;
revoke all on function provision_agency(text, text, text, text) from public;
grant execute on function provision_agency(text, text, text, text) to authenticated;

-- La persona invitada entra con su mail y reclama su lugar: crea su perfil en
-- la agencia que la invitó, con el rol de la invitación.
create or replace function accept_invite(p_full_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_email  text;
  v_invite agency_invites;
begin
  if auth.uid() is null then raise exception 'No hay sesión activa'; end if;
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'El usuario ya pertenece a una agencia';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_invite from agency_invites
  where lower(email) = lower(v_email) and accepted_at is null and expires_at > now()
  order by created_at desc limit 1;

  if not found then
    raise exception 'No hay una invitación vigente para este mail';
  end if;

  insert into profiles (id, agency_id, full_name, email, role)
  values (auth.uid(), v_invite.agency_id,
          coalesce(nullif(trim(p_full_name), ''), 'Sin nombre'), v_email, v_invite.role);

  update agency_invites set accepted_at = now() where id = v_invite.id;
  return v_invite.agency_id;
end;
$$;
revoke all on function accept_invite(text) from public;
grant execute on function accept_invite(text) to authenticated;

-- ── 4. Operaciones (el expediente) ──────────────────────────────────────────

create type deal_kind as enum ('venta', 'alquiler');

-- Etapas de ambos flujos en un solo enum. Qué salto es válido lo decide la
-- tabla `deal_transitions`, no el enum.
create type deal_stage as enum (
  -- comunes
  'lead', 'visita', 'reserva', 'caido',
  -- alquiler
  'contactado', 'interesado', 'docs_solicitada', 'docs_recibida', 'verificacion',
  'aprobacion', 'contrato', 'firma', 'entrega', 'activo', 'renovacion', 'finalizado',
  -- venta
  'oferta', 'negociacion', 'informes', 'estudio_titulos', 'boleto', 'escritura', 'cerrado'
);

create table operations (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies (id) on delete cascade,
  kind                deal_kind not null,
  stage               deal_stage not null default 'lead',
  stage_since         timestamptz not null default now(),
  property_id         uuid references properties (id) on delete set null,
  opportunity_id      uuid references opportunities (id) on delete set null,
  responsible_id      uuid references profiles (id) on delete set null,
  supervisor_id       uuid references profiles (id) on delete set null,
  price               numeric(14, 2),
  currency            currency_code not null default 'USD',
  commission_pct      numeric(5, 2),
  -- Condiciones que cambian según el tipo (plazo, ajuste, anticipo, escribano…).
  terms               jsonb not null default '{}'::jsonb,
  lost_reason         text,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on operations (agency_id, stage);
create index on operations (property_id);

-- Quién participa y con qué rol. Una persona no se duplica: apunta a contacts.
create type party_role as enum (
  'propietario', 'comprador', 'inquilino', 'garante', 'escribano', 'profesional', 'otro'
);

create table operation_parties (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  operation_id  uuid not null references operations (id) on delete cascade,
  contact_id    uuid references contacts (id) on delete set null,
  role          party_role not null,
  -- Datos que van al contrato (DNI, domicilio, estado civil…). Sensibles.
  legal_data    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on operation_parties (operation_id);

-- Transiciones válidas de etapa, por tipo de operación.
create table deal_transitions (
  kind        deal_kind  not null,
  from_stage  deal_stage not null,
  to_stage    deal_stage not null,
  primary key (kind, from_stage, to_stage)
);
alter table deal_transitions enable row level security;
create policy deal_transitions_read on deal_transitions for select to authenticated using (true);

do $$
declare
  alquiler deal_stage[] := array['lead','contactado','visita','interesado','docs_solicitada',
    'docs_recibida','verificacion','aprobacion','reserva','contrato','firma','entrega',
    'activo','renovacion','finalizado']::deal_stage[];
  venta deal_stage[] := array['lead','visita','oferta','negociacion','reserva','informes',
    'estudio_titulos','boleto','escritura','cerrado']::deal_stage[];
  i int;
begin
  -- Avanzar un paso, o volver uno.
  for i in 1 .. array_length(alquiler, 1) - 1 loop
    insert into deal_transitions values ('alquiler', alquiler[i], alquiler[i + 1]) on conflict do nothing;
    insert into deal_transitions values ('alquiler', alquiler[i + 1], alquiler[i]) on conflict do nothing;
  end loop;
  for i in 1 .. array_length(venta, 1) - 1 loop
    insert into deal_transitions values ('venta', venta[i], venta[i + 1]) on conflict do nothing;
    insert into deal_transitions values ('venta', venta[i + 1], venta[i]) on conflict do nothing;
  end loop;
  -- Renovar: de finalizado a activo. Y caer desde cualquier etapa abierta.
  insert into deal_transitions values ('alquiler', 'renovacion', 'activo') on conflict do nothing;
  for i in 1 .. array_length(alquiler, 1) - 1 loop
    insert into deal_transitions values ('alquiler', alquiler[i], 'caido') on conflict do nothing;
  end loop;
  for i in 1 .. array_length(venta, 1) - 1 loop
    insert into deal_transitions values ('venta', venta[i], 'caido') on conflict do nothing;
  end loop;
  -- Reabrir una caída vuelve al principio.
  insert into deal_transitions values ('alquiler', 'caido', 'lead'), ('venta', 'caido', 'lead') on conflict do nothing;
end $$;

create or replace function operations_enforce_stage()
returns trigger
language plpgsql set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    if not exists (
      select 1 from deal_transitions
      where kind = new.kind and from_stage = old.stage and to_stage = new.stage
    ) then
      raise exception 'Salto de etapa no permitido en % : % -> %', new.kind, old.stage, new.stage;
    end if;
    new.stage_since := now();
    if new.stage in ('cerrado', 'finalizado') then new.closed_at := now(); end if;
  end if;
  return new;
end;
$$;
create trigger operations_stage_guard
  before insert or update on operations
  for each row execute function operations_enforce_stage();

-- ── 5. Checklists: plantillas y estado por expediente ───────────────────────

-- Plantillas de checklist. agency_id NULL = modelo base de la plataforma.
create table checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid references agencies (id) on delete cascade,
  kind        deal_kind not null,
  -- Cada ítem: {key, group, label, party_role, required, hint, requires_validation}
  items       jsonb not null,
  version     int not null default 1,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on checklist_templates (agency_id, kind);

create type checklist_status as enum ('pendiente', 'recibido', 'observado', 'validado');

create table operation_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  operation_id  uuid not null references operations (id) on delete cascade,
  key           text not null,
  label         text not null,
  party_role    party_role,
  required      boolean not null default true,
  status        checklist_status not null default 'pendiente',
  note          text,
  file_path     text,          -- Storage privado; nunca URL pública.
  reviewed_by   uuid references profiles (id) on delete set null,
  reviewed_at   timestamptz,
  unique (operation_id, key)
);
create index on operation_checklist_items (operation_id);

-- "Validado" lo marca alguien con permiso, no cualquiera que suba el archivo.
create or replace function checklist_guard_validation()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'validado' and (tg_op = 'INSERT' or old.status is distinct from 'validado') then
    if current_user_role() not in
       ('owner', 'admin', 'gerente', 'supervisor', 'resp_ventas', 'resp_alquileres', 'administrativo')
    then
      raise exception 'Tu rol no puede validar documentación';
    end if;
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;
create trigger checklist_validation_guard
  before insert or update on operation_checklist_items
  for each row execute function checklist_guard_validation();

-- ── 6. Verificaciones (recibos, relación laboral, etc.) ─────────────────────
-- Se registra QUÉ se verificó, contra qué fuente, quién y cuándo. Nunca se
-- "declara verdadero" un dato: se deja el rastro de cómo se comprobó.

create type verification_status as enum ('no_verificado', 'parcial', 'verificado', 'inconsistente');

create table verifications (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  operation_id  uuid not null references operations (id) on delete cascade,
  party_id      uuid references operation_parties (id) on delete set null,
  subject       text not null,                 -- 'recibo_sueldo', 'relacion_laboral', 'dominio'…
  status        verification_status not null default 'no_verificado',
  source        text,                          -- con qué se contrastó
  detail        jsonb not null default '{}'::jsonb,   -- períodos, empleador, etc.
  result_note   text,
  verified_by   uuid references profiles (id) on delete set null,
  verified_at   timestamptz,
  retain_until  date,                          -- retención definida por la agencia
  created_at    timestamptz not null default now()
);
create index on verifications (operation_id);

-- ── 7. Documentos generados (inmutables) ────────────────────────────────────

create table document_templates (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid references agencies (id) on delete cascade,  -- NULL = base
  doc_type    text not null,          -- 'reserva', 'contrato_alquiler', 'boleto_compraventa'…
  kind        deal_kind not null,
  version     int not null default 1,
  -- Bloques con {{variables}}: mismo formato que renderiza el frontend.
  body        jsonb not null,
  is_active   boolean not null default true,
  based_on    uuid references document_templates (id) on delete set null,
  created_by  uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique nulls not distinct (agency_id, doc_type, kind, version)
);

create table operation_documents (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  operation_id  uuid not null references operations (id) on delete cascade,
  doc_type      text not null,
  template_id   uuid references document_templates (id) on delete set null,
  template_version int,
  version       int not null,
  -- Snapshot del texto final y de los datos con que se generó.
  content       jsonb not null,
  variables     jsonb not null default '{}'::jsonb,
  storage_path  text,                 -- PDF firmado o escaneado, si existe
  generated_by  uuid references profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (operation_id, doc_type, version)
);

-- Un documento emitido no se modifica ni se borra: se emite una versión nueva.
create or replace function block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% es inmutable (%): emití una versión nueva', tg_table_name, tg_op;
end;
$$;
create trigger operation_documents_immutable
  before update or delete on operation_documents
  for each row execute function block_mutation();

-- ── 8. Tareas ligadas a la operación y reglas de automatización ─────────────

alter table tasks add column operation_id uuid references operations (id) on delete cascade;
alter table tasks add column assigned_role user_role;
create index on tasks (operation_id);

-- "Al pasar a X, crear la tarea Y para el rol Z." Es dato, no código: se
-- cambia el flujo sin desplegar. agency_id NULL = regla base de la plataforma.
create table task_rules (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid references agencies (id) on delete cascade,
  kind          deal_kind not null,
  on_stage      deal_stage not null,
  task_text     text not null,
  assign_role   user_role,
  due_in_days   int,
  is_active     boolean not null default true
);
create index on task_rules (kind, on_stage);

create or replace function operations_apply_task_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.stage is distinct from old.stage then
    insert into tasks (agency_id, owner_id, text, is_priority, due_date, operation_id, assigned_role)
    select new.agency_id,
           new.responsible_id,
           r.task_text,
           false,
           case when r.due_in_days is null then null else current_date + r.due_in_days end,
           new.id,
           r.assign_role
    from task_rules r
    where r.is_active
      and r.kind = new.kind
      and r.on_stage = new.stage
      and (r.agency_id is null or r.agency_id = new.agency_id)
      -- si la agencia tiene su propia regla para esta etapa, gana sobre la base
      and not (r.agency_id is null and exists (
        select 1 from task_rules a
        where a.agency_id = new.agency_id and a.kind = r.kind
          and a.on_stage = r.on_stage and a.is_active));
  end if;
  return new;
end;
$$;
create trigger operations_task_rules
  after update on operations
  for each row execute function operations_apply_task_rules();

-- Reglas base tomadas del flujo definido para la plataforma.
insert into task_rules (kind, on_stage, task_text, assign_role, due_in_days) values
  ('alquiler', 'docs_solicitada', 'Enviar el checklist de documentación al interesado', 'administrativo', 1),
  ('alquiler', 'docs_recibida',   'Revisar documentación recibida y ejecutar verificaciones', 'resp_alquileres', 2),
  ('alquiler', 'aprobacion',      'Resumen del expediente para aprobación', 'resp_alquileres', 1),
  ('alquiler', 'reserva',         'Solicitar documentación faltante y generar la reserva', 'administrativo', 1),
  ('alquiler', 'contrato',        'Preparar el contrato y coordinar la firma', 'administrativo', 3),
  ('alquiler', 'entrega',         'Checklist de entrega de llaves e inventario con fotos', 'administrativo', 2),
  ('alquiler', 'activo',          'Agendar ajustes, cobros y vencimiento del contrato', 'administrativo', 7),
  ('venta',    'reserva',         'Solicitar informes de dominio e inhibiciones', 'resp_ventas', 2),
  ('venta',    'informes',        'Asignar el estudio de títulos al profesional', 'resp_ventas', 2),
  ('venta',    'boleto',          'Preparar el boleto y coordinar la firma', 'administrativo', 3),
  ('venta',    'escritura',       'Confirmar fecha de escritura y checklist de escribanía', 'resp_ventas', 3),
  ('venta',    'cerrado',         'Registrar comisión, cerrar publicaciones y archivar documentación', 'administrativo', 2);

-- ── 9. Auditoría inalterable ────────────────────────────────────────────────

create table audit_events (
  id          bigint generated always as identity primary key,
  agency_id   uuid,
  actor_id    uuid,
  table_name  text not null,
  row_id      uuid,
  action      text not null,          -- INSERT | UPDATE | DELETE
  old_data    jsonb,
  new_data    jsonb,
  created_at  timestamptz not null default now()
);
create index on audit_events (agency_id, created_at desc);
create index on audit_events (table_name, row_id);

create trigger audit_events_immutable
  before update or delete on audit_events
  for each row execute function block_mutation();

create or replace function audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_events (agency_id, actor_id, table_name, row_id, action, old_data, new_data)
  values (
    nullif(v_row ->> 'agency_id', '')::uuid,
    auth.uid(),
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'operations', 'operation_parties', 'operation_checklist_items', 'verifications',
    'operation_documents', 'properties', 'contacts', 'opportunities'
  ]
  loop
    execute format(
      'create trigger %1$s_audit after insert or update or delete on %1$I
         for each row execute function audit_row_change()', t);
  end loop;
end $$;

-- ── 10. RLS ─────────────────────────────────────────────────────────────────

alter table operations                enable row level security;
alter table operation_parties         enable row level security;
alter table operation_checklist_items enable row level security;
alter table verifications             enable row level security;
alter table operation_documents       enable row level security;
alter table checklist_templates       enable row level security;
alter table document_templates        enable row level security;
alter table task_rules                enable row level security;
alter table audit_events              enable row level security;

-- Tablas de la operación: aislamiento por agencia.
do $$
declare t text;
begin
  foreach t in array array[
    'operations', 'operation_parties', 'operation_checklist_items',
    'verifications', 'operation_documents'
  ]
  loop
    execute format($f$
      create policy %1$s_tenant_isolation on %1$I
        for all
        using (agency_id = current_agency_id())
        with check (agency_id = current_agency_id());
    $f$, t);
  end loop;
end $$;

-- Plantillas y reglas: se leen las base (agency_id NULL) y las de la propia
-- agencia. Las base las escribe solo el admin de plataforma; las de la agencia,
-- sus admins.
do $$
declare t text;
begin
  foreach t in array array['checklist_templates', 'document_templates', 'task_rules']
  loop
    execute format($f$
      create policy %1$s_read on %1$I for select
        using (agency_id is null or agency_id = current_agency_id());
      create policy %1$s_write_agency on %1$I for all
        using (agency_id = current_agency_id() and is_admin())
        with check (agency_id = current_agency_id() and is_admin());
      create policy %1$s_write_base on %1$I for all
        using (agency_id is null and is_platform_admin())
        with check (agency_id is null and is_platform_admin());
    $f$, t);
  end loop;
end $$;

-- Auditoría: la lee la conducción de la agencia; nadie la escribe desde el cliente.
create policy audit_events_read on audit_events for select
  using (
    agency_id = current_agency_id()
    and current_user_role() in ('owner', 'admin', 'gerente', 'supervisor')
  );

-- Documentos inmutables: el trigger ya bloquea UPDATE/DELETE; además se quita
-- el permiso a nivel tabla.
revoke update, delete on operation_documents from authenticated;
revoke all on audit_events from authenticated;
grant select on audit_events to authenticated;

-- ── 11. Storage privado para documentación ──────────────────────────────────
-- documentos/<agency_id>/<operation_id>/<archivo>. Bucket PRIVADO: se accede
-- con URLs firmadas de corta duración, nunca públicas (hay DNI y recibos).

insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

create policy "documentos_lectura_por_agencia" on storage.objects for select
  to authenticated
  using (bucket_id = 'documentos'
         and (storage.foldername(name))[1] = current_agency_id()::text);

create policy "documentos_escritura_por_agencia" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documentos'
              and (storage.foldername(name))[1] = current_agency_id()::text);

-- Sin política de UPDATE ni DELETE: lo subido no se pisa ni se borra desde el cliente.
