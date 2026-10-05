# Publicar en Facebook e Instagram + Web pública de la inmobiliaria

Rama `feat/meta-y-web`. Todo lo de Meta está **apagado** hasta que Meta apruebe los permisos
(`META_PUBLISH_ENABLED` / `VITE_META_PUBLISH_ENABLED`); sin eso la UI dice «Requiere aprobación de Meta».
La web pública funciona apenas se despliega (solo necesita las variables de Supabase que ya existen).

## 1. Qué hay en el código

### Meta (Página de Facebook + Instagram profesional)

| Acción (`api/meta.ts`, misma función) | Qué hace |
|---|---|
| `GET /api/meta/publish-status` | Estado de la conexión (Página, @instagram). Nunca devuelve tokens. |
| `POST /api/meta/publish-connect` | `code` de Facebook Login for Business → token de usuario de larga duración → `/me/accounts` → token de Página (no vence). Guarda en `agency_integrations` (provider `meta`). Si administra varias Páginas, devuelve la lista y se repite el login con la elegida. Solo administradores. |
| `POST /api/meta/publish-disconnect` | Borra la conexión. Solo administradores. |
| `POST /api/meta/ig-create` | Valida (JPEG, relación 4:5–1,91:1, ≤ 8 MB, máx. 10, texto ≤ 2.200 / 30 hashtags), consulta `content_publishing_limit` y crea el contenedor: foto, carrusel o story de imagen. |
| `POST /api/meta/ig-publish` | Si el contenedor está `FINISHED`, `media_publish`; si está `IN_PROGRESS` responde 202 y el navegador pregunta cada 5 s (hasta 5 min). Guarda `permalink` en `property_publications`. |
| `POST /api/meta/fb-publish` | Posteo en la Página: fotos subidas con `published=false` + `attached_media`, o link a la ficha pública. |
| `POST /api/meta/fb-delete` | `DELETE /{page-post-id}` y deja la publicación como `removed`. |

**Fuente de verdad de la conexión: `agency_integrations` (base de la app)**, no `channel_accounts` del Supabase
propio del CRM. Motivos: la tabla ya existe y está aplicada, ya cifra tokens con `INTEGRATIONS_ENC_KEY`, tiene
grants por columna (el navegador no puede leer tokens) y es la misma que usa Mercado Libre. El Supabase del CRM
todavía no existe. El inbox unificado puede reutilizar el mismo token de Página más adelante leyendo esta fila
(`provider = 'meta'`, `external_account_id` = id de la Página); hay una sola conexión de Meta por inmobiliaria.
El Instagram vinculado no se guarda: se consulta a la Página (`instagram_business_account`) en cada uso.

Seguridad: el servidor solo manda a Meta fotos del bucket público `property-photos` que sean de esa propiedad
(columna `photos`) o de la carpeta de la agencia (`<agency_id>/…`). La propiedad tiene que ser de la agencia y
estar `active`. Las de ejemplo nunca llegan (no existen en la base).

Pantallas:
- **Multipublicador** (`/publicador`): tarjetas Facebook e Instagram con «Conectar con Facebook» (una conexión
  para las dos), «+ Publicar una propiedad», «Ver mis avisos» y «Desconectar».
- **Por propiedad** (`/publicador/:id`): panel «Facebook e Instagram» (elegir fotos, texto, publicar carrusel o
  foto, publicar en la Página con o sin link a la web, ver publicación, borrar de Facebook). La UI aclara que
  **Instagram no permite borrar por API**.
- **Estudio de Instagram** (`/instagram/:id`, paso Publicar): «Publicar ahora» hornea las ediciones a JPEG, las
  sube a `property-photos/<agency_id>/instagram/` y publica foto, carrusel o story de imagen. Programar sigue
  siendo un recordatorio (no hay cola).

No incluido: **Reels y stories de video**. La API oficial sí los permite (`media_type=REELS` / `STORIES` con
`video_url`), pero el video tiene que estar en una URL pública y el bucket de la app solo acepta imágenes de
hasta 5 MB. Para habilitarlo hace falta un bucket público de videos (p. ej. `social-media`, mp4/mov, 300 MB) y
el mismo flujo de contenedor + espera. Tampoco: publicación programada en el servidor.

### Web pública (canal «web»)

- `/sitio/:slug`: portada con nombre, filtros (operación, tipo, zona, precio en USD, ambientes; quedan en la URL)
  y grilla. `/sitio/:slug/p/:id`: galería, datos, descripción, características, ubicación y contacto por
  WhatsApp/mail. `?embed=1` saca encabezado y pie para insertarla con un iframe.
- `/sitio/vista-previa`: la misma web con los datos de ESE navegador (también en la demo), marcando «No se
  publica» lo que es de ejemplo o no está sincronizado. No publica nada.
- Datos: `api/web.ts` (función nueva) con `site`, `property`, `feed` (JSON público con CORS para integradores) y
  `og` (HTML con meta tags para bots). Service role + **lista blanca de columnas** (`id, title, description,
  photos, barrio, type, operation_type, rooms, amenities, price_usd_*, updated_at`): nunca dueño, DNI, dirección,
  lat/lng de la app ni datos del CRM (precio mínimo de reserva, comisión). Caché `s-maxage=300,
  stale-while-revalidate=3600`: un cambio tarda hasta 5 min en verse.
- Aparece una propiedad si: es de la agencia, `status = 'active'` en la app (disponible) y no está oculta.
- **«Mostrar en mi web»** (por propiedad, `/publicador/:id` → «Mi web»): se guarda en `property_publications`
  canal `web` (`status = 'removed'` = oculta; sin fila = visible). Así el servidor lo lee sin columnas nuevas.
- **Ubicación**: por defecto solo barrio y link a la zona en Google Maps. «Mostrar ubicación exacta» solo se
  puede activar si la propiedad tiene coordenadas en el CRM; se guardan en esa misma fila web
  (`external_id = 'geo:lat,lng'`) y la ficha muestra un mapa de OpenStreetMap (sin clave). Es provisorio hasta
  tener una columna propia.
- **Contacto**: teléfono y mail de la cuenta paraguas de la inmobiliaria (`agencies.owner_user_id` → `users`).
  Conviene que ese teléfono esté en formato internacional (+54 9 …).
- **Slug**: `agencies` no tiene `slug`. Se deriva: `<nombre>-<8 primeros del uuid>` (p. ej.
  `inmobiliaria-lopez-1ffdbb92`). Para elegirlo a mano: `supabase/drafts/agencies_slug.sql` (sin aplicar); el
  servidor ya usa la columna si existe.
- **SEO**: la web es una SPA de Vite, así que title/description/Open Graph se ponen en el navegador (Google
  ejecuta JS y los ve). Los bots de vista previa de links (WhatsApp, Facebook, X, LinkedIn, Telegram, Slack…) no
  ejecutan JS: `vercel.json` los reescribe por User-Agent a `/api/web/og`, que devuelve el HTML con las meta
  tags. A los buscadores no se les sirve otra cosa (para no hacer cloaking).
- Limitación: la web carga el bundle completo del CRM (las páginas del sitio son lazy, pero `App.tsx` importa el
  resto de forma estática). Mejora futura: separar el CRM en chunks.

### Funciones de Vercel

Antes 5 (`meli`, `inbox`, `whatsapp`, `meta`, `proppi`). Ahora **6**: se suma `api/web.ts`; todo lo de Meta va
en `api/meta.ts` (con `maxDuration: 60`).

## 2. Checklist para la inmobiliaria / dueño de la app de Meta (pasos que NO hizo el código)

### A. App de Meta

1. En https://developers.facebook.com/apps usar la app existente del inbox (la misma `META_APP_ID`) o crear una
   de tipo **Business**. Tiene que estar asociada al portfolio comercial (Business Manager) de PropMatch.
2. Productos: **Facebook Login for Business** (y la API de Instagram con inicio de sesión de Facebook, que viene
   con los permisos `instagram_*`).
3. Facebook Login for Business → **Configurations** → crear una configuración «PropMatch – Publicar»:
   - Tipo de token: **User access token**.
   - Activos: Páginas (e Instagram).
   - Permisos: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`,
     `instagram_content_publish`, `business_management`.
   - Copiar el **Configuration ID** → `VITE_META_PUBLISH_CONFIG_ID`.
4. Facebook Login for Business → Settings:
   - **Allowed Domains for the JavaScript SDK**: `https://propmatch-crm-taupe.vercel.app` (y el dominio propio
     si hay).
   - **Login with the JavaScript SDK**: Sí.
   - **Valid OAuth Redirect URIs**: `https://propmatch-crm-taupe.vercel.app/` (el login se hace con el JS SDK y
     `response_type=code`; no hay callback propio).
5. Settings → Basic: Privacy Policy URL, Terms URL, ícono, categoría, **Data Deletion** (instrucciones o URL).
6. **Business Verification** del portfolio (Configuración del negocio → Centro de seguridad). Es requisito para
   Advanced Access.
7. **App Review** → pedir **Advanced Access** para cada permiso (las inmobiliarias no son dueñas de la app). Para
   cada uno: descripción de uso + video de pantalla. Guion sugerido (un solo video sirve para todos, en inglés o
   con subtítulos):
   1. Login en PropMatch con usuario de prueba → Publicaciones → tarjeta Facebook → «Conectar con Facebook».
   2. Diálogo de Facebook: elegir la Página y su Instagram, aceptar permisos.
   3. Vuelve a PropMatch: «Conectado», muestra la Página y @instagram (`pages_show_list`, `instagram_basic`,
      `business_management`).
   4. Abrir una propiedad → panel Facebook e Instagram → elegir fotos → «Publicar carrusel» → abrir el link al
      post en Instagram (`instagram_content_publish`, `pages_read_engagement`).
   5. «Publicar en Facebook» → abrir el posteo en la Página → «Borrar de Facebook» (`pages_manage_posts`).
   6. Mostrar «Desconectar».
   Justificación corta: «PropMatch es un CRM inmobiliario. La inmobiliaria conecta su Página y su Instagram
   profesional para publicar las fotos y la descripción de sus propiedades en venta o alquiler, sin descargar y
   volver a subir. Solo publica cuando un usuario de la inmobiliaria toca Publicar; no lee mensajes ni datos de
   terceros.»
8. Mientras la app está en modo Desarrollo, solo funcionan usuarios con rol en la app (admin/developer/tester):
   sirve para probar antes de la revisión.

### B. Variables de entorno en Vercel (Production)

Ya existentes (verificar): `META_APP_ID`, `META_APP_SECRET`, `VITE_META_APP_ID`, `INTEGRATIONS_ENC_KEY`,
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`.

Nuevas:

| Variable | Valor |
|---|---|
| `VITE_META_PUBLISH_CONFIG_ID` | Configuration ID del paso A.3 |
| `VITE_META_PUBLISH_ENABLED` | `1` recién con los permisos aprobados |
| `META_PUBLISH_ENABLED` | `1` (igual que la anterior, del lado del servidor) |
| `META_GRAPH_VERSION` | opcional; por defecto `v25.0` (`api/_lib/inbox/graph.ts`) |

Las `VITE_*` se leen al compilar: después de cambiarlas hay que volver a desplegar.

### C. Cómo conecta cada inmobiliaria

1. Su Instagram tiene que ser **profesional** (empresa o creador) y estar **vinculado a la Página** de Facebook.
2. Un **administrador** de la inmobiliaria en PropMatch: Publicaciones → tarjeta Facebook o Instagram →
   «Conectar con Facebook» → elegir la Página → aceptar.
3. Para publicar: Publicaciones → «+ Publicar una propiedad» o `/publicador/:id`, o desde el Estudio de Instagram.

### D. Web pública: cómo compartirla e insertarla

1. Publicaciones → tarjeta **Mi web** → «Ver mi web» / «Copiar link» (`https://<dominio>/sitio/<slug>`).
2. «Insertar en mi sitio» da un `<iframe src=".../sitio/<slug>?embed=1" …>`:
   - WordPress: bloque «HTML personalizado».
   - Wix: «Agregar» → «Insertar código» → «Insertar HTML» (o «Insertar un sitio» con la URL).
   - Tiendanube / otros: cualquier bloque de HTML.
3. Feed JSON para un desarrollador: `https://<dominio>/api/web/feed?slug=<slug>`.
4. Para ocultar una propiedad: `/publicador/:id` → «Mi web» → destildar «Mostrar en mi web».

## 3. Fuentes oficiales consultadas (2026-10-05)

- Publicación de contenido en Instagram: https://developers.facebook.com/docs/instagram-platform/content-publishing
- `POST /{ig-user-id}/media`: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- `content_publishing_limit`: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
- Fotos de Página: https://developers.facebook.com/docs/graph-api/reference/page/photos/
- Feed de Página: https://developers.facebook.com/docs/graph-api/reference/page/feed/
- Posteos de Página (borrar, permalink): https://developers.facebook.com/docs/pages-api/posts
- Facebook Login for Business: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- Tokens de larga duración: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived

## 4. Lo que NO pude confirmar en la documentación oficial

- **Cupo de Instagram**: la guía de publicación dice 100 posteos por API cada 24 h y la referencia de
  `content_publishing_limit` dice `quota_total` 50. El código no asume ninguno: usa lo que devuelve la API.
- El **código de error** de cupo agotado (se trata `code 9` / `subcode 2207042` como cupo): no pude abrir la
  página de códigos de error de Instagram.
- **Borrar en Instagram**: la referencia dice «not supported»; si Meta lo habilita más adelante, se puede sumar.
- **`attached_media` y `link` juntos**: la doc no lo aclara; por eso con fotos el link va dentro del texto.
- La referencia de `/{page-id}/feed` dice que el `link` «tiene que pertenecer a la Página» en algunos casos
  (personalización de la vista previa); un link común a la web debería andar, sin confirmar.
- Tope de fotos por posteo de Página: no documentado; usamos 10.
- Detalle exacto de Redirect URIs / dominios para FB Login for Business con JS SDK: la página no lo detalla;
  los valores de arriba siguen lo que ya usa el inbox.
- Que los bots de WhatsApp/Facebook respeten el rewrite por User-Agent de Vercel (`has` con regex): probarlo
  con el depurador de Facebook (https://developers.facebook.com/tools/debug/) después del deploy.
