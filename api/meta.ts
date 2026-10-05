import { routeByAction } from "./_lib/router.js";
import connect from "./_lib/routes/meta/connect.js";

/** /api/meta/connect (Messenger/Instagram). Agrupado para sumar rutas sin sumar funciones. */
export default routeByAction("meta", { connect });
