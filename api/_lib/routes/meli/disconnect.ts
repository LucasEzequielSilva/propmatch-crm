import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin } from "../../auth.js";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, json } from "../../http.js";
import { meliDisconnect } from "../../integrations/adapters/mercadolibre.js";

/** POST /api/meli/disconnect — revoca (mejor esfuerzo) y borra la conexión de la agencia. Solo admins. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    await meliDisconnect(ctx);
    json(res, 200, { ok: true });
  } catch {
    fail(res, 500, "server_error");
  }
}
