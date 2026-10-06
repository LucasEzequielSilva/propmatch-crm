import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../../auth.js";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, json } from "../../http.js";
import { meliStatusBody } from "../../integrations/adapters/mercadolibre.js";

/** GET /api/meli/status — estado de la conexión de la agencia (sin tokens). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!isConfigured()) return json(res, 200, { configured: false, connected: false });
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    json(res, 200, await meliStatusBody(ctx));
  } catch {
    fail(res, 500, "server_error");
  }
}
