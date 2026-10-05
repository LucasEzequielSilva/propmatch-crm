# Multipublicador: puesta en marcha

Checklist para que el multipublicador publique de verdad. Estado al 2026-10-05, rama `feat/multipublicador-apis`.

Resumen corto:

- **Mercado Libre**: el código está completo (OAuth con PKCE, publicar, actualizar, pausar, reactivar, finalizar, sincronizar estado y notificaciones). Falta crear la app, cargar variables, aplicar una migración y probar con un usuario de test.
- **Zonaprop, Argenprop, CABAPROP**: no hay API pública ni feed con formato público. Dependen de un acuerdo o de credenciales que entrega cada portal. No hay nada que se pueda programar contra una especificación verificada.
- **Instagram y Facebook**: hay API oficial, pero depende de App Review y Business Verification de Meta (ver `docs/meta-app-review-checklist.md`).

---

## 1. Mercado Libre Inmuebles

### 1.1 Qué hace el código

| Pieza | Archivo | Qué hace |
|---|---|---|
| Conectar | `api/_lib/routes/meli/connect.ts` | Arma la URL de autorización con `state` y PKCE S256. Guarda `state`, `code_verifier`, agencia y usuario en una cookie HttpOnly cifrada con AES-256-GCM que vence a los 10 minutos. Solo para admins de la agencia. |
| Callback | `api/_lib/routes/meli/callback.ts` | Valida `state` en tiempo constante, canjea el `code` con el `code_verifier`, exige refresh token (scope offline), lee `/users/me` y guarda los tokens **cifrados** en `agency_integrations` con la service role. Rechaza una cuenta de ML ya conectada a otra inmobiliaria. |
| Estado | `api/_lib/routes/meli/status.ts` | Conectada, sin conectar, o `needsReauth`. Nunca lee las columnas de tokens. |
| Desconectar | `api/_lib/routes/meli/disconnect.ts` | Revoca la autorización en ML (mejor esfuerzo) y borra la fila. Solo admins. |
| Tokens | `api/_lib/meli.ts` | Refresca 5 minutos antes de que venza. El refresh token es de un solo uso, así que la escritura es condicional al token leído y, si falla, relee la fila por si otra request ya lo renovó. Solo marca `needs_reauth` si ML rechaza la credencial (400 o 401). |
| Publicar | `api/_lib/routes/meli/publish.ts` | Acciones `check`, `publish`, `update`, `pause`, `activate`, `close` (solo admins) y `sync`. Ver 1.2. |
| Notificaciones | `api/_lib/routes/meli/notifications.ts` | Callback del topic `items`. Responde 200 al instante y sincroniza en segundo plano con `waitUntil`. |
| Mapeo y validación | `shared/meliListing.ts` | Funciones puras con la fuente de cada regla. Tests: `npm run test:meli`. |
| Pantalla | `src/features/propiedades/MeliPublishPanel.tsx` | En `/publicador/:id`: qué falta, ubicación de ML, tipo de publicación, acciones, estado, error y link al aviso. |

### 1.2 Cómo publica

1. El cliente manda la ficha del CRM. El servidor **no acepta fotos del cliente**: las toma de `properties.photos` de la app y solo usa URLs del Storage público del propio proyecto (`<SUPABASE_URL>/storage/v1/object/public/...`).
2. Comprueba que la propiedad sea de la agencia del usuario (`properties.agency_id`).
3. Elige la categoría hoja según tipo y operación (tabla en `shared/meliListing.ts`, sacada de `GET /categories/MLA1459` y sus hijas). En venta usa "Propiedades Individuales". Terreno, local y oficina no tienen alquiler temporario en ML.
4. Consulta en vivo `GET /categories/{id}/attributes` y valida los atributos con `tags.required`. Si la API no responde, usa la tabla estática.
5. Hace un HEAD a la primera foto para confirmar que ML la va a poder descargar.
6. Consulta el cupo con `GET /users/{id}/classifieds_promotion_packs?package_content=publications&status=active` y elige el `listing_type_id` (silver por defecto; gold o gold_premium si hay cupo).
7. Marca la fila como `pending` (evita el doble clic), hace `POST /items` y después `POST /items/{id}/description` en texto plano.
8. Guarda `external_id`, `external_url` (permalink), `status`, `error_message`, `published_at` y `last_synced_at` en `property_publications`.

Si ya hay un aviso vivo, "publicar" lo actualiza en lugar de duplicarlo (`PUT /items/{id}` con título, precio, fotos y atributos, más `PUT /items/{id}/description?api_version=2`). Pausar, reactivar y finalizar son `PUT /items/{id}` con `status` en `paused`, `active` o `closed`. Finalizar es definitivo.

Correspondencia de estados (`mapMeliItemStatus`):

| Estado en ML | Estado en `property_publications` |
|---|---|
| `active` | `published` |
| `paused` | `paused` |
| `closed` | `removed` |
| `closed` con sub_status `pack_quota_exceeded` | `error` ("se agotó el cupo") |
| `under_review` | `pending` |
| `inactive` | `error` |

### 1.3 Fuentes oficiales usadas

Todas consultadas el 2026-10-05:

- Publicar inmuebles (cuerpo de `POST /items`, `buying_mode: classified`, `channels: ["marketplace"]`, ubicación, fotos, descripción por POST aparte): https://developers.mercadolibre.com.ar/en_us/list-properties
- Ubicación (alcanza con el id de barrio, o de ciudad si no tiene barrios): https://developers.mercadolibre.com.ar/en_us/locate-property
- Paquetes (silver obligatorio; gold y gold_premium destacan; desde el 20/01/2026 silver exige al menos una foto en el POST; activación del usuario como inmobiliaria por soporte): https://developers.mercadolibre.com.ar/es_ar/gestionar-paquetes-de-inmuebles
- Modificar, pausar y cerrar: https://developers.mercadolibre.com.ar/en_us/real-estate-sync-listings
- Imágenes (JPG, JPEG y PNG, hasta 10 MB, mínimo 500 px): https://developers.mercadolibre.com.ar/es_ar/trabajar-con-imagenes
- Descripción (texto plano; `PUT ...?api_version=2` para reemplazar): https://developers.mercadolibre.com.ar/es_ar/descripcion-de-articulos
- OAuth, PKCE, refresh token de un solo uso y 6 meses de vida: https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
- Crear la app (redirect URI obligatoriamente HTTPS, PKCE, scopes, topics): https://developers.mercadolibre.com.ar/es_ar/crea-una-aplicacion-en-mercado-libre-es
- Permisos funcionales ("Publicación y sincronización"): https://developers.mercadolibre.com.ar/es_ar/permisos-funcionales
- Notificaciones (responder 200 en menos de 500 ms; reintentos durante 1 hora): https://developers.mercadolibre.com.ar/en_us/products-receive-notifications
- Inmueble de prueba (usuario de test, activarlo como inmobiliaria, contratar paquete): https://developers.mercadolibre.com.ar/es_ar/pasos-rapidos-para-publicar-un-inmueble-de-prueba
- Categorías y atributos: API pública `https://api.mercadolibre.com/categories/{id}` y `/categories/{id}/attributes`.

### 1.4 Pasos para dejarlo andando (en orden)

**A. Crear la app en Mercado Libre** (DevCenter: https://developers.mercadolibre.com.ar/devcenter). Conviene hacerlo con una cuenta de la empresa, no personal: la doc recomienda que la app quede a nombre de una entidad legal.

1. Nombre y descripción: "PropMatch CRM".
2. Redirect URIs (tienen que ser HTTPS y coincidir exacto):
   - Producción: `https://propmatch-crm-taupe.vercel.app/api/meli/callback`
   - Pruebas locales: ML **no acepta** `http://localhost`. Hay dos opciones: probar contra un deploy de Vercel con dominio fijo, o correr `vercel dev --listen 5182` detrás de un túnel HTTPS (cloudflared o ngrok) y registrar `https://<túnel>/api/meli/callback`. `npm run dev` (vite) **no** ejecuta las funciones de `api/`.
   - Las URLs de preview de Vercel cambian en cada deploy: no sirven salvo que les asignes un alias fijo.
3. PKCE: **activado**. El código siempre manda `code_challenge` S256.
4. Scopes: lectura y escritura, con acceso offline (`offline_access`). Sin offline no hay refresh token y el callback falla con "offline".
5. Permisos funcionales: "Usuarios" (viene por defecto) y "Publicación y sincronización".
6. Notificaciones: callback `https://propmatch-crm-taupe.vercel.app/api/meli/notifications`, topic **Items**. Es opcional: sin esto, el estado se actualiza con el botón "Actualizar estado".
7. Anotar el Client ID (APP ID) y el Client Secret.

**B. Variables de entorno en Vercel** (proyecto propmatch-crm, entornos Production y, si se usa, Preview y Development). Son solo de servidor: **ninguna lleva prefijo `VITE_`**.

| Variable | Valor |
|---|---|
| `MELI_CLIENT_ID` | APP ID de la app de ML |
| `MELI_CLIENT_SECRET` | Client Secret de la app de ML |
| `MELI_REDIRECT_URI` | `https://propmatch-crm-taupe.vercel.app/api/meli/callback` (en local, la del túnel) |
| `APP_URL` | `https://propmatch-crm-taupe.vercel.app` (a dónde vuelve el callback) |
| `INTEGRATIONS_ENC_KEY` | 32 bytes aleatorios en base64. Generar con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Si se cambia, los tokens guardados dejan de servir y hay que reconectar. |
| `SUPABASE_URL` | URL del proyecto de Supabase (la misma que `VITE_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | anon key (la misma que `VITE_SUPABASE_ANON_KEY`); se usa para validar el JWT del usuario |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key. Es la única que puede leer y escribir tokens. Nunca va al cliente. |

Si falta cualquiera, `/api/meli/status` responde `configured: false` y la pantalla muestra "La integración no está configurada en este entorno".

**C. Base de datos** (con aprobación de Lucas):

1. Confirmar que ya están aplicadas `20261004110000_crm_agency_integration.sql` y `20261004120000_property_publications.sql`. Según el repo, las dos lo están.
2. Aplicar `supabase/migrations/20261005140000_agency_integrations.sql`. Es aditiva: crea `agency_integrations`, con RLS, grants por columna (los clientes no pueden leer tokens y no tienen escritura), índice único por cuenta externa y un índice `property_publications (channel, external_id)` para las notificaciones.
3. Verificar que el bucket de fotos sea público (solo lectura, no cambia nada):
   ```sql
   select id, public from storage.buckets where id = 'property-photos';
   ```
   Tiene que dar `public = true`. El CRM ya usa `getPublicUrl` sobre ese bucket. Si diera `false`, ML no puede descargar las fotos y el endpoint lo avisa ("la URL no es pública"). En ese caso hay que decidir con Lucas si se hace público o si se generan URLs firmadas de larga duración. Esa variante no está implementada.

`20261005120000_swipes_agency_column_guard.sql` es independiente de esto.

**D. Probar con un usuario de test de ML**

1. Con un access token de la cuenta dueña de la app, crear un usuario de test: `POST https://api.mercadolibre.com/users/test_user` con body `{"site_id":"MLA"}`. Guardar el usuario y la contraseña que devuelve. Se pueden crear hasta 10.
2. Entrar a mercadolibre.com.ar con ese usuario, registrarlo como inmobiliaria y pedir la activación con el formulario de soporte de ML ("activar usuario"). La guía de inmueble de prueba lo marca como obligatorio.
3. Con el usuario ya activado, contratar un paquete de publicación de Inmuebles **desde el usuario de test** (si se usa la cuenta real, hay cargos).
4. En PropMatch: un admin de la agencia va a Publicaciones → Plataformas → "Conectar Mercado Libre" e inicia sesión **con el usuario de test**.
5. Elegir una propiedad **sincronizada con la app** (hoy solo las de precio en USD), abrir `/publicador/:id`, completar lo que marque "Validación previa", elegir ciudad y barrio, tocar "Verificar con Mercado Libre" y después "Publicar en Mercado Libre".
6. Revisar que aparezcan el id `MLA…` y el link "Ver en Mercado Libre", y que la fila de `property_publications` tenga `external_id`, `external_url` y `status = published`.
7. Probar Pausar, Reactivar, "Actualizar aviso" (cambiar el precio en el CRM), "Actualizar estado" y, al final, "Finalizar aviso".
8. Ver los errores: quitar la superficie cubierta (bloquea en el cliente), y desconectar la cuenta desde ML (tiene que pedir "Reconectar").

### 1.5 Limitaciones conocidas

- **Solo propiedades sincronizadas con la app.** `property_publications.property_id` es FK a `properties` y las fotos públicas viven en la app. Hoy el CRM sincroniza solo propiedades en USD (`canPublishToApp`). Para publicar alquileres en pesos hay que ampliar eso (decisión con Lucas, porque la app solo modela precio en USD).
- **Ubicación.** El CRM guarda localidad y provincia como texto. ML usa su propio árbol (por ejemplo, "La Plata" existe en "Bs.As. G.B.A. Sur" y en "Buenos Aires Interior"). El selector sugiere por nombre y la persona confirma. La elección queda en el navegador (localStorage), no en la base.
- **Coordenadas.** El CRM hoy crea propiedades con `lat`/`lng` nulos: el aviso queda ubicado por barrio.
- **Expensas.** Se mandan como `MAINTENANCE_FEE` en ARS: se asume que el CRM las carga en pesos.
- **Fotos WebP.** Hasta este cambio el CRM comprimía a WebP, y ML documenta solo JPG y PNG. Las fotos nuevas salen en JPEG. Las viejas en WebP generan una advertencia (no un bloqueo), porque no se pudo confirmar si ML las rechaza.
- **Timeout al crear.** Si `POST /items` no responde, no se sabe si el aviso se creó. La fila queda en error con la indicación de revisar en ML antes de reintentar.

---

## 2. Otros portales: qué existe de verdad

| Portal | API o feed | Requisito comercial | Qué se puede hacer ya | Qué depende de terceros |
|---|---|---|---|---|
| **Zonaprop** (Navent / QuintoAndar) | API de integradores (publicar, editar, borrar, estado, mapeo de zonas, leads) y canal XML legado. La doc está en `open-docs.navent.com/arg/`, que redirige a un Notion que no se pudo leer sin navegador. | Acuerdo de integrador con Zonaprop (no hay alta self-service verificada). Cada inmobiliaria necesita un plan, y Zonaprop tiene que asignar los planes a su "cuenta API". | Pedir el acuerdo y la documentación a Zonaprop. Dejar el mapeo de zonas pensado. | Credenciales de integrador, documentación completa y condiciones comerciales. |
| **Argenprop** | "API de Publicación de Avisos" propia (HTTP POST, form-urlencoded, spec v4.0). Solo apareció una copia en Scribd, sin el cuerpo legible. | Credenciales por inmobiliaria (`xxx@api.com`, contraseña, IdVendedor, IdOrigen) que entrega Argenprop. **Al pedir la integración, Argenprop da de baja los avisos activos.** | Pedirle a Argenprop la spec vigente y las condiciones para integradores. | Spec oficial vigente, alta como integrador y credenciales por inmobiliaria. |
| **CABAPROP** | Integración por API key que la inmobiliaria genera en su panel (Menú → Configuración → Integración). No se encontró la documentación técnica del endpoint. | Gratis según integradores. Solo profesionales matriculados. Mínimo 3 fotos. | Pedirle la documentación a CABAPROP. Con eso es el portal más simple después de ML (el guardado de la API key ya entra en `agency_integrations` con `provider = 'cabaprop'`). | Documentación del endpoint. |
| **Meta** (Instagram y Facebook Page) | Instagram Graph API (`instagram_content_publish`) y Pages API (`pages_manage_posts`). Marketplace de inmuebles **no** tiene vía self-service. | App Review, Business Verification y política de privacidad pública. | Checklist en `docs/meta-app-review-checklist.md`. El estudio de Instagram arma las piezas y se publica a mano. | Aprobación de Meta (semanas). |

**Feed XML para Zonaprop y Argenprop: no se implementó a propósito.** No se encontró un formato oficial y público de feed para ninguno de los dos. Zonaprop menciona un canal XML, pero su especificación solo se entrega a integradores, y lo mismo pasa con la API de Argenprop. Escribir un generador "a ojo" sería inventar un formato. Cuando cualquiera de los dos entregue la spec, el mapeo puede salir del mismo lugar que el de ML: la ficha del CRM más las fotos públicas de la app.

Detalle y fuentes de cada portal: `docs/integraciones-portales.md`.
