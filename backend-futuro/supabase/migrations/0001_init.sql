-- ============================================================================
-- PropMatch CRM — esquema inicial
--
-- Principios:
--   1. MULTI-TENANT DESDE EL DÍA 1. Toda tabla de negocio lleva `agency_id` y
--      tiene RLS que la filtra. El aislamiento no depende del frontend.
--   2. PREPARADO PARA FASE 2 (consumer) sin construirla: los puntos de enganche
--      están marcados con  -- [FASE 2]  y son columnas nullable, nada más.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────

create type user_role         as enum ('owner', 'admin', 'agente');
create type operation_type    as enum ('venta', 'alquiler', 'alquiler_temporal');
create type property_type     as enum ('casa', 'departamento', 'ph', 'terreno', 'local', 'oficina');
create type property_status   as enum ('disponible', 'reservada', 'vendida', 'alquilada', 'pausada', 'en_revision');
create type currency_code     as enum ('USD', 'ARS');
create type contact_status    as enum ('nuevo', 'activo', 'en_seguimiento', 'visita_programada', 'cerrado', 'perdido');
create type contact_kind      as enum ('comprador', 'inquilino', 'propietario', 'inversor', 'otro');
create type contact_source    as enum ('manual', 'web', 'portal', 'referido', 'consumer_app'); -- [FASE 2] consumer_app
create type client_profile    as enum ('inversor', 'primera_vivienda', 'familia', 'estudiante', 'profesional');
create type authorization_type as enum ('exclusiva', 'no_exclusiva');
create type opportunity_stage as enum ('nuevos', 'contactados', 'visita', 'negociacion', 'cierre', 'perdida');
create type activity_type     as enum ('contacto_creado', 'contacto_actualizado', 'propiedad_publicada', 'visita_programada', 'match_creado', 'etapa_avanzada', 'mensaje', 'llamada', 'nota');
create type event_type        as enum ('visita', 'llamada', 'reunion', 'seguimiento');
create type match_origin      as enum ('crm', 'consumer'); -- [FASE 2] consumer

-- ── Tenants ─────────────────────────────────────────────────────────────────

create table agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  logo_url    text,
  phone       text,
  email       text,
  city        text,
  province    text,
  created_at  timestamptz not null default now()
);

-- Un perfil por usuario de auth. Es la tabla que ancla el usuario a su agencia.
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  agency_id   uuid not null references agencies (id) on delete cascade,
  full_name   text not null,
  email       text,
  phone       text,
  avatar_url  text,
  initials    text generated always as (
                upper(left(split_part(full_name, ' ', 1), 1) ||
                      coalesce(left(nullif(split_part(full_name, ' ', 2), ''), 1), ''))
              ) stored,
  role        user_role not null default 'agente',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on profiles (agency_id);

-- ── Helpers de RLS ──────────────────────────────────────────────────────────
-- SECURITY DEFINER para poder leer `profiles` sin disparar la RLS de `profiles`
-- (si no, la política se llamaría a sí misma y entraría en recursión infinita).

create or replace function current_agency_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agency_id from profiles where id = auth.uid();
$$;

create or replace function current_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role in ('owner', 'admin') from profiles where id = auth.uid()), false);
$$;

-- ── Contactos ───────────────────────────────────────────────────────────────

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  owner_id      uuid references profiles (id) on delete set null,  -- agente asignado
  full_name     text not null,
  email         text,
  phone         text,
  kind          contact_kind not null default 'comprador',
  status        contact_status not null default 'nuevo',
  source        contact_source not null default 'manual',
  profile_type  client_profile,
  notes         text,
  -- [FASE 2] cuando exista la app del comprador, su cuenta se enlaza acá.
  -- Nullable: en el MVP siempre queda en NULL.
  user_id       uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on contacts (agency_id, status);
create index on contacts (agency_id, owner_id);

-- Qué busca el contacto. Tabla aparte (no columnas en `contacts`) porque una
-- persona puede tener más de una búsqueda activa y porque en Fase 2 este es
-- exactamente el "perfil de búsqueda" que va a editar el comprador.
create table contact_requirements (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null references agencies (id) on delete cascade,
  contact_id        uuid not null references contacts (id) on delete cascade,
  label             text,
  operation         operation_type not null default 'venta',
  property_types    property_type[] not null default '{}',
  zones             text[] not null default '{}',
  budget_min        numeric(14,2),
  budget_max        numeric(14,2),
  currency          currency_code not null default 'USD',
  rooms_min         int,
  bedrooms_min      int,
  bathrooms_min     int,
  surface_min       numeric(10,2),
  surface_max       numeric(10,2),
  features          text[] not null default '{}',
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on contact_requirements (agency_id, contact_id);
create index on contact_requirements (agency_id) where is_active;

-- ── Propiedades ─────────────────────────────────────────────────────────────

create table properties (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references agencies (id) on delete cascade,
  owner_agent_id      uuid references profiles (id) on delete set null,
  owner_contact_id    uuid references contacts (id) on delete set null, -- el propietario
  title               text not null,
  description         text,
  type                property_type not null,
  operation           operation_type not null default 'venta',
  status              property_status not null default 'disponible',
  -- Ubicación
  street              text,
  street_number       text,
  locality            text,
  province            text,
  zone                text,
  lat                 double precision,
  lng                 double precision,
  -- Métricas
  price               numeric(14,2),
  currency            currency_code not null default 'USD',
  expenses            numeric(14,2),
  taxes               numeric(14,2),
  commission_pct      numeric(5,2),
  authorization_type  authorization_type,          -- null = sin autorización firmada
  authorization_expires_at date,
  surface_total       numeric(10,2),
  surface_covered     numeric(10,2),
  rooms               int,
  bedrooms            int,
  bathrooms           int,
  garages             int,
  age_years           int,
  features            text[] not null default '{}',
  is_featured         boolean not null default false,
  -- [FASE 2] visibilidad en el marketplace del comprador. En el MVP nadie la lee.
  published_to_marketplace boolean not null default false,
  published_at        timestamptz default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on properties (agency_id, status);
create index on properties (agency_id, type, operation);
create index on properties (agency_id, zone);

create table property_photos (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies (id) on delete cascade,
  property_id  uuid not null references properties (id) on delete cascade,
  storage_path text not null,
  position     int not null default 0,
  is_cover     boolean not null default false,
  created_at   timestamptz not null default now()
);
create index on property_photos (property_id, position);

-- El bloque "Preferencias para Match" del formulario de alta.
-- Es lo que el agente declara sobre a quién le podría servir esta propiedad.
create table property_match_prefs (
  property_id      uuid primary key references properties (id) on delete cascade,
  agency_id        uuid not null references agencies (id) on delete cascade,
  budget_min       numeric(14,2),
  budget_max       numeric(14,2),
  client_profiles  client_profile[] not null default '{}',
  target_features  text[] not null default '{}',
  updated_at       timestamptz not null default now()
);

-- ── Matches ─────────────────────────────────────────────────────────────────
-- El score se calcula y se guarda; NO se inventa en el frontend.

create table matches (
  id               uuid primary key default gen_random_uuid(),
  agency_id        uuid not null references agencies (id) on delete cascade,
  contact_id       uuid not null references contacts (id) on delete cascade,
  requirement_id   uuid not null references contact_requirements (id) on delete cascade,
  property_id      uuid not null references properties (id) on delete cascade,
  score            int not null check (score between 0 and 100),
  -- Los 5 factores del diseño, cada uno 0-100
  score_location   int not null default 0,
  score_budget     int not null default 0,
  score_type       int not null default 0,
  score_size       int not null default 0,
  score_features   int not null default 0,
  reasons          text[] not null default '{}',   -- los chips "✓ Zona preferida"
  origin           match_origin not null default 'crm', -- [FASE 2]
  is_reviewed      boolean not null default false,
  is_dismissed     boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (requirement_id, property_id)
);
create index on matches (agency_id, score desc);
create index on matches (agency_id, contact_id);
create index on matches (agency_id, property_id);

-- ── Oportunidades (pipeline) ────────────────────────────────────────────────

create table opportunities (
  id              uuid primary key default gen_random_uuid(),
  agency_id       uuid not null references agencies (id) on delete cascade,
  contact_id      uuid not null references contacts (id) on delete cascade,
  property_id     uuid references properties (id) on delete set null,
  match_id        uuid references matches (id) on delete set null,
  owner_id        uuid references profiles (id) on delete set null,
  stage           opportunity_stage not null default 'nuevos',
  value           numeric(14,2),
  currency        currency_code not null default 'USD',
  is_priority     boolean not null default false,
  priority_note   text,
  stage_since     timestamptz not null default now(),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on opportunities (agency_id, stage);
create index on opportunities (agency_id, owner_id);

-- Mantiene `stage_since` para poder mostrar "3d en esta etapa" sin hardcodear.
create or replace function touch_stage_since()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_since := now();
    if new.stage = 'cierre' then new.closed_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger opportunities_stage_change
  before update on opportunities
  for each row execute function touch_stage_since();

-- ── Actividades, eventos y tareas ───────────────────────────────────────────

create table activities (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies (id) on delete cascade,
  actor_id     uuid references profiles (id) on delete set null,
  type         activity_type not null,
  title        text not null,
  detail       text,
  contact_id   uuid references contacts (id) on delete cascade,
  property_id  uuid references properties (id) on delete cascade,
  opportunity_id uuid references opportunities (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index on activities (agency_id, created_at desc);

create table events (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references agencies (id) on delete cascade,
  owner_id      uuid references profiles (id) on delete set null,
  type          event_type not null default 'visita',
  title         text not null,
  contact_id    uuid references contacts (id) on delete set null,
  property_id   uuid references properties (id) on delete set null,
  opportunity_id uuid references opportunities (id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  notes         text,
  created_at    timestamptz not null default now()
);
create index on events (agency_id, starts_at);

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references agencies (id) on delete cascade,
  owner_id     uuid references profiles (id) on delete cascade,
  text         text not null,
  is_priority  boolean not null default false,
  is_done      boolean not null default false,
  due_date     date,
  contact_id   uuid references contacts (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index on tasks (agency_id, owner_id, is_done);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Regla general: ves las filas de tu agencia, y punto.
-- ============================================================================

alter table agencies             enable row level security;
alter table profiles             enable row level security;
alter table contacts             enable row level security;
alter table contact_requirements enable row level security;
alter table properties           enable row level security;
alter table property_photos      enable row level security;
alter table property_match_prefs enable row level security;
alter table matches              enable row level security;
alter table opportunities        enable row level security;
alter table activities           enable row level security;
alter table events               enable row level security;
alter table tasks                enable row level security;

-- Agencias: cada quien ve la suya; solo owner/admin la edita.
create policy agencies_select on agencies for select
  using (id = current_agency_id());
create policy agencies_update on agencies for update
  using (id = current_agency_id() and is_admin());

-- Perfiles: se ve el equipo de la agencia; cada uno edita el suyo, admin edita todos.
create policy profiles_select on profiles for select
  using (agency_id = current_agency_id());
create policy profiles_update_self on profiles for update
  using (id = auth.uid());
create policy profiles_admin_all on profiles for all
  using (agency_id = current_agency_id() and is_admin())
  with check (agency_id = current_agency_id() and is_admin());

-- Resto de tablas: una política por tabla, mismo criterio.
-- Se genera en bucle para que no haya forma de olvidarse una.
do $$
declare t text;
begin
  foreach t in array array[
    'contacts', 'contact_requirements', 'properties', 'property_photos',
    'property_match_prefs', 'matches', 'opportunities', 'activities',
    'events', 'tasks'
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

-- ============================================================================
-- ALTA DE CUENTA
-- Crea la agencia y el perfil del usuario logueado en una sola transacción.
-- Se llama desde el registro. SECURITY DEFINER porque en ese momento el usuario
-- todavía no tiene agencia y por lo tanto la RLS lo dejaría afuera.
-- ============================================================================

create or replace function signup_agency(p_agency_name text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agency_id uuid;
  v_slug      text;
begin
  if auth.uid() is null then
    raise exception 'No hay sesión activa';
  end if;
  if exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'El usuario ya pertenece a una agencia';
  end if;

  v_slug := regexp_replace(lower(trim(p_agency_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if exists (select 1 from agencies where slug = v_slug) then
    v_slug := v_slug || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into agencies (name, slug) values (trim(p_agency_name), v_slug)
  returning id into v_agency_id;

  insert into profiles (id, agency_id, full_name, email, role)
  values (
    auth.uid(),
    v_agency_id,
    coalesce(nullif(trim(p_full_name), ''), 'Sin nombre'),
    (select email from auth.users where id = auth.uid()),
    'owner'
  );

  return v_agency_id;
end;
$$;

revoke all on function signup_agency(text, text) from public;
grant execute on function signup_agency(text, text) to authenticated;

-- ============================================================================
-- STORAGE: fotos de propiedades
-- Se guardan como  propiedades/<agency_id>/<property_id>/<archivo>
-- La primera carpeta es el agency_id, así la política puede aislar por tenant.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('propiedades', 'propiedades', true)
on conflict (id) do nothing;

create policy "propiedades_lectura_publica" on storage.objects for select
  using (bucket_id = 'propiedades');

create policy "propiedades_escritura_por_agencia" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'propiedades'
    and (storage.foldername(name))[1] = current_agency_id()::text
  );

create policy "propiedades_borrado_por_agencia" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'propiedades'
    and (storage.foldername(name))[1] = current_agency_id()::text
  );
