import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { allowMethod, fail, json } from "../../http.js";
import { env } from "../../env.js";
import { crmDb } from "../../inbox/db.js";
import { inboxAuth, jsonBody, str } from "../../inbox/request.js";
import { emailConfigured, marketingDbConfigured, sendEnabled, whatsappConfigured } from "../../marketing/env.js";
import { blockedReason, loadSuppression, RECIPIENT_COLS, type RecipientRow } from "../../marketing/db.js";
import { approvedMarketingTemplate, dispatchCampaign, sendRows, whatsappAccountFor } from "../../marketing/dispatch.js";
import {
  clampLimits,
  normalizeEmail,
  normalizePhone,
  isSampleEmail,
  isSamplePhoneDigits,
  UNSUB_PLACEHOLDER,
  type MarketingChannel,
} from "../../../../shared/marketing.js";

/**
 * POST /api/marketing/campaign  (solo administradores de la agencia)
 *
 * { action: "queue", campaign: {...}, recipients: [...], final: boolean }
 *    Sube la campaña y sus destinatarios YA personalizados (en tandas de hasta
 *    500). El servidor vuelve a filtrar bajas y consentimientos: lo que no
 *    pasa queda registrado como "omitido" con el motivo. Con `final: true`
 *    queda programada (scheduledAt) o lista para salir ya.
 * { action: "cancel" | "pause" | "resume", localId }
 * { action: "test", campaign: {...}, recipient: {...} }
 *    Envío de prueba: email al mail del usuario logueado; WhatsApp al número que indique.
 */
const isChannel = (v: unknown): v is MarketingChannel => v === "email" || v === "whatsapp";
const MAX_BATCH = 500;

interface CampaignIn {
  localId: string;
  name: string;
  channel: MarketingChannel;
  segment: unknown;
  template: unknown;
  limits: unknown;
  scheduledAt: string | null;
}

function parseCampaign(v: unknown): CampaignIn | null {
  const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const localId = str(c.localId, 80);
  const name = str(c.name, 160);
  if (!localId || !name || !isChannel(c.channel)) return null;
  const at = typeof c.scheduledAt === "string" && !Number.isNaN(Date.parse(c.scheduledAt)) ? new Date(c.scheduledAt).toISOString() : null;
  const small = (x: unknown) => (x && typeof x === "object" && JSON.stringify(x).length < 20_000 ? x : {});
  return { localId, name, channel: c.channel, segment: small(c.segment), template: small(c.template), limits: clampLimits(c.limits as never), scheduledAt: at };
}

interface RecipientIn {
  contact_ref: string | null;
  contact_name: string | null;
  email_norm: string | null;
  phone_norm: string | null;
  subject: string | null;
  html: string | null;
  text_body: string | null;
  wa_template: { name: string; language: string; params: string[] } | null;
}

function parseRecipient(v: unknown, channel: MarketingChannel): RecipientIn | { error: string } {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const email = normalizeEmail(typeof r.email === "string" ? r.email : null);
  const phone = normalizePhone(typeof r.phone === "string" ? r.phone : null);
  // Datos de ejemplo: nunca entran a la cola (doble red, el navegador ya los saca).
  if (r.isSample === true || isSampleEmail(email) || isSamplePhoneDigits(phone)) return { error: "ejemplo" };
  if (channel === "email") {
    const html = typeof r.html === "string" ? r.html : "";
    const subject = str(r.subject, 300);
    if (!email) return { error: "sin_email" };
    if (!subject || !html || html.length > 190_000) return { error: "contenido" };
    // El pie con el link de baja es obligatorio.
    if (!html.includes(UNSUB_PLACEHOLDER)) return { error: "sin_link_baja" };
    return {
      contact_ref: str(r.contactRef, 120),
      contact_name: str(r.name, 160),
      email_norm: email,
      phone_norm: null,
      subject,
      html,
      text_body: typeof r.text === "string" ? r.text.slice(0, 45_000) : null,
      wa_template: null,
    };
  }
  const t = (r.waTemplate && typeof r.waTemplate === "object" ? r.waTemplate : {}) as Record<string, unknown>;
  const name = str(t.name, 512);
  const language = str(t.language, 16);
  if (!phone) return { error: "sin_telefono" };
  if (!name || !language) return { error: "plantilla" };
  const params = Array.isArray(t.params) ? t.params.slice(0, 20).map((p) => (typeof p === "string" ? p.slice(0, 1024) : "")) : [];
  return { contact_ref: str(r.contactRef, 120), contact_name: str(r.name, 160), email_norm: null, phone_norm: phone, subject: null, html: null, text_body: null, wa_template: { name, language, params } };
}

async function upsertCampaign(agencyId: string, userId: string, c: CampaignIn) {
  const db = crmDb();
  const { data: existing } = await db.from("marketing_campaigns").select("id, status, channel").eq("agency_id", agencyId).eq("local_id", c.localId).maybeSingle();
  if (existing) {
    if (existing.channel !== c.channel) throw new Error("channel_changed");
    if (["sending", "sent", "cancelled"].includes(existing.status)) return { id: existing.id as string, status: existing.status as string };
    await db.from("marketing_campaigns").update({ name: c.name, segment: c.segment, template: c.template, limits: c.limits }).eq("id", existing.id);
    return { id: existing.id as string, status: existing.status as string };
  }
  const { data, error } = await db
    .from("marketing_campaigns")
    .insert({ agency_id: agencyId, local_id: c.localId, name: c.name, channel: c.channel, segment: c.segment, template: c.template, limits: c.limits, created_by: userId })
    .select("id, status")
    .single();
  if (error || !data) throw new Error("db");
  return { id: data.id as string, status: data.status as string };
}

async function userEmail(req: VercelRequest): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return null;
  const { data } = await createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), { auth: { persistSession: false } }).auth.getUser(m[1]);
  return normalizeEmail(data.user?.email ?? null);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!marketingDbConfigured()) return fail(res, 503, "not_configured");
  const ctx = await inboxAuth(req, res, { admin: true, bucket: "mkt_campaign", limit: 120 });
  if (!ctx) return;
  const b = jsonBody(req);
  const db = crmDb();

  try {
    if (b.action === "cancel" || b.action === "pause" || b.action === "resume") {
      const localId = str(b.localId, 80);
      if (!localId) return fail(res, 400, "bad_request");
      const { data: c } = await db.from("marketing_campaigns").select("id, status").eq("agency_id", ctx.agencyId).eq("local_id", localId).maybeSingle();
      if (!c) return fail(res, 404, "not_found");
      if (b.action === "cancel") {
        await db.from("marketing_campaigns").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", c.id);
        await db.from("marketing_recipients").update({ status: "skipped", skip_reason: "cancelada", html: null, text_body: null }).eq("campaign_id", c.id).eq("status", "queued");
      } else if (b.action === "pause") {
        if (["scheduled", "sending"].includes(c.status)) await db.from("marketing_campaigns").update({ status: "paused" }).eq("id", c.id);
      } else if (c.status === "paused") {
        await db.from("marketing_campaigns").update({ status: "sending" }).eq("id", c.id);
      }
      return json(res, 200, { ok: true });
    }

    const camp = parseCampaign(b.campaign);
    if (!camp) return fail(res, 400, "bad_request");
    if (camp.channel === "email" && !emailConfigured()) return fail(res, 503, "email_not_configured");
    if (camp.channel === "whatsapp" && !whatsappConfigured()) return fail(res, 503, "whatsapp_not_configured");

    // Para WhatsApp: número conectado y plantilla MARKETING aprobada.
    if (camp.channel === "whatsapp") {
      const tpl = (camp.template ?? {}) as { waName?: string; waLanguage?: string };
      const acc = await whatsappAccountFor(ctx.agencyId);
      if (!acc) return fail(res, 409, "whatsapp_no_conectado");
      if (!tpl.waName || !tpl.waLanguage || !(await approvedMarketingTemplate(acc, tpl.waName, tpl.waLanguage)))
        return fail(res, 409, "plantilla_no_aprobada");
    }

    if (b.action === "test") {
      if (!sendEnabled()) return fail(res, 409, "send_disabled");
      const { id: campaignId } = await upsertCampaign(ctx.agencyId, ctx.userId, camp);
      const rec = parseRecipient(b.recipient, camp.channel);
      if ("error" in rec) return fail(res, 400, rec.error);
      if (camp.channel === "email") {
        const me = await userEmail(req);
        if (!me) return fail(res, 400, "sin_email_propio");
        rec.email_norm = me; // la prueba va SIEMPRE al mail de quien la pide
      }
      const { data: ins, error } = await db
        .from("marketing_recipients")
        .insert({ ...rec, agency_id: ctx.agencyId, campaign_id: campaignId, channel: camp.channel, is_test: true, status: "sending", attempts: 1 })
        .select(RECIPIENT_COLS)
        .single();
      if (error || !ins) return fail(res, 500, "server_error");
      const supp = await loadSuppression(ctx.agencyId, camp.channel);
      const why = blockedReason(supp, camp.channel, ins as RecipientRow);
      if (why === "baja") {
        await db.from("marketing_recipients").update({ status: "skipped", skip_reason: "baja" }).eq("id", (ins as RecipientRow).id);
        return fail(res, 409, "destino_dado_de_baja");
      }
      const r = await sendRows({ id: campaignId, agency_id: ctx.agencyId, channel: camp.channel }, [ins as RecipientRow]);
      return json(res, r.sent ? 200 : 502, { ok: r.sent > 0 });
    }

    if (b.action !== "queue") return fail(res, 400, "bad_request");
    const { id: campaignId, status } = await upsertCampaign(ctx.agencyId, ctx.userId, camp);
    if (["sending", "sent", "cancelled"].includes(status)) return fail(res, 409, "campaign_locked");

    const list = Array.isArray(b.recipients) ? b.recipients : [];
    if (list.length > MAX_BATCH) return fail(res, 400, "too_many");
    const supp = await loadSuppression(ctx.agencyId, camp.channel);
    const { data: already } = await db
      .from("marketing_recipients")
      .select("email_norm, phone_norm")
      .eq("campaign_id", campaignId)
      .eq("is_test", false)
      .limit(50_000);
    const seen = new Set((already ?? []).map((r) => (r.email_norm ?? r.phone_norm) as string));
    const rows: Record<string, unknown>[] = [];
    const rejected: Record<string, number> = {};
    const sendAfter = camp.scheduledAt ?? new Date().toISOString();
    for (const raw of list) {
      const r = parseRecipient(raw, camp.channel);
      if ("error" in r) {
        rejected[r.error] = (rejected[r.error] ?? 0) + 1;
        continue;
      }
      const key = (r.email_norm ?? r.phone_norm) as string;
      if (seen.has(key)) continue;
      seen.add(key);
      const why = blockedReason(supp, camp.channel, r);
      rows.push({
        ...r,
        ...(why ? { html: null, text_body: null, status: "skipped", skip_reason: why } : { status: "queued" }),
        agency_id: ctx.agencyId,
        campaign_id: campaignId,
        channel: camp.channel,
        send_after: sendAfter,
      });
      if (why) rejected[why] = (rejected[why] ?? 0) + 1;
    }
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("marketing_recipients").insert(rows.slice(i, i + 100));
      if (error) return fail(res, 500, "server_error");
    }
    if (b.final === true) {
      await db
        .from("marketing_campaigns")
        .update({ status: "scheduled", scheduled_at: camp.scheduledAt ?? new Date().toISOString() })
        .eq("id", campaignId);
    }
    const queued = rows.filter((r) => r.status === "queued").length;
    // "Enviar ahora": primera tanda en el mismo request.
    let dispatched = null;
    if (b.final === true && !camp.scheduledAt && sendEnabled()) dispatched = await dispatchCampaign(ctx.agencyId, campaignId);
    return json(res, 200, { ok: true, queued, rejected, dispatched });
  } catch (e) {
    const code = e instanceof Error ? e.message : "error";
    if (code === "channel_changed") return fail(res, 409, code);
    console.warn("[marketing] campaign", { code: code.slice(0, 40) });
    return fail(res, 500, "server_error");
  }
}
