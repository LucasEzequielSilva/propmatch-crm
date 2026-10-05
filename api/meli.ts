import { routeByAction } from "./_lib/router.js";
import callback from "./_lib/routes/meli/callback.js";
import connect from "./_lib/routes/meli/connect.js";
import disconnect from "./_lib/routes/meli/disconnect.js";
import notifications from "./_lib/routes/meli/notifications.js";
import publish from "./_lib/routes/meli/publish.js";
import status from "./_lib/routes/meli/status.js";

/**
 * Una sola función para /api/meli/* (callback, connect, disconnect,
 * notifications, publish, status). Las URLs públicas no cambian: ver los
 * rewrites de vercel.json. `callback` y `notifications` están registradas en
 * Mercado Libre.
 */
export default routeByAction("meli", { callback, connect, disconnect, notifications, publish, status });
