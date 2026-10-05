import type { VercelRequest, VercelResponse } from "@vercel/node";
import { agencyBySlug, publicAgency, publicProperty } from "../../web/data.js";
import { onlyGet, q, sendJson, webConfigured } from "../../web/http.js";
import { isUuid } from "../../../../shared/publicSite.js";

/** GET /api/web/property?slug=…&id=… — ficha pública de una propiedad. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyGet(req, res)) return;
  if (!webConfigured()) return sendJson(res, 503, { error: "not_configured" });
  const id = q(req, "id");
  if (!isUuid(id)) return sendJson(res, 404, { error: "not_found" });
  try {
    const found = await agencyBySlug(q(req, "slug"));
    if (!found) return sendJson(res, 404, { error: "not_found" });
    const [agency, property] = await Promise.all([publicAgency(found.row, found.canonical), publicProperty(found.row.id, id)]);
    if (!property) return sendJson(res, 404, { error: "not_found", agency });
    sendJson(res, 200, { agency, property });
  } catch {
    sendJson(res, 500, { error: "server_error" });
  }
}
