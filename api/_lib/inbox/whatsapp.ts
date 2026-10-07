/**
 * WhatsApp Business Platform (Cloud API) — procesamiento de webhooks, envío y
 * onboarding por Embedded Signup.
 *
 * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint
 *       https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
 *       https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/
 */
import { accountByExternal, markNeedsReauth, tokenOf, type AccountRow } from "./accounts.js";
import { applyStatus, crmDb, ingestMessage } from "./db.js";
import { graph, GraphError, isAuthError } from "./graph.js";
import { ienv } from "./env.js";
import { marketingOnInbound, marketingOnStatus, marketingOnUserPreferences } from "../marketing/whatsappHooks.js";

// ── Tipos del payload (solo lo que usamos) ─────────────────────────────────

interface WaMedia {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

export interface WaMessage {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  audio?: WaMedia;
  video?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  contacts?: { name?: { formatted_name?: string } }[];
}

interface WaStatus {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string }[];
}

interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: WaStatus[];
  message_echoes?: WaMessage[];
  history?: { threads?: { id?: string; messages?: WaMessage[] }[] }[];
  state_sync?: { type?: string; action?: string; contact?: { full_name?: string; phone_number?: string } }[];
  event?: string;
  message_template_name?: string;
  message_template_language?: string;
}

export interface WaEntry {
  id?: string; // WABA id
  changes?: { field?: string; value?: WaValue }[];
}

const MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);
const KNOWN_TYPES = new Set([
  "text", "image", "audio", "video", "document", "sticker", "location", "contacts", "interactive", "reaction", "button",
]);

const tsToIso = (ts?: string) => (ts && /^\d+$/.test(ts) ? new Date(Number(ts) * 1000).toISOString() : null);
const phoneOf = (waId?: string) => (waId ? `+${waId.replace(/\D/g, "")}` : null);

/** Normaliza un mensaje de WhatsApp a lo que guardamos. */
export function mapWaMessage(m: WaMessage): { type: string; body: string | null; mediaId: string | null; mediaMime: string | null } {
  const t = m.type ?? "unsupported";
  if (t === "text") return { type: "text", body: m.text?.body ?? null, mediaId: null, mediaMime: null };
  if (MEDIA_TYPES.has(t)) {
    const md = (m as unknown as Record<string, WaMedia | undefined>)[t];
    return { type: t, body: md?.caption ?? md?.filename ?? null, mediaId: md?.id ?? null, mediaMime: md?.mime_type ?? null };
  }
  if (t === "location") {
    const l = m.location;
    const body = [l?.name, l?.address, l?.latitude != null ? `${l.latitude},${l.longitude}` : null].filter(Boolean).join(" · ");
    return { type: "location", body: body || null, mediaId: null, mediaMime: null };
  }
  if (t === "button") return { type: "button", body: m.button?.text ?? null, mediaId: null, mediaMime: null };
  if (t === "interactive")
    return {
      type: "interactive",
      body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null,
      mediaId: null,
      mediaMime: null,
    };
  if (t === "reaction") return { type: "reaction", body: m.reaction?.emoji ?? null, mediaId: null, mediaMime: null };
  if (t === "contacts")
    return {
      type: "contacts",
      body: (m.contacts ?? []).map((c) => c.name?.formatted_name).filter(Boolean).join(", ") || null,
      mediaId: null,
      mediaMime: null,
    };
  return { type: KNOWN_TYPES.has(t) ? t : "unsupported", body: null, mediaId: null, mediaMime: null };
}

async function ingestWa(
  acc: AccountRow,
  m: WaMessage,
  opts: { direction: "in" | "out"; thread: string; name?: string | null; echo?: boolean; countUnread?: boolean },
) {
  if (!m.id) return;
  const mm = mapWaMessage(m);
  await ingestMessage({
    agencyId: acc.agency_id,
    channel: "whatsapp",
    channelAccountId: acc.id,
    threadId: opts.thread,
    contactName: opts.name ?? null,
    contactPhone: phoneOf(opts.thread),
    direction: opts.direction,
    type: mm.type,
    body: mm.body,
    mediaId: mm.mediaId,
    mediaMime: mm.mediaMime,
    externalId: m.id,
    createdAt: tsToIso(m.timestamp),
    echo: opts.echo,
    status: opts.direction === "in" ? "received" : "sent",
    countUnread: opts.countUnread,
  });
}

/** Procesa un entry de object=whatsapp_business_account. Devuelve contadores para debug. */
export async function processWaEntry(entry: WaEntry): Promise<{ handled: number; skipped: number }> {
  let handled = 0;
  let skipped = 0;
  for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    const field = ch.field ?? "";

    // Plantillas: aprobada / rechazada / pausada.
    if (field === "message_template_status_update") {
      if (v.message_template_name && v.event && entry.id) {
        await crmDb()
          .from("message_templates")
          .update({ status: v.event, synced_at: new Date().toISOString() })
          .eq("waba_id", entry.id)
          .eq("name", v.message_template_name)
          .eq("language", v.message_template_language ?? "");
        handled++;
      }
      continue;
    }

    // El cliente dio de baja la integración desde su lado.
    if (field === "account_offboarded" || (field === "account_update" && v.event === "PARTNER_REMOVED")) {
      if (entry.id) {
        await crmDb().from("channel_accounts").update({ status: "disconnected", last_error: "baja_desde_meta" }).eq("waba_id", entry.id);
        handled++;
      }
      continue;
    }

    const pnid = v.metadata?.phone_number_id;
    if (!pnid) {
      skipped++;
      continue;
    }
    const acc = await accountByExternal("whatsapp", "phone_number_id", pnid);
    if (!acc) {
      skipped++;
      continue;
    }

    if (field === "messages") {
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        if (!m.from) continue;
        await ingestWa(acc, m, { direction: "in", thread: m.from, name: names.get(m.from) });
        // Marketing: "BAJA" / botón de baja, o respuesta a una campaña.
        await marketingOnInbound(acc, m);
        handled++;
      }
      for (const s of v.statuses ?? []) {
        if (!s.id || !s.status) continue;
        const st = s.status === "played" ? "read" : s.status;
        if (st !== "sent" && st !== "delivered" && st !== "read" && st !== "failed") continue;
        const err = s.errors?.[0];
        await applyStatus(s.id, st, tsToIso(s.timestamp), err?.code != null ? String(err.code) : null, err?.title ?? null);
        await marketingOnStatus(s.id, st, err?.code != null ? String(err.code) : null);
        handled++;
      }
      continue;
    }

    // Marketing: el usuario frenó las promociones desde WhatsApp.
    if (field === "user_preferences") {
      handled += await marketingOnUserPreferences(acc, v);
      continue;
    }

    // Coexistencia: lo que el negocio manda desde la app WhatsApp Business del celular.
    if (field === "smb_message_echoes") {
      for (const m of v.message_echoes ?? []) {
        if (!m.to) continue;
        await ingestWa(acc, m, { direction: "out", thread: m.to, echo: true });
        handled++;
      }
      continue;
    }

    // Coexistencia: historial (hasta 6 meses, llega en fases). No suma "no leídos".
    if (field === "history") {
      for (const h of v.history ?? []) {
        for (const th of h.threads ?? []) {
          if (!th.id) continue;
          for (const m of th.messages ?? []) {
            const inbound = m.from === th.id;
            await ingestWa(acc, m, { direction: inbound ? "in" : "out", thread: th.id, echo: !inbound, countUnread: false });
            handled++;
          }
        }
      }
      continue;
    }

    // Coexistencia: contactos de la app. Solo actualizamos el nombre de conversaciones existentes.
    if (field === "smb_app_state_sync") {
      for (const s of v.state_sync ?? []) {
        const phone = phoneOf(s.contact?.phone_number);
        if (s.type !== "contact" || s.action === "remove" || !phone || !s.contact?.full_name) continue;
        await crmDb()
          .from("conversations")
          .update({ contact_name: s.contact.full_name.slice(0, 120) })
          .eq("channel_account_id", acc.id)
          .eq("contact_phone", phone);
        handled++;
      }
      continue;
    }
    skipped++;
  }
  return { handled, skipped };
}

// ── Envío ─────────────────────────────────────────────────────────────────

interface SendResp {
  messages?: { id?: string }[];
}

async function waPost(acc: AccountRow, body: Record<string, unknown>): Promise<string> {
  if (!acc.phone_number_id) throw new Error("no_phone");
  try {
    const r = await graph<SendResp>(`${acc.phone_number_id}/messages`, {
      method: "POST",
      token: tokenOf(acc),
      body: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
    });
    const id = r.messages?.[0]?.id;
    if (!id) throw new Error("no_id");
    return id;
  } catch (e) {
    if (isAuthError(e)) await markNeedsReauth(acc.id);
    throw e;
  }
}

export function waSendText(acc: AccountRow, toWaId: string, text: string): Promise<string> {
  return waPost(acc, { to: toWaId, type: "text", text: { preview_url: false, body: text } });
}

export function waSendTemplate(acc: AccountRow, toWaId: string, name: string, language: string, params: string[]): Promise<string> {
  const components = params.length
    ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }]
    : undefined;
  return waPost(acc, { to: toWaId, type: "template", template: { name, language: { code: language }, components } });
}

/** Descarga un media de WhatsApp (la URL de Meta exige el token y dura ~5 min). */
export async function waDownloadMedia(acc: AccountRow, mediaId: string, maxBytes: number): Promise<{ mime: string; data: Buffer }> {
  const token = tokenOf(acc);
  const meta = await graph<{ url?: string; mime_type?: string; file_size?: number }>(mediaId, { token });
  if (!meta.url) throw new Error("media_url");
  if (meta.file_size && meta.file_size > maxBytes) throw new Error("media_too_big");
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("media_fetch");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("media_too_big");
  return { mime: meta.mime_type ?? r.headers.get("content-type") ?? "application/octet-stream", data: buf };
}

// ── Plantillas ────────────────────────────────────────────────────────────

interface TplComponent {
  type?: string;
  text?: string;
}
interface TplRow {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: TplComponent[];
}

export function countBodyParams(components: TplComponent[] | undefined): number {
  const body = (components ?? []).find((c) => c.type === "BODY")?.text ?? "";
  const nums = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) nums.add(m[1]);
  return nums.size;
}

/** Trae las plantillas del WABA (todas las páginas, hasta 500) y las espeja en la base. */
export async function syncTemplates(acc: AccountRow): Promise<number> {
  if (!acc.waba_id) throw new Error("no_waba");
  const token = tokenOf(acc);
  const rows: TplRow[] = [];
  let next: string | undefined = `${acc.waba_id}/message_templates`;
  let query: Record<string, string> | undefined = { fields: "id,name,language,status,category,components", limit: "100" };
  for (let i = 0; next && i < 5; i++) {
    const page: { data?: TplRow[]; paging?: { next?: string } } = await graph(next, { token, query });
    rows.push(...(page.data ?? []));
    next = page.paging?.next;
    query = undefined; // `next` ya trae los parámetros
  }
  const now = new Date().toISOString();
  const upserts = rows
    .filter((t) => t.name && t.language && t.status)
    .map((t) => ({
      agency_id: acc.agency_id,
      channel_account_id: acc.id,
      waba_id: acc.waba_id,
      external_id: t.id ?? null,
      name: t.name,
      language: t.language,
      category: t.category ?? null,
      status: t.status,
      components: t.components ?? [],
      body_params: countBodyParams(t.components),
      synced_at: now,
    }));
  if (upserts.length) {
    const { error } = await crmDb().from("message_templates").upsert(upserts, { onConflict: "channel_account_id,name,language" });
    if (error) throw new Error("db");
  }
  return upserts.length;
}

// ── Embedded Signup ───────────────────────────────────────────────────────

/**
 * Canjea el `code` que devuelve FB.login (Embedded Signup) por el token de
 * negocio. El code vence a los ~30 s. El ejemplo oficial no usa redirect_uri.
 * https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
 */
export async function exchangeCode(code: string): Promise<{ token: string; expiresIn: number | null }> {
  const r = await graph<{ access_token?: string; expires_in?: number }>("oauth/access_token", {
    query: { client_id: ienv("META_APP_ID"), client_secret: ienv("META_APP_SECRET"), code },
  });
  if (!r.access_token) throw new Error("no_token");
  return { token: r.access_token, expiresIn: typeof r.expires_in === "number" ? r.expires_in : null };
}

export async function phoneInfo(token: string, phoneNumberId: string) {
  return graph<{ display_phone_number?: string; verified_name?: string }>(phoneNumberId, {
    token,
    query: { fields: "display_phone_number,verified_name" },
  });
}

export async function subscribeWaba(token: string, wabaId: string): Promise<void> {
  await graph(`${wabaId}/subscribed_apps`, { method: "POST", token });
}

export async function registerNumber(token: string, phoneNumberId: string, pin: string): Promise<void> {
  await graph(`${phoneNumberId}/register`, { method: "POST", token, body: { messaging_product: "whatsapp", pin } });
}

/** Coexistencia: pedir contactos ("smb_app_state_sync") e historial ("history"). Una sola vez, dentro de 24 h. */
export async function requestSmbSync(token: string, phoneNumberId: string, syncType: "smb_app_state_sync" | "history"): Promise<void> {
  await graph(`${phoneNumberId}/smb_app_data`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", sync_type: syncType },
  });
}

/** Texto de error para la UI a partir de un error de Graph, sin datos internos. */
export function waErrorCode(e: unknown): string {
  if (!(e instanceof GraphError)) return "send_failed";
  if (e.code === 131047) return "window_closed"; // re-engagement: fuera de la ventana de 24 h
  if (e.code === 131026) return "undeliverable";
  if (e.code === 132001) return "template_not_found";
  if (e.code === 132000) return "template_params";
  if (e.code === 130429 || e.code === 131056) return "rate_limited";
  if (e.code === 190) return "needs_reauth";
  return "send_failed";
}
