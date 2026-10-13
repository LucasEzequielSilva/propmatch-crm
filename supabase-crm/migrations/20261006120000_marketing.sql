-- Marketing por email y WhatsApp: campañas, destinatarios, bajas y consentimientos.
--
-- OJO: va en el Supabase PROPIO del CRM (el mismo de 20261005140000_inbox_schema.sql),
-- NO en el de la app (jhtkvcxvgjwnuzfhbale). APLICADA el 2026-10-09 en ktltjpwetvdoxcaayvkh (vía MCP). Antes: lo aplica el usuario
-- siguiendo docs/marketing-puesta-en-marcha.md, DESPUÉS de las migraciones del inbox
-- (usa channel_accounts y api_rate_limits).
--
-- Modelo de acceso igual que el inbox: el navegador nunca habla con esta base.
-- Todo pasa por api/marketing (JWT de la app → agency_id) y la service role.
-- RLS habilitada y FORZADA, sin policies, y revoke a anon/authenticated.
--
-- agency_id, created_by, recorded_by son uuids de la base de la app.
-- contact_ref es el id del contacto en el CRM (hoy texto: vive en el navegador).

create extension if not exists pgcrypto;

-- Campañas -------------------------------------------------------------------

create table public.marketing_campaigns (
  id             uuid primary key default gen_random_uuid(),
  agency_id      uuid not null,
  -- id del borrador en el navegador (para no duplicar si se reenvía).
  local_id       text not null,
  name           text not null check (char_length(name) between 1 and 160),
  channel        text not null check (channel in ('email','whatsapp')),
  status         text not null default 'draft'
                 check (status in ('draft','scheduled','sending','sent','paused','cancelled')),
  -- Copia de lo que se mandó (segmento y plantilla), para auditoría.
  segment        jsonb not null default '{}'::jsonb,
  template       jsonb not null default '{}'::jsonb,
  -- { perHour, perDay, minDaysBetween }
  limits         jsonb not null default '{}'::jsonb,
  scheduled_at   timestamptz,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (agency_id, local_id)
);
create index marketing_campaigns_agency_idx on public.marketing_campaigns (agency_id, created_at desc);

-- Destinatarios (un registro por contacto y campaña) --------------------------

create table public.marketing_recipients (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null,
  campaign_id          uuid not null references public.marketing_campaigns(id) on delete cascade,
  channel              text not null check (channel in ('email','whatsapp')),
  contact_ref          text,
  contact_name         text,
  email_norm           text,
  phone_norm           text,          -- dígitos E.164 sin "+"
  is_test              boolean not null default false,
  status               text not null default 'queued'
                       check (status in ('queued','sending','sent','delivered','opened','clicked','replied',
                                         'bounced','complained','unsubscribed','failed','skipped')),
  -- Contenido ya personalizado (se borra al enviarse para no guardar HTML de más).
  subject              text,
  html                 text check (html is null or octet_length(html) <= 200000),
  text_body            text check (text_body is null or octet_length(text_body) <= 50000),
  -- WhatsApp: { name, language, params: [...] }
  wa_template          jsonb,
  send_after           timestamptz not null default now(),
  attempts             integer not null default 0,
  provider             text check (provider in ('resend','whatsapp_cloud')),
  provider_message_id  text,
  error_code           text,
  error_detail         text,
  skip_reason          text,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  opened_at            timestamptz,
  clicked_at           timestamptz,
  replied_at           timestamptz,
  unsubscribed_at      timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (email_norm is not null or phone_norm is not null)
);
create unique index marketing_recipients_campaign_contact_uidx
  on public.marketing_recipients (campaign_id, coalesce(email_norm, phone_norm)) where not is_test;
create index marketing_recipients_due_idx on public.marketing_recipients (agency_id, status, send_after);
create index marketing_recipients_campaign_idx on public.marketing_recipients (campaign_id, status);
create unique index marketing_recipients_provider_uidx
  on public.marketing_recipients (provider, provider_message_id) where provider_message_id is not null;
create index marketing_recipients_email_idx on public.marketing_recipients (agency_id, email_norm, sent_at desc) where email_norm is not null;
create index marketing_recipients_phone_idx on public.marketing_recipients (agency_id, phone_norm, sent_at desc) where phone_norm is not null;

-- Bajas -----------------------------------------------------------------------
-- Una baja vigente = revoked_at is null. Se revierte SOLO con un consentimiento
-- nuevo (resubscribe_consent_id).

create table public.marketing_unsubscribes (
  id                      uuid primary key default gen_random_uuid(),
  agency_id               uuid not null,
  scope                   text not null check (scope in ('email','whatsapp','all')),
  contact_ref             text,
  email_norm              text,
  phone_norm              text,
  source                  text not null check (source in (
                            'link_email','one_click','whatsapp_boton','whatsapp_texto','whatsapp_meta',
                            'queja_spam','rebote','manual')),
  campaign_id             uuid references public.marketing_campaigns(id) on delete set null,
  recipient_id            uuid references public.marketing_recipients(id) on delete set null,
  note                    text,
  recorded_by             uuid,
  created_at              timestamptz not null default now(),
  revoked_at              timestamptz,
  resubscribe_consent_id  uuid,
  check (email_norm is not null or phone_norm is not null or contact_ref is not null)
);
create index marketing_unsubscribes_agency_idx on public.marketing_unsubscribes (agency_id, created_at desc);
create index marketing_unsubscribes_email_idx on public.marketing_unsubscribes (agency_id, email_norm) where revoked_at is null;
create index marketing_unsubscribes_phone_idx on public.marketing_unsubscribes (agency_id, phone_norm) where revoked_at is null;

-- Consentimientos ---------------------------------------------------------------
-- Historial: no se edita, se agrega. El vigente es el último por canal/destino.

create table public.marketing_consents (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null,
  channel      text not null check (channel in ('email','whatsapp')),
  contact_ref  text,
  email_norm   text,
  phone_norm   text,
  status       text not null check (status in ('granted','revoked')),
  -- Cómo lo dio: formulario_web, whatsapp, verbal, escrito, importacion, app, otro
  method       text not null check (char_length(method) between 1 and 40),
  -- Detalle libre: "Formulario de contacto de la web, casilla marcada".
  evidence     text check (evidence is null or char_length(evidence) <= 500),
  given_at     timestamptz not null,
  recorded_by  uuid,
  created_at   timestamptz not null default now(),
  check (email_norm is not null or phone_norm is not null)
);
create index marketing_consents_email_idx on public.marketing_consents (agency_id, channel, email_norm, given_at desc) where email_norm is not null;
create index marketing_consents_phone_idx on public.marketing_consents (agency_id, channel, phone_norm, given_at desc) where phone_norm is not null;

-- Eventos crudos de proveedores (Resend) para deduplicar y reprocesar -----------

create table public.marketing_events (
  id            bigint generated always as identity primary key,
  provider      text not null,
  external_id   text not null,          -- svix-id
  type          text not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text,
  unique (provider, external_id)
);

-- updated_at -------------------------------------------------------------------

create or replace function public.marketing_set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger marketing_campaigns_updated_at before update on public.marketing_campaigns
  for each row execute function public.marketing_set_updated_at();
create trigger marketing_recipients_updated_at before update on public.marketing_recipients
  for each row execute function public.marketing_set_updated_at();

-- Reservar destinatarios para enviar (sin doble envío entre instancias) ---------

create or replace function public.marketing_claim(p_agency_id uuid, p_campaign_id uuid, p_limit integer)
returns setof public.marketing_recipients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.marketing_recipients r
     set status = 'sending', attempts = r.attempts + 1, updated_at = now()
   where r.id in (
     select id from public.marketing_recipients
      where agency_id = p_agency_id
        and campaign_id = p_campaign_id
        and status = 'queued'
        and send_after <= now()
      order by send_after, id
      limit greatest(0, least(p_limit, 500))
      for update skip locked
   )
  returning r.*;
end;
$$;

-- Destinatarios "enviando" colgados (la función murió a mitad): vuelven a la cola.
create or replace function public.marketing_release_stuck(p_minutes integer default 15)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with u as (
    update public.marketing_recipients
       set status = 'queued'
     where status = 'sending' and provider_message_id is null
       and updated_at < now() - make_interval(mins => p_minutes)
       and attempts < 3
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Seguridad: RLS forzada sin policies + revoke ---------------------------------

alter table public.marketing_campaigns    enable row level security;
alter table public.marketing_recipients   enable row level security;
alter table public.marketing_unsubscribes enable row level security;
alter table public.marketing_consents     enable row level security;
alter table public.marketing_events       enable row level security;

alter table public.marketing_campaigns    force row level security;
alter table public.marketing_recipients   force row level security;
alter table public.marketing_unsubscribes force row level security;
alter table public.marketing_consents     force row level security;
alter table public.marketing_events       force row level security;

revoke all on public.marketing_campaigns, public.marketing_recipients, public.marketing_unsubscribes,
              public.marketing_consents, public.marketing_events
  from anon, authenticated, public;
revoke all on sequence public.marketing_events_id_seq from anon, authenticated, public;
revoke all on function public.marketing_claim(uuid, uuid, integer) from anon, authenticated, public;
revoke all on function public.marketing_release_stuck(integer) from anon, authenticated, public;

grant all on public.marketing_campaigns, public.marketing_recipients, public.marketing_unsubscribes,
             public.marketing_consents, public.marketing_events
  to service_role;
grant usage, select on sequence public.marketing_events_id_seq to service_role;
grant execute on function public.marketing_claim(uuid, uuid, integer) to service_role;
grant execute on function public.marketing_release_stuck(integer) to service_role;
