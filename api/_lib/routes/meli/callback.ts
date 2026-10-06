import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, readCookie, redirect } from "../../http.js";
import { MELI_CLEAR_COOKIE, MELI_OAUTH_COOKIE, meliHandleCallback } from "../../integrations/adapters/mercadolibre.js";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * GET /api/meli/callback — URL registrada en la app de Mercado Libre (no cambia).
 * Vuelve a /publicador o a /configuracion/integraciones según el destino que
 * quedó cifrado en la cookie del OAuth (lista cerrada: no hay redirección abierta).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  const { location, reason } = await meliHandleCallback(
    { code: one(req.query.code), state: one(req.query.state), error: one(req.query.error) },
    readCookie(req, MELI_OAUTH_COOKIE),
  );
  // Solo el motivo (sin códigos ni tokens): para diagnosticar desde los logs de Vercel.
  if (reason) console.warn(`[meli/callback] fallo: ${reason}`);
  res.setHeader("Set-Cookie", MELI_CLEAR_COOKIE);
  redirect(res, location);
}
