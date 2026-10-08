-- Link de suscripción iCal por agente (Agenda → «Suscribir en Google Calendar»).
--
-- OJO: va en el Supabase PROPIO del CRM (el de 20261005140000_inbox_schema.sql),
-- NO en el de la app. SIN APLICAR: lo aplica el usuario siguiendo
-- docs/google-calendar.md.
--
-- Modelo de acceso igual que el inbox: el navegador nunca habla con esta base.
-- Todo pasa por api/integrations (JWT de la app → usuario/agencia) con la
-- service role. RLS habilitada y FORZADA, sin policies, y revoke a anon/authenticated.
--
-- token_hash: sha256 (hex) del token del link. El token en sí NO se guarda:
-- se le muestra una vez al agente. Rotar = revocar la fila y crear otra.
-- events: ítems ya validados por el servidor (shared/gcal.ts → parseFeedBody):
-- título, horario, tipo, cliente, propiedad y dirección. Nada de precios ni notas.
-- app_user_id / agency_id son uuids de la base de la app.

create extension if not exists pgcrypto;

create table public.calendar_feeds (
  id           uuid primary key default gen_random_uuid(),
  app_user_id  uuid not null,
  agency_id    uuid not null,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  events       jsonb not null default '[]'::jsonb check (jsonb_typeof(events) = 'array'),
  event_count  integer not null default 0 check (event_count between 0 and 500),
  pushed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

-- Un solo link activo por agente.
create unique index calendar_feeds_one_active on public.calendar_feeds (app_user_id) where revoked_at is null;
create index calendar_feeds_agency on public.calendar_feeds (agency_id);

-- Seguridad: RLS forzada sin policies + revoke ---------------------------------

alter table public.calendar_feeds enable row level security;
alter table public.calendar_feeds force row level security;

revoke all on public.calendar_feeds from anon, authenticated, public;
grant all on public.calendar_feeds to service_role;
