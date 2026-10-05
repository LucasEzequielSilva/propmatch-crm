# Inbox unificado: puesta en marcha (WhatsApp, Instagram y Messenger)

Investigado el 2026-10-05 en la documentación oficial de Meta. Meta está mudando la doc de WhatsApp de `developers.facebook.com/docs/whatsapp/...` a `developers.facebook.com/documentation/business-messaging/whatsapp/...` y por ahora responden las dos rutas. Si el App Dashboard dice otra cosa el día que lo cargues, vale el Dashboard.

Convenciones: **[V]** está confirmado en la doc oficial (con URL). **[NV]** no lo pude confirmar en la doc oficial.

Ya está hecho en el código (rama `feat/inbox-unificado`):
- webhooks;
- envío;
- Embedded Signup;
- UI del inbox;
- Configuración → Canales.

Todo lo de este documento depende de vos: crear cuentas, cargar credenciales y aplicar SQL.

---

## 0. Cómo queda armado

```
 Navegador (CRM)                         Vercel (api/)                                   Bases
 ───────────────                         ─────────────                                   ─────
 Login Supabase APP ──JWT──►  api/inbox/*  ──auth.getUser(JWT)──────────────►  Supabase APP (jhtkvcxvgjwnuzfhbale)
                                          ──agency_members (lectura)──────►      (no se toca)
                                          ──service role──────────────────►  Supabase CRM (nuevo)
                                                                               channel_accounts, conversations,
                                                                               messages, webhook_events,
                                                                               message_templates, api_rate_limits
 FB JS SDK (Embedded Signup) ─code─► api/whatsapp/onboard ──Graph API──► Meta (token, WABA, número)
 FB JS SDK (FB Login Business) ─code─► api/meta/connect  ──Graph API──► Meta (Páginas, IG)
                                       api/inbox/send     ──Graph API──► Meta (mensajes)
 Meta ──POST firmado (X-Hub-Signature-256)──► api/whatsapp/webhook ──► Supabase CRM
       (WhatsApp, Messenger e Instagram usan la MISMA URL; se rutea por `object`)
```

- El navegador **nunca** habla con el Supabase del CRM ni ve tokens de Meta.
- Los tokens se guardan cifrados con AES-256-GCM usando `INBOX_ENC_KEY`.
- Las tablas tienen RLS activada y ninguna policy: solo entra la service role.

---

## 1. Supabase del CRM

1. En supabase.com creá un proyecto **nuevo**, por ejemplo `propmatch-crm`. Elegí la región São Paulo (`sa-east-1`), que es la más cercana. **No uses el de la app.**
2. Andá a SQL Editor y ejecutá en este orden:
   1. `supabase-crm/migrations/20261005140000_inbox_schema.sql`
   2. `supabase-crm/migrations/20261005140100_inbox_functions.sql`

   Las dos se probaron sobre Postgres (PGlite): idempotencia, contador de no leídos, estados que solo avanzan, rate limit y bloqueo del rol anon.
3. En Settings → API copiá:
   - la **Project URL**, que va en `CRM_SUPABASE_URL`;
   - la **service_role key**, que va en `CRM_SUPABASE_SERVICE_ROLE_KEY`. Nunca la uses en el navegador.
4. Opcional: si querés que la limpieza sea diaria, activá `pg_cron` y programá `select public.inbox_purge(30);` todos los días.
5. Para ver eventos que fallaron: `select id, provider, received_at, error from webhook_events where processed_at is null order by id desc;`.

## 2. App en Meta for Developers

Ya existe un checklist general en `docs/meta-app-review-checklist.md`, armado para publicar en IG/FB. Esta sección agrega lo que hace falta para mensajería.

1. **Crear la app.** Andá a developers.facebook.com → My Apps → Create App y elegí el tipo **Business**, porque es requisito para Facebook Login for Business. [V] https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
2. **Vincularla al Business Portfolio de PropMatch**, el de la empresa legal.
3. **Agregar estos productos o casos de uso:**
   - **WhatsApp** (WhatsApp Business Platform / Cloud API);
   - **Facebook Login for Business**;
   - **Messenger** (Messenger Platform);
   - **Instagram**, en la variante "API with Facebook Login", que reutiliza el token de Página y el mismo endpoint de envío de Messenger. [V] https://developers.facebook.com/docs/instagram-platform/overview
4. **Registrarse como Tech Provider.** PropMatch da servicio a otras empresas, las inmobiliarias, y cada una paga sus mensajes con su propio medio de pago. No hace falta ser Solution Partner, que es el que comparte su línea de crédito. [V] https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers
5. En Settings → Basic copiá el **App ID** (va en `META_APP_ID` y `VITE_META_APP_ID`) y el **App Secret** (va en `META_APP_SECRET`). El App Secret además sirve para validar la firma de los webhooks.
6. Completá los **dominios** en Settings → Basic → App Domains con `propmatch-crm-taupe.vercel.app`.
7. En Facebook Login for Business → Settings cargá:
   - en **Allowed Domains for the JavaScript SDK**: `https://propmatch-crm-taupe.vercel.app`;
   - en **Valid OAuth Redirect URIs**: el mismo origen.

### 2.1 Embedded Signup (WhatsApp)

- **Versión vigente: v4**, lanzada el 8/10/2025. En v4 la versión **la fija la configuración** (`config_id`) y no hay que pasarla en `extras`. **v2 deja de andar el 15/10/2026**, así que no la uses. [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions/
- **Crear la configuración.** Andá a Facebook Login for Business → Configurations → Create:
  - elegí la variante para **WhatsApp Embedded Signup**;
  - los permisos son `whatsapp_business_management` y `whatsapp_business_messaging`;
  - el token es el **token de usuario del sistema de integración comercial** (business integration system user), que es lo que espera el código.

  El **Configuration ID** va en `VITE_META_WA_CONFIG_ID`.
- **Qué hace el código.** Llama a `FB.login({ config_id, response_type: "code", override_default_response_type: true, extras: { setup: {} } })`. Para la coexistencia, `extras` además lleva `featureType: "whatsapp_business_app_onboarding"`. Después escucha el `postMessage` `WA_EMBEDDED_SIGNUP`, solo si viene de un origen `*.facebook.com`, para leer `waba_id`, `phone_number_id` y `business_id`. [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
- **El `code` vence en ~30 s.** El servidor lo canjea en el momento con `GET /oauth/access_token?client_id&client_secret&code`, sin `redirect_uri`, igual que en el ejemplo oficial. [V] https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider. Que funcione siempre sin `redirect_uri` es **[NV]**: la doc no lo dice de forma explícita, solo lo omite.
- **Pasos del servidor** (`api/whatsapp/onboard.ts`):
  1. Lee los datos del número.
  2. Llama a `POST /{waba_id}/subscribed_apps`.
  3. Llama a `POST /{phone_number_id}/register` con un PIN aleatorio de 6 dígitos, que queda guardado cifrado. **En coexistencia este paso no se hace**, porque el número ya está registrado.
  4. Guarda la cuenta y sincroniza las plantillas.

  [V] (las mismas URLs que arriba)

### 2.2 Coexistencia: seguir usando la app WhatsApp Business del celular

Fuente: [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/

- **Cómo funciona.** En el Embedded Signup la inmobiliaria pone el número que ya usa en la **app WhatsApp Business**. Después confirma la vinculación desde la app del celular. La doc oficial que leí describe un **código de verificación** que se confirma en la app. La vinculación "por QR" que pediste **no la encontré escrita en la doc oficial [NV]**: puede ser una variante de la UI de Meta. La UI del CRM dice "escaneando el QR o con el código que te muestra Meta", así cubre los dos casos.
- **Requisito:** la app WhatsApp Business tiene que ser la versión **2.24.17 o superior**. Que el número tenga que estar activo una cantidad mínima de días es **[NV]**: no aparece en la doc.
- **Qué se sincroniza:**
  - contactos;
  - **hasta 6 meses de historial**.

  Se pide con `POST /{phone_number_id}/smb_app_data` y `sync_type` `smb_app_state_sync` o `history`. Hay que hacerlo **una sola vez y dentro de las 24 h** desde la conexión. El código lo pide automáticamente al conectar. Si falla, hay que desconectar y repetir el flujo.
- **Webhooks propios de la coexistencia:**
  - `history`, que llega en fases;
  - `smb_message_echoes`, con lo que el negocio escribe desde el celular (en el CRM aparece como "Desde WhatsApp Business (celular)");
  - `smb_app_state_sync`, con los contactos.

  Desde el 04/02/2026 existen también `account_offboarded` y `account_reconnected`. [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
- **Límites:**
  - el throughput es fijo en **20 mensajes/s**;
  - no se soportan grupos, mensajes temporales, "ver una vez", ubicación en tiempo real, listas de difusión ni llamadas;
  - si el celular principal pasa unos 14 días sin uso, se desconecta.
- **Costos:** lo que se manda desde la app sigue siendo gratis y lo que se manda por API se cobra con la tarifa de Cloud API.
- **Argentina: no figura nombrada [NV].** Nunca estuvo en las listas de países no soportados (EEA/UK/AU/JP/etc. se habilitaron el 23/10/2025, India el 05/05/2025), así que **se infiere** que está disponible. Hay que confirmarlo con el primer cliente real.

## 3. Webhooks

Se usa **una sola URL para los tres productos**, porque el código rutea por `object`:

- Producción: `https://propmatch-crm-taupe.vercel.app/api/whatsapp/webhook`
- Verify token: el valor de `META_WEBHOOK_VERIFY_TOKEN`. Inventá un string largo, por ejemplo con `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.

Pasos:

1. **WhatsApp → Configuration → Webhook.**
   1. Cargá la URL y el token y tocá Verify. Esto llama al `GET`, que responde `hub.challenge`. [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
   2. Suscribí los campos `messages`, `message_template_status_update`, `history`, `smb_message_echoes`, `smb_app_state_sync` y `account_update`.
2. **Messenger → Webhooks.** Cargá la misma URL y token y suscribí `messages`, `message_echoes`, `message_deliveries` y `message_reads`. Cuando se conecta una Página, el código además hace `POST /{page_id}/subscribed_apps`. [V] https://developers.facebook.com/docs/messenger-platform/webhooks
3. **Instagram → Webhooks.** Cargá la misma URL y suscribí `messages`.
4. **Firma.** Cada `POST` se valida con HMAC-SHA256 del cuerpo crudo usando el App Secret y se compara con `X-Hub-Signature-256`. Si no coincide, responde 401. [V] (misma URL de create-webhook-endpoint)
5. **Reintentos.** Meta reintenta hasta 7 días si no recibe 200. [V] https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks. El endpoint responde 500 solo cuando no pudo guardar el evento, para que Meta reintente. Si lo guardó, responde 200 aunque después falle el procesamiento, y el evento queda para revisar.
6. **Preview de Vercel.** Cada deploy de preview tiene otra URL y suele tener Deployment Protection, así que Meta no llega. Opciones:
   - crear una **Test App** de Meta, que es una app hija con su propio webhook, apuntada a una URL de preview estable o a un túnel (por ejemplo `vercel dev` + ngrok) para probar;
   - o cambiar temporalmente la URL de la app principal.

   Si es una preview protegida, sumá el bypass de Vercel en la URL (`?x-vercel-protection-bypass=...`) **[NV]**: no probé que Meta acepte query strings en la callback.

## 4. Número de prueba (para probar sin número real)

- Al hacer "Get Started" en el producto WhatsApp, Meta crea un **WABA y un número de prueba** ya registrados. Tienen límites más bajos y no piden medio de pago para mandar plantillas. [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started
- Que el número de prueba solo pueda escribirle a **hasta 5 destinatarios** verificados por SMS es **[NV]**: lo muestra el panel API Setup y lo repiten terceros, pero no lo encontré en la doc.
- **Probar el inbox sin Embedded Signup:**
  1. Generá un token temporal en API Setup.
  2. Insertá a mano una fila en `channel_accounts` con el `phone_number_id` y el `waba_id` de prueba y `access_token_enc` cifrado. El script para cifrar es `node -e` usando la misma función `sealToken` (pedímelo y lo armo).
  3. Mandá un mensaje desde tu celular al número de prueba y debería aparecer en el inbox.

  Este paso usa credenciales reales y por eso **no lo hice**.

## 5. Business Verification y App Review

Sin estas dos cosas **no se puede hacer onboarding de inmobiliarias clientes**: "You will not be able to onboard business customers until your app has been approved for advanced access". [V] https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/

1. **Business Verification** del Business Portfolio de PropMatch: documentación legal de la empresa, dominio y teléfono. Ver `docs/meta-app-review-checklist.md` §2.
2. **App Review con Advanced Access** para estos permisos:

   | Permiso | Para qué | Qué mostrar en el video |
   |---|---|---|
   | `whatsapp_business_messaging` | Mandar y recibir mensajes | Un agente responde un WhatsApp desde el Inbox del CRM y el mensaje llega al celular. |
   | `whatsapp_business_management` | WABA, número y plantillas | Crear o sincronizar una plantilla y enviarla con la ventana cerrada. |
   | `pages_messaging` (y `pages_manage_metadata`, `pages_show_list`) | Messenger | Conectar una Página, recibir un mensaje en el inbox y responderlo. |
   | `instagram_manage_messages` (+ `instagram_basic`, `pages_read_engagement`) | DMs de Instagram | Igual que Messenger, con una cuenta profesional de IG vinculada a la Página. |
   | `business_management` | Solo si después pasás a Solution Partner (línea de crédito) | — |

   - Para Tech Provider, Meta pide **2 videos**: uno enviando un mensaje y otro creando una plantilla. [V] https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers
   - **Justificación sugerida:** "PropMatch es un CRM inmobiliario. Las inmobiliarias conectan su número de WhatsApp Business, su Página e Instagram para responder desde un inbox unificado las consultas de compradores e inquilinos sobre propiedades. Los mensajes los inicia el cliente; fuera de la ventana de 24 h solo se envían plantillas aprobadas."
3. **Access Verification** sube el límite de **10 a 200 clientes nuevos por semana**. [V] (URL del overview de ES)
4. **Human Agent** es opcional. Es para responder en IG/Messenger hasta 7 días con `HUMAN_AGENT`; se pide aparte y después se activa con `META_HUMAN_AGENT_ENABLED=1`. Los 7 días están [V] para Messenger: https://developers.facebook.com/docs/messenger-platform/send-messages. Para IG son [NV].

## 6. Variables de entorno en Vercel

En Settings → Environment Variables, para Production y, si querés, Preview:

| Variable | Dónde | Valor |
|---|---|---|
| `VITE_META_APP_ID` | navegador | App ID |
| `VITE_META_WA_CONFIG_ID` | navegador | Configuration ID del Embedded Signup |
| `VITE_META_MESSAGING_CONFIG_ID` | navegador | Configuration ID de FB Login for Business con permisos de mensajería |
| `VITE_META_MESSAGING_ENABLED` | navegador | `1` recién con IG/Messenger aprobados |
| `CRM_SUPABASE_URL` | servidor | URL del Supabase del CRM |
| `CRM_SUPABASE_SERVICE_ROLE_KEY` | servidor | service role del Supabase del CRM |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | servidor | los del Supabase de **la app** (ya existen por Mercado Libre) |
| `INBOX_ENC_KEY` | servidor | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `META_APP_ID` | servidor | App ID |
| `META_APP_SECRET` | servidor | App Secret |
| `META_WEBHOOK_VERIFY_TOKEN` | servidor | el string del paso 3 |
| `META_GRAPH_VERSION` | servidor (opcional) | por defecto `v25.0`; la última es v26.0 (29/07/2026). [V] https://developers.facebook.com/docs/graph-api/changelog |
| `META_MESSAGING_ENABLED` | servidor | `1` junto con el `VITE_` |
| `META_HUMAN_AGENT_ENABLED` | servidor (opcional) | `1` si aprobaron Human Agent |

Las `VITE_*` se leen en build, así que después de cargarlas hay que **redeployar**.

## 7. Costos de WhatsApp

- **Modelo vigente: precio por mensaje**, desde el 1/7/2025. Se cobra solo por **plantillas entregadas**: [V] https://developers.facebook.com/docs/whatsapp/pricing
  - **Marketing:** siempre se cobra.
  - **Utility:** gratis dentro de la ventana de atención de 24 h; fuera de ella se cobra.
  - **Authentication:** se cobra.
  - **Service** (respuestas de texto libre dentro de la ventana): **gratis**.
  - **Free entry point:** 72 h gratis si la conversación vino de un anuncio Click-to-WhatsApp.
- Utility y authentication tienen descuentos por volumen, calculados por business portfolio.
- **Argentina (+54) tiene tarifa propia** en las rate cards (CSV/PDF): https://business.whatsapp.com/products/platform-pricing#rates. **No pude extraer los montos [NV]**: bajá la planilla vigente.
- **Quién paga:** como Tech Provider, cada inmobiliaria carga su medio de pago en su WABA. PropMatch no paga los mensajes de sus clientes.
- En el CRM, el selector de plantillas avisa cuando una es de marketing.

## 8. Instagram y Messenger: qué cambia

- **No hay plantillas.** Solo se puede responder dentro de las **24 h** desde el último mensaje de la persona, y solo si escribió primero. Con Human Agent aprobado, el plazo sube a 7 días.
- **Largo del texto:**
  - Messenger: 2000 caracteres;
  - Instagram: 1000 bytes. [V] https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
- **Las dos se conectan con un solo login**, que es Facebook Login for Business con una configuración de mensajería:
  - permisos `pages_show_list`, `pages_messaging`, `pages_manage_metadata`, `instagram_basic`, `instagram_manage_messages` y `pages_read_engagement`;
  - el ID de esa configuración va en `VITE_META_MESSAGING_CONFIG_ID`;
  - la cuenta de IG tiene que ser **profesional y estar vinculada a la Página**.
- **Etiquetas:** desde el 27/04/2026, las etiquetas `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE` y `POST_PURCHASE_UPDATE` dan error. El código no las usa.
- **Estado actual:** en la UI aparece "Requiere aprobación de Meta" hasta que pongas `VITE_META_MESSAGING_ENABLED=1` y `META_MESSAGING_ENABLED=1`.

## 9. Si Meta tarda: alternativas (no implementadas)

- **BSPs / Solution Partners**, como 360dialog, Twilio, Gupshup o Infobip:
  - ya tienen verificación y Embedded Signup propios, y pueden onboardear clientes en días;
  - cobran un fee mensual o por mensaje además de lo que cobra Meta;
  - cada uno tiene su propia API y sus propios webhooks, así que habría que escribir un adaptador en `api/_lib/inbox/`. El esquema (`channel_accounts`, `conversations`, `messages`) sirve tal cual.
- **Mientras tanto:** el CRM sigue teniendo los links `wa.me` (`src/lib/whatsapp.ts`), que abren el WhatsApp del agente sin integración.
- **Descartado:** WhatsApp "no oficial" por QR (whatsapp-web.js, Baileys). Viola los términos y pone en riesgo el número.

## 10. Checklist corto

1. [ ] Crear el Supabase del CRM y aplicar las 2 migraciones en orden.
2. [ ] Crear la app de Meta (Business) y vincularla al portfolio.
3. [ ] Agregar los productos WhatsApp, Facebook Login for Business, Messenger e Instagram.
4. [ ] Crear la configuración de Embedded Signup (v4) y anotar el config_id.
5. [ ] Configurar el webhook en los tres productos con la misma URL y suscribir los campos.
6. [ ] Cargar las env vars en Vercel y redeployar.
7. [ ] Probar con el número de prueba (sección 4).
8. [ ] Business Verification.
9. [ ] App Review (videos y justificación) y después Access Verification.
10. [ ] Conectar el primer número real con coexistencia y confirmar que funciona en Argentina.
11. [ ] Cuando aprueben IG/Messenger: crear la configuración de mensajería y activar los flags.
