import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fail, json, noStore } from "../_lib/http.js";
import { crmDb } from "../_lib/inbox/db.js";
import { inboxCoreConfigured } from "../_lib/inbox/env.js";
import { inboxAuth, isUuid, jsonBody, str } from "../_lib/inbox/request.js";

const CHANNELS = new Set(["whatsapp", "instagram", "messenger"]);

/**
 * Conversaciones de canales externos de la agencia.
 *
 * GET  ?channel=whatsapp|instagram|messenger&limit=200
 * POST { action: "link_contact", id, crmContactId | null }
 * POST { action: "assign", id, userId | null }
 * POST { action: "close" | "reopen", id }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (!inboxCoreConfigured()) {
    if (req.method === "GET") return json(res, 200, { configured: false, conversations: [] });
    return fail(res, 503, "not_configured");
  }

  if (req.method === "GET") {
    // El inbox hace polling cada ~10 s: 6/min por pestaña, con margen.
    const ctx = await inboxAuth(req, res, { bucket: "conv_list", limit: 40 });
    if (!ctx) return;
    const ch = typeof req.query.channel === "string" ? req.query.channel : "";
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    let q = crmDb()
      .from("conversations")
      .select(
        "id, channel, channel_account_id, external_thread_id, contact_name, contact_phone, contact_username, crm_contact_id, last_message_at, last_message_preview, last_message_direction, last_inbound_at, unread_count, assigned_to, status, created_at",
      )
      .eq("agency_id", ctx.agencyId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (CHANNELS.has(ch)) q = q.eq("channel", ch);
    const { data, error } = await q;
    if (error) return json(res, 200, { configured: false, conversations: [] });
    return json(res, 200, { configured: true, conversations: data ?? [], now: new Date().toISOString() });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }

  const ctx = await inboxAuth(req, res, { bucket: "conv_write", limit: 60 });
  if (!ctx) return;
  const b = jsonBody(req);
  if (!isUuid(b.id)) return fail(res, 400, "bad_request");

  let patch: Record<string, unknown>;
  switch (b.action) {
    case "link_contact": {
      const cid = b.crmContactId === null ? null : str(b.crmContactId, 128);
      if (b.crmContactId !== null && !cid) return fail(res, 400, "bad_request");
      patch = { crm_contact_id: cid };
      break;
    }
    case "assign": {
      if (b.userId !== null && !isUuid(b.userId)) return fail(res, 400, "bad_request");
      patch = { assigned_to: b.userId };
      break;
    }
    case "close":
      patch = { status: "closed" };
      break;
    case "reopen":
      patch = { status: "open" };
      break;
    default:
      return fail(res, 400, "bad_request");
  }

  const { data, error } = await crmDb()
    .from("conversations")
    .update(patch)
    .eq("id", b.id)
    .eq("agency_id", ctx.agencyId)
    .select("id")
    .maybeSingle();
  if (error) return fail(res, 500, "server_error");
  if (!data) return fail(res, 404, "not_found");
  return json(res, 200, { ok: true });
}
