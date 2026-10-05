import { routeByAction } from "./_lib/router.js";
import webhook from "./_lib/routes/whatsapp/webhook.js";
import onboard from "./_lib/routes/whatsapp/onboard.js";

/**
 * Una sola función para /api/whatsapp/* (webhook, onboard).
 * `/api/whatsapp/webhook` es la URL registrada en Meta: no cambia.
 */
export default routeByAction("whatsapp", { webhook, onboard });
