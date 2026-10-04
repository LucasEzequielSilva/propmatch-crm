-- ════════════════════════════════════════════════════════════════════════════
-- INBOX: RESPUESTAS RÁPIDAS Y AUTOMATIZACIONES — BORRADOR. NO APLICADO.
--
-- Hoy las reglas viven en localStorage (src/features/inbox/automationStore.ts,
-- interfaz `AutomationStore`) y solo se ejecutan con PropMatch abierto. Este
-- borrador es el modo servidor: reglas compartidas por todo el equipo y envío
-- 24/7. Revisar con Lucas antes de aplicar. Usa el esquema real de la app:
-- agencies, agency_members(role text), messages, matches, is_agency_member().
-- ════════════════════════════════════════════════════════════════════════════

-- ── Respuestas rápidas ──────────────────────────────────────────────────────
create table public.inbox_snippets (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 60),
  body        text not null check (char_length(body) between 1 and 1000),
  position    int  not null default 0,
  factory_id  text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index inbox_snippets_agency_idx on public.inbox_snippets (agency_id, position);

-- ── Reglas ──────────────────────────────────────────────────────────────────
create table public.inbox_automations (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  trigger     text not null check (trigger in ('first_message','off_hours','new_match','no_reply')),
  enabled     boolean not null default false,
  -- Solo 'app' por ahora; los demás canales se suman al conectar cuentas.
  channel     text not null default 'app' check (channel in ('app','whatsapp','instagram','mercadolibre','zonaprop','web')),
  template    text not null check (char_length(template) between 1 and 1000),
  -- delayMin, afterHours, firma, filtros (operaciones / propiedades) y horario de atención.
  config      jsonb not null default '{}'::jsonb,
  -- Para no responder a hechos anteriores a que la regla se prendiera.
  enabled_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index inbox_automations_agency_idx on public.inbox_automations (agency_id, enabled);

-- ── Registro de envíos (idempotencia real) ──────────────────────────────────
create table public.inbox_automation_log (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references public.agencies(id) on delete cascade,
  automation_id uuid not null references public.inbox_automations(id) on delete cascade,
  match_id      uuid not null references public.matches(id) on delete cascade,
  -- Mensaje creado: permite marcar "Automático" de forma confiable en el chat.
  message_id    uuid,
  sent_at       timestamptz not null default now(),
  status        text not null check (status in ('pending','ok','error')),
  attempts      int  not null default 1,
  error         text,
  -- Una fila por regla+conversación: dos navegadores o dos corridas no duplican.
  -- "Fuera de horario" (1 cada 12 h) actualiza sent_at en vez de insertar otra fila.
  unique (automation_id, match_id)
);
create index inbox_automation_log_agency_idx on public.inbox_automation_log (agency_id, sent_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.inbox_snippets       enable row level security;
alter table public.inbox_automations    enable row level security;
alter table public.inbox_automation_log enable row level security;

-- Lectura: cualquier miembro de la agencia.
create policy inbox_snippets_read on public.inbox_snippets
  for select to authenticated using (public.is_agency_member(agency_id));
create policy inbox_automations_read on public.inbox_automations
  for select to authenticated using (public.is_agency_member(agency_id));
create policy inbox_automation_log_read on public.inbox_automation_log
  for select to authenticated using (public.is_agency_member(agency_id));

-- Respuestas rápidas: las edita cualquier miembro.
create policy inbox_snippets_write on public.inbox_snippets
  for all to authenticated
  using (public.is_agency_member(agency_id))
  with check (public.is_agency_member(agency_id));

-- Reglas: solo admin de la agencia (agency_members.role = 'admin').
create policy inbox_automations_admin_write on public.inbox_automations
  for all to authenticated
  using (exists (select 1 from public.agency_members m
                 where m.agency_id = inbox_automations.agency_id and m.user_id = auth.uid() and m.role = 'admin'))
  with check (exists (select 1 from public.agency_members m
                 where m.agency_id = inbox_automations.agency_id and m.user_id = auth.uid() and m.role = 'admin'));

-- El log NO tiene política de escritura para usuarios: solo lo escribe el
-- servidor con service role (que ignora RLS).

-- ── Cómo correría 24/7 ──────────────────────────────────────────────────────
-- Tarea programada en el servidor (cron de Vercel o pg_cron + Edge Function),
-- cada 1 minuto, con service role:
--   1. Leer reglas enabled por agencia, matches y últimos mensajes.
--   2. Calcular los envíos con la MISMA lógica pura de
--      src/features/inbox/automationEngine.ts (`planAutomations`), compartida
--      entre cliente y servidor.
--   3. Por cada envío: insert en inbox_automation_log (status 'pending') con
--      on conflict (automation_id, match_id) do nothing; si insertó, crear el
--      mensaje en `messages` y pasar a 'ok' o 'error'. Si la fila ya existía,
--      otra corrida se ocupó: no se envía.
--   4. Re-leer los mensajes del match justo antes de enviar y abortar si un
--      agente ya respondió.
-- Cuando exista este modo, el runner del navegador debe apagarse para no
-- duplicar (o quedar solo de respaldo, apoyado en la misma tabla de log).
-- Pendiente de definir con Lucas: qué sender_id usa un mensaje del servidor
-- (messages_agency_send hoy exige un usuario real de la agencia).
