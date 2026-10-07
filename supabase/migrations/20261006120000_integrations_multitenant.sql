-- ════════════════════════════════════════════════════════════════════════════
-- Integraciones multi-inmobiliaria: modelo explícito
--   Organization        = public.agencies
--   Portal Connection   = public.agency_integrations   (una por agencia y portal)
--   Publication         = public.property_publications (una por propiedad y portal)
--
-- SIN APLICAR. Aplicar solo con aprobación de Lucas (la base es compartida con
-- la app y tiene usuarios reales). Orden: después de
--   20261004110000_crm_agency_integration   (agencies, agency_members)
--   20261004120000_property_publications
--   20261005140000_agency_integrations
-- Es ADITIVA: solo agrega columnas nullable o con default, un índice y amplía
-- un check. No borra ni reescribe datos. El código del CRM funciona con y sin
-- esta migración (detecta las columnas que faltan y sigue sin ellas).
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Conexión: cómo se autorizó, último error legible y última verificación.
alter table public.agency_integrations
  add column if not exists auth_method     text not null default 'oauth',
  add column if not exists last_error      text,
  add column if not exists last_checked_at timestamptz;

alter table public.agency_integrations
  drop constraint if exists agency_integrations_auth_method_check;
alter table public.agency_integrations
  add constraint agency_integrations_auth_method_check
  check (auth_method in ('oauth','credentials','api_key','feed'));

-- Proveedores: hoy no hace falta ampliar la lista (Argenprop y Zonaprop ya
-- estaban; Facebook e Instagram son UNA conexión, provider 'meta'). Se reescribe
-- el check con el mismo contenido para que tenga nombre conocido y sumar un
-- portal nuevo sea cambiar una sola línea.
alter table public.agency_integrations
  drop constraint if exists agency_integrations_provider_check;
alter table public.agency_integrations
  add constraint agency_integrations_provider_check
  check (provider in ('mercadolibre','meta','whatsapp','zonaprop','argenprop','cabaprop','properati'));

-- El navegador puede leer el estado (sin secretos): se suman las columnas nuevas
-- a los grants por columna. Los tokens y credenciales siguen sin grant.
grant select (auth_method, last_error, last_checked_at)
  on public.agency_integrations to authenticated;

-- 2. Publicación → conexión con la que se publicó. Si la inmobiliaria
-- desconecta el portal, la publicación queda (con su external_id) y la
-- referencia pasa a null.
alter table public.property_publications
  add column if not exists connection_id uuid
    references public.agency_integrations(id) on delete set null;

create index if not exists property_publications_connection_idx
  on public.property_publications (connection_id)
  where connection_id is not null;

-- La conexión tiene que ser de la MISMA agencia que la publicación (el cliente
-- puede escribir property_publications por RLS: esto evita que apunte a una
-- conexión ajena). Aditivo: no toca la policy existente.
create or replace function public.property_publications_connection_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.connection_id is not null and not exists (
    select 1 from public.agency_integrations i
    where i.id = new.connection_id and i.agency_id = new.agency_id
  ) then
    raise exception 'connection_id de otra inmobiliaria' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists property_publications_connection_guard on public.property_publications;
create trigger property_publications_connection_guard
  before insert or update of connection_id, agency_id on public.property_publications
  for each row execute function public.property_publications_connection_guard();
