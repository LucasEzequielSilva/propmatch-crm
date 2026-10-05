import { routeByAction } from "./_lib/router.js";
import feed from "./_lib/routes/web/feed.js";
import og from "./_lib/routes/web/og.js";
import property from "./_lib/routes/web/property.js";
import site from "./_lib/routes/web/site.js";

/**
 * Web pública de la inmobiliaria (canal "web" del multipublicador). Sin login.
 * Una sola función para /api/web/* (site, property, feed, og).
 * Ver docs/meta-publicaciones-y-web.md.
 */
export default routeByAction("web", { site, property, feed, og });
