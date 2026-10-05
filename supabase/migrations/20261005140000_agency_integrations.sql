-- ════════════════════════════════════════════════════════════════════════════
-- agency_integrations: cuentas externas conectadas por cada inmobiliaria
-- (Mercado Libre hoy; Meta, Zonaprop, etc. más adelante).
--
-- SIN APLICAR. Aplicar solo con aprobación de Lucas (la base es compartida con
-- la app). Requiere que ya estén aplicadas 20261004110000_crm_agency_integration
-- (agencies, agency_members, is_agency_member) y 20261004120000_property_publications.
-- Es aditiva: crea una tabla nueva y no toca nada existente.
--
-- POR QUÉ LOS TOKENS NUNCA SON LEGIBLES DESDE EL NAVEGADOR
--   1. Se guardan CIFRADOS (AES-256-GCM, clave INTEGRATIONS_ENC_KEY solo en el
--      servidor): aun si se filtrara la fila, no sirven sin la clave.
--   2. Grants por columna: `authenticated` solo puede hacer SELECT de columnas
--      "seguras". `access_token_enc` y `refresh_token_enc` no están en la lista,
--      así que `select *` o pedirlas explícitamente falla con permission denied.
--   3. `anon` no tiene nada y `authenticated` no tiene INSERT/UPDATE/DELETE:
--      escribe únicamente el backend (api/meli/*) con la service role.
-- ════════════════════════════════════════════════════════════════════════════

create table public.agency_integrations (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null references public.agencies(id) on delete cascade,
  provider            text not null check (provider in
                        ('mercadolibre','meta','whatsapp','zonaprop','argenprop','cabaprop','properati')),
  status              text not null default 'connected' check (status in ('connected','needs_reauth','error')),
  external_account_id text,
  account_label       text,
  access_token_enc    text,            -- cifrado, iv.tag.cipher (base64url)
  refresh_token_enc   text,            -- cifrado
  expires_at          timestamptz,
  scopes              text[],
  connected_by        uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (agency_id, provider)
);

-- Una cuenta externa pertenece a una sola inmobiliaria: las notificaciones de
-- Mercado Libre solo traen el user_id y así se resuelve la agencia sin ambigüedad.
create unique index agency_integrations_provider_account_uidx
  on public.agency_integrations (provider, external_account_id)
  where external_account_id is not null;

create or replace function public.agency_integrations_touch()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger agency_integrations_touch
  before update on public.agency_integrations
  for each row execute function public.agency_integrations_touch();

alter table public.agency_integrations enable row level security;

-- Sacar todo y devolver solo lo mínimo, columna por columna.
revoke all on public.agency_integrations from public, anon, authenticated;
grant select (id, agency_id, provider, status, external_account_id, account_label,
              expires_at, connected_by, created_at, updated_at)
  on public.agency_integrations to authenticated;
grant all on public.agency_integrations to service_role;

-- Los miembros de la agencia ven el ESTADO de la conexión (sin tokens).
create policy agency_integrations_select on public.agency_integrations
  for select to authenticated
  using (public.is_agency_member(agency_id));

-- Sin policies de INSERT/UPDATE/DELETE para authenticated: solo la service role escribe.

-- Búsqueda de la publicación por id externo (notificaciones de Mercado Libre).
create index if not exists property_publications_external_idx
  on public.property_publications (channel, external_id)
  where external_id is not null;
