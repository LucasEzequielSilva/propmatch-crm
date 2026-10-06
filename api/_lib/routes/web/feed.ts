import type { VercelRequest, VercelResponse } from "@vercel/node";
import { agencyBySlug, publicAgency, publicProperties } from "../../web/data.js";
import { onlyGet, q, sendJson, siteOrigin, webConfigured } from "../../web/http.js";

/**
 * GET /api/web/feed?slug=… — feed JSON público para integradores (otra web,
 * un portal, una planilla). Mismos datos y mismas reglas que la web, con
 * links absolutos y CORS abierto (es información pública).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!onlyGet(req, res)) return;
  if (!webConfigured()) return sendJson(res, 503, { error: "not_configured" }, { cors: true });
  try {
    const found = await agencyBySlug(q(req, "slug"));
    if (!found) return sendJson(res, 404, { error: "not_found" }, { cors: true });
    const [agency, properties] = await Promise.all([publicAgency(found.row, found.canonical), publicProperties(found.row.id)]);
    const base = `${siteOrigin(req)}/sitio/${agency.slug}`;
    sendJson(
      res,
      200,
      {
        version: 1,
        generatedAt: new Date().toISOString(),
        agency: { ...agency, url: base },
        properties: properties.map((p) => ({ ...p, currency: "USD", url: `${base}/p/${p.id}` })),
      },
      { cors: true },
    );
  } catch {
    sendJson(res, 500, { error: "server_error" }, { cors: true });
  }
}
