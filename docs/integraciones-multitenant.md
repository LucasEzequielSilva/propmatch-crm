# Integraciones multi-inmobiliaria (portales)

Fecha: 2026-10-06. Rama `feat/integraciones-multitenant`.

PropMatch es un SaaS para muchas inmobiliarias. Cada inmobiliaria conecta **sus** cuentas de portales con el flujo oficial de cada portal: OAuth cuando existe, o credenciales emitidas por el portal cuando ese es el mecanismo. Nadie copia tokens ni claves técnicas a mano. El dueño de PropMatch configura cada portal **una sola vez**: la app, el alta de integrador y las variables de entorno.

## 1. Modelo

```
Organization  = agencies
  └─ Portal Connection  = agency_integrations   (UNIQUE agency_id+provider; secretos cifrados)
       └─ Publication   = property_publications  (UNIQUE property_id+channel; connection_id → conexión usada)

Propiedad ──► Engine (api/_lib/integrations/engine.ts)
                 ├─ resuelve la conexión de la agencia DEL USUARIO (JWT → agency_members)
                 ├─ Adapter.validate / Adapter.publish   (api/_lib/integrations/adapters/*)
                 │      └─► API del portal
                 └─ guarda property_publications (+ connection_id) y devuelve un resultado por portal
```

- `agency_integrations.provider` admite `mercadolibre`, `meta` (Facebook e Instagram son una sola conexión), `argenprop`, `zonaprop`, `cabaprop`, `properati` y `whatsapp`.
- Columnas nuevas, en la migración sin aplicar:
  - `auth_method`: `oauth`, `credentials`, `api_key` o `feed`.
  - `last_error`: el último problema, en texto legible para la inmobiliaria.
  - `last_checked_at`
  - `property_publications.connection_id`
- **Compatibilidad**: el código funciona con y sin la migración.
  - `api/_lib/integrations/dbCompat.ts` detecta la columna faltante (PostgREST `PGRST204` o Postgres `42703`).
  - En ese caso reintenta sin las columnas nuevas y lo recuerda por proceso.
  - Deployar antes de aplicar el SQL no rompe nada: simplemente no se guardan `last_error` ni `connection_id`.

## 2. Piezas

| Pieza | Archivo |
|---|---|
| Contrato `PortalAdapter` (id, nombre, authMethod, availability, status, connect, disconnect, refresh, validate, publish, update, lifecycle (pausar/activar/cerrar/sincronizar), mapStatus) | `api/_lib/integrations/types.ts` |
| Registro de adapters (servidor) | `api/_lib/integrations/registry.ts` |
| Motor | `api/_lib/integrations/engine.ts` (sin imports de runtime, se prueba sin red) |
| Endpoint (7.ª función de Vercel) | `api/integrations.ts` → `/api/integrations/{list,connect,disconnect,credentials,check,publish}` |
| Mercado Libre | `adapters/mercadolibre.ts`: toda la lógica que antes estaba en `routes/meli/*`. Esos handlers siguen con las mismas URLs y respuestas y ahora delegan en el adapter. |
| Meta | `adapters/meta.ts`: adapter externo (ver §4) |
| Argenprop | `adapters/argenprop.ts` + `argenpropCredentials.ts` |
| Zonaprop | `adapters/zonaprop.ts`: esqueleto "no disponible" |
| Destino tras el OAuth | `returnTo.ts`: lista cerrada (`publicador`, `integraciones`) |
| Registro del cliente (logo, nombre, textos, ayuda) | `src/lib/integrations/registry.ts` |
| UI | `src/features/integraciones/*`: `/configuracion/integraciones` y el diálogo «Publicar en portales» |

Funciones de Vercel: `meli`, `inbox`, `whatsapp`, `meta`, `proppi`, `web` y `integrations` (7 en total). No cambia ninguna URL registrada: `/api/meli/callback`, `/api/meli/notifications` y `/api/whatsapp/webhook` siguen iguales.

## 3. Qué hace cada uno

### El dueño de PropMatch (una vez por portal)

| Portal | Paso único |
|---|---|
| Mercado Libre | Ya hecho: hay una app de PropMatch con `MELI_CLIENT_ID`, `MELI_CLIENT_SECRET`, `MELI_REDIRECT_URI` y scope `offline_access`, y las notificaciones apuntan a `/api/meli/notifications`. Pendiente a futuro: certificar la app (ver §6). |
| Meta | App Review de `pages_manage_posts` e `instagram_content_publish`, y después `META_PUBLISH_ENABLED=1` (ver `docs/meta-app-review-checklist.md`). |
| Argenprop | Pedir a Argenprop el **alta como integrador** y la especificación de la API de publicación. Probablemente PropMatch reciba un IdOrigen propio (sin confirmar). Recién entonces: implementar `publish` en el adapter y prender `ARGENPROP_CREDENTIALS_ENABLED=1`. |
| Zonaprop | Pedir el **alta como integrador** (atencionainmobiliarias@zonaprop.com, sin confirmar) y obtener las credenciales OAuth del integrador. Es el trámite más incierto. |

### Cada inmobiliaria

1. Un **administrador** entra a Configuración → Integraciones.
2. Toca «Conectar» en el portal:
   - Mercado Libre: inicia sesión **en Mercado Libre** con la cuenta principal de la inmobiliaria y acepta. Vuelve a Integraciones con un aviso de éxito o de error.
   - Argenprop, cuando esté habilitado: pega en el formulario guiado los datos que Argenprop le mandó por mail.
3. Publica desde la ficha de la propiedad o desde `/publicador/:id` con «Publicar en portales». Elige los portales, completa los faltantes ahí mismo y ve el resultado de cada portal.

Los agentes que no son administradores ven el estado de las conexiones pero no pueden conectar ni desconectar. El servidor lo exige con `requireAgencyAdmin`.

## 4. Decisiones

- **Mercado Libre: comportamiento igual.**
  - `runMeliAction` es el cuerpo de `publish.ts`, movido tal cual: devuelve el mismo status y el mismo JSON. La única diferencia es `updatedExisting: true` cuando «publicar» terminó actualizando un aviso que ya existía.
  - Se mantienen:
    - el caso 402 (pendiente de pago: se guarda el id para no duplicar);
    - el bloqueo por doble clic (`in_progress`);
    - la regla «publicar sobre un aviso vivo = actualizar»;
    - el refresh con escritura condicional.
  - `getMeliSession` ahora además devuelve `connectionId`.
- **Vuelta del OAuth.** `POST /api/meli/connect` (y `/api/integrations/connect`) acepta `return: "integraciones" | "publicador"`.
  - Ese valor viaja **cifrado en la cookie**.
  - El callback arma `APP_URL + path fijo`. Cualquier otro valor vuelve al publicador, como antes.
  - Los motivos de error se filtran con `^[a-z_]+$`. No hay redirección abierta.
- **Meta no pasa por el motor.**
  - La conexión se hace con el SDK de Facebook en el navegador, no con un redirect del servidor.
  - El posteo lo redacta la persona (texto y fotos), y en Instagram son dos pasos con espera.
  - Envolverlo obligaría a cambiar el flujo que funciona. Por eso `MetaAdapter` informa el estado y desconecta, y el diálogo lleva al panel de Meta.
- **Propiedades de ejemplo.**
  - No existen en la base: nunca se sincronizan.
  - Además, el cliente manda `isSample` y el motor corta antes de tocar un portal.
  - El diálogo también lo bloquea.
- **Aislamiento.**
  - `agencyId` sale siempre del JWT.
  - La propiedad se verifica contra esa agencia, y cada adapter lee solo `agency_id = scope.agencyId`.
  - La migración agrega un trigger que impide apuntar `connection_id` a una conexión de otra agencia.

## 5. Seguridad

- **Cifrado.** Los tokens OAuth y las credenciales de Argenprop se guardan con AES-256-GCM (`INTEGRATIONS_ENC_KEY`, solo en el servidor) en `access_token_enc` y `refresh_token_enc`. Las credenciales de Argenprop van como JSON cifrado en `access_token_enc`.
- **Lectura desde el navegador.** Hay grants por columna: `authenticated` no puede leer los secretos. La migración suma `auth_method`, `last_error` y `last_checked_at` a los grants de lectura.
- **Escritura.** Solo la service role escribe `agency_integrations`.
- **Lo que llega a la UI.** El cliente nunca recibe ids externos de la cuenta ni tokens. Ve solo la etiqueta: el nickname, o el usuario de Argenprop enmascarado (`inm***@api.com`).
- **Refresh.** El refresh token de Mercado Libre es de un solo uso. Por eso el update es condicional al token leído.
  - Si Mercado Libre rechaza la credencial (400 o 401), la conexión pasa a `needs_reauth` con un `last_error` legible. La UI muestra «Requiere reconectar».
  - Una caída de Mercado Libre (5xx o error de red) no la marca así.
- **Revocación.**
  - Al desconectar Mercado Libre se llama `DELETE /users/{id}/applications/{app}` (mejor esfuerzo) y se borra la fila.
  - Meta y Argenprop borran la fila. Argenprop no tiene un endpoint de revocación documentado.
  - Lo ya publicado en los portales queda publicado.
- **Una cuenta, una inmobiliaria.** Una cuenta externa pertenece a una sola inmobiliaria: hay un índice único `provider + external_account_id`, y se chequea antes de guardar.

## 6. Investigación (con fuentes; lo no confirmado está marcado)

### Argenprop

- **Confirmado:** no hay OAuth. Argenprop manda por mail credenciales de integración que son distintas del login del portal: un usuario `xxx@api.com`, una contraseña y un IdAnunciante.
  - Con el login normal, la cuenta figura como conectada pero no publica.
  - Fuente: https://help.mapaprop.com/en/help/mi-inmobiliaria/configuracion/conectar-cuentas/conectar-con-argenprop
- **Confirmado:** 2clics pide USR, PSD, IdVendedor e IdOrigen. Según 2clics, al solicitar la integración «todos los anuncios que tenga activos serán desactivados». Mapaprop dice que Argenprop «puede» darlos de baja.
  - Fuente: https://ayuda.2clics.app/es/articles/8295818-como-configurar-argenprop-en-la-aplicacion
- **Confirmado:** hace falta una suscripción por puntos, y los avisos publicados por CRM no se editan desde el portal.
  - Fuente: https://help.mapaprop.com/en/help/propiedades/publicacion/argenprop
- **Contexto:** Argenprop tiene su propio CRM gratuito (https://gestion.argenprop.com/). La página de canales oficiales no muestra un contacto de integraciones (https://www.argenprop.com/canales-oficiales). Existe una copia vieja de la especificación «API de Publicación de Avisos v4.0» (https://es.scribd.com/document/282711473/API-de-Publicacion-Argenprop); no se usó para escribir código.
- **Sin confirmar:**
  - endpoints públicos, endpoint de login o verificación, feed XML;
  - cómo se da de alta un integrador;
  - si el IdOrigen identifica al CRM (inferencia).
- **Diseño:** formulario de credenciales cifradas con `auth_method='credentials'`, **sin verificación** porque no hay endpoint documentado, y apagado hasta tener el alta de integrador.

### Zonaprop

- **Confirmado (vía Mapaprop):**
  - Hay API, con publicación instantánea y una autorización tipo OAuth (popup de Zonaprop con usuario y contraseña).
  - También hay un XML asincrónico.
  - Hace falta un plan contratado.
  - Fuentes: https://help.mapaprop.com/en/help/mi-inmobiliaria/configuracion/conectar-cuentas/conectar-con-zonaprop y https://www.mapaprop.com/blog/posts/2024-06-11-new-zonaprop-api/
- **Confirmado:** 2clics «ya no puede gestionar altas, bajas o modificaciones» en Zonaprop, así que Zonaprop restringe qué CRMs pueden publicar.
  - Fuente: https://ayuda.2clics.app/es/articles/8331060-como-crear-la-relacion-de-avisos-y-anuncios-en-zonaprop
- **Contexto:** Tokko Broker pertenece a Zonaprop.
  - Fuente: https://mercado.com.ar/ruta-digital/zonaprop-amplio-su-base-a-mas-de-11-000-clientes-en-una-decada
- **Sin confirmar:**
  - el canal de pedido de integración: según el resumen del buscador es atencionainmobiliarias@zonaprop.com; la página https://help.zonaprop.com.ar/s/article/Qu%C3%A9-es-una-integraci%C3%B3n-y-c%C3%B3mo-la-efect%C3%BAo no se pudo leer;
  - cómo obtiene un CRM nuevo su client_id;
  - la documentación pública.
- **Diseño:** OAuth cuando exista el alta de integrador; hasta entonces el adapter queda en «Próximamente».

### Mercado Libre: app no certificada y certificación

- **Confirmado:**
  - OAuth Authorization Code server side, con PKCE.
  - Tiene que autorizar el usuario **administrador** de la cuenta: un operador o colaborador falla con `invalid_operator_user_id`.
  - El token se invalida tras 4 meses sin uso.
  - La pantalla de autorización le muestra al vendedor si la app está certificada.
  - Fuente: https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion
- **Confirmado:** `GET /applications/$APP_ID` devuelve `certification_status` (por ejemplo `not_certified`) y la cuota de requests.
  - Fuente: https://developers.mercadolibre.com.ar/es_ar/gestiona-tus-aplicaciones
- **Confirmado:** el Developer Partner Program para Vehículos e Inmobiliarias (VIS) certifica apps que **ya tienen usuarios**.
  - Exige un piso de usuarios activos en los últimos 3 meses (en Argentina, 150 para el Nivel 1) y publicaciones activas.
  - Exige requisitos técnicos (OAuth server side, chequeo de vulnerabilidades, callback HTTPS).
  - Exige requisitos funcionales de inmuebles: fotos, video, ubicación, paquetes y destaques, preguntas, notificaciones, tour virtual, publicación masiva.
  - Fuente: https://developers.mercadolibre.com.ar/es_ar/developer-partner-program-vehiculos-inmobiliarias
- **Confirmado:**
  - Para publicar Inmuebles hace falta un paquete (`silver`); `gold` y `gold_premium` son destaques.
  - Desde el 20/01/2026 se rechaza una publicación silver sin `pictures`.
  - Para contratar paquetes, la cuenta tiene que estar activada como inmobiliaria.
  - Fuentes: https://developers.mercadolibre.com.ar/gestionar-paquetes-de-inmuebles y https://developers.mercadolibre.com.ar/contratacion-de-paquetes-de-publicacion
- **Sin confirmar:**
  - No se encontró un **límite de usuarios** para apps no certificadas: solo el rate limit y la etiqueta «no certificada».
  - El 402 o `payment_required` sin paquete lo documenta Mapaprop (https://help.mapaprop.com/en/help/faqs/mercadolibre-aviso-requiere-pago-payment-required), no la documentación oficial que se leyó.
- **Conclusión:** cualquier inmobiliaria puede autorizar hoy la app no certificada. Certificar es un paso posterior, cuando se llegue al piso de usuarios.

## 7. Cómo agregar un portal (checklist)

1. Confirmar con la documentación oficial el flujo de conexión y los endpoints. **No se inventan.** Anotar las fuentes en el adapter.
2. Si el provider no está en el check de `agency_integrations.provider`, sumarlo con una migración aditiva. Si es un canal nuevo, sumarlo también a `property_publications.channel`.
3. Crear `api/_lib/integrations/adapters/<portal>.ts` que cumpla `PortalAdapter`:
   - `availability()` con el motivo real si todavía no está disponible;
   - `status()` con `readConnection` y `toConnectionStatus`, sin seleccionar columnas secretas;
   - `connect()`: OAuth (state y PKCE en una cookie cifrada, `returnTo` de la lista cerrada) o `{ form: true }` para credenciales;
   - secretos cifrados con `encrypt()`, escritos con `withOptionalColumns`, y chequeo de «una cuenta, una inmobiliaria»;
   - `validate()` y `publish()` idempotentes: si ya hay un `external_id` vivo, se actualiza. Guardar `property_publications` con `connection_id`. Mensajes en criollo, sin volcar respuestas crudas ni tokens;
   - `mapStatus()` del estado del portal al estado de `property_publications`.
4. Registrarlo en `api/_lib/integrations/registry.ts` y en `src/lib/integrations/registry.ts`: mismo id, descripción, ayuda paso a paso y advertencias.
5. Si necesita callback registrado, enrutarlo dentro de una función existente (`routeByAction`) **sin** crear otra función de Vercel.
6. Pruebas sin red en `scripts/integraciones.test.ts`.
7. Ejecutar:
   ```
   npm run typecheck && npx vite build && npm run test:meli && npm run test:meta && npm run test:integraciones
   ```

## 8. SQL pendiente (orden de aplicación)

Todo **sin aplicar**. Requiere aprobación de Lucas: la base es compartida y tiene usuarios reales.

1. `20261004110000_crm_agency_integration.sql`: ya aplicada en producción (está versionada para que quede el historial).
2. `20261004120000_property_publications.sql`
3. `20261005140000_agency_integrations.sql`
4. `20261006120000_integrations_multitenant.sql` (nueva):
   ```sql
   alter table public.agency_integrations
     add column if not exists auth_method text not null default 'oauth',
     add column if not exists last_error text,
     add column if not exists last_checked_at timestamptz;
   -- check auth_method in ('oauth','credentials','api_key','feed')
   -- check provider reescrito con nombre (misma lista)
   grant select (auth_method, last_error, last_checked_at) on public.agency_integrations to authenticated;
   alter table public.property_publications
     add column if not exists connection_id uuid references public.agency_integrations(id) on delete set null;
   create index if not exists property_publications_connection_idx on public.property_publications (connection_id) where connection_id is not null;
   -- trigger property_publications_connection_guard: la conexión tiene que ser de la misma agencia
   ```

## 9. Variables de entorno

No se cargó ninguna.

- `ARGENPROP_CREDENTIALS_ENABLED=1` (opcional): habilita el formulario de Argenprop. Recién tiene sentido con el alta de integrador.
- Las de Mercado Libre y Meta, sin cambios.
