import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin } from "../_lib/auth.js";
import { decrypt } from "../_lib/crypto.js";
import { env, isConfigured } from "../_lib/env.js";
import { allowMethod, fail, json } from "../_lib/http.js";
import { MELI_API } from "../_lib/meli.js";
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;
    const db = supabaseAdmin();

    const { data: row } = await db
      .from("agency_integrations")
      .select("external_account_id, access_token_enc")
      .eq("agency_id", ctx.agencyId)
      .eq("provider", "mercadolibre")
      .maybeSingle();

    // Mejor esfuerzo: revocar la autorización de la app en Mercado Libre.
    // Su falla nunca bloquea el borrado local.
    if (row?.external_account_id && row.access_token_enc) {
      try {
        const user = encodeURIComponent(row.external_account_id);
        const app = encodeURIComponent(env("MELI_CLIENT_ID"));
        await fetch(`${MELI_API}/users/${user}/applications/${app}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${decrypt(row.access_token_enc)}` },
        });
      } catch {
        /* ignorado a propósito */
      }
    }

    const { error } = await db
      .from("agency_integrations")
      .delete()
      .eq("agency_id", ctx.agencyId)
      .eq("provider", "mercadolibre");
    if (error) return fail(res, 500, "server_error");
    json(res, 200, { ok: true });
  } catch {
    fail(res, 500, "server_error");
  }
}
