-- Inbox unificado: funciones atómicas que usan las funciones de Vercel.
-- Aplicar DESPUÉS de 20261005140000_inbox_schema.sql. SIN APLICAR.
--
-- Todas son SECURITY INVOKER y solo las puede ejecutar service_role.

-- Ingesta de un mensaje (entrante, eco o saliente) ---------------------------
-- Crea/actualiza la conversación y agrega el mensaje en una sola transacción.
-- Idempotente por external_message_id: un webhook reintentado no duplica nada
-- ni vuelve a sumar "no leídos".
create or replace function public.inbox_ingest_message(
  p_agency_id          uuid,
  p_channel            text,
  p_channel_account_id uuid,
  p_thread_id          text,
  p_contact_name       text,
  p_contact_phone      text,
  p_contact_username   text,
  p_direction          text,
  p_type               text,
  p_body               text,
  p_media_id           text,
  p_media_url          text,
  p_media_mime         text,
  p_external_id        text,
  p_created_at         timestamptz,
  p_echo               boolean default false,
  p_status             text default null,
  p_template_name      text default null,
  p_template_language  text default null,
  p_sent_by            uuid default null,
  p_count_unread       boolean default true
)
returns table (message_id uuid, conversation_id uuid, inserted boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_conv uuid;
  v_msg  uuid;
  v_at   timestamptz := coalesce(p_created_at, now());
  v_preview text := left(coalesce(nullif(p_body, ''), case p_type
                      when 'image' then '📷 Foto'
                      when 'audio' then '🎤 Audio'
                      when 'video' then '🎬 Video'
                      when 'document' then '📄 Documento'
                      when 'sticker' then 'Sticker'
                      when 'location' then '📍 Ubicación'
                      when 'template' then 'Plantilla: ' || coalesce(p_template_name, '')
                      else 'Mensaje' end), 140);
begin
  insert into public.conversations as c
    (agency_id, channel, channel_account_id, external_thread_id, contact_name, contact_phone, contact_username)
  values
    (p_agency_id, p_channel, p_channel_account_id, p_thread_id, p_contact_name, p_contact_phone, p_contact_username)
  on conflict (channel_account_id, external_thread_id) do update
    set contact_name     = coalesce(excluded.contact_name, c.contact_name),
        contact_phone    = coalesce(c.contact_phone, excluded.contact_phone),
        contact_username = coalesce(excluded.contact_username, c.contact_username)
  returning c.id into v_conv;

  insert into public.messages
    (agency_id, conversation_id, direction, type, body, media_id, media_url, media_mime,
     template_name, template_language, external_message_id, status, status_at, echo, sent_by, created_at)
  values
    (p_agency_id, v_conv, p_direction, p_type, p_body, p_media_id, p_media_url, p_media_mime,
     p_template_name, p_template_language, p_external_id, p_status,
     case when p_status is null then null else now() end, coalesce(p_echo, false), p_sent_by, v_at)
  on conflict (external_message_id) where external_message_id is not null do nothing
  returning id into v_msg;

  if v_msg is null then
    -- Ya estaba: reintento del webhook.
    select m.id into v_msg from public.messages m where m.external_message_id = p_external_id;
    return query select v_msg, v_conv, false;
    return;
  end if;

  update public.conversations c set
    last_message_at        = greatest(coalesce(c.last_message_at, v_at), v_at),
    last_message_preview   = case when c.last_message_at is null or v_at >= c.last_message_at then v_preview else c.last_message_preview end,
    last_message_direction = case when c.last_message_at is null or v_at >= c.last_message_at then p_direction else c.last_message_direction end,
    last_inbound_at        = case when p_direction = 'in' then greatest(coalesce(c.last_inbound_at, v_at), v_at) else c.last_inbound_at end,
    unread_count           = case when p_direction = 'in' and p_count_unread then c.unread_count + 1
                                  -- Si el negocio respondió (CRM o celular), ya lo vio.
                                  when p_direction = 'out' and v_at >= coalesce(c.last_inbound_at, v_at) then 0
                                  else c.unread_count end,
    status                 = 'open'
  where c.id = v_conv;

  return query select v_msg, v_conv, true;
end;
$$;

-- Estado de entrega (solo avanza: sent → delivered → read) --------------------
create or replace function public.inbox_status_rank(p text)
returns integer
language sql immutable
as $$
  select case p when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else -1 end;
$$;

create or replace function public.inbox_apply_status(
  p_external_id text,
  p_status      text,
  p_at          timestamptz,
  p_error_code  text default null,
  p_error_title text default null
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_found boolean;
begin
  update public.messages m set
    status      = p_status,
    status_at   = coalesce(p_at, now()),
    error_code  = case when p_status = 'failed' then p_error_code else m.error_code end,
    error_title = case when p_status = 'failed' then p_error_title else m.error_title end
  where m.external_message_id = p_external_id
    and (
      (p_status = 'failed' and coalesce(m.status, 'pending') in ('pending','sent'))
      or (p_status <> 'failed' and coalesce(m.status, 'pending') <> 'failed'
          and public.inbox_status_rank(p_status) > public.inbox_status_rank(coalesce(m.status, 'pending')))
    );
  get diagnostics v_found = row_count;
  if v_found then return true; end if;
  -- ¿Existe pero el estado no avanza? Entonces no es "no encontrado".
  return exists (select 1 from public.messages where external_message_id = p_external_id);
end;
$$;

-- Rate limit de ventana fija: true = permitido ------------------------------
create or replace function public.inbox_rate_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.api_rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- Limpieza: eventos procesados y contadores viejos ---------------------------
-- Correr a mano o con pg_cron (ver docs). No borra eventos con error.
create or replace function public.inbox_purge(p_days integer default 30)
returns void
language sql
set search_path = public, pg_temp
as $$
  delete from public.webhook_events where processed_at is not null and error is null
    and received_at < now() - make_interval(days => p_days);
  delete from public.api_rate_limits where window_start < now() - interval '1 day';
$$;

revoke execute on function
  public.inbox_ingest_message(uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text,
                              timestamptz, boolean, text, text, text, uuid, boolean),
  public.inbox_apply_status(text, text, timestamptz, text, text),
  public.inbox_rate_hit(text, integer, integer),
  public.inbox_purge(integer),
  public.inbox_status_rank(text)
from public, anon, authenticated;

grant execute on function
  public.inbox_ingest_message(uuid, text, uuid, text, text, text, text, text, text, text, text, text, text, text,
                              timestamptz, boolean, text, text, text, uuid, boolean),
  public.inbox_apply_status(text, text, timestamptz, text, text),
  public.inbox_rate_hit(text, integer, integer),
  public.inbox_purge(integer),
  public.inbox_status_rank(text)
to service_role;
