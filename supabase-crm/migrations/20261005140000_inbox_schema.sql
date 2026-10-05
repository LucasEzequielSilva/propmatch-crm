-- Inbox unificado: esquema base del Supabase PROPIO del CRM.
--
-- OJO: esto NO va en el Supabase de la app (jhtkvcxvgjwnuzfhbale). Va en el
-- proyecto nuevo del CRM. SIN APLICAR: lo aplica el usuario siguiendo
-- docs/inbox-unificado-puesta-en-marcha.md.
--
-- Modelo de acceso: el navegador NUNCA habla con esta base. Todo pasa por las
-- funciones de Vercel (api/inbox/*, api/whatsapp/*, api/meta/*), que validan
-- el JWT del usuario contra el Supabase de la app, resuelven su agency_id y
-- usan la service role de esta base. Por eso: RLS habilitada en todas las
-- tablas y CERO policies para anon/authenticated (todo denegado), más revoke
-- explícito de privilegios por si alguien agrega una policy por error.
--
-- agency_id / assigned_to / connected_by / sent_by son uuids de la base de la
-- app: no hay foreign key posible entre proyectos.

create extension if not exists pgcrypto;

create or replace function public.inbox_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Cuentas de canal conectadas -----------------------------------------------

create table public.channel_accounts (
  id                uuid primary key default gen_random_uuid(),
  agency_id         uuid not null,
  channel           text not null check (channel in ('whatsapp','instagram','messenger')),
  status            text not null default 'connected'
                    check (status in ('pending','connected','disconnected','error','needs_reauth')),
  -- Lo que se muestra en la UI.
  display_name      text,
  display_phone     text,
  username          text,
  -- Ids externos de Meta (según el canal).
  business_id       text,          -- Business Portfolio del cliente
  waba_id           text,          -- WhatsApp Business Account
  phone_number_id   text,          -- número de WhatsApp en Cloud API
  page_id           text,          -- Página de Facebook (Messenger, e IG vía FB Login)
  ig_user_id        text,          -- cuenta profesional de Instagram
  -- Coexistencia: el número sigue activo en la app WhatsApp Business del celular.
  coexistence       boolean not null default false,
  -- Token de acceso (business/system user o page token), cifrado AES-256-GCM
  -- en el servidor con INBOX_ENC_KEY. Nunca se selecciona hacia el cliente.
  access_token_enc  text,
  token_expires_at  timestamptz,
  -- PIN de verificación en dos pasos que fijamos al registrar el número en
  -- Cloud API (no aplica en coexistencia). Cifrado igual que el token.
  wa_pin_enc        text,
  last_error        text,
  connected_by      uuid,
  connected_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index channel_accounts_agency_idx on public.channel_accounts (agency_id, channel);
-- Un número / página / cuenta IG pertenece a una sola agencia a la vez.
create unique index channel_accounts_wa_phone_uidx
  on public.channel_accounts (phone_number_id)
  where channel = 'whatsapp' and phone_number_id is not null and status <> 'disconnected';
create unique index channel_accounts_page_uidx
  on public.channel_accounts (page_id)
  where channel = 'messenger' and page_id is not null and status <> 'disconnected';
create unique index channel_accounts_ig_uidx
  on public.channel_accounts (ig_user_id)
  where channel = 'instagram' and ig_user_id is not null and status <> 'disconnected';
create index channel_accounts_waba_idx on public.channel_accounts (waba_id) where waba_id is not null;

create trigger channel_accounts_updated_at
  before update on public.channel_accounts
  for each row execute function public.inbox_set_updated_at();

-- Conversaciones -------------------------------------------------------------

create table public.conversations (
  id                    uuid primary key default gen_random_uuid(),
  agency_id             uuid not null,
  channel               text not null check (channel in ('whatsapp','instagram','messenger')),
  channel_account_id    uuid not null references public.channel_accounts(id) on delete cascade,
  -- WhatsApp: wa_id del cliente. Instagram: IGSID. Messenger: PSID.
  external_thread_id    text not null,
  contact_name          text,
  contact_phone         text,
  contact_username      text,
  -- Id del contacto en el CRM (texto: hoy los contactos viven fuera de esta base).
  crm_contact_id        text,
  last_message_at       timestamptz,
  last_message_preview  text,
  last_message_direction text check (last_message_direction in ('in','out')),
  -- Último mensaje ENTRANTE: abre la ventana de 24 h de atención al cliente.
  last_inbound_at       timestamptz,
  unread_count          integer not null default 0 check (unread_count >= 0),
  assigned_to           uuid,
  status                text not null default 'open' check (status in ('open','closed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (channel_account_id, external_thread_id)
);

create index conversations_agency_last_idx on public.conversations (agency_id, last_message_at desc nulls last);
create index conversations_agency_channel_idx on public.conversations (agency_id, channel, last_message_at desc nulls last);
create index conversations_agency_phone_idx on public.conversations (agency_id, contact_phone) where contact_phone is not null;
create index conversations_crm_contact_idx on public.conversations (agency_id, crm_contact_id) where crm_contact_id is not null;

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.inbox_set_updated_at();

-- Mensajes -------------------------------------------------------------------

create table public.messages (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null,
  conversation_id      uuid not null references public.conversations(id) on delete cascade,
  direction            text not null check (direction in ('in','out')),
  type                 text not null default 'text'
                       check (type in ('text','image','audio','video','document','sticker','location',
                                       'contacts','template','interactive','reaction','button','unsupported','system')),
  body                 text,
  -- Media: WhatsApp manda un media id (se baja con token vía api/inbox/messages?media=);
  -- IG/Messenger mandan una URL temporal de CDN.
  media_id             text,
  media_url            text,
  media_mime           text,
  template_name        text,
  template_language    text,
  -- wamid (WhatsApp) o mid (IG/Messenger). Único: idempotencia de webhooks y reintentos.
  external_message_id  text,
  status               text check (status in ('pending','sent','delivered','read','failed','received')),
  status_at            timestamptz,
  error_code           text,
  error_title          text,
  -- Mensaje mandado desde la app WhatsApp Business del celular (coexistencia)
  -- o desde Meta Business Suite: no lo escribió nadie en el CRM.
  echo                 boolean not null default false,
  sent_by              uuid,
  created_at           timestamptz not null default now(),
  received_at          timestamptz not null default now()
);

create unique index messages_external_uidx on public.messages (external_message_id) where external_message_id is not null;
create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_agency_idx on public.messages (agency_id, created_at desc);

-- Eventos crudos de webhooks (debug / reintentos) ------------------------------

create table public.webhook_events (
  id               bigint generated always as identity primary key,
  provider         text not null check (provider in ('whatsapp','instagram','messenger','unknown')),
  object           text,
  signature_valid  boolean not null,
  payload          jsonb not null,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  attempts         integer not null default 0,
  error            text
);

create index webhook_events_pending_idx on public.webhook_events (received_at) where processed_at is null;
create index webhook_events_received_idx on public.webhook_events (received_at desc);

-- Plantillas de WhatsApp (espejo de las aprobadas en el WABA) ----------------

create table public.message_templates (
  id                  uuid primary key default gen_random_uuid(),
  agency_id           uuid not null,
  channel_account_id  uuid not null references public.channel_accounts(id) on delete cascade,
  waba_id             text not null,
  external_id         text,
  name                text not null,
  language            text not null,
  category            text,           -- MARKETING | UTILITY | AUTHENTICATION
  status              text not null,  -- APPROVED | PENDING | REJECTED | PAUSED | DISABLED ...
  components          jsonb not null default '[]'::jsonb,
  -- Cantidad de variables {{n}} del BODY, precalculada al sincronizar.
  body_params         integer not null default 0,
  synced_at           timestamptz not null default now(),
  unique (channel_account_id, name, language)
);

create index message_templates_agency_idx on public.message_templates (agency_id, status);

-- Rate limit básico (ventana fija) --------------------------------------------

create table public.api_rate_limits (
  key           text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (key, window_start)
);

-- Seguridad: RLS sin policies + revoke ---------------------------------------

alter table public.channel_accounts  enable row level security;
alter table public.conversations     enable row level security;
alter table public.messages          enable row level security;
alter table public.webhook_events    enable row level security;
alter table public.message_templates enable row level security;
alter table public.api_rate_limits   enable row level security;

alter table public.channel_accounts  force row level security;
alter table public.conversations     force row level security;
alter table public.messages          force row level security;
alter table public.webhook_events    force row level security;
alter table public.message_templates force row level security;
alter table public.api_rate_limits   force row level security;

revoke all on public.channel_accounts, public.conversations, public.messages,
              public.webhook_events, public.message_templates, public.api_rate_limits
  from anon, authenticated, public;
revoke all on sequence public.webhook_events_id_seq from anon, authenticated, public;

grant all on public.channel_accounts, public.conversations, public.messages,
             public.webhook_events, public.message_templates, public.api_rate_limits
  to service_role;
grant usage, select on sequence public.webhook_events_id_seq to service_role;
