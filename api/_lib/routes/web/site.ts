import type { VercelRequest, VercelResponse } from "@vercel/node";
import { agencyBySlug, publicAgency, publicProperties } from "../../web/data.js";
import { onlyGet, q, sendJson, webConfigured } from "../../web/http.js";
import type { PublicSite } from "../../../../shared/publicSite.js";

/** GET /api/web/site?slug=… — portada de la web: inmobiliaria + propiedades disponibles. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyGet(req, res)) return;
  if (!webConfigured()) return sendJson(res, 503, { error: "not_configured" });
  try {
    const found = await agencyBySlug(q(req, "slug"));
    if (!found) return sendJson(res, 404, { error: "not_found" });
    const [agency, properties] = await Promise.all([publicAgency(found.row, found.canonical), publicProperties(found.row.id)]);
    const body: PublicSite = { agency, properties, generatedAt: new Date().toISOString() };
    sendJson(res, 200, body);
  } catch {
    sendJson(res, 500, { error: "server_error" });
  }
}
