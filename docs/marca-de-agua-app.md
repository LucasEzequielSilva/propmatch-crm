# Logo en las fotos de la app PropMatch

Opción en **Configuración → Marca → Logo sobre las fotos**: **«Poner el logo en las fotos de la app PropMatch»** (apagada por defecto).

> Se agrega a una copia de cada foto que va a la app. Las fotos originales y las de Mercado Libre no cambian.

A diferencia de «Mostrar el logo sobre las fotos» (una capa CSS en el CRM, la ficha, el PDF y la web), esta opción **quema** el logo en la imagen: la app PropMatch recibe archivos JPEG con el logo ya dibujado.

## Antes de prenderla

- **Confirmar con el dueño de la app (Lucas) que acepta fotos con logo.** La app muestra propiedades de varias inmobiliarias y hasta ahora todas las fotos llegaban limpias. Es una decisión de producto de la app, no del CRM.
- La marca tiene que estar **publicada** (cuenta vinculada a una inmobiliaria real y «Guardar marca» con el logo subido). Con la demo o una cuenta sin vincular la opción se guarda, pero no se aplica.
- Esta versión tiene que estar desplegada en Vercel (el dibujo corre en `/api/integrations/watermark-photos`; con `vite dev` solo no hay servidor y las fotos van sin logo).

## Qué hace

- Usa la **misma configuración** que el logo visual: versión para fotos (o el logo principal sobre placa clara si no hay), esquina, tamaño y fondo.
  - Tamaño: **chico ≈ 14 %** y **mediano ≈ 20 %** del ancho de la foto (con un tope de alto para logos cuadrados), margen ≈ 3 % del lado menor.
  - Fondo: **sombra suave**, **placa clara** (blanca 86 %) o **placa oscura** (50 %), redondeadas.
- Cada copia sale en **JPEG calidad 85**, derecha según la orientación EXIF, con un máximo de 2560 px de lado mayor (si pasara de 5 MB, el tope del bucket, baja la calidad).
- **Nunca frena la publicación**: si una foto no se puede marcar, a la app va la original y se avisa (en la ficha de la propiedad, y en el progreso de «Publicar todas» / «Actualizar las fotos»: «N fotos fueron sin el logo»).

## Dónde se usa

| Camino | Qué pasa con la opción prendida |
|---|---|
| Guardar / editar una propiedad (`syncPropertyToApp`) | Sube las originales como siempre, pide las copias con logo y escribe esas en `properties.photos`. |
| «Publicar todas en la app» (`publishPropertyToApp`) | Igual, propiedad por propiedad, en tandas. |
| «Actualizar las fotos en la app» | Vuelve a mandar las fotos de las propiedades que **ya están** en la app (ver abajo). |
| **El CRM** | Guarda y muestra siempre las **originales**. |
| **Mercado Libre** (y cualquier portal) | Siempre las **originales**: si lee `properties.photos`, cambia cada copia por su original (`portalPhotosFromAppRow`). Mercado Libre no acepta logos ni marcas de agua. |
| **Web pública** | Muestra las originales (el logo ya lo pone la capa CSS: no sale dos veces). |
| Propiedades que el CRM trae de la app | Se guardan con las originales. |

## Dónde se guardan las copias

Bucket público `property-photos`, en la carpeta de la propiedad:

```
<agency_id>/<crmPropertyId>/app/<hash>_<original>.jpg
```

- `<hash>`: sha256 (24 caracteres) de foto + logo + esquina + tamaño + fondo + versión. **Idempotente**: si ese archivo ya existe no se vuelve a procesar; cambiar el logo o una opción genera copias nuevas.
- `<original>`: la ruta de la foto original dentro de la carpeta de la agencia, en base64url. Con eso cualquiera que lea `properties.photos` puede volver a la original sin una tabla nueva y sin confiar en el navegador (`originalPhotos` en `shared/appWatermark.ts`).
- Las originales siguen donde estaban (`<agency_id>/<crmPropertyId>/<uuid>.<ext>` o `<agency_id>/crm/<crmPropertyId>/…`). Nunca se tocan.
- Las copias viejas (de un logo o configuración anterior) **no se borran**: quedan en el bucket sin uso (ver Pendientes).

## Seguridad

- La acción `watermark-photos` exige sesión de un **miembro** de la agencia; la agencia sale del JWT + `agency_members`, nunca del pedido.
- **No descarga nada de internet**: solo acepta URLs de fotos dentro de `property-photos/<su agencia>/` (no `branding/`, no copias `app/`, sin `..` ni query) y el logo solo de `property-photos/<su agencia>/branding/`. El servidor las lee del Storage por su ruta con la service role, y verifica por los bytes que sean JPEG/PNG/WebP (máx. 10 MB).
- Sube con la service role solo a `<su agencia>/<crmPropertyId>/app/`.
- Hasta 12 fotos por pedido; el cliente manda tandas de 6. Plazo de 40 s para empezar fotos nuevas (la función tiene `maxDuration` 60 s); lo que no entra vuelve en `skipped` y el navegador lo reintenta (hasta 3 veces por tanda).
- Sin funciones nuevas en Vercel: es una acción más de `api/integrations.ts` (siguen siendo 8). `sharp` se carga con `import()` solo en esta acción.

## Cómo actualizar las fotos que ya están en la app

Las propiedades publicadas **antes** de prender la opción (o antes de cambiar el logo, la esquina, el tamaño o el fondo) siguen en la app con las fotos de antes. Para ponerlas al día:

1. Cambiá la opción o el logo y tocá **«Guardar marca»** (se publica).
2. Debajo del interruptor aparece el aviso «Cambió el logo o esta opción desde la última vez…» con el botón **«Actualizar las fotos en la app»** (solo admins/dueños, con la cuenta vinculada).
3. Corre en tandas con el mismo motor que «Publicar todas»: se puede cerrar el diálogo, pausar, cancelar, retomar tras recargar y reintentar las fallidas.

Apagar la opción y actualizar devuelve las originales a la app. El CRM recuerda (en este navegador, `propmatch.appWatermark.applied.v1`) con qué configuración quedaron las fotos para saber cuándo mostrar el aviso; el botón se puede usar siempre.

## Archivos

- `shared/brand.ts`: `photoLogo.inApp`, `resolveAppWatermark`, `appWatermarkFingerprint`.
- `shared/appWatermark.ts`: rutas, validación del pedido, orquestador del servidor, `appPhotosWithLogo` (cliente), `originalPhotos` / `portalPhotosFromAppRow`.
- `api/_lib/photoWatermark/render.ts`: dibujo con `sharp`.
- `api/integrations.ts`: acción `watermark-photos`.
- `src/lib/appWatermark.ts`, `src/data/store.tsx`: integración al publicar.
- `src/features/appSync/*`: «Actualizar las fotos en la app» (trabajo `refresh`).
- `src/features/branding/BrandingCard.tsx`: el interruptor.

## Dependencia: sharp en Vercel

`sharp` (^0.34) va en `dependencies`. El `package-lock.json` incluye los binarios prearmados de todas las plataformas, entre ellos `@img/sharp-linux-x64` y `@img/sharp-libvips-linux-x64` que usan las Vercel Functions (Linux x64, glibc). `@vercel/nft`, que arma el paquete de cada función, tiene un caso especial para `sharp` que incluye esos binarios. Funciona con Node 18.17+, 20.3+ y 22.

## Pruebas

```
npm run test:marca-agua
```

Sin red, con imágenes generadas en memoria: opción de la marca, rutas, validación anti-SSRF del pedido, idempotencia, plazos, errores por foto, qué URLs van a la app, que **Mercado Libre se arme con las originales** (`buildMeliItem` / `buildMeliUpdate`), y el dibujo real con sharp (tamaño, esquina, EXIF, transparencia).

Prueba manual (con la versión desplegada en un entorno de prueba):

1. Marca → subir versión para fotos → prender «Poner el logo en las fotos de la app PropMatch» → Guardar marca.
2. Editar y guardar una propiedad en USD: en Storage aparece `<agencia>/<id>/app/…jpg` y en la app la foto se ve con el logo; en el CRM la foto sigue sin logo.
3. Publicarla en Mercado Libre: el aviso tiene las fotos sin logo.
4. Cambiar la esquina → Guardar marca → «Actualizar las fotos en la app».

## Pendientes

- **Confirmar con el dueño de la app** que acepta logos en las fotos (y si quiere un tope de tamaño o de esquina).
- Limpiar las copias viejas de `…/app/` que quedan sin uso cuando cambia el logo o la configuración (hoy no se borran; ocupan Storage).
- El aviso «Actualizar las fotos» se recuerda por navegador; si otro admin actualiza desde otra compu, acá puede seguir apareciendo (actualizar de nuevo no duplica nada: las copias ya existen y no se re-procesan).
- Facebook/Instagram eligen fotos del CRM (originales), así que no llevan logo quemado.
