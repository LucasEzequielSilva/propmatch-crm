import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { crmDb, ingestMessage } from "../../inbox/db.js";
import { humanAgentTagEnabled, metaConfigured } from "../../inbox/env.js";
import { inboxAuth, isUuid, jsonBody, str } from "../../inbox/request.js";
import { accountById } from "../../inbox/accounts.js";
import { GraphError } from "../../inbox/graph.js";
import { waErrorCode, waSendTemplate, waSendText } from "../../inbox/whatsapp.js";
import { metaSendText } from "../../inbox/meta.js";
import { isWhatsappUnsubscribed } from "../../marketing/db.js";

const H24 = 24 * 3600 * 1000;
const D7 = 7 * 24 * 3600 * 1000;
const MAX_TEXT: Record<string, number> = { whatsapp: 4096, messenger: 2000, instagram: 1000 };

/**
 * Envío desde el CRM.
 *
 * { conversationId, text }                                  → texto libre
 * { conversationId, template: { name, language, params } }  → plantilla (WhatsApp)
 *
 * Reglas de Meta:
 *  - WhatsApp: texto libre solo dentro de las 24 h desde el último mensaje del
 *    cliente. Fuera de esa ventana, solo plantillas aprobadas.
 *  - Instagram/Messenger: 24 h; con HUMAN_AGENT habilitado, hasta 7 días.
 *    Fuera de eso no se puede escribir (no hay plantillas).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!metaConfigured()) return fail(res, 503, "not_configured");
  const ctx = await inboxAuth(req, res, { bucket: "send", limit: 30 });
  if (!ctx) return;

  const b = jsonBody(req);
  if (!isUuid(b.conversationId)) return fail(res, 400, "bad_request");
  const db = crmDb();
  const { data: conv } = await db
    .from("conversations")
    .select("id, channel, channel_account_id, external_thread_id, last_inbound_at")
    .eq("id", b.conversationId)
    .eq("agency_id", ctx.agencyId)
    .maybeSingle();
  if (!conv) return fail(res, 404, "not_found");
  const acc = await accountById(conv.channel_account_id, ctx.agencyId);
  if (!acc || acc.status === "disconnected") return fail(res, 409, "channel_disconnected");
  if (acc.status === "needs_reauth") return fail(res, 409, "needs_reauth");

  const sinceInbound = conv.last_inbound_at ? Date.now() - Date.parse(conv.last_inbound_at) : Infinity;
  const windowOpen = sinceInbound < H24;

  // ── Preparar qué se manda ───────────────────────────────────────────────
  const text = typeof b.text === "string" ? b.text.replace(/\r\n/g, "\n").trim() : "";
  const tpl = b.template && typeof b.template === "object" ? (b.template as Record<string, unknown>) : null;
  let humanAgent = false;
  let tplRow: { name: string; language: string; components: { type?: string; text?: string }[]; body_params: number } | null = null;
  let params: string[] = [];

  if (tpl) {
    if (conv.channel !== "whatsapp") return fail(res, 400, "templates_only_whatsapp");
    const name = str(tpl.name, 512);
    const language = str(tpl.language, 16);
    if (!name || !language) return fail(res, 400, "bad_request");
    const { data } = await db
      .from("message_templates")
      .select("name, language, components, body_params")
      .eq("channel_account_id", acc.id)
      .eq("name", name)
      .eq("language", language)
      .eq("status", "APPROVED")
      .maybeSingle();
    if (!data) return fail(res, 400, "template_not_approved");
    // Marketing: una plantilla de MARKETING no sale a quien pidió la baja de WhatsApp.
    if (await isWhatsappUnsubscribed(ctx.agencyId, acc.id, name, language, conv.external_thread_id)) {
      return fail(res, 409, "contact_unsubscribed");
    }
    tplRow = data;
    params = Array.isArray(tpl.params) ? tpl.params.map((p) => (typeof p === "string" ? p : "")) : [];
    // WhatsApp rechaza parámetros vacíos, con saltos de línea, tabs o >4 espacios seguidos.
    params = params.map((p) => p.replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024));
    if (params.length !== data.body_params || params.some((p) => !p)) return fail(res, 400, "template_params");
  } else {
    if (!text) return fail(res, 400, "empty");
    if (text.length > (MAX_TEXT[conv.channel] ?? 1000)) return fail(res, 400, "too_long");
    if (!windowOpen) {
      if (conv.channel === "whatsapp") {
        return fail(res, 409, "window_closed_template_required");
      }
      if (humanAgentTagEnabled() && sinceInbound < D7) humanAgent = true;
      else return fail(res, 409, "window_closed");
    }
  }

  // ── Guardar como "pendiente" y mandar ──────────────────────────────────
  const preview = tplRow
    ? ((tplRow.components.find((c) => c.type === "BODY")?.text ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] ?? "") ||
      `Plantilla ${tplRow.name}`)
    : text;
  const local = await ingestMessage({
    agencyId: ctx.agencyId,
    channel: conv.channel,
    channelAccountId: acc.id,
    threadId: conv.external_thread_id,
    direction: "out",
    type: tplRow ? "template" : "text",
    body: preview,
    templateName: tplRow?.name ?? null,
    templateLanguage: tplRow?.language ?? null,
    status: "pending",
    sentBy: ctx.userId,
  });

  try {
    const externalId =
      conv.channel === "whatsapp"
        ? tplRow
          ? await waSendTemplate(acc, conv.external_thread_id, tplRow.name, tplRow.language, params)
          : await waSendText(acc, conv.external_thread_id, text)
        : await metaSendText(acc, conv.external_thread_id, text, humanAgent);
    // Queda "pending" con id externo (= aceptado por Meta). Los tildes
    // (sent/delivered/read) los pone SOLO el webhook de estados.
    // Si el eco del webhook llegó antes, ese id ya existe: se borra el local.
    const { error } = await db
      .from("messages")
      .update({ external_message_id: externalId })
      .eq("id", local.messageId);
    if (error) await db.from("messages").delete().eq("id", local.messageId);
    return json(res, 200, { ok: true, messageId: local.messageId });
  } catch (e) {
    const code = conv.channel === "whatsapp" ? waErrorCode(e) : "send_failed";
    await db
      .from("messages")
      .update({
        status: "failed",
        status_at: new Date().toISOString(),
        error_code: e instanceof GraphError && e.code != null ? String(e.code) : code,
        error_title: e instanceof GraphError ? e.title.slice(0, 200) : null,
      })
      .eq("id", local.messageId);
    console.warn("[send] falló", { channel: conv.channel, code });
    return fail(res, code === "window_closed" ? 409 : 502, code);
  }
}
