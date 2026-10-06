import type { VercelRequest, VercelResponse } from "@vercel/node";
import { noStore } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { readRawBody } from "../../inbox/request.js";
import { marketingDbConfigured } from "../../marketing/env.js";
import { recordUnsubscribe } from "../../marketing/db.js";
import { resendWebhookSecret, verifySvix } from "../../marketing/resend.js";
import { advanceStatus, type RecipientStatus } from "../../../../shared/marketing.js";

/**
 * Webhook de Resend: POST /api/marketing/resend-webhook
 * https://resend.com/docs/dashboard/webhooks/event-types
 *
 * Firma Svix sobre el cuerpo crudo. Deduplica por svix-id (marketing_events).
 * email.complained y email.bounced generan además una baja de email.
 */
const MAP: Record<string, RecipientStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
  "email.suppressed": "failed",
};

const header = (req: VercelRequest, k: string) => {
  const v = req.headers[k];
  return Array.isArray(v) ? v[0] : v;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("method_not_allowed");
  }
  if (!marketingDbConfigured() || !process.env.RESEND_WEBHOOK_SECRET) return res.status(503).send("not_configured");

  const raw = await readRawBody(req, 1_000_000);
  const h = { id: header(req, "svix-id"), timestamp: header(req, "svix-timestamp"), signature: header(req, "svix-signature") };
  if (!verifySvix(raw, h, resendWebhookSecret())) return res.status(401).send("invalid_signature");

  let ev: { type?: string; created_at?: string; data?: { email_id?: string; tags?: Record<string, string> | { name: string; value: string }[] } };
  try {
    ev = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).send("bad_json");
  }
  const type = String(ev.type ?? "");
  const db = crmDb();
  const { error: dupErr } = await db.from("marketing_events").insert({ provider: "resend", external_id: h.id, type: type.slice(0, 60), payload: ev });
  // 23505 = ya lo procesamos (Svix reintenta): 200 para que no insista.
  if (dupErr) return res.status(dupErr.code === "23505" ? 200 : 500).send(dupErr.code === "23505" ? "duplicate" : "retry");

  const next = MAP[type];
  let error: string | null = null;
  if (next) {
    try {
      const tags = ev.data?.tags;
      const tagRid = Array.isArray(tags) ? tags.find((t) => t.name === "pm_recipient")?.value : tags?.pm_recipient;
      let q = db.from("marketing_recipients").select("id, agency_id, campaign_id, contact_ref, email_norm, status");
      q = tagRid && /^[0-9a-f-]{36}$/i.test(tagRid) ? q.eq("id", tagRid) : q.eq("provider", "resend").eq("provider_message_id", ev.data?.email_id ?? "-");
      const { data } = await q.maybeSingle();
      const r = data as { id: string; agency_id: string; campaign_id: string; contact_ref: string | null; email_norm: string | null; status: RecipientStatus } | null;
      if (r) {
        const at = ev.created_at && !Number.isNaN(Date.parse(ev.created_at)) ? new Date(ev.created_at).toISOString() : new Date().toISOString();
        const patch: Record<string, unknown> = { status: next === "failed" || next === "bounced" ? next : advanceStatus(r.status, next) };
        if (next === "delivered") patch.delivered_at = at;
        if (next === "opened") patch.opened_at = at;
        if (next === "clicked") patch.clicked_at = at;
        if (next === "failed" || next === "bounced") patch.error_code = type.replace("email.", "");
        await db.from("marketing_recipients").update(patch).eq("id", r.id);
        // Queja de spam o rebote: no se le vuelve a escribir por email.
        if ((next === "complained" || next === "bounced") && r.email_norm) {
          await recordUnsubscribe({
            agencyId: r.agency_id,
            scope: "email",
            email: r.email_norm,
            contactRef: r.contact_ref,
            source: next === "complained" ? "queja_spam" : "rebote",
            campaignId: r.campaign_id,
            recipientId: r.id,
          });
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 120) : "process_error";
    }
  }
  await db.from("marketing_events").update({ processed_at: error ? null : new Date().toISOString(), error }).eq("provider", "resend").eq("external_id", h.id as string);
  return res.status(200).send("ok");
}
