import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin } from "../../auth.js";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, json } from "../../http.js";
import { meliStartConnect } from "../../integrations/adapters/mercadolibre.js";

/**
 * POST /api/meli/connect — inicia el OAuth (PKCE) de Mercado Libre para la
 * agencia del admin. Body opcional: { return: "publicador" | "integraciones" }
 * (a dónde volver; cualquier otro valor → publicador, como siempre).
 * La lógica vive en el adapter (api/_lib/integrations/adapters/mercadolibre.ts).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const { url, setCookie } = meliStartConnect(ctx, b.return);
    res.setHeader("Set-Cookie", setCookie);
    json(res, 200, { url });
  } catch {
    fail(res, 500, "server_error");
  }
}
