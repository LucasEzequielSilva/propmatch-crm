# Google Calendar en la Agenda

Cada agente ve su agenda del CRM en **su** Google Calendar. Hay dos caminos, y se pueden usar los dos:

| | B · Link de suscripción (.ics) | A · Conectar Google Calendar |
|---|---|---|
| Qué hace | Google lee un link privado con tu agenda | PropMatch escribe en tu calendario y lee tus cambios |
| Sentido | CRM → Google | CRM ↔ Google (los dos sentidos) |
| Demora | Google lo relee cada varias horas (lo decide Google) | Al instante (CRM → Google) / cada 3 min con la Agenda abierta (Google → CRM) |
| Lo que necesita | La base del CRM | La base del CRM + un proyecto en Google Cloud con la pantalla de consentimiento verificada |
| Lo ve en la Agenda | — | Tus otros eventos de Google como «Ocupado» |

En los dos casos va **solo lo del agente** (eventos y visitas cuyo asesor es él o sin asignar, visitas de la app asignadas a él y tareas con fecha), **sin datos de ejemplo ni de la demo**, y con lo mínimo: título, horario, tipo/estado, nombre del cliente, título y dirección de la propiedad y un link a `/agenda`. **Nunca** precios, notas internas, teléfonos ni ids de la base.

---

## B · Link de suscripción (.ics)

### Cómo lo usa el agente

1. Agenda → «Google Calendar» → **Generar mi link** (o Configuración → Integraciones → Google Calendar).
2. Copia el link. Se muestra **una sola vez** (en la base queda solo el hash); este navegador lo recuerda para poder copiarlo de nuevo.
3. En Google Calendar (en la compu): **Otros calendarios → + → Desde URL** → pega el link → «Agregar calendario». Aparece como «PropMatch — Mi agenda».
4. «Generar link nuevo» invalida el anterior al instante (hay que volver a suscribirse). «Desactivar» lo apaga.

Google vuelve a leer los calendarios por URL cada varias horas (no se puede forzar). Para que sea al instante: opción A.

### Cómo funciona

- El navegador arma el snapshot (30 días atrás → 6 meses adelante, hasta 500 ítems) y lo manda a `POST /api/integrations/gcal-feed-push` al abrir la Agenda y después de cada cambio en eventos / visitas / tareas (con debounce de 3 s), **solo si el agente activó el link**. Lo arma el `GoogleCalendarProvider` del AppLayout, así que los cambios hechos desde otras pantallas también se mandan. Las visitas de la app se cargan en la Agenda: las otras pantallas usan las últimas que vio la Agenda en ese navegador.
- El servidor valida cada ítem (`shared/gcal.ts → parseFeedBody`: descarta lo roto, los campos de más y lo que está fuera de la ventana; tope de cuerpo 400 KB; un push cada 5 s por agente → 429) y guarda los ítems en `calendar_feeds.events` (jsonb). **El navegador nunca manda texto .ics.**
- `GET /api/integrations/calendar/<token>.ics` (público, rewrite en `vercel.json` → `/api/integrations?action=calendar-feed`) busca el `sha256(token)` en filas no revocadas y arma el .ics con `shared/ics.ts`. `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex`. Cualquier problema (token mal formado, inexistente, revocado, base sin configurar) → `404 Not found` sin más detalle.
- UID estable por ítem (`pm-event-<id>@propmatch`, `pm-task-<id>@propmatch`, `pm-visit-<uuid>@propmatch`): Google actualiza el evento en vez de duplicarlo.
- Tareas: evento de día completo (`VALUE=DATE`, `TRANSP:TRANSPARENT`, no marcan ocupado).

### Acciones (todas en `api/integrations.ts`, ninguna función nueva de Vercel)

| Acción | Quién | Qué |
|---|---|---|
| `GET gcal-feed-status` | el agente | `{ db, active, createdAt, pushedAt, eventCount }` (nunca el link) |
| `POST gcal-feed-create { items? }` | el agente | crea el link y devuelve `{ url }` una vez (409 si ya hay uno activo) |
| `POST gcal-feed-rotate { items? }` | el agente | revoca el activo y crea otro (conserva los eventos si no vienen) |
| `POST gcal-feed-revoke` | el agente | desactiva el link |
| `POST gcal-feed-push { items }` | el agente | guarda el snapshot |
| `GET /api/integrations/calendar/<token>.ics` | público | el .ics |

### Puesta en marcha (B)

1. Tener creado el **Supabase propio del CRM** (el del inbox) y cargadas en Vercel `CRM_SUPABASE_URL` y `CRM_SUPABASE_SERVICE_ROLE_KEY` (además de `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `APP_URL`, que ya están).
2. Aplicar en **esa** base (no en la de la app) `supabase-crm/migrations/20261008120000_calendar_feeds.sql`.
3. Redeploy. Sin la base configurada (o sin la migración), la Agenda muestra «Falta configurar la base del CRM» y nada se rompe.

### Seguridad

- Token de 32 bytes aleatorios (base64url, 43 caracteres); en la base solo el sha256. Si se filtra la base, los links no.
- Quien tenga el link ve la agenda de ese agente (es la forma en que funcionan los calendarios por URL). Por eso: datos mínimos, rotación con un clic y aviso en la UI de no compartirlo.
- El link se recuerda en el `localStorage` del navegador del agente (`propmatch.gcal.feed.v1:<userId>`) solo para poder copiarlo otra vez. Al cerrar sesión no se borra (igual que los datos del CRM, que también son locales por cuenta).
- Tabla `calendar_feeds` con RLS forzada sin policies y `revoke` a `anon`/`authenticated`: solo la service role. **No** se usa el bucket `property-photos` (es público y listable).
- Si un agente deja la inmobiliaria, su link sigue sirviendo el último snapshot hasta que alguien lo revoque (pendiente: revocar al sacar al miembro).
