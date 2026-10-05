import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { metaPublishAuth } from "../../metaPublish/core.js";

/**
 * POST /api/meta/publish-disconnect — borra la conexión (y el token cifrado).
 * Lo ya publicado en Facebook/Instagram queda publicado. Para revocar el
 * acceso del lado de Meta: Facebook → Configuración → Integraciones comerciales.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  const ctx = await metaPublishAuth(req, res, { admin: true });
  if (!ctx) return;
  const { error } = await supabaseAdmin().from("agency_integrations").delete().eq("agency_id", ctx.agencyId).eq("provider", "meta");
  if (error) return fail(res, 500, "server_error");
  json(res, 200, { ok: true });
}
