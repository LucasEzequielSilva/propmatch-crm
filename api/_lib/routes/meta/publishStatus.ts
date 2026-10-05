import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../../auth.js";
import { allowMethod, fail, json } from "../../http.js";
import { isAuthError } from "../../inbox/graph.js";
import { instagramOf, loadMetaConnection, markMetaNeedsReauth, metaPublishConfigured, metaPublishEnabled } from "../../metaPublish/core.js";

/**
 * GET /api/meta/publish-status — estado de la conexión de publicación.
 * Nunca devuelve tokens. Sin flag responde `enabled: false` (la UI dice
 * "Requiere aprobación de Meta") sin consultar nada.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!metaPublishConfigured()) return json(res, 200, { configured: false, enabled: false, connected: false });
  if (!metaPublishEnabled()) return json(res, 200, { configured: true, enabled: false, connected: false });
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const isAdmin = ctx.role === "admin";
    const conn = await loadMetaConnection(ctx.agencyId);
    if (!conn) return json(res, 200, { configured: true, enabled: true, connected: false, isAdmin });
    if (conn.status === "needs_reauth") {
      return json(res, 200, { configured: true, enabled: true, connected: false, needsReauth: true, page: { name: conn.pageName }, isAdmin });
    }
    let instagram: { username: string | null } | null = null;
    try {
      const ig = await instagramOf(conn);
      instagram = ig ? { username: ig.username } : null;
    } catch (e) {
      if (isAuthError(e)) {
        await markMetaNeedsReauth(ctx.agencyId).catch(() => undefined);
        return json(res, 200, { configured: true, enabled: true, connected: false, needsReauth: true, page: { name: conn.pageName }, isAdmin });
      }
      // Meta caída: mostramos la Página conectada sin el dato de Instagram.
    }
    return json(res, 200, {
      configured: true,
      enabled: true,
      connected: true,
      page: { id: conn.pageId, name: conn.pageName },
      instagram,
      isAdmin,
    });
  } catch {
    fail(res, 500, "server_error");
  }
}
