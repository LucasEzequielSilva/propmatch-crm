# Marketing por email y WhatsApp: puesta en marcha

Pantalla **Marketing** del CRM: campañas de retargeting por email (Resend) y por WhatsApp (Cloud API oficial, plantillas MARKETING), con baja en un clic. Revisado en octubre de 2026.

> **Estado:** el código está listo. **No se aplicó SQL, no se cargaron variables, no se crearon cuentas y no se envió nada real.** Hasta que completes los pasos de abajo, la pantalla funciona en *modo preparación*: armás audiencias, plantillas y campañas, y registrás consentimientos y bajas en el navegador, pero no se envía nada.

---

## 1. Cómo funciona

```
Navegador (CRM)                         api/marketing (Vercel)             Supabase PROPIO del CRM
- audiencias con datos del CRM  ──JWT──► valida usuario + agencia  ──SR──► marketing_campaigns
- contenido personalizado por contacto   vuelve a filtrar bajas,           marketing_recipients
  (variables + propiedades por matching) consentimiento y frecuencia       marketing_unsubscribes
                                         manda por Resend / Cloud API      marketing_consents
Página pública /baja/:token  ──────────► unsubscribe (token HMAC)         marketing_events
Resend ──webhook firmado (Svix)────────► resend-webhook
Meta   ──webhook del inbox─────────────► "BAJA" / botón / estados / user_preferences
```

- Los contactos viven en el navegador (localStorage) y en la app. Por eso el **navegador arma el contenido** de cada destinatario y lo sube; el **servidor** decide si sale (bajas, consentimiento, frecuencia, topes) y lo manda.
- **Bajas y consentimientos viven en el servidor** (la baja llega desde un link público o desde WhatsApp). El navegador guarda una copia y lo que todavía no se subió.
- **Datos de ejemplo** (`is_sample`, teléfonos `+54 221 555-01xx`, mails `example.com`) **nunca** entran a una campaña: los filtra el navegador y otra vez el servidor.
- Interruptor general: **`MARKETING_SEND_ENABLED=1`**. Sin eso no sale nada aunque todo esté configurado, ni siquiera una prueba.

### Archivos

| Qué | Dónde |
|---|---|
| Función de Vercel (una sola) | `api/marketing.ts` → acciones `status`, `state`, `consent`, `campaign`, `dispatch`, `unsubscribe`, `resend-webhook` |
| Lógica del servidor | `api/_lib/marketing/*`, `api/_lib/routes/marketing/*` |
| Reglas compartidas y pruebas | `shared/marketing.ts`, `shared/marketingCrypto.ts`, `scripts/marketing.test.ts` (`npm run test:marketing`) |
| UI | `src/features/marketing/*`, `src/lib/marketing/*` |
| Migración (SIN aplicar) | `supabase-crm/migrations/20261006120000_marketing.sql` |
| Baja por WhatsApp | gancho en `api/_lib/inbox/whatsapp.ts` (webhook del inbox) |

---

## 2. Supabase del CRM

Es el **mismo proyecto nuevo del inbox** (`docs/inbox-unificado-puesta-en-marcha.md`), **no** el de la app (`jhtkvcxvgjwnuzfhbale`).

1. Aplicá primero las migraciones del inbox (`20261005140000_*`, `20261005140100_*`).
2. Después aplicá `20261006120000_marketing.sql`. Todas las tablas tienen **RLS habilitada y forzada, sin policies**, y `revoke` a `anon`/`authenticated`: solo entra la service role desde las funciones.
3. Variables (ya las pide el inbox): `CRM_SUPABASE_URL`, `CRM_SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (app, para validar el JWT) e `INBOX_ENC_KEY`.

## 3. Variables de entorno de marketing (Vercel, solo servidor, nunca `VITE_`)

| Variable | Para qué |
|---|---|
| `MARKETING_UNSUB_SECRET` | 32+ bytes aleatorios (`openssl rand -base64 48`). Firma los links de baja con HMAC-SHA256. **Si lo cambiás, los links ya enviados dejan de funcionar.** |
| `APP_URL` | URL pública del CRM (`https://crm.tudominio.com`), para armar `/baja/:token` y el one-click. |
| `RESEND_API_KEY` | API key de Resend (permiso *Sending access* alcanza). |
| `MARKETING_FROM_EMAIL` | `Inmobiliaria X <novedades@mail.tudominio.com>`, en un dominio verificado. |
| `MARKETING_REPLY_TO` | Opcional. A dónde llegan las respuestas. |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` del webhook de Resend. |
| `MARKETING_SEND_ENABLED` | `1` para habilitar envíos reales. Dejalo sin poner hasta probar. |
| `MARKETING_AGENCY_DAILY_CAP` | Tope diario por agencia sumando todas las campañas (default 1000). |
| `CRON_SECRET` | Opcional, para el despachador programado (ver 6). |

WhatsApp usa además las variables de Meta del inbox (`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`) y un número conectado desde *Inbox → Canales*.

## 4. Resend (email)

Docs: https://resend.com/docs

1. **Cuenta**: crear la cuenta en resend.com (lo hace el dueño).
2. **Dominio**: usá un **subdominio** para marketing (por ejemplo `mail.tudominio.com`) así una mala reputación no afecta tu mail corporativo. Resend recomienda separar newsletters y transaccionales en subdominios distintos (https://resend.com/docs/dashboard/domains/introduction).
3. **DNS** (https://resend.com/docs/add-a-domain):
   - **SPF**: TXT y MX en el subdominio `send` (`v=spf1 include:amazonses.com ~all`; copiá los valores exactos del panel).
   - **DKIM**: TXT en `resend._domainkey`.
   - **DMARC** (recomendado, y obligatorio para Gmail/Yahoo en envíos masivos): TXT en `_dmarc.tudominio.com`, para empezar `v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com`. Cuando todo pase, subilo a `quarantine`.
   - Suele verificar en unos 15 minutos; puede tardar hasta 72 h.
4. **Seguimiento de aperturas y clicks**: se activa **por dominio** en el panel de Resend. Si no lo activás, la campaña muestra entregados, rebotes y quejas, pero no aperturas ni clicks.
5. **Webhook**: en Resend → Webhooks, URL `https://TU_CRM/api/marketing/resend-webhook` con los eventos `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed` y `email.suppressed`. Copiá el `whsec_…` a `RESEND_WEBHOOK_SECRET`.
   - La firma se valida con Svix (`svix-id`, `svix-timestamp`, `svix-signature`), con tolerancia de 5 minutos y deduplicación por `svix-id` (https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests).
   - Una **queja de spam** o un **rebote** generan una baja de email automática.
6. **Cómo se envía**:
   - Por `POST /emails/batch`, de hasta 100 mails por request, con `Idempotency-Key` (https://resend.com/docs/api-reference/emails/send-batch-emails).
   - El rate limit por defecto es de 10 requests/s por team (https://resend.com/docs/api-reference/rate-limit). Con 100 por request sobra.
   - Cada mail lleva `List-Unsubscribe: <https://TU_CRM/api/marketing/unsubscribe?t=…>` y `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058; https://resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails). El POST one-click responde 200 y da de baja sin pedir nada más.
   - El GET del mismo link **no** da de baja (los antivirus abren los links solos): redirige a la página `/baja/:token`.

**Prueba antes de encender**: con todo cargado y `MARKETING_SEND_ENABLED=1`, usá **«Enviar prueba a mí»**: llega al email de tu usuario. Verificá el pie, el link de baja y el botón «Desuscribirse» de Gmail.

## 5. WhatsApp (Cloud API oficial)

Solo **plantillas de categoría MARKETING aprobadas por Meta**, por la API oficial, a contactos con **opt-in**. **Nada de envíos masivos por wa.me**: el `WhatsAppModal` sigue siendo uno a uno y además se bloquea si el contacto se dio de baja.

1. **Número conectado** desde *Inbox → Canales* (Embedded Signup, ver la doc del inbox).
2. **Plantilla MARKETING** en WhatsApp Manager:
   - Cuerpo con variables `{{1}}`, `{{2}}`… (en la pestaña Plantillas del CRM se arma el texto y qué va en cada variable).
   - Botón de **respuesta rápida «No recibir más mensajes»**. Meta limita el texto del botón a 25 caracteres, por eso no entra «No quiero recibir más mensajes», que tiene 30. Si no ponés el botón, incluí en el cuerpo «Respondé BAJA para no recibir más mensajes».
   - Al enviar, el CRM agrega el payload `PM_MKT_BAJA` al botón (`components: [{ type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload }] }]`). Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components
3. **Sincronizá las plantillas** desde el Inbox cuando Meta las apruebe. La campaña verifica que estén `APPROVED` y sean `MARKETING`.
4. **Baja por WhatsApp**: el webhook del inbox (`/api/whatsapp/webhook`, el mismo de siempre) marca la baja cuando:
   - el contacto toca el botón (payload `PM_MKT_BAJA` o el texto del botón);
   - responde «BAJA», «STOP», «No quiero recibir más mensajes», «darme de baja», etc. El criterio es conservador: «¿bajaron el precio?» **no** da de baja;
   - Meta responde el error **131050** («el usuario dejó de recibir mensajes de marketing») al enviar, o llega el campo **`user_preferences`** con `stop` (https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates/marketing-templates). Para recibirlo, suscribí el campo `user_preferences` en el webhook de la app de Meta. **La forma exacta de ese payload no está del todo documentada**: el código la lee de forma tolerante.

   Si el envío está habilitado, se le confirma la baja con un texto libre: el propio mensaje del contacto abrió la ventana de 24 h.
5. **Límites y calidad**:
   - Escalones de mensajería por *business portfolio*: 250 → 2.000 → 10.000 → 100.000 → ilimitado (https://developers.facebook.com/docs/whatsapp/messaging-limits).
   - Meta limita cuántos mensajes de marketing recibe cada usuario. El error **131049** (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) se reintenta a las 24 h, máximo 3 intentos.
   - Arrancá con pocos destinatarios: muchos bloqueos o reportes bajan la calidad del número y pueden pausar plantillas.
6. **Costos**:
   - Desde el 1/7/2025 Meta cobra **por mensaje de plantilla entregado**. Las de marketing **siempre** se cobran.
   - Argentina tiene tarifa propia en la tabla oficial: https://developers.facebook.com/docs/whatsapp/pricing . **Revisá el valor vigente antes de cada campaña**: no lo copiamos acá porque cambia.
7. **Marketing Messages API**: Meta ofrece un endpoint aparte (`/marketing_messages`) y lo recomienda para tráfico de marketing (https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/overview/). Este código usa la Cloud API (`/messages`), que sigue admitiendo plantillas de marketing. **No pudimos confirmar** que la MM API sea obligatoria; si lo pasa a ser, el cambio queda acotado a `api/_lib/marketing/dispatch.ts`.
8. **Opt-in**: la persona tiene que aceptar recibir mensajes de **tu** empresa por WhatsApp, de forma clara (https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in y https://business.whatsapp.com/policy). En el CRM se registra en la ficha → *Marketing → Registrar consentimiento*, con fecha, cómo lo dio y evidencia.

## 6. Envío programado y despachador

- **Enviar ahora**: la primera tanda sale en el mismo request y el resto, mientras la pantalla de la campaña está abierta, cada 1 minuto, respetando los topes por hora y por día.
- **Programado o sin la pantalla abierta**: hace falta un disparador externo que llame `GET /api/marketing/dispatch` con `Authorization: Bearer <CRON_SECRET>`. Opciones:
  - **Vercel Cron**: en el plan Hobby solo corre **una vez por día**. Una expresión más frecuente hace fallar el deploy, por eso **no se agregó a `vercel.json`**. En Pro: `{"crons":[{"path":"/api/marketing/dispatch","schedule":"*/10 * * * *"}]}`. Vercel manda solo el `Authorization: Bearer <CRON_SECRET>`.
  - Un cron externo (por ejemplo cron-job.org) con ese header.
- Los destinatarios que quedan "enviando" por una función caída vuelven a la cola a los 15 minutos (`marketing_release_stuck`).

## 7. Legal y cumplimiento (Argentina)

> No es asesoramiento legal: revisalo con un abogado. Lo que no pudimos confirmar está marcado.

**Ley 25.326 de Protección de Datos Personales** (https://servicios.infoleg.gob.ar/infolegInternet/anexos/60000-64999/64790/norma.htm)
- **Art. 5**: el consentimiento tiene que ser libre, expreso e informado. Por eso el CRM **no envía a nadie sin un consentimiento registrado**, con fecha, medio y evidencia.
- **Art. 6**: al pedir el dato hay que informar la finalidad, los destinatarios, quién es el responsable y los derechos de acceso, rectificación y supresión. Va en tus formularios: el CRM no los crea.
- **Art. 21**: las bases de datos se registran ante la AAIP (https://www.argentina.gob.ar/aaip/datospersonales).
- **Art. 27**: se permite publicidad con datos de fuentes públicas o con consentimiento, y el titular puede pedir **retiro o bloqueo en cualquier momento** (inc. 3). En el CRM: link de baja, botón y «BAJA» por WhatsApp, baja manual, y bloqueo de todo envío posterior.
- **Decreto 1558/2001, art. 27** (https://servicios.infoleg.gob.ar/infolegInternet/anexos/70000-74999/70368/norma.htm): toda comunicación publicitaria tiene que indicar en forma expresa y destacada que se puede pedir el retiro o bloqueo. Está en el pie del email (`DEFAULT_LEGAL` en `shared/marketing.ts`) y en las plantillas de WhatsApp (botón o texto).
- **Disposición DNPDP 4/2009** (https://www.argentina.gob.ar/normativa/nacional/norma-151221/texto):
  - Art. 1: el aviso tiene que incluir el mecanismo de baja y transcribir el art. 27 inc. 3 de la ley y el 3er párrafo del art. 27 del decreto. El pie del email lo transcribe.
  - Art. 2: la publicidad **no solicitada** lleva «Publicidad» en el asunto. La plantilla de email tiene la opción de anteponerlo.
  - Art. 3: el mecanismo de baja tiene que tener capacidad operativa suficiente.
- **No confirmado**: el proyecto de nueva ley de datos perdió estado parlamentario en 2025, y la AAIP trabaja en uno nuevo. No verificamos el estado de los proyectos de 2026.

**Ley 26.951, Registro Nacional «No Llame»** (https://www.argentina.gob.ar/normativa/nacional/norma-233066/texto; Decreto 2501/2014: https://www.argentina.gob.ar/normativa/nacional/240407/texto)
- Alcanza a los servicios de **telefonía en cualquiera de sus modalidades**: fija, móvil, VoIP y similares. Prohíbe contactar a los inscriptos y obliga a consultar el registro (art. 7; la lista se actualiza cada 30 días).
- Excepciones (art. 8): relación contractual vigente y contacto autorizado expresamente.
- **No confirmado**: no encontramos una interpretación oficial que la extienda a **WhatsApp** o al **email**. La AAIP habla de «mensajes o llamadas publicitarias» a teléfonos fijos o móviles (https://www.argentina.gob.ar/noticias/registro-no-llame-la-aaip-brinda-informacion-para-garantizar-el-cumplimiento-de-la-ley). Por prudencia:
  - antes de una campaña por WhatsApp, cruzá los teléfonos con el registro (hoy el CRM **no** lo consulta automáticamente);
  - o asegurate de tener el consentimiento expreso, que es la excepción del art. 8.
- Las llamadas en frío desde el CRM no son parte de este módulo.

## 8. Buenas prácticas anti-spam

- **Solo con consentimiento** y solo sobre lo que la persona pidió (su búsqueda). Las audiencias de retargeting usan datos que la persona dio para eso.
- **Gmail y Yahoo** (https://support.google.com/a/answer/81126, https://senders.yahooinc.com/best-practices/), para más de 5.000 mails por día:
  - SPF + DKIM + DMARC;
  - baja en un clic (RFC 8058) procesada en menos de 2 días: el CRM la aplica en el momento;
  - tasa de spam por debajo de 0,3% (ideal menos de 0,1%). Mirá Google Postmaster Tools.
- **Calentá el dominio**: las primeras semanas mandá pocos mails por día (los topes por campaña ayudan) y subí de a poco.
- **Frecuencia**: por defecto, como mínimo 7 días entre dos mensajes de marketing al mismo contacto (`minDaysBetween`).
- **Limpieza**: rebotes y quejas generan una baja automática. No reactives a nadie sin un consentimiento nuevo.
- **Contenido**: asunto honesto, texto además del HTML (el CRM manda los dos), pocas imágenes, links a tu propio dominio y datos reales de la inmobiliaria en el pie.

## 9. Checklist para encender

1. [ ] Aplicar las migraciones del inbox y la de marketing en el Supabase del CRM.
2. [ ] Cargar `MARKETING_UNSUB_SECRET` y `APP_URL` (+ las del inbox). El banner «Modo preparación» desaparece.
3. [ ] Email: cuenta de Resend, dominio verificado (SPF/DKIM/DMARC), `RESEND_API_KEY`, `MARKETING_FROM_EMAIL` y webhook con `RESEND_WEBHOOK_SECRET`.
4. [ ] WhatsApp: número conectado, plantilla MARKETING con botón de baja aprobada y sincronizada, y campo `user_preferences` suscripto.
5. [ ] Registrar consentimientos (los contactos sin consentimiento no reciben nada).
6. [ ] `MARKETING_SEND_ENABLED=1` → envío de prueba a vos → revisar el pie, el link de baja, el one-click y «BAJA» por WhatsApp.
7. [ ] (Opcional) Despachador programado con `CRON_SECRET`.
8. [ ] Revisión legal del pie (`DEFAULT_LEGAL`), de los formularios de captación (art. 6) y del registro de la base ante la AAIP.
