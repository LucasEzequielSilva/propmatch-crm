# PropMatch: checklist de Business Verification y App Review de Meta

Fecha de investigación: 2026-10-04. Alcance: publicar en Instagram (feed, carruseles, stories) y Páginas de Facebook de inmobiliarias clientes; WhatsApp Cloud API más adelante.

Convenciones: **[V]** = confirmado en documentación oficial de Meta que se consultó (URL citada). **[NV]** = no verificado en fuente oficial (viene de terceros o de memoria; confirmar en el Dashboard antes de actuar). Las páginas de developers.facebook.com cambian seguido: lo que diga el App Dashboard el día de la carga manda sobre este documento.

Limitación de esta investigación: las páginas de ayuda de facebook.com/business/help no devolvieron contenido útil al extraerlas (requieren renderizado/login), por lo que la lista de documentos de Business Verification y los tiempos salen de terceros [NV].

---

## 0. Resumen ejecutivo

1. PropMatch es un **Tech Provider**: accede a datos de otras empresas (las inmobiliarias). Por eso necesita **Business Verification de PropMatch (su empresa)** + **App Review con Advanced Access** + **Access Verification**. Las inmobiliarias clientes **no** necesitan verificarse. [V] https://developers.facebook.com/docs/development/release/business-verification y https://developers.facebook.com/docs/development/release/tech-providers
2. Sin esto, mientras la app esté en Live, usuarios de otros negocios no pueden otorgar permisos avanzados y las funciones quedan inactivas. [V] (misma URL de Business Verification).
3. Camino recomendado de API: **Instagram API with Facebook Login (vía Facebook Login for Business)**, porque también cubre Páginas de Facebook con una sola app, un solo login y un solo review (sección 1.2).
4. Tiempo total realista: **4 a 10 semanas** desde que se empieza con los documentos hasta tener permisos aprobados (sección 8). La variable más grande es la Business Verification y las rondas de rechazo del App Review.

---

## 1. Tipo de app, producto y modos

### 1.1 Crear la app
- Tipo de app: **Business** (necesario para Facebook Login for Business). [V] https://developers.facebook.com/docs/facebook-login/facebook-login-for-business ("Your app must be a business type app").
- Casos de uso/productos a agregar: Instagram (Instagram API with Facebook Login), Facebook Login for Business, y para Páginas el uso de Pages API. WhatsApp se agrega después como producto aparte. [V parcial] https://developers.facebook.com/docs/instagram-platform/overview. La denominación exacta de los "casos de uso" en el Dashboard cambia; **[NV]** el nombre literal de cada caso de uso hoy.
- Vincular la app a un **Business Portfolio (Business Manager) de PropMatch** (a nombre de la empresa legal). [V] Business Verification: "connect your app to a Business in App Dashboard settings, then complete verification in Business Manager".

### 1.2 Instagram Login vs Facebook Login: cuál conviene

| | Instagram API with Instagram Login | Instagram API with Facebook Login |
|---|---|---|
| Permisos | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages` | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`, `pages_show_list`, `pages_read_engagement` |
| Credenciales del usuario | Instagram | Facebook |
| Requiere Página de FB vinculada | No | Sí |
| Publicar en Página de Facebook | No (solo Instagram) | Sí, misma app/login (con `pages_manage_posts`) |
| Insights/hashtag search/product tags | Limitado | Disponible |
| Servidor | graph.instagram.com | graph.facebook.com |

Fuente [V]: https://developers.facebook.com/docs/instagram-platform/overview. Para otras cuentas (no propias), ambos requieren Advanced Access; Facebook Login además App Review y Business Verification.

**Recomendación: Facebook Login for Business.** Motivos:
1. PropMatch también quiere publicar en **Páginas de Facebook**; eso solo existe con Facebook Login. Con Instagram Login habría que montar dos flujos y dos reviews.
2. Las inmobiliarias que publican en Instagram para vender propiedades suelen tener Página de FB igual (y para publicar con la API de Facebook Login es requisito).
3. Facebook Login for Business permite configuraciones (`config_id`) con los permisos y activos predefinidos, y tokens de usuario o BISU (System User de integración de negocio, que por defecto no expiran). [V] https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
4. Desventaja: más fricción para el cliente (debe tener Página vinculada y ser admin). Alternativa a evaluar más adelante: sumar Instagram Login para clientes sin Página. **[NV]** si conviene tener ambas en la misma app.

### 1.3 Modo Desarrollo vs Live
- **Development**: solo se pueden pedir permisos a usuarios con **rol en la app** (admin, developer, tester) y solo con access Standard/Advanced; datos de prueba visibles solo a esos roles. [V] https://developers.facebook.com/docs/development/build-and-test/app-modes
- **Live**: se pueden pedir permisos a cualquiera, pero solo los **aprobados en App Review**. [V] misma URL.
- Regla central: App Review es obligatorio si la app la va a usar alguien sin rol en la app (o en un Business que la reclamó). [V] https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review
- Consecuencia práctica: **todo el desarrollo y las pruebas con cuentas propias (la de PropMatch y las de 1 o 2 inmobiliarias amigas agregadas como Testers/Developers) se pueden hacer hoy en Development sin revisión**. Los clientes reales solo después del review.
- Los prerequisitos para pasar a Live (URL de política de privacidad, categoría, ícono 1024x1024, etc.) no figuran en la página consultada: **[NV]** confirmar en Dashboard > Configuración > Básica.

---

## 2. Permisos

Dependencias y requisito de review: [V] https://developers.facebook.com/docs/permissions

| Permiso | Para qué en PropMatch | Depende de | Requiere |
|---|---|---|---|
| `instagram_basic` | Leer id/usuario de la cuenta IG profesional conectada | `pages_show_list` (+ `pages_read_user_content` según doc) | App Review + Advanced Access |
| `instagram_content_publish` | Publicar foto, carrusel, story | `instagram_basic`, `pages_read_engagement`, `pages_show_list` | App Review + screencast del flujo de publicación |
| `pages_show_list` | Listar Páginas que administra el usuario y elegir cuál conectar | ninguna | App Review |
| `pages_read_engagement` | Requerido como dependencia de IG publish y de pages_manage_posts | `pages_show_list` | App Review |
| `pages_manage_posts` | Publicar fotos/texto en la Página de FB | `pages_read_engagement`, `pages_show_list` | App Review + demostrar creación y publicación |
| `instagram_manage_insights` | Solo si se muestran métricas de posts (opcional, fase 2) | `instagram_basic`, `pages_read_engagement`, `pages_show_list` | App Review + ejemplos de analytics |
| `business_management` | **No pedir** salvo necesidad real (más difícil de aprobar) | | App Review |

Notas:
- La doc de Instagram Content Publishing lista como permisos de Facebook Login: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, y `ads_management`/`ads_read` solo si el usuario tiene rol en la Página vía Business Manager. [V] https://developers.facebook.com/docs/instagram-platform/content-publishing. Es un caso común con inmobiliarias cuya Página está en un Business Manager: probarlo (ver riesgos). La necesidad real de `ads_*` queda **[NV]**; no pedirlos de entrada.
- Publicar fotos en Página: token de Página de alguien con tarea `CREATE_CONTENT`; requiere `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`. Se pasa `url` pública de la foto, `message`, y para multi-foto `attached_media` en `/{page-id}/feed`. Máx. 4 MB por foto subida. [V] https://developers.facebook.com/docs/graph-api/reference/page/photos/
- Los endpoints de media de Instagram requieren token de **usuario** (no de Página). [V] https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- Los 21 permisos "restringidos" exigen condición de Tech Provider además del App Review. [V] https://developers.facebook.com/docs/development/release/tech-providers. **[NV]** si `pages_manage_posts` o `instagram_content_publish` están en esa lista de 21; la página no la reprodujo. Asumir que sí.
- Mensajes privados (`instagram_manage_messages`, `pages_messaging`): **no pedir**. Pedir de más es motivo de rechazo.
- Si se elige Instagram Login en el futuro: `instagram_business_basic` + `instagram_business_content_publish` (dependencia entre ambos). [V] permissions doc.

---

## 3. Business Verification

**Qué es:** proceso para confirmar que sos una empresa real, en Business Manager > Centro de seguridad. Obligatorio para apps que dan acceso avanzado y permiten a otros negocios acceder a sus datos (vigente desde 1/2/2023). Sin ella, usuarios de otros negocios no pueden otorgar permisos y las funciones quedan inactivas. [V] https://developers.facebook.com/docs/development/release/business-verification

**Quién se verifica:** **PropMatch** (la entidad legal dueña de la app/Business Portfolio). Las inmobiliarias clientes **no**: solo se loguean y autorizan. [V] (el requisito aplica a la empresa que posee la app; "apps usadas solo por usuarios con rol en la app no requieren verificación").

**Documentación para empresa argentina [NV, fuente de terceros]:** constancia de inscripción de ARCA/AFIP con CUIT (razón social exacta), más comprobante de domicilio que coincida con la dirección legal (factura de luz, agua, internet). Fuente: https://docs.360dialog.com/docs/resources/meta-business-verification (proveedor BSP; no es Meta). Otros posibles: estatuto/contrato social, factura de servicios, extracto bancario (**[NV]**). Si PropMatch es persona física/monotributista, verificar si Meta acepta ese tipo de entidad: **[NV]**, confirmar en el flujo.

Preparación recomendada:
- Nombre del Business Portfolio **idéntico** a la razón social del documento.
- Dirección y teléfono idénticos a los de la constancia.
- Sitio web propio con dominio de la empresa, con nombre legal, datos de contacto, política de privacidad y términos; correo con ese dominio. Verificar el dominio en Business Manager (Brand Safety > Dominios).
- Activar 2FA en las cuentas admin.

**Tiempos [NV, terceros]:** hasta 14 días hábiles según 360dialog (https://docs.360dialog.com/docs/resources/meta-business-verification); en la práctica, de 1 día a 2-3 semanas con reintentos. Seguimiento en el Centro de seguridad.

**Causas comunes de rechazo [NV, terceros]** (https://chakrahq.com/article/meta-business-verification-rejected-reasons, https://support.chatarchitect.com/books/general-information/page/common-reasons-for-facebook-business-manager-verification-rejection):
- Nombre del portfolio distinto (aunque sea parecido) a la razón social del documento.
- Dirección o teléfono que no coinciden.
- Dominio sin relación con el nombre de la empresa, sitio en construcción o sin datos de contacto.
- Documentos vencidos, ilegibles o recortados.

**Pasos adicionales tras verificar:** vincular la app al Business, y completar **Access Verification** (admin del Business). Sin eso no se obtiene estado de Tech Provider. [V] https://developers.facebook.com/docs/development/release/tech-providers. La verificación puede revocarse si se pierde la Business Verification o hay restricciones. [V] misma URL.

---

## 4. App Review

### 4.1 Pasos
1. Dashboard completo: ícono, categoría, **URL de política de privacidad**, **URL de términos**, **URL/callback de borrado de datos**, contacto, dominio de la app.
2. Business Verification iniciada (idealmente aprobada) y app vinculada al Business.
3. Dashboard > App Review > Permisos y funciones: pedir **Advanced Access** de cada permiso. Para cada uno: justificación en texto + screencast + instrucciones para el revisor + credenciales de prueba.
4. Enviar. Responder las observaciones y reenviar.
5. Pasar a Live al aprobar.
6. Mantenimiento: completar el **Data Use Checkup** periódico (cada año) **[NV]**; no hacerlo puede revocar permisos.

Meta verifica que la app implementa realmente el permiso: "If we are unable to access your app to test it, your entire submission will be rejected"; si no se puede probar la funcionalidad de un permiso, se deniega ese permiso. [V] https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review

### 4.2 Qué preparar
- **Política de privacidad** pública, sin login, en HTTPS, con: qué datos se leen de Meta (ID de cuenta, nombre de Página, tokens), para qué, con quién se comparten (Supabase/Vercel como encargados), retención, cómo borrar, contacto, y mención a la Ley 25.326 de Protección de Datos Personales (Argentina). Debe ser accesible desde la pantalla de conexión de la app (los revisores lo piden en el screencast [NV, terceros]).
- **Términos del servicio** públicos.
- **Borrado de datos**: o bien URL de instrucciones, o bien **callback HTTPS** que reciba el `signed_request`, valide HMAC-SHA256 con el app secret, borre los datos del `user_id` y responda `{ url, confirmation_code }`. [V] https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback. Meta envía además avisos cada 21 días con ids pendientes de borrado (misma fuente).
- **Cuenta de prueba para el revisor**: una cuenta de PropMatch (login con usuario/clave que el revisor pueda usar sin 2FA ni captcha) ya cargada con propiedades de ejemplo. Un usuario de Facebook de prueba con Página + IG profesional vinculada, o instrucciones para usar una de ustedes agregada como Tester. **[NV]** si Meta permite Test Users para IG real: normalmente se usa una cuenta real dedicada, no personal.
- **Screencast** por permiso (o uno largo que los cubra, con subtítulos/índice por permiso): ver guion en sección 9.2. Formato **[NV]** (consenso de terceros): MP4, 1080p, con voz o subtítulos en inglés, mostrar el flujo completo desde la primera autorización OAuth (borrar antes la conexión previa; si no, el consentimiento no se ve), URL del dominio visible, sin cortes. La doc oficial de formato no fue accesible; confirmar límites de tamaño/duración en el formulario.
- **Justificación** por permiso (sección 9.1).
- Apps de prueba en Development: la app debe estar funcional y accesible para el revisor (el sitio en producción, no localhost).

### 4.3 Errores frecuentes [NV, terceros]
Fuentes: https://www.saurabhdhar.com/blog/6-meta-app-review-approvals-in-one-day-our-secrets, https://botsailor.com/blog/how-to-submit-for-instagram-app-permission-approval-for-botsailor-whitelabel-agency-users, https://docs.mixpost.app/services/social/facebook/app-review/
- Screencast incompleto o sin mostrar el consentimiento OAuth.
- Usar cuenta personal de IG en la demo (la API solo funciona con Business/Creator).
- Cuenta IG no vinculada a Página o no demostrado.
- Credenciales de prueba que no funcionan, con 2FA o con paywall.
- Pedir permisos que la app no usa.
- Mostrar publicación masiva sin acción explícita del usuario por cada post. PropMatch debe mostrar que el usuario presiona "Publicar" (o programa explícitamente).
- Desalineación entre justificación, video e instrucciones.

### 4.4 Tiempos [NV]
Un tercero estima 2 a 6 semanas para `instagram_content_publish` con varias rondas (https://www.blotato.com/blog/instagram-api-pricing, "Meta App Review for Advanced Access ... 2 to 6 weeks"). Otros reportan días por permiso. Estimación de planificación: **1 a 3 semanas por ronda, 1 a 3 rondas**.

---

## 5. Requisitos de las cuentas de los clientes

- **Instagram**: cuenta **profesional** (Business o Creator), no personal. [V] requisito de la API: "Instagram professional account connected to a Page" https://developers.facebook.com/docs/instagram-platform/content-publishing
- **Vínculo con una Página de Facebook** (en el flujo de Facebook Login). [V] https://developers.facebook.com/docs/instagram-platform/overview
- **Rol**: el usuario que autoriza debe poder administrar la Página (para Página: tarea `CREATE_CONTENT`; para IG vía Página, con acceso a la cuenta IG). [V parcial] page/photos doc. **[NV]** nivel exacto de rol (Admin vs Editor) para IG publish; pedir "Administrador" es lo más seguro.
- Si la Página está dentro de un Business Manager del cliente, puede ser necesario que el usuario tenga acceso con control total sobre el activo; en esos casos la doc menciona `ads_management`/`ads_read` (ver sección 2). Probar con una cuenta real así.
- Requisito de **Page Publishing Authorization (PPA)** si aplica a la Página. [V] mencionado en content-publishing doc; **[NV]** cuándo se exige.
- **Flujo OAuth (usuario final)**: botón "Conectar Instagram/Facebook" en PropMatch > diálogo de Facebook Login for Business con la `config_id` > el usuario elige Páginas y cuentas IG a compartir y acepta permisos > redirect con `code` > el servidor lo canjea por token de usuario (long-lived) o BISU > se guarda cifrado > se obtiene la Página y su `instagram_business_account`. Tokens cifrados en Supabase; nunca en el frontend. [V parcial] https://developers.facebook.com/docs/facebook-login/facebook-login-for-business

---

## 6. Límites y reglas de publicación

Fuentes: https://developers.facebook.com/docs/instagram-platform/content-publishing y https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media

| Tema | Regla | Estado |
|---|---|---|
| Formato de imagen | **Solo JPEG** (MPO y JPS no) | [V] |
| Tamaño de imagen | máx. 8 MB | [V] (ig-user/media) |
| Relación de aspecto | entre 4:5 y 1.91:1 | [V] |
| Ancho | mín. 320 px, máx. 1440 px | [V] |
| Carrusel | hasta 10 ítems (imágenes/videos); todas se recortan según la primera (por defecto 1:1) | [V] |
| Mínimo del carrusel | 2 ítems | [NV] (consenso de terceros; no aparece en lo consultado) |
| Caption | máx. 2200 caracteres, 30 hashtags, 20 @tags | [V] |
| Límite diario | **100 posts publicados por API en 24 h móviles**; carrusel cuenta como 1. Consultable con `GET /{ig-id}/content_publishing_limit` | [V] (docs actuales). Algunos terceros dicen 50: usar el endpoint como verdad. |
| ¿Stories cuentan en el límite? | no aclarado | [NV] |
| Expiración del contenedor | 24 h sin publicar -> `EXPIRED` | [V] |
| Media debe estar en URL pública accesible | sí | [V] |
| Stories | `media_type=STORIES`, expiran a las 24 h; no se pueden publicar stickers interactivos; mencionar usuarios sin sticker sí | [V] |
| Stories imagen | JPEG, relación recomendada 9:16 | [NV] (terceros) |
| Links clicables en caption | **No** son clicables en feed (limitación de Instagram) | [NV]: la doc de Meta no lo trata; es comportamiento conocido. Poner "link en bio" o el sitio como texto. |
| No soportado | filtros, shopping tags (en la doc de publishing) | [V] |

**Flujo de contenedores:**
1. Imagen única: `POST /{ig-id}/media` con `image_url` y `caption` -> devuelve `container_id` -> `POST /{ig-id}/media_publish` con `creation_id`.
2. Carrusel: crear cada hijo con `is_carousel_item=true` -> `POST /{ig-id}/media` con `media_type=CAROUSEL` y `children=id1,id2,...` -> `media_publish`.
3. Story: `POST /{ig-id}/media` con `media_type=STORIES` e `image_url` -> `media_publish`.
4. Antes de publicar, consultar `GET /{container_id}?fields=status_code` hasta `FINISHED`. [V] content-publishing doc.

**Implicancia para PropMatch:** las fotos de propiedades suelen ser PNG/WebP o con relación 16:9 (1.78, ok) o 3:2; hay que **convertir a JPEG, validar relación 4:5 a 1.91:1 y que el primer ítem del carrusel defina el recorte**. Alojarlas en una URL pública (Supabase Storage público o URL firmada de vida suficiente).

**Facebook Page:** fotos hasta 4 MB subidas (formatos jpeg, bmp, png, gif, tiff), Facebook elimina metadatos de ubicación. [V] https://developers.facebook.com/docs/graph-api/reference/page/photos/

**Rate limit general de lectura:** `4800 * impresiones` llamadas en 24 h por par app-usuario. [V] https://developers.facebook.com/docs/instagram-platform/overview. Usar webhooks en vez de polling.

---

## 7. WhatsApp Cloud API (resumen, para pedir junto con la verificación)

- **Tech Provider + Embedded Signup**: Embedded Signup deja que los clientes creen/conecten su WABA y número desde PropMatch; devuelve WABA ID, phone number ID y un código para canjear por token. Permisos: `whatsapp_business_management` y `whatsapp_business_messaging`, ambos con Advanced Access. [V] https://developers.facebook.com/docs/whatsapp/embedded-signup/overview
- Sin Advanced Access no se pueden onboardear clientes. Por defecto el límite es **10 clientes por ventana móvil de 7 días**; con Business Verification + App Review + Access Verification sube a **200 por semana**. [V] misma URL.
- Cada cliente debe cargar **su propio medio de pago** en su WABA (los Tech Providers no comparten línea de crédito). [V] misma URL. **[NV]** si PropMatch quiere ser Solution Partner con línea de crédito: es un programa distinto.
- **Plantillas**: mensajes fuera de la ventana de 24 h deben ser plantillas aprobadas (categorías marketing, utility, authentication). **[NV]** tiempos de aprobación de plantillas (suelen ser minutos a horas).
- **Costos**: desde 1/7/2025 se cobra **por mensaje de plantilla entregado**: marketing siempre cobrado; utility y authentication cobrados fuera de la ventana de servicio; mensajes no-plantilla dentro de la ventana de 24 h gratis; utility dentro de ventana, gratis; 72 h gratis desde anuncios Click-to-WhatsApp. [V] https://developers.facebook.com/docs/whatsapp/pricing
- **Argentina**: es un mercado con tarifa propia y facturación en **ARS disponible desde 1/4/2025** (para negocios con país "Sold-To" Argentina). [V] https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing. **Las tarifas numéricas no pude obtenerlas**: la tabla es interactiva (https://whatsappbusiness.com/es-la/products/platform-pricing/) y hay CSV/PDF en la doc de rate cards. **[NV]** valores: descargar el CSV de Argentina.
- Registrar la intención de usar WhatsApp en el mismo review inicial **no es necesario**; es mejor un segundo submission posterior para no frenar el de Instagram. Lo que sí conviene hacer ya: tener la Business Verification (se reutiliza).

---

## 8. Plan de tareas con orden, dependencias y paralelismo

### Decisión previa (día 0, bloqueante): titularidad
- El **Business Portfolio y la app deben ser de la empresa legal de PropMatch** (razón social con CUIT), no de una cuenta personal de Facebook. Si PropMatch aún no tiene entidad con CUIT propio (SAS, SRL o monotributo a nombre de Valentín/Lucas): **definir quién es el titular antes de nada**, porque la Business Verification se hace sobre esa entidad. Si la empresa es un socio (Lucas) y la app la crea otra persona, hay que alinear el nombre del Business con la constancia de ARCA.
- Usar una cuenta de Facebook personal real del titular o representante como admin del Business, con 2FA, **y una segunda persona como admin de respaldo** (evita quedar bloqueados). **[NV]** cuenta personal nueva o sin historial puede disparar revisiones: usar una con antigüedad.

### Orden y dependencias

| # | Tarea | Depende de | Duración estimada | Paralelo desde hoy |
|---|---|---|---|---|
| 1 | Definir titular legal y reunir: constancia de inscripción ARCA con CUIT, comprobante de domicilio coincidente, (estatuto si es sociedad) | - | 1-3 días | Sí |
| 2 | Publicar sitio de PropMatch en dominio propio, con nombre legal, domicilio, contacto; email del dominio | - | 2-5 días | Sí |
| 3 | Redactar y publicar **Política de Privacidad** (URL pública), **Términos**, **página de borrado de datos** (instrucciones) | - | 2-4 días | Sí |
| 4 | Crear Business Portfolio con nombre exacto de la razón social, verificar dominio, activar 2FA | 1, 2 | 1 día | Tras 1-2 |
| 5 | **Iniciar Business Verification** | 4 | 1 día a 3 semanas (hasta 14 días hábiles reportado) | - |
| 6 | Crear la app (tipo Business) en Development, vincularla al Business, completar datos básicos y URLs | 3, 4 | 1 día | Sí, en paralelo con 5 |
| 7 | Desarrollar: login con Facebook Login for Business, OAuth callback, almacenamiento cifrado de tokens, publicar foto/carrusel/story en IG, foto/texto en Página, callback de borrado de datos | 6 (basta Development) | 1-3 semanas | Sí, en paralelo con 5 |
| 8 | Probar con roles (tu cuenta + 1-2 inmobiliarias amigas como Tester) en Development | 7 | 3-5 días | Sí |
| 9 | Preparar cuenta de prueba para el revisor, datos de ejemplo, grabar screencasts (sección 9) | 8 | 2-3 días | - |
| 10 | **Enviar App Review** (todos los permisos de publicación juntos) | 5 aprobada (idealmente), 9 | 1-3 semanas por ronda | - |
| 11 | Access Verification / estado Tech Provider; pasar a Live | 5, 10 | días | - |
| 12 | Piloto con 1-2 clientes reales | 11 | 1 semana | - |
| 13 | WhatsApp: Embedded Signup, plantillas, segundo review | 11 | 2-4 semanas | Recién después |

**Tiempo total estimado:** camino crítico = Business Verification (1-3 sem) -> App Review (1-3 sem x 1-3 rondas) = **4 a 10 semanas** desde hoy, asumiendo que desarrollo, páginas públicas y documentos corren en paralelo. Escenario optimista: ~4 semanas. Escenario con un rechazo de verificación y dos rondas de review: ~10 semanas.

**Hacer YA en paralelo (sin depender de nadie):** tareas 1, 2, 3 y el desarrollo (7) en modo Development con tu cuenta y testers.

---

## 9. Plantillas de texto

### 9.1 Justificación por permiso (copiar y adaptar)

**Descripción general de la app (EN):**
> PropMatch is a CRM for real-estate agencies in Argentina. Agency staff manage property listings (photos, price, description). With PropMatch, an authorized agency user connects the agency's Instagram professional account and Facebook Page and publishes their own property listings (photos and caption text) to those accounts. PropMatch does not read private messages, does not post without an explicit user action, and does not access personal profiles.

**`pages_show_list`**
- EN: "After the agency admin logs in with Facebook, PropMatch lists the Pages that person manages so they can pick the agency's Page to connect. Without this permission we cannot show the Page selection step or identify the Instagram account linked to the chosen Page."
- ES: "Luego del login, PropMatch muestra las Páginas que administra el usuario para que elija la de su inmobiliaria. Sin este permiso no se puede identificar la Página ni la cuenta de Instagram vinculada."

**`pages_read_engagement`**
- EN: "Required as a dependency to read basic Page metadata (name, ID, linked Instagram professional account) and to publish content via the Page and Instagram APIs. We display the connected Page name and linked Instagram username in the integration settings screen. We do not use it to analyze followers."
- ES: "Se requiere como dependencia para leer metadatos básicos de la Página (nombre, ID, cuenta de Instagram vinculada) y para publicar. Mostramos el nombre de la Página y el usuario de Instagram conectados."

**`instagram_basic`**
- EN: "We read the Instagram professional account's ID and username to confirm which account the agency connected, show it in the settings screen, and as the target of the publish request."
- ES: "Leemos el ID y el nombre de usuario de la cuenta profesional de Instagram para confirmar qué cuenta conectó la inmobiliaria y usarla como destino de la publicación."

**`instagram_content_publish`**
- EN: "The agency user selects a property in PropMatch, chooses photos (up to 10 for a carousel) and edits the caption, then presses 'Publish to Instagram' (feed post, carousel or story). PropMatch creates a media container and publishes it to the agency's own Instagram professional account via /media and /media_publish. Every publication is initiated by an explicit user click; there is no bulk or automatic posting without user confirmation. We use it only to publish content the agency created for its own listings."
- ES: "El usuario elige una propiedad, selecciona fotos (hasta 10 para carrusel), edita el texto y presiona 'Publicar en Instagram' (post, carrusel o story). PropMatch crea el contenedor y lo publica en la cuenta de la propia inmobiliaria. Toda publicación requiere un clic explícito del usuario."

**`pages_manage_posts`**
- EN: "The agency user presses 'Publish to Facebook' on a property and PropMatch creates a post with the photos and description on the agency's own Facebook Page. We do not edit or delete posts not created by PropMatch, and we do not publish without user action."
- ES: "El usuario presiona 'Publicar en Facebook' y PropMatch crea una publicación con fotos y descripción en la Página de su inmobiliaria. No editamos ni borramos publicaciones ajenas ni publicamos sin acción del usuario."

**`instagram_manage_insights` (solo si se implementa)**
- EN: "We show reach, likes and comments count for posts published through PropMatch so agents can see which property listings perform best."
- ES: "Mostramos alcance y cantidad de likes/comentarios de las publicaciones hechas desde PropMatch, para que la inmobiliaria vea qué propiedades funcionan mejor."

**Mensajes privados:** no solicitar. Si se pidiera más adelante (`instagram_manage_messages`), requiere un review aparte con su propio caso de uso.

**Notas para el revisor (EN):**
> Test login: URL https://<dominio>/login, user <email>, password <clave>. No 2FA. Go to Settings > Integrations > Connect Instagram/Facebook. Use the test Facebook account <...> (provided separately) which manages Page "<...>" linked to Instagram professional account "@<...>". Then open Properties > any property > Publish. Privacy policy: <URL>. Data deletion: <URL>.

### 9.2 Guion del screencast (≈4-6 min, 1080p, un solo plano continuo, subtítulos en inglés)

Preparar: la app ya desconectada de la cuenta de prueba (para mostrar el consentimiento desde cero); cuenta IG profesional vinculada a una Página; idioma de Facebook en inglés si es posible.

1. (0:00) Mostrar la URL de producción en la barra del navegador. Decir/subtitular: "This is PropMatch, a CRM for real-estate agencies."
2. Login en PropMatch con la cuenta de prueba. Abrir Settings > Integrations. Mostrar el enlace visible a Política de Privacidad y Términos; abrirlo brevemente.
3. Clic en "Connect with Facebook". Mostrar el diálogo de Meta completo: pantalla de login, selección de Páginas/cuentas IG, **lista de permisos solicitados** y botón Continuar. Subtitular qué permiso se está concediendo (`pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `pages_manage_posts`).
4. Volver a PropMatch: mostrar la lista de Páginas (`pages_show_list`) y elegir la Página; mostrar el nombre de la Página y el @usuario de IG obtenidos (`pages_read_engagement`, `instagram_basic`).
5. Abrir una propiedad con 3 fotos. Clic en "Publish to Instagram" > carrusel > editar caption > confirmar. Mostrar el estado "Publishing..." y luego "Published". (`instagram_content_publish`)
6. Abrir instagram.com/app con la cuenta y **mostrar el post publicado** con fotos y texto. Repetir con una story (mostrarla en la app de IG).
7. Volver a PropMatch > "Publish to Facebook" > confirmar. Abrir la Página de Facebook y mostrar la publicación. (`pages_manage_posts`)
8. Mostrar Settings > Disconnect y la página de borrado de datos; opcionalmente remover la app desde Facebook > Configuración > Apps y mostrar que se dispara el borrado. (callback de borrado)
9. Cierre: "PropMatch publishes only when the user clicks Publish, and does not access messages."

Un video por permiso o uno solo con **marcadores de tiempo** en la descripción de cada permiso. **[NV]** confirmar en el formulario cuántos videos admite por permiso.

---

## 10. Riesgos y preguntas abiertas

**Riesgos**
1. **Titularidad/Business Verification**: si PropMatch no tiene entidad con CUIT propio o el nombre no coincide exacto con la constancia, se rechaza y se pierden semanas. Mitigación: resolver titular y datos antes de iniciar.
2. **Rechazos de App Review por screencast/cuenta de prueba**: la causa más común en fuentes de terceros. Cada ronda cuesta 1-3 semanas. Mitigación: probar el guion con un tercero y que las credenciales funcionen sin 2FA.
3. **Fricción de los clientes con la Página de Facebook y roles**: muchas inmobiliarias tienen la cuenta IG sin Página vinculada o la Página dentro de un Business Manager gestionado por una agencia/community manager; el flujo falla sin que PropMatch pueda hacer nada. Mitigación: guía de onboarding, detección de errores claros, y evaluar sumar Instagram Login como segunda vía.
4. Cambios de política/nombres de permisos de Meta (la plataforma renombra casos de uso seguido). Revalidar en el Dashboard.
5. Tokens: expiración/revocación; guardar cifrados y manejar reconexión.
6. Cumplimiento: Ley 25.326 (datos personales) y reglas de Meta (Platform Terms); no usar datos de Meta para otros fines.
7. Imágenes: conversión a JPEG y relación de aspecto; fallas silenciosas del contenedor.

**Preguntas abiertas (a resolver con el Dashboard o con Meta)**
- ¿Quién será el titular legal (razón social/CUIT) del Business? ¿Existe ya?
- ¿Lista exacta de documentos que acepta Meta para Argentina hoy y si acepta monotributistas? [NV]
- ¿`pages_manage_posts` e `instagram_content_publish` están entre los 21 permisos que exigen Tech Provider? (asumir que sí) [NV]
- ¿Se exige `ads_management`/`ads_read` cuando la Página está en un Business Manager del cliente? [NV]
- ¿Los Stories cuentan en el tope de 100 posts/24 h? [NV]
- Tarifas WhatsApp en ARS para utility/marketing: descargar CSV oficial. [NV]
- ¿Se pedirá insights en la primera ronda? Recomendado **no**: menos permisos, menos riesgo.
- ¿Instagram Login como segunda opción para clientes sin Página? decisión de producto.

---

## Fuentes consultadas (oficiales, [V])
- https://developers.facebook.com/docs/instagram-platform/overview
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
- https://developers.facebook.com/docs/permissions
- https://developers.facebook.com/docs/development/release/business-verification
- https://developers.facebook.com/docs/development/release/tech-providers
- https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review
- https://developers.facebook.com/docs/development/build-and-test/app-modes
- https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- https://developers.facebook.com/docs/graph-api/reference/page/photos/
- https://developers.facebook.com/docs/whatsapp/embedded-signup/overview
- https://developers.facebook.com/docs/whatsapp/pricing
- https://developers.facebook.com/docs/whatsapp/pricing/updates-to-pricing
- https://whatsappbusiness.com/es-la/products/platform-pricing/

## Fuentes de terceros ([NV])
- https://docs.360dialog.com/docs/resources/meta-business-verification
- https://chakrahq.com/article/meta-business-verification-rejected-reasons
- https://support.chatarchitect.com/books/general-information/page/common-reasons-for-facebook-business-manager-verification-rejection
- https://www.blotato.com/blog/instagram-api-pricing
- https://www.saurabhdhar.com/blog/6-meta-app-review-approvals-in-one-day-our-secrets
- https://botsailor.com/blog/how-to-submit-for-instagram-app-permission-approval-for-botsailor-whitelabel-agency-users
- https://docs.mixpost.app/services/social/facebook/app-review/
