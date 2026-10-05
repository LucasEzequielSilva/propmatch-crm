import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fail, json, noStore } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { inboxCoreConfigured } from "../../inbox/env.js";
import { inboxAuth, isUuid, jsonBody } from "../../inbox/request.js";
import { accountById } from "../../inbox/accounts.js";
import { waDownloadMedia } from "../../inbox/whatsapp.js";

// Vercel corta las respuestas de funciones en ~4.5 MB.
const MAX_MEDIA_BYTES = 4_000_000;
const SAFE_INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp))(;.*)?$/i;

/**
 * Mensajes de una conversación externa.
 *
 * GET  ?conversationId=<uuid>[&before=<iso>][&limit=50]  → orden cronológico
 * GET  ?media=<messageId>                                → media de WhatsApp (proxy con token)
 * POST { action: "read", conversationId }                → marca la conversación como leída
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (!inboxCoreConfigured()) return fail(res, 503, "not_configured");

  if (req.method === "GET") {
    const media = req.query.media;
    if (typeof media === "string") return serveMedia(req, res, media);

    const ctx = await inboxAuth(req, res, { bucket: "msg_list", limit: 60 });
    if (!ctx) return;
    const cid = req.query.conversationId;
    if (!isUuid(cid)) return fail(res, 400, "bad_request");
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;

    let q = crmDb()
      .from("messages")
      .select("id, direction, type, body, external_message_id, media_id, media_url, media_mime, template_name, status, status_at, error_code, error_title, echo, sent_by, created_at")
      .eq("agency_id", ctx.agencyId)
      .eq("conversation_id", cid)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) q = q.lt("created_at", before);
    const { data, error } = await q;
    if (error) return fail(res, 500, "server_error");
    const rows = (data ?? []).reverse().map((m) => ({
      ...m,
      // El navegador nunca ve el media id de WhatsApp: pide el proxy.
      media_id: undefined,
      external_message_id: undefined,
      has_media: !!(m.media_id || m.media_url),
      // Meta lo aceptó (hay id externo) aunque todavía no llegó ningún estado.
      accepted: !!m.external_message_id,
    }));
    return json(res, 200, { messages: rows, hasMore: (data ?? []).length === limit });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }

  const ctx = await inboxAuth(req, res, { bucket: "msg_write", limit: 60 });
  if (!ctx) return;
  const b = jsonBody(req);
  if (b.action !== "read" || !isUuid(b.conversationId)) return fail(res, 400, "bad_request");
  const { error } = await crmDb()
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", b.conversationId)
    .eq("agency_id", ctx.agencyId);
  if (error) return fail(res, 500, "server_error");
  return json(res, 200, { ok: true });
}

async function serveMedia(req: VercelRequest, res: VercelResponse, messageId: string) {
  const ctx = await inboxAuth(req, res, { bucket: "media", limit: 60 });
  if (!ctx) return;
  if (!isUuid(messageId)) return fail(res, 400, "bad_request");
  const { data: msg } = await crmDb()
    .from("messages")
    .select("media_id, media_url, conversation_id, conversations!inner(channel_account_id)")
    .eq("id", messageId)
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();
  if (!msg) return fail(res, 404, "not_found");
  if (!msg.media_id) {
    // IG/Messenger: URL de CDN de Meta, se abre directo.
    if (msg.media_url && /^https:\/\/[^/]*(fbcdn\.net|fbsbx\.com|cdninstagram\.com)\//.test(msg.media_url)) {
      res.setHeader("Location", msg.media_url);
      return res.status(302).end();
    }
    return fail(res, 404, "not_found");
  }
  const conv = msg.conversations as unknown as { channel_account_id: string } | { channel_account_id: string }[];
  const accountId = Array.isArray(conv) ? conv[0]?.channel_account_id : conv?.channel_account_id;
  const acc = accountId ? await accountById(accountId, ctx.agencyId) : null;
  if (!acc) return fail(res, 404, "not_found");
  try {
    const { mime, data } = await waDownloadMedia(acc, msg.media_id, MAX_MEDIA_BYTES);
    // Solo tipos que el navegador muestra sin riesgo; el resto se descarga.
    const inline = SAFE_INLINE.test(mime);
    res.setHeader("Content-Type", inline ? mime : "application/octet-stream");
    res.setHeader("Content-Disposition", inline ? "inline" : "attachment");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).send(data);
  } catch (e) {
    return fail(res, e instanceof Error && e.message === "media_too_big" ? 413 : 502, "media_unavailable");
  }
}
