-- Conexión directa con Google Calendar, una por agente (opción A).
--
-- OJO: va en el Supabase PROPIO del CRM (el de 20261005140000_inbox_schema.sql),
-- NO en el de la app. SIN APLICAR: lo aplica el usuario siguiendo
-- docs/google-calendar.md (después de 20261008120000_calendar_feeds.sql).
--
-- Mismo modelo de acceso que el inbox: el navegador nunca habla con esta base.
-- Todo pasa por api/integrations (JWT de la app → usuario/agencia) con la
-- service role. RLS habilitada y FORZADA, sin policies, y revoke a anon/authenticated.
--
-- Tokens de Google cifrados con AES-256-GCM (INTEGRATIONS_ENC_KEY, formato
-- iv.tag.cipher en base64url): acá nunca hay un token en claro.
-- app_user_id / agency_id son uuids de la base de la app.

create table public.google_calendar_connections (
  app_user_id              uuid primary key,
  agency_id                uuid not null,
  google_email             text,
  -- `sub` del id_token: identifica la cuenta de Google aunque cambie el email.
  google_sub               text,
  refresh_token_enc        text not null,
  access_token_enc         text,
  access_token_expires_at  timestamptz,
  scopes                   text[],
  -- Calendario donde escribe PropMatch. Hoy siempre 'primary' (el scope mínimo
  -- calendar.events no permite crear calendarios).
  calendar_id              text not null default 'primary',
  -- Último nextSyncToken de events.list. Hoy el cursor lo maneja el navegador
  -- (la agenda del CRM es local); queda acá para las push notifications.
  sync_token               text,
  -- Push notifications (events.watch), para más adelante: ver docs.
  channel_id               text unique,
  channel_resource_id      text,
  channel_token_hash       text,
  channel_expires_at       timestamptz,
  status                   text not null default 'connected'
                           check (status in ('connected','needs_reauth','error')),
  last_error               text check (last_error is null or char_length(last_error) <= 300),
  last_sync_at             timestamptz,
  connected_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index google_calendar_connections_agency on public.google_calendar_connections (agency_id);

-- Seguridad: RLS forzada sin policies + revoke ---------------------------------

alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_connections force row level security;

revoke all on public.google_calendar_connections from anon, authenticated, public;
grant all on public.google_calendar_connections to service_role;
