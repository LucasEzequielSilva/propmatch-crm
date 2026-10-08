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

---

## A · Conectar Google Calendar (OAuth, los dos sentidos)

### Cómo lo usa el agente

Agenda → «Google Calendar» → **Conectar Google Calendar** (o Configuración → Integraciones → Google Calendar). Entra con su cuenta de Google, acepta, y vuelve a `/agenda?gcal=ok`. Desde ahí:

- Lo que agenda en el CRM aparece en su Google Calendar en segundos (desde cualquier pantalla del CRM).
- Si mueve o borra en Google un evento creado por PropMatch, el CRM lo toma: con la Agenda abierta, al abrirla y cada 3 min con la pestaña visible («Sincronizar ahora» lo fuerza).
- Sus otros eventos de Google se ven en la Agenda como «Ocupado» (gris rayado, leyenda «Ocupado en Google»). Toggles «Mostrar mis otros eventos de Google» y «Mostrar sus títulos» (por defecto solo «Ocupado»), recordados en ese navegador. Cuentan para el «primer hueco libre». No se guardan en el CRM. Si se filtra la Agenda por otro asesor, no se muestran.
- Si Google revoca el acceso (lo sacó en su cuenta, cambió la contraseña, venció el modo Testing…): «Google desconectó PropMatch de tu cuenta. Volvé a conectar.»
- «Desconectar» revoca el token en Google y borra la conexión. Lo ya creado en su calendario queda ahí.

### Decisiones

- **Calendario principal (`primary`)**, no uno «PropMatch» aparte: el scope mínimo `calendar.events` no permite crear calendarios (haría falta `calendar` completo, o `calendar.app.created`, que además no deja leer el principal para el «Ocupado»). Escribir en el principal hace que el agente vea sus visitas en el celular sin configurar nada y que el «Ocupado» salga del mismo calendario. Los eventos de PropMatch se reconocen por `extendedProperties.private.propmatchId` y por el link «Ver en PropMatch». La columna `calendar_id` deja abierta la opción de elegir otro calendario.
- **Ids determinísticos**: el id del evento en Google es `pm` + base32hex(sha256(`<usuario>:<propmatchId>`)). El mismo ítem del CRM siempre va al mismo evento: reintentos, dos pestañas o dos navegadores no duplican (insert → 409 → update). El id también se guarda en el CRM (`google_event_id` en eventos y tareas).
- **Qué se sincroniza**: eventos del CRM cuyo asesor es el agente o sin asignar; visitas de la app asignadas al agente (solo CRM → Google: si las mueve en Google vuelven a su horario, porque se gestionan en la app); tareas con fecha y sin terminar (día completo, «libre»). Al conectar se suben solo los de 7 días atrás a 1 año adelante. Visita cancelada, tarea hecha o asesor cambiado → se borra de su Google.
- **Google → CRM**: cambio de horario → se aplica al evento o tarea. Borrado → una visita del CRM pasa a «Cancelada» (no se pierde el feedback), los otros eventos se borran; una tarea o visita de la app borrada en Google deja de sincronizarse (no se borra del CRM) hasta que cambie. Cambios de título o descripción en Google se ignoran (manda el CRM).
- **Conflictos: gana el último cambio.** El CRM guarda `updated_at`; Google, `updated`. Antes de pisar un evento, el servidor lo lee: si su horario no es el último que mandó este navegador (alguien lo cambió en Google) **y** ese cambio es posterior al del CRM, no lo pisa y devuelve el conflicto para que el navegador aplique lo de Google. En el pull, lo mismo al revés (`shared/gcal.ts`: `detectConflict` y `decidePullAction`). Empate → CRM.
- **Pull incremental** con `syncToken` (`events.list`): el cursor lo guarda el **navegador** (con el ledger, `localStorage` `propmatch.gcal.sync.v1:<userId>`), porque la agenda del CRM vive en cada navegador; así un segundo navegador no «se come» los cambios del primero. Hay copia en `google_calendar_connections.sync_token`. 410 → sincronización completa. El «Ocupado» se pide aparte con `timeMin/timeMax` del rango visible (`singleEvents=true`: los recurrentes vienen expandidos).

### Acciones (en `api/integrations.ts`)

- `GET gcal-status` → `{ configured, db, state, email, connectedAt, lastSyncAt, lastError }`
- `POST gcal-connect { return }` → URL de consentimiento (PKCE S256 + state). Cookie `gcal_oauth` HttpOnly, Secure, SameSite=Lax, cifrada (AES-256-GCM), `Path=/api/integrations`, 10 min.
- `GET gcal-callback` → canjea el code, verifica que se haya dado `calendar.events`, guarda tokens cifrados y vuelve a `/agenda?gcal=ok` o `?gcal=error&reason=…` (o a Integraciones). Solo rutas de una lista cerrada.
- `POST gcal-disconnect` → revoca y borra.
- `POST gcal-upsert { items }` (hasta 10) y `POST gcal-delete { items }` (hasta 20).
- `POST gcal-pull { syncToken?, pageToken?, busy?, titles? }` → cambios de eventos de PropMatch + «Ocupado» (ventana de hasta 70 días).

Refresh automático: el access token se renueva cuando le falta menos de 1 min o Google responde 401; `invalid_grant` → estado `needs_reauth`. Google a veces rota el refresh token: si viene uno nuevo, se guarda.

### Puesta en marcha (A): pasos para el dueño

**1. Proyecto en Google Cloud**
1. https://console.cloud.google.com con la cuenta de Google de la empresa → selector de proyectos → **Nuevo proyecto** («PropMatch CRM»).
2. **APIs y servicios → Biblioteca** → **Google Calendar API** → **Habilitar**.

**2. Pantalla de consentimiento** (Google Auth Platform → «Branding», ex «OAuth consent screen»)
1. Tipo de usuario: **Externo** (los agentes usan sus cuentas, Gmail o Workspace).
2. Nombre «PropMatch CRM», email de soporte, logo opcional (si lo subís, la verificación es más larga).
3. **Dominios autorizados**: el del CRM (hoy `propmatch-crm-taupe.vercel.app`). Para publicar, Google pide un dominio verificado en Search Console: conviene un **dominio propio**.
4. **Página principal, política de privacidad y términos** en ese dominio. La política tiene que decir qué datos de Google se usan (eventos del calendario: crear, editar y borrar los de PropMatch; leer el horario de los otros para mostrarlos como «Ocupado»), que no se venden ni se usan para publicidad, y cómo pedir el borrado («Desconectar» en el CRM + revocar en https://myaccount.google.com/permissions).
5. **Scopes** («Acceso a datos»): solo `openid`, `.../auth/userinfo.email` y `https://www.googleapis.com/auth/calendar.events` (este es **sensible**).

**3. Credenciales**
1. **Clientes → Crear cliente → Aplicación web**.
2. **URIs de redireccionamiento autorizados** (tienen que coincidir exacto):
   - `https://propmatch-crm-taupe.vercel.app/api/integrations/gcal-callback` (producción)
   - `http://localhost:3000/api/integrations/gcal-callback` (con `vercel dev`)
   - Previews de Vercel: cada preview tiene otra URL y Google **no acepta comodines**. Registrar una URL fija (alias de rama) y en ese entorno setear `GOOGLE_REDIRECT_URI` y `APP_URL` a esa URL; si no, probar en producción o local.
3. Copiar **ID de cliente** y **secreto**.

**4. Modo Testing (para arrancar ya)**
- Con la app en **Testing** y un scope sensible, solo conectan los **usuarios de prueba** cargados en «Público» (hasta **100** cuentas): agregá el email de Google de cada agente.
- Google muestra «Google no verificó esta app» → «Configuración avanzada» → «Ir a PropMatch CRM». Es normal en Testing.
- **Ojo**: en Testing los refresh tokens **vencen a los 7 días** → el agente ve «Volvé a conectar» una vez por semana. Se arregla publicando.

**5. Publicar y verificación de Google (scope sensible)**
1. «Público» → **Publicar app**. Con `calendar.events` Google pide **verificación** antes de quitar el aviso y el tope de 100 usuarios.
2. Piden: dominio verificado en Search Console, política de privacidad en el dominio, justificación de cada scope y un **video** (YouTube no listado) que muestre el login con la pantalla de consentimiento (con el client ID visible en la URL) y el uso del scope en el CRM (agendar una visita → aparece en Google; moverla en Google → cambia en el CRM; el «Ocupado»).
3. Suele tardar de días a algunas semanas. Al ser **sensible** (no restringido) no hace falta la auditoría de seguridad (CASA).

**6. Variables en Vercel** (Production; Preview si aplica)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: del paso 3.
- `GOOGLE_REDIRECT_URI`: opcional; por defecto `<APP_URL>/api/integrations/gcal-callback`.
- Ya existentes y necesarias: `APP_URL`, `INTEGRATIONS_ENC_KEY` (cifra los tokens, como Mercado Libre), `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- De la base del CRM: `CRM_SUPABASE_URL`, `CRM_SUPABASE_SERVICE_ROLE_KEY`.

**7. Migraciones**: en el Supabase **del CRM** (no en el de la app), en orden:
1. `supabase-crm/migrations/20261008120000_calendar_feeds.sql` (opción B)
2. `supabase-crm/migrations/20261008120100_google_calendar_connections.sql` (opción A)

Redeploy. Sin Google configurado, la tarjeta dice «Todavía no está disponible» y el link .ics sigue andando. Sin la base: «Falta configurar la base del CRM».

### Más adelante: push notifications (webhooks)

Hoy Google → CRM es por polling con la Agenda abierta. Para enterarse sin la Agenda abierta:
1. Verificar el dominio en Search Console (Google lo exige para webhooks).
2. Al conectar, y antes de que venza (`channel_expires_at`, ~7 días), `POST /calendars/primary/events/watch` con `{ id: <uuid>, type: "web_hook", address: "<APP_URL>/api/integrations/gcal-webhook", token: <aleatorio> }`; guardar `channel_id`, `channel_resource_id`, el sha256 del token y `channel_expires_at` (las columnas ya están).
3. Acción `gcal-webhook` en `api/integrations.ts` (sin función nueva): responder 200 rápido, validar `X-Goog-Channel-Id` + `X-Goog-Channel-Token` contra la fila y, con `waitUntil`, hacer el `events.list` incremental con el `sync_token` de la base. Al desconectar: `POST /channels/stop`.
4. El límite de fondo es que **la agenda del CRM vive en el navegador**: el webhook no tiene dónde aplicar los cambios. Sirve cuando la agenda pase a la base del CRM (o para dejar una cola de cambios que el navegador lee al abrir).

---

## Limitaciones

- **Depende de la base del CRM** (Supabase propio, todavía sin crear). Sin ella, ni A ni B.
- **La agenda del CRM es local por navegador** (`propmatch.store.v1:<userId>`): lo que llega de Google se aplica en el navegador que tiene la Agenda abierta. Dos navegadores del mismo agente tienen cada uno su agenda; los ids determinísticos evitan duplicados en Google, pero un evento creado solo en el navegador X no existe en el Y.
- Google → CRM solo con la Agenda abierta (polling). CRM → Google funciona desde cualquier pantalla con la sesión abierta.
- Visitas de la app: van a Google cuando la Agenda las cargó (en esa sesión para A; la última vez que se abrió la Agenda para el link .ics).
- «Gana el último cambio» compara la hora del navegador con la de Google: un reloj muy corrido puede dar un resultado raro.
- El link .ics lo relee Google cuando quiere (varias horas); no se puede forzar.
- Demo y datos de ejemplo: nunca salen hacia Google (en la demo ni se llama al servidor).

## Archivos

- `shared/gcal.ts`: todo lo puro (mapeo, validación, ids, conflictos, plan de sincronización, link .ics).
- `shared/ics.ts`: armado de .ics (antes `src/lib/ics.ts`, que ahora lo reexporta).
- `api/_lib/gcal/`: `feed.ts` (B), `routes.ts` (A), `oauth.ts` (state/PKCE), `google.ts` (HTTP a Google), `connections.ts` (tabla + refresh), `env.ts`, `db.ts`, `feedToken.ts`.
- `src/lib/gcal/`: `GoogleCalendarProvider.tsx` (en el AppLayout), `useGcalSync.ts` (A), `items.ts`, `api.ts`.
- `src/features/agenda/GoogleCalendarDialog.tsx`, `src/features/integraciones/GoogleCalendarCard.tsx`.
- Pruebas: `npm run test:gcal` (`scripts/gcal.test.ts`, sin red).
