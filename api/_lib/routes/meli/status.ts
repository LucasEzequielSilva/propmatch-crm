import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../../auth.js";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, json } from "../../http.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!isConfigured()) return json(res, 200, { configured: false, connected: false });
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const isAdmin = ctx.role === "admin";

    // Nunca se seleccionan las columnas de tokens acá.
    const { data, error } = await supabaseAdmin()
      .from("agency_integrations")
      .select("status, account_label, created_at")
      .eq("agency_id", ctx.agencyId)
      .eq("provider", "mercadolibre")
      .maybeSingle();
    // Tabla inexistente (borrador SQL sin aplicar) u otro fallo: no rompe.
    if (error || !data) return json(res, 200, { configured: true, connected: false, isAdmin });

    json(res, 200, {
      configured: true,
      connected: data.status === "connected",
      needsReauth: data.status === "needs_reauth",
      status: data.status,
      nickname: data.account_label ?? undefined,
      connectedAt: data.created_at,
      isAdmin,
    });
  } catch {
    fail(res, 500, "server_error");
  }
}
