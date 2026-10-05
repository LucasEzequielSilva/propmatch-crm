import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fail, json, noStore } from "../_lib/http.js";
import { crmDb, PUBLIC_ACCOUNT_COLUMNS } from "../_lib/inbox/db.js";
import { inboxCoreConfigured, metaConfigured, metaMessagingEnabled } from "../_lib/inbox/env.js";
import { inboxAuth, isUuid, jsonBody } from "../_lib/inbox/request.js";
import { accountById, tokenOf } from "../_lib/inbox/accounts.js";
import { graph } from "../_lib/inbox/graph.js";
import { syncTemplates } from "../_lib/inbox/whatsapp.js";

/**
 * Canales conectados de la agencia (sin tokens).
 *
 * GET                       → { configured, accounts[], isAdmin }
 * GET  ?templates=<id>      → plantillas APROBADAS de esa cuenta de WhatsApp
 * POST { action: "disconnect", id }       (admin)
 * POST { action: "sync_templates", id }   (admin)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  const configured = { core: inboxCoreConfigured(), meta: metaConfigured(), messaging: metaMessagingEnabled() };
  if (!configured.core) {
    if (req.method === "GET") return json(res, 200, { configured, accounts: [], isAdmin: false });
    return fail(res, 503, "not_configured");
  }

  if (req.method === "GET") {
    const ctx = await inboxAuth(req, res, { bucket: "channels", limit: 60 });
    if (!ctx) return;
    const db = crmDb();
    const tplFor = req.query.templates;
    if (typeof tplFor === "string") {
      if (!isUuid(tplFor)) return fail(res, 400, "bad_request");
      const { data, error } = await db
        .from("message_templates")
        .select("id, name, language, category, status, components, body_params")
        .eq("agency_id", ctx.agencyId)
        .eq("channel_account_id", tplFor)
        .eq("status", "APPROVED")
        .order("name");
      if (error) return fail(res, 500, "server_error");
      return json(res, 200, { templates: data ?? [] });
    }
    const { data, error } = await db
      .from("channel_accounts")
      .select(PUBLIC_ACCOUNT_COLUMNS)
      .eq("agency_id", ctx.agencyId)
      .neq("status", "disconnected")
      .order("connected_at", { ascending: false });
    // Tablas sin crear (migración sin aplicar): no rompe la UI.
    if (error) return json(res, 200, { configured: { ...configured, core: false }, accounts: [], isAdmin: ctx.role === "admin" });
    return json(res, 200, { configured, accounts: data ?? [], isAdmin: ctx.role === "admin" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }

  const ctx = await inboxAuth(req, res, { admin: true, bucket: "channels_admin", limit: 20 });
  if (!ctx) return;
  const b = jsonBody(req);
  if (!isUuid(b.id)) return fail(res, 400, "bad_request");
  const acc = await accountById(b.id, ctx.agencyId);
  if (!acc) return fail(res, 404, "not_found");

  if (b.action === "disconnect") {
    // Best effort: dejar de recibir webhooks de ese WABA / Página.
    try {
      if (acc.access_token_enc) {
        const token = tokenOf(acc);
        if (acc.channel === "whatsapp" && acc.waba_id) await graph(`${acc.waba_id}/subscribed_apps`, { method: "DELETE", token });
        // En Messenger/IG la suscripción es por Página: solo se quita si no queda otro canal de esa Página.
        if (acc.channel !== "whatsapp" && acc.page_id) {
          const { data: others } = await crmDb()
            .from("channel_accounts")
            .select("id")
            .eq("page_id", acc.page_id)
            .neq("id", acc.id)
            .neq("status", "disconnected");
          if (!others?.length) await graph(`${acc.page_id}/subscribed_apps`, { method: "DELETE", token });
        }
      }
    } catch {
      /* el token pudo haber vencido: igual se desconecta de nuestro lado */
    }
    const { error } = await crmDb()
      .from("channel_accounts")
      .update({ status: "disconnected", access_token_enc: null, wa_pin_enc: null })
      .eq("id", acc.id)
      .eq("agency_id", ctx.agencyId);
    if (error) return fail(res, 500, "server_error");
    return json(res, 200, { ok: true });
  }

  if (b.action === "sync_templates") {
    if (acc.channel !== "whatsapp") return fail(res, 400, "bad_request");
    try {
      const n = await syncTemplates(acc);
      return json(res, 200, { ok: true, count: n });
    } catch {
      return fail(res, 502, "sync_failed");
    }
  }

  return fail(res, 400, "bad_request");
}
