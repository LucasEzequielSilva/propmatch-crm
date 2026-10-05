import { routeByAction } from "./_lib/router.js";
import connect from "./_lib/routes/meta/connect.js";
import fbDelete from "./_lib/routes/meta/fbDelete.js";
import fbPublish from "./_lib/routes/meta/fbPublish.js";
import igCreate from "./_lib/routes/meta/igCreate.js";
import igPublish from "./_lib/routes/meta/igPublish.js";
import publishConnect from "./_lib/routes/meta/publishConnect.js";
import publishDisconnect from "./_lib/routes/meta/publishDisconnect.js";
import publishStatus from "./_lib/routes/meta/publishStatus.js";

/**
 * Una sola función para /api/meta/*. Agrupado para sumar rutas sin sumar funciones.
 * - connect: Messenger/Instagram del inbox (META_MESSAGING_ENABLED).
 * - publish-*, ig-*, fb-*: publicar propiedades en la Página y en Instagram
 *   (META_PUBLISH_ENABLED). Ver docs/meta-publicaciones-y-web.md.
 */
export default routeByAction("meta", {
  connect,
  "publish-status": publishStatus,
  "publish-connect": publishConnect,
  "publish-disconnect": publishDisconnect,
  "ig-create": igCreate,
  "ig-publish": igPublish,
  "fb-publish": fbPublish,
  "fb-delete": fbDelete,
});
