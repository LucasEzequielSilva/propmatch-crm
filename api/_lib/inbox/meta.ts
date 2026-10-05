/**
 * Instagram (mensajes) y Facebook Messenger vía Messenger Platform, con
 * Facebook Login for Business y tokens de Página.
 *
 * Docs: https://developers.facebook.com/docs/messenger-platform/webhooks
 *       https://developers.facebook.com/docs/messenger-platform/send-messages
 *       https://developers.facebook.com/docs/instagram-platform/overview
 *
 * Preparado pero apagado (META_MESSAGING_ENABLED) hasta que Meta apruebe
 * pages_messaging / instagram_manage_messages en App Review.
 */
import { accountByExternal, markNeedsReauth, tokenOf, type AccountRow, type ChannelName } from "./accounts.js";
import { applyStatus, crmDb, ingestMessage } from "./db.js";
import { graph, isAuthError } from "./graph.js";
import { ienv } from "./env.js";

interface MsgAttachment {
  type?: string;
  payload?: { url?: string };
}

interface MessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: MsgAttachment[]; is_deleted?: boolean };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { watermark?: number; mid?: string };
}

export interface MessagingEntry {
  id?: string; // page id (object=page) o IG user id (object=instagram)
  time?: number;
  messaging?: MessagingEvent[];
}

const ATTACH_TYPE: Record<string, string> = { image: "image", video: "video", audio: "audio", file: "document" };

async function fetchProfileName(acc: AccountRow, userId: string): Promise<{ name: string | null; username: string | null }> {
  try {
    const fields = acc.channel === "instagram" ? "name,username" : "name";
    const p = await graph<{ name?: string; username?: string }>(userId, { token: tokenOf(acc), query: { fields }, timeoutMs: 2000 });
    return { name: p.name ?? null, username: p.username ?? null };
  } catch {
    return { name: null, username: null };
  }
}

export async function processMessagingEntry(object: "page" | "instagram", entry: MessagingEntry): Promise<{ handled: number; skipped: number }> {
  let handled = 0;
  let skipped = 0;
  const channel: ChannelName = object === "page" ? "messenger" : "instagram";
  if (!entry.id) return { handled, skipped: 1 };
  const acc = await accountByExternal(channel, channel === "messenger" ? "page_id" : "ig_user_id", entry.id);
  if (!acc) return { handled, skipped: (entry.messaging ?? []).length || 1 };

  for (const ev of entry.messaging ?? []) {
    const at = ev.timestamp ? new Date(ev.timestamp).toISOString() : null;

    if (ev.message?.mid && !ev.message.is_deleted) {
      const echo = !!ev.message.is_echo;
      const thread = echo ? ev.recipient?.id : ev.sender?.id;
      if (!thread) {
        skipped++;
        continue;
      }
      const att = ev.message.attachments?.[0];
      const type = att?.type ? (ATTACH_TYPE[att.type] ?? "unsupported") : "text";
      const r = await ingestMessage({
        agencyId: acc.agency_id,
        channel,
        channelAccountId: acc.id,
        threadId: thread,
        direction: echo ? "out" : "in",
        type,
        body: ev.message.text ?? null,
        mediaUrl: att?.payload?.url ?? null,
        externalId: ev.message.mid,
        createdAt: at,
        echo,
        status: echo ? "sent" : "received",
      });
      // Nombre del contacto: solo la primera vez, best effort (2 s máx.).
      if (r.inserted && !echo) {
        const { data } = await crmDb().from("conversations").select("contact_name").eq("id", r.conversationId).maybeSingle();
        if (data && !data.contact_name) {
          const p = await fetchProfileName(acc, thread);
          if (p.name || p.username) {
            await crmDb().from("conversations").update({ contact_name: p.name, contact_username: p.username }).eq("id", r.conversationId);
          }
        }
      }
      handled++;
      continue;
    }

    if (ev.delivery?.mids?.length) {
      for (const mid of ev.delivery.mids) await applyStatus(mid, "delivered", at);
      handled++;
      continue;
    }

    // "Leído" llega como marca de agua: todo lo saliente hasta ese momento quedó leído.
    if (ev.read && ev.sender?.id) {
      const wm = ev.read.watermark ? new Date(ev.read.watermark).toISOString() : at;
      const { data: conv } = await crmDb()
        .from("conversations")
        .select("id")
        .eq("channel_account_id", acc.id)
        .eq("external_thread_id", ev.sender.id)
        .maybeSingle();
      if (conv && wm) {
        await crmDb()
          .from("messages")
          .update({ status: "read", status_at: wm })
          .eq("conversation_id", conv.id)
          .eq("direction", "out")
          .lte("created_at", wm)
          .in("status", ["sent", "delivered"]);
      }
      handled++;
      continue;
    }
    skipped++;
  }
  return { handled, skipped };
}

// ── Envío ─────────────────────────────────────────────────────────────────

/**
 * Responde por Messenger o Instagram (FB Login) desde la Página.
 * Dentro de 24 h: RESPONSE. Hasta 7 días: MESSAGE_TAG + HUMAN_AGENT (requiere
 * el permiso Human Agent aprobado).
 */
export async function metaSendText(acc: AccountRow, recipientId: string, text: string, humanAgent: boolean): Promise<string> {
  if (!acc.page_id) throw new Error("no_page");
  const body = humanAgent
    ? { recipient: { id: recipientId }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT", message: { text } }
    : { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } };
  try {
    const r = await graph<{ message_id?: string }>(`${acc.page_id}/messages`, { method: "POST", token: tokenOf(acc), body });
    if (!r.message_id) throw new Error("no_id");
    return r.message_id;
  } catch (e) {
    if (isAuthError(e)) await markNeedsReauth(acc.id);
    throw e;
  }
}

// ── Conexión (Facebook Login for Business) ────────────────────────────────

export interface PageInfo {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

/** code → token de usuario → token de larga duración → páginas con sus tokens. */
export async function pagesFromCode(code: string): Promise<PageInfo[]> {
  const short = await graph<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: ienv("META_APP_ID"), client_secret: ienv("META_APP_SECRET"), code },
  });
  if (!short.access_token) throw new Error("no_token");
  const long = await graph<{ access_token?: string }>("oauth/access_token", {
    query: {
      grant_type: "fb_exchange_token",
      client_id: ienv("META_APP_ID"),
      client_secret: ienv("META_APP_SECRET"),
      fb_exchange_token: short.access_token,
    },
  });
  const userToken = long.access_token ?? short.access_token;
  const r = await graph<{ data?: PageInfo[] }>("me/accounts", {
    token: userToken,
    query: { fields: "id,name,access_token,instagram_business_account{id,username}", limit: "50" },
  });
  return (r.data ?? []).filter((p) => p.id && p.access_token);
}

export async function subscribePage(pageToken: string, pageId: string): Promise<void> {
  await graph(`${pageId}/subscribed_apps`, {
    method: "POST",
    token: pageToken,
    query: { subscribed_fields: "messages,message_echoes,message_deliveries,message_reads" },
  });
}
