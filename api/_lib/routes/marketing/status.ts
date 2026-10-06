import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { inboxAuth } from "../../inbox/request.js";
import { emailConfigured, marketingDbConfigured, sendEnabled, whatsappConfigured } from "../../marketing/env.js";
import { optOutButtonIndex, whatsappAccountFor } from "../../marketing/dispatch.js";

/**
 * GET /api/marketing/status → qué está listo para enviar. Nunca dice QUÉ
 * variable falta (solo si el bloque está o no).
 *
 * { configured: { db, email, whatsapp, sendEnabled }, whatsapp: { connected, phone, templates[] } }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  const configured = { db: marketingDbConfigured(), email: emailConfigured(), whatsapp: whatsappConfigured(), sendEnabled: sendEnabled() };
  if (!configured.db) return json(res, 200, { configured, whatsapp: null, isAdmin: false });

  const ctx = await inboxAuth(req, res, { bucket: "mkt_status", limit: 60 });
  if (!ctx) return;

  // ¿Están las tablas? (migración aplicada)
  const probe = await crmDb().from("marketing_campaigns").select("id", { head: true, count: "exact" }).eq("agency_id", ctx.agencyId);
  if (probe.error) return json(res, 200, { configured: { ...configured, db: false, email: false, whatsapp: false }, whatsapp: null, isAdmin: ctx.role === "admin" });

  let whatsapp: { connected: boolean; phone: string | null; templates: unknown[] } | null = null;
  if (configured.whatsapp) {
    try {
      const acc = await whatsappAccountFor(ctx.agencyId);
      if (!acc) whatsapp = { connected: false, phone: null, templates: [] };
      else {
        const { data } = await crmDb()
          .from("message_templates")
          .select("name, language, category, status, components, body_params")
          .eq("channel_account_id", acc.id)
          .order("name");
        whatsapp = {
          connected: true,
          phone: acc.display_phone,
          templates: ((data ?? []) as { name: string; language: string; category: string | null; status: string; components: never; body_params: number }[]).map((t) => ({
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            body_params: t.body_params,
            components: t.components,
            hasOptOutButton: optOutButtonIndex(t.components ?? []) >= 0,
          })),
        };
      }
    } catch {
      return fail(res, 500, "server_error");
    }
  }
  return json(res, 200, { configured, whatsapp, isAdmin: ctx.role === "admin" });
}
