-- ════════════════════════════════════════════════════════════════════════════
-- agency_integrations — BORRADOR. NO APLICADO. NO es una migración.
--
-- Cuentas externas conectadas por cada inmobiliaria (Mercado Libre, etc.).
-- Aplicar solo con aprobación de Lucas (la base es compartida con la app).
--
-- POR QUÉ LOS TOKENS NUNCA SON LEGIBLES DESDE EL NAVEGADOR
--   1. Se guardan CIFRADOS (AES-256-GCM, clave INTEGRATIONS_ENC_KEY solo en el
--      servidor): aun si se filtrara la fila, no sirven sin la clave.
--   2. Grants por columna: `authenticated` solo puede hacer SELECT de columnas
--      "seguras". `access_token_enc` y `refresh_token_enc` no están en la lista,
--      así que `select *` o pedirlas explícitamente falla con permission denied.
--   3. `authenticated` no tiene INSERT/UPDATE/DELETE: escribe únicamente el
--      backend (api/meli/*) con la service role, que se saltea RLS y grants.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.agency_integrations (
  id                 uuid primary key default gen_random_uuid(),
  agency_id          uuid not null references public.agencies(id) on delete cascade,
  provider           text not null check (provider in
                       ('mercadolibre','meta','whatsapp','zonaprop','argenprop','cabaprop','properati')),
  status             text not null default 'connected' check (status in ('connected','needs_reauth','error')),
  external_account_id text,
  account_label      text,
  access_token_enc   text,            -- cifrado, iv.tag.cipher (base64url)
  refresh_token_enc  text,            -- cifrado
  expires_at         timestamptz,
  scopes             text[],
  connected_by       uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (agency_id, provider)
);

create or replace function public.agency_integrations_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_agency_integrations_updated_at on public.agency_integrations;
create trigger trg_agency_integrations_updated_at
  before update on public.agency_integrations
  for each row execute function public.agency_integrations_set_updated_at();

alter table public.agency_integrations enable row level security;

-- Sacar todo y devolver solo lo mínimo, columna por columna.
revoke all on public.agency_integrations from anon, authenticated;
grant select (id, agency_id, provider, status, external_account_id, account_label,
              expires_at, connected_by, created_at, updated_at)
  on public.agency_integrations to authenticated;

-- Los miembros de la agencia ven el ESTADO de la conexión (sin tokens).
drop policy if exists agency_integrations_select on public.agency_integrations;
create policy agency_integrations_select on public.agency_integrations
  for select to authenticated
  using (public.is_agency_member(agency_id));

-- Sin policies de INSERT/UPDATE/DELETE: solo la service role escribe.
