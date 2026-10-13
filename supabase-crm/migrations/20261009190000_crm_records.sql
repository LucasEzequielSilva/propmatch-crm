-- Datos del CRM en la base propia: contactos, propiedades, oportunidades,
-- agenda, tareas, operaciones, perfiles y la inmobiliaria. Ver docs/datos-en-la-base.md.
--
-- OJO: va en el Supabase PROPIO del CRM (ktltjpwetvdoxcaayvkh), NO en el de la
-- app. APLICADA el 2026-10-09 (vía MCP).
--
-- Modelo: un registro por entidad (`kind` + `id`), con su contenido en jsonb
-- tal como lo maneja el store del navegador (src/data/store.tsx). El navegador
-- NUNCA habla con esta base: todo pasa por api/crm.ts, que valida el JWT de la
-- app, resuelve la inmobiliaria y usa la service role. RLS forzada sin
-- policies y revoke a anon/authenticated, igual que el inbox.
--
-- `scope_id` es la inmobiliaria (uuid de `agencies` en la base de la app) o,
-- si la cuenta todavía no está vinculada a ninguna, el uuid del usuario. Al
-- vincularse, `crm_adopt_scope` pasa lo suyo a la inmobiliaria (si está vacía).
--
-- `version` es un contador global que sube con cada escritura: el navegador
-- pide «lo que cambió desde la versión N» y aplica los registros (el último
-- cambio gana, por registro). Las bajas son tumbas (`deleted = true`): nunca se
-- borra una fila, así los demás navegadores se enteran.

create sequence if not exists public.crm_records_version_seq;

create table public.crm_records (
  scope_id    uuid        not null,
  kind        text        not null check (kind ~ '^[a-z_]{1,32}$'),
  id          text        not null check (char_length(id) between 1 and 80),
  data        jsonb       not null default '{}'::jsonb,
  version     bigint      not null default nextval('public.crm_records_version_seq'),
  deleted     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (scope_id, kind, id)
);

create index crm_records_scope_version_idx on public.crm_records (scope_id, version);

-- Escritura en lote, atómica. `p_items` = [{kind, id, data, deleted?}, …].
-- Devuelve la versión más alta asignada (0 si no vino nada).
create or replace function public.crm_push(p_scope uuid, p_user uuid, p_items jsonb)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_item    jsonb;
  v_version bigint;
  v_max     bigint := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_version := nextval('public.crm_records_version_seq');
    insert into public.crm_records as r (scope_id, kind, id, data, version, deleted, updated_at, updated_by)
    values (
      p_scope,
      v_item->>'kind',
      v_item->>'id',
      coalesce(v_item->'data', '{}'::jsonb),
      v_version,
      coalesce((v_item->>'deleted')::boolean, false),
      now(),
      p_user
    )
    on conflict (scope_id, kind, id) do update
      set data       = excluded.data,
          version    = excluded.version,
          deleted    = excluded.deleted,
          updated_at = now(),
          updated_by = p_user;
    v_max := greatest(v_max, v_version);
  end loop;
  return v_max;
end;
$$;

-- Cuenta recién vinculada a una inmobiliaria: lo que cargó sola pasa a la
-- inmobiliaria, solo si la inmobiliaria todavía no tiene nada. Devuelve cuántos
-- registros movió.
create or replace function public.crm_adopt_scope(p_from uuid, p_to uuid)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_moved integer := 0;
begin
  if p_from = p_to then return 0; end if;
  if exists (select 1 from public.crm_records where scope_id = p_to) then return 0; end if;
  update public.crm_records set scope_id = p_to, version = nextval('public.crm_records_version_seq')
    where scope_id = p_from;
  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

-- Fotos cargadas en el CRM (las que no van a la app): bucket público, se
-- escribe solo con la service role desde api/crm.ts (acción `upload`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-photos', 'crm-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Seguridad: RLS forzada sin policies + revoke ---------------------------------

alter table public.crm_records enable row level security;
alter table public.crm_records force row level security;

revoke all on public.crm_records from anon, authenticated, public;
revoke all on sequence public.crm_records_version_seq from anon, authenticated, public;
revoke all on function public.crm_push(uuid, uuid, jsonb) from anon, authenticated, public;
revoke all on function public.crm_adopt_scope(uuid, uuid) from anon, authenticated, public;

grant all on public.crm_records to service_role;
grant usage, select, update on sequence public.crm_records_version_seq to service_role;
grant execute on function public.crm_push(uuid, uuid, jsonb) to service_role;
grant execute on function public.crm_adopt_scope(uuid, uuid) to service_role;
