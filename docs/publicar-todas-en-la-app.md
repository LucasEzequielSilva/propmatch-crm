# Publicar todas en la app

Botón **«Publicar todas en la app»** (en *Propiedades* y en *Configuración → Integraciones → App PropMatch*): sube a la app PropMatch, en tandas, las propiedades del CRM que todavía no están, y copia sus fotos al almacenamiento de PropMatch.

## Requisitos

- **Cuenta vinculada** a una agencia de la app (fila en `agency_members`). Sin eso la cuenta trabaja en modo local (`local-<uid>`) y el botón se ve deshabilitado: «Tu cuenta todavía no está vinculada a la app PropMatch».
- **Admin o dueño** de la agencia. El servidor también lo exige (`requireAgencyAdmin`).
- **Acuerdo de la inmobiliaria**: las propiedades pasan a verse en la app para los usuarios que buscan. El diálogo pide confirmarlo con una casilla.
- **Acuerdo con el dueño de la app** (Lucas): es una carga masiva sobre la base real. Conviene avisar antes de la primera vez.
- Esta versión desplegada en Vercel (la copia de fotos corre en `/api/integrations/copy-photos`; con `vite dev` solo no hay servidor).

## Qué sube y qué no

Sube las propiedades **sin `app_property_id`** que cumplen todo esto:

| Requisito | Motivo que se muestra si falta |
|---|---|
| Precio en USD | «Está en pesos: la app solo maneja USD» |
| No es dato de ejemplo | «Es un dato de ejemplo» |
| Precio mayor a 0 | «No tiene precio» |
| Zona / barrio (`locality`) | «No tiene zona / barrio» |
| Al menos una foto | «No tiene fotos» |
| Título | «No tiene título» |
| Ambientes (o dormitorios) | «No tiene cantidad de ambientes» (la app lo exige) |
| Tipo y operación que la app admite | «Tipo/Operación que la app no admite» |
| No vendida/alquilada | «Está vendida o alquilada» |

Las que ya tienen `app_property_id` cuentan como «ya están en la app» y no se tocan. Las en pesos siguen en el CRM y se pueden publicar en portales. Lógica en `shared/appBulkSync.ts` (`classifyForApp`).

## Cómo funciona

1. El diálogo muestra el resumen (listas / ya están / no van, con lista desplegable de motivos).
2. Al confirmar, procesa **2 propiedades a la vez**. Por cada una:
   - Fotos externas (`http(s)` de otro sitio, p. ej. las de un Excel importado): se mandan a `/api/integrations/copy-photos` en sub-tandas de 8.
   - Fotos que ya están en `property-photos/<agencia>/` se dejan igual; las cargadas en el navegador (`data:`) las sube el mismo flujo de siempre.
   - Se crea la fila en `properties` de la app (o se actualiza si ya tenía `app_property_id`) y se guarda `app_property_id` + `sync_status`.
3. En el CRM, cada foto copiada **reemplaza a la original en su lugar**. Las que no se pudieron copiar quedan con su URL original en el CRM y **no** se mandan a la app (la propiedad sube con el resto). Si no se copia ninguna, la propiedad falla.
4. Barra de progreso (`142/308`), pausar, cancelar y resumen final con las fallidas y su motivo.

Si se cierra el diálogo sigue en segundo plano (aviso flotante abajo a la derecha). Si se recarga la página, el trabajo queda «interrumpido» (se guarda en `localStorage`, clave `propmatch.appBulkSync.v1`) y se **retoma** desde donde quedó. Es idempotente: lo ya subido tiene `app_property_id` y no se vuelve a crear.

Si la sesión vence, el servidor no responde o falta permiso, se frena todo (no marca las propiedades como fallidas) y se muestra el motivo: tocar **«Retomar»** cuando esté resuelto.

## Copia de fotos (servidor)

`POST /api/integrations/copy-photos` con `{ crmPropertyId, urls }` (código en `api/_lib/photoCopy/`). Va del lado servidor porque el navegador no puede leer imágenes de otro dominio sin CORS.

- **Quién**: JWT de Supabase + `agency_members` con rol admin. La carpeta destino sale de esa membresía, nunca del pedido: `property-photos/<agency_id>/<crmPropertyId>/<uuid>.<ext>` (se sube con service role).
- **Anti-SSRF**: solo `http`/`https`, puertos 80/443, sin usuario/clave en la URL; se rechazan `localhost`, `*.local`/`.internal`/etc., hosts sin dominio, IPs escritas raras (decimal, hexa) e IPs privadas/reservadas (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 —metadata de nubes—, 100.64/10, multicast, IPv6 loopback/ULA/link-local, IPv4 mapeada en IPv6, NAT64…). El DNS se valida **en el momento de conectar** (`lookup` propio), así un DNS que cambia de respuesta no sirve; las redirecciones (máx. 3) se revalidan en cada salto.
- **Contenido**: máx. **10 MB** por imagen (se corta la descarga al pasarse), solo **JPEG/PNG/WebP** verificado por los bytes (no por el `Content-Type` remoto; SVG/HTML/GIF se rechazan). Máx. **40** URLs por pedido y por propiedad.
- **Tiempo**: 15 s por foto, 4 descargas en paralelo y un plazo de 40 s por pedido (la función tiene `maxDuration` 60 s). Lo que no llegó a empezar vuelve en `skipped` y el cliente lo reenvía (hasta 3 veces).
- Las fotos se suben tal cual (sin re-comprimir).

Respuesta: `{ results: [{ url, ok, publicUrl?, reason? }], skipped: [url] }`.

## Cómo reintentar

- **Fallidas**: al terminar, «Reintentar N fallidas» vuelve a procesar solo esas.
- **Interrumpido / frenado**: «Retomar» sigue con las pendientes.
- **Fotos que no se copiaron**: quedan en el CRM con la URL original. Para reintentarlas, corregí la foto en la ficha (o volvé a cargarla) y guardá la propiedad.
- «Nueva publicación» olvida el trabajo anterior (no borra nada de la app) y vuelve a calcular el resumen.

## Pruebas

`npm run test:app-sync` (sin red): elegibilidad, plan y reemplazo de fotos, cola con concurrencia/pausa/cancelar, estado guardado, sync de una propiedad con fakes, guardas anti-SSRF, tipo por bytes y orquestador del servidor.
