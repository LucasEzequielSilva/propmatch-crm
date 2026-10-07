/**
 * Despacho de una campaña: toma destinatarios en cola (respetando topes),
 * vuelve a chequear bajas/consentimientos/frecuencia en el servidor y manda
 * por Resend (email) o por la Cloud API oficial de WhatsApp (plantillas).
 *
 * Nada sale si MARKETING_SEND_ENABLED != "1".
 */
import { crmDb, ingestMessage } from "../inbox/db.js";
import { markNeedsReauth, tokenOf, type AccountRow } from "../inbox/accounts.js";
import { graph, GraphError, isAuthError } from "../inbox/graph.js";
import { agencyDailyCap, appBase, menv, replyTo, sendEnabled } from "./env.js";
import { blockedReason, loadSuppression, recentlyContacted, recordUnsubscribe, sentCount, type RecipientRow } from "./db.js";
import { resendBatch, ResendError, type ResendEmail } from "./resend.js";
import { signUnsubToken } from "./token.js";
import {
  clampLimits,
  fillUnsubscribe,
  isOptOutMessage,
  WA_OPT_OUT_BUTTON,
  WA_OPT_OUT_PAYLOAD,
  type MarketingChannel,
} from "../../../shared/marketing.js";

/** Por invocación (la función tiene ~60 s). */
const CHUNK: Record<MarketingChannel, number> = { email: 100, whatsapp: 40 };

export interface DispatchResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  requeued: number;
  remaining: number;
  stopped?: string;
}

interface CampaignRow {
  id: string;
  agency_id: string;
  channel: MarketingChannel;
  status: string;
  limits: Record<string, unknown>;
  scheduled_at: string | null;
}

type CampaignRef = Pick<CampaignRow, "id" | "agency_id" | "channel">;

/** Manda filas ya reservadas (lo usa también el envío de prueba). */
export async function sendRows(c: CampaignRef, rows: RecipientRow[]): Promise<DispatchResult> {
  const res: DispatchResult = { claimed: rows.length, sent: 0, skipped: 0, failed: 0, requeued: 0, remaining: 0 };
  if (c.channel === "email") await sendEmails(c, rows, res);
  else await sendWhatsapps(c, rows, res);
  return res;
}

export function unsubLinks(recipientId: string): { page: string; oneClick: string } {
  const t = signUnsubToken(recipientId);
  const base = appBase();
  return { page: `${base}/baja/${t}`, oneClick: `${base}/api/marketing/unsubscribe?t=${encodeURIComponent(t)}` };
}

async function finishIfDone(campaignId: string): Promise<number> {
  const { count } = await crmDb()
    .from("marketing_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .in("status", ["queued", "sending"]);
  const remaining = count ?? 0;
  if (remaining === 0) {
    await crmDb()
      .from("marketing_campaigns")
      .update({ status: "sent", finished_at: new Date().toISOString() })
      .eq("id", campaignId)
      .in("status", ["scheduled", "sending"]);
  }
  return remaining;
}

const upd = (id: string, patch: Record<string, unknown>) => crmDb().from("marketing_recipients").update(patch).eq("id", id);

export async function dispatchCampaign(agencyId: string, campaignId: string): Promise<DispatchResult> {
  const res: DispatchResult = { claimed: 0, sent: 0, skipped: 0, failed: 0, requeued: 0, remaining: 0 };
  const db = crmDb();
  const { data: camp } = await db
    .from("marketing_campaigns")
    .select("id, agency_id, channel, status, limits, scheduled_at")
    .eq("id", campaignId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  const c = camp as CampaignRow | null;
  if (!c) return { ...res, stopped: "not_found" };
  if (c.status !== "scheduled" && c.status !== "sending") return { ...res, stopped: "not_active" };
  if (c.scheduled_at && Date.parse(c.scheduled_at) > Date.now()) return { ...res, stopped: "not_yet" };
  if (!sendEnabled()) return { ...res, stopped: "send_disabled" };

  await db.rpc("marketing_release_stuck", { p_minutes: 15 });

  // Topes: campaña por hora y por día, y agencia por día.
  const limits = clampLimits(c.limits as never);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [h, d, ag] = await Promise.all([
    sentCount(agencyId, hourAgo, c.id),
    sentCount(agencyId, dayAgo, c.id),
    sentCount(agencyId, dayAgo),
  ]);
  const budget = Math.min(limits.perHour - h, limits.perDay - d, agencyDailyCap() - ag, CHUNK[c.channel]);
  if (budget <= 0) {
    res.remaining = await finishIfDone(c.id);
    return { ...res, stopped: "limit_reached" };
  }

  if (c.status === "scheduled") {
    await db.from("marketing_campaigns").update({ status: "sending", started_at: new Date().toISOString() }).eq("id", c.id);
  }

  const { data: claimed, error } = await db.rpc("marketing_claim", { p_agency_id: agencyId, p_campaign_id: c.id, p_limit: budget });
  if (error) throw new Error("db");
  const rows = (claimed ?? []) as RecipientRow[];
  res.claimed = rows.length;

  const supp = await loadSuppression(agencyId, c.channel);
  const targets = rows.map((r) => (c.channel === "email" ? r.email_norm : r.phone_norm)).filter((x): x is string => !!x);
  const recent = await recentlyContacted(agencyId, c.channel, targets, limits.minDaysBetween);

  const ok: RecipientRow[] = [];
  for (const r of rows) {
    // Las pruebas van a uno mismo: no piden consentimiento, pero sí respetan una baja.
    let why = blockedReason(supp, c.channel, r);
    if (r.is_test && why === "sin_consentimiento") why = null;
    const target = c.channel === "email" ? r.email_norm : r.phone_norm;
    if (!why && !r.is_test && target && recent.has(target)) why = "frecuencia";
    if (why) {
      await upd(r.id, { status: "skipped", skip_reason: why, html: null, text_body: null });
      res.skipped++;
    } else ok.push(r);
  }

  if (c.channel === "email") await sendEmails(c, ok, res);
  else await sendWhatsapps(c, ok, res);

  res.remaining = await finishIfDone(c.id);
  return res;
}

/* ── Email ──────────────────────────────────────────────────────────────── */

async function sendEmails(c: CampaignRef, rows: RecipientRow[], res: DispatchResult) {
  if (!rows.length) return;
  const from = menv("MARKETING_FROM_EMAIL");
  const reply = replyTo();
  const emails: ResendEmail[] = rows.map((r) => {
    const links = unsubLinks(r.id);
    return {
      from,
      to: [r.email_norm as string],
      subject: (r.subject ?? "").slice(0, 300),
      html: fillUnsubscribe(r.html ?? "", links.page),
      text: fillUnsubscribe(r.text_body ?? "", links.page),
      ...(reply ? { reply_to: reply } : {}),
      // RFC 8058: baja en un clic. Gmail/Yahoo lo exigen a remitentes masivos.
      headers: {
        "List-Unsubscribe": `<${links.oneClick}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      tags: [
        { name: "pm_campaign", value: c.id },
        { name: "pm_recipient", value: r.id },
      ],
    };
  });
  try {
    const ids = await resendBatch(emails, `pm-mkt-${c.id}-${rows[0].id}-${rows.length}-${rows[0].attempts}`);
    const now = new Date().toISOString();
    await Promise.all(
      rows.map((r, i) =>
        upd(r.id, { status: "sent", provider: "resend", provider_message_id: ids[i] || null, sent_at: now, html: null, text_body: null }),
      ),
    );
    res.sent += rows.length;
  } catch (e) {
    const retry = e instanceof ResendError && (e.status === 429 || e.status >= 500);
    await Promise.all(
      rows.map((r) =>
        retry && r.attempts < 3
          ? upd(r.id, { status: "queued", send_after: new Date(Date.now() + 60_000).toISOString() })
          : upd(r.id, { status: "failed", error_code: e instanceof ResendError ? `resend_${e.status}` : "send_failed", html: null, text_body: null }),
      ),
    );
    if (retry) res.requeued += rows.length;
    else res.failed += rows.length;
    console.warn("[marketing] resend falló", { campaign: c.id, status: e instanceof ResendError ? e.status : "x" });
  }
}

/* ── WhatsApp (Cloud API, plantillas MARKETING aprobadas) ───────────────── */

interface TplRow {
  name: string;
  language: string;
  category: string | null;
  components: { type?: string; text?: string; buttons?: { type?: string; text?: string }[] }[];
  body_params: number;
}

/** Índice del botón de respuesta rápida de baja dentro de la plantilla, o -1. */
export function optOutButtonIndex(components: TplRow["components"]): number {
  const buttons = components.find((x) => (x.type ?? "").toUpperCase() === "BUTTONS")?.buttons ?? [];
  return buttons.findIndex(
    (b) => (b.type ?? "").toUpperCase() === "QUICK_REPLY" && (isOptOutMessage(b.text) || b.text === WA_OPT_OUT_BUTTON),
  );
}

export async function whatsappAccountFor(agencyId: string): Promise<AccountRow | null> {
  const { data } = await crmDb()
    .from("channel_accounts")
    .select(
      "id, agency_id, channel, status, display_name, display_phone, username, business_id, waba_id, phone_number_id, page_id, ig_user_id, coexistence, access_token_enc",
    )
    .eq("agency_id", agencyId)
    .eq("channel", "whatsapp")
    .eq("status", "connected")
    .order("connected_at", { ascending: false })
    .limit(1);
  return (data?.[0] as AccountRow | undefined) ?? null;
}

export async function approvedMarketingTemplate(acc: AccountRow, name: string, language: string): Promise<TplRow | null> {
  const { data } = await crmDb()
    .from("message_templates")
    .select("name, language, category, components, body_params")
    .eq("channel_account_id", acc.id)
    .eq("name", name)
    .eq("language", language)
    .eq("status", "APPROVED")
    .maybeSingle();
  const t = data as TplRow | null;
  return t && (t.category ?? "").toUpperCase() === "MARKETING" ? t : null;
}

const cleanParam = (p: unknown) =>
  (typeof p === "string" ? p : "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024);

async function sendWhatsapps(c: CampaignRef, rows: RecipientRow[], res: DispatchResult) {
  if (!rows.length) return;
  const acc = await whatsappAccountFor(c.agency_id);
  const fail = async (r: RecipientRow, code: string) => {
    await upd(r.id, { status: "failed", error_code: code });
    res.failed++;
  };
  if (!acc?.phone_number_id) {
    for (const r of rows) await fail(r, "whatsapp_no_conectado");
    return;
  }
  const tplCache = new Map<string, TplRow | null>();
  for (const r of rows) {
    const name = r.wa_template?.name ?? "";
    const language = r.wa_template?.language ?? "";
    const key = `${name}|${language}`;
    if (!tplCache.has(key)) tplCache.set(key, name && language ? await approvedMarketingTemplate(acc, name, language) : null);
    const tpl = tplCache.get(key);
    if (!tpl) {
      await fail(r, "plantilla_no_aprobada");
      continue;
    }
    const params = (r.wa_template?.params ?? []).map(cleanParam);
    if (params.length !== tpl.body_params || params.some((p) => !p)) {
      await fail(r, "parametros_plantilla");
      continue;
    }
    const components: Record<string, unknown>[] = [];
    if (params.length) components.push({ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) });
    const idx = optOutButtonIndex(tpl.components);
    if (idx >= 0) {
      components.push({ type: "button", sub_type: "quick_reply", index: String(idx), parameters: [{ type: "payload", payload: WA_OPT_OUT_PAYLOAD }] });
    }
    try {
      const out = await graph<{ messages?: { id?: string }[] }>(`${acc.phone_number_id}/messages`, {
        method: "POST",
        token: tokenOf(acc),
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: r.phone_norm,
          type: "template",
          template: { name: tpl.name, language: { code: tpl.language }, ...(components.length ? { components } : {}) },
        },
      });
      const id = out.messages?.[0]?.id;
      if (!id) throw new Error("no_id");
      await upd(r.id, { status: "sent", provider: "whatsapp_cloud", provider_message_id: id, sent_at: new Date().toISOString() });
      res.sent++;
      // Que la conversación aparezca en el inbox (best effort).
      try {
        await ingestMessage({
          agencyId: c.agency_id,
          channel: "whatsapp",
          channelAccountId: acc.id,
          threadId: r.phone_norm as string,
          contactName: r.contact_name,
          contactPhone: `+${r.phone_norm}`,
          direction: "out",
          type: "template",
          body: `Campaña: plantilla ${tpl.name}`,
          externalId: id,
          status: "sent",
          templateName: tpl.name,
          templateLanguage: tpl.language,
          countUnread: false,
        });
      } catch {
        /* el inbox no es crítico para el envío */
      }
    } catch (e) {
      if (isAuthError(e)) {
        await markNeedsReauth(acc.id);
        await fail(r, "needs_reauth");
        continue;
      }
      const code = e instanceof GraphError ? e.code : null;
      if (code === 131050) {
        // El usuario cortó el marketing desde WhatsApp: es una baja.
        await recordUnsubscribe({ agencyId: c.agency_id, scope: "whatsapp", phone: r.phone_norm, contactRef: r.contact_ref, source: "whatsapp_meta", campaignId: c.id, recipientId: r.id });
        await upd(r.id, { status: "unsubscribed", unsubscribed_at: new Date().toISOString(), error_code: "131050" });
        res.skipped++;
      } else if ((code === 131049 || code === 130429 || code === 131056) && r.attempts < 3) {
        // Límite por usuario de Meta (131049): reintentar después de 24 h. Rate limit: en 1 min.
        const wait = code === 131049 ? 86_400_000 : 60_000;
        await upd(r.id, { status: "queued", send_after: new Date(Date.now() + wait).toISOString(), error_code: String(code) });
        res.requeued++;
      } else {
        await fail(r, code != null ? String(code) : "send_failed");
      }
    }
  }
}
