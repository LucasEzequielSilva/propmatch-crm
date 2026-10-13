import { routeByAction } from "./_lib/router.js";
import { pull, push, upload } from "./_lib/crm/routes.js";

/**
 * Una sola función para /api/crm/* : los datos del CRM (contactos, propiedades,
 * oportunidades, agenda, operaciones…) en la base propia. Ver
 * docs/datos-en-la-base.md y api/_lib/crm/routes.ts.
 */
export default routeByAction("crm", { pull, push, upload });
