import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { inboxAuth } from "../../inbox/request.js";
import { marketingDbConfigured } from "../../marketing/env.js";

/**
 * GET /api/marketing/state                 → bajas, consentimientos y campañas con métricas
 * GET /api/marketing/state?campaign=<local> → registro por destinatario de una campaña (sin contenido)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!marketingDbConfigured()) return fail(res, 503, "not_configured");
  const ctx = await inboxAuth(req, res, { bucket: "mkt_state", limit: 60 });
  if (!ctx) return;
  const db = crmDb();

  const local = typeof req.query.campaign === "string" ? req.query.campaign.slice(0, 80) : null;
  if (local) {
    const { data: camp } = await db.from("marketing_campaigns").select("id").eq("agency_id", ctx.agencyId).eq("local_id", local).maybeSingle();
    if (!camp) return json(res, 200, { recipients: [] });
    const { data, error } = await db
      .from("marketing_recipients")
      .select(
        "id, contact_ref, contact_name, email_norm, phone_norm, is_test, status, skip_reason, error_code, sent_at, delivered_at, opened_at, clicked_at, replied_at, unsubscribed_at, created_at",
      )
      .eq("campaign_id", camp.id)
      .order("created_at", { ascending: true })
      .limit(2000);
    if (error) return fail(res, 500, "server_error");
    return json(res, 200, { recipients: data ?? [] });
  }

  const [unsubs, consents, camps] = await Promise.all([
    db
      .from("marketing_unsubscribes")
      .select("id, scope, contact_ref, email_norm, phone_norm, source, note, created_at, revoked_at")
      .eq("agency_id", ctx.agencyId)
      .order("created_at", { ascending: false })
      .limit(2000),
    db
      .from("marketing_consents")
      .select("id, channel, contact_ref, email_norm, phone_norm, status, method, evidence, given_at")
      .eq("agency_id", ctx.agencyId)
      .order("given_at", { ascending: false })
      .limit(3000),
    db
      .from("marketing_campaigns")
      .select("id, local_id, name, channel, status, scheduled_at, started_at, finished_at, created_at")
      .eq("agency_id", ctx.agencyId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (unsubs.error || consents.error || camps.error) return fail(res, 500, "server_error");

  // Métricas por campaña (conteo por estado).
  const stats: Record<string, Record<string, number>> = {};
  const ids = (camps.data ?? []).map((c) => c.id);
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db
      .from("marketing_recipients")
      .select("campaign_id, status, opened_at, clicked_at, replied_at, delivered_at")
      .in("campaign_id", ids.slice(i, i + 50))
      .eq("is_test", false)
      .limit(50_000);
    for (const r of data ?? []) {
      const s = (stats[r.campaign_id] ??= {});
      s[r.status] = (s[r.status] ?? 0) + 1;
      s.total = (s.total ?? 0) + 1;
      if (r.delivered_at) s.delivered_any = (s.delivered_any ?? 0) + 1;
      if (r.opened_at) s.opened_any = (s.opened_any ?? 0) + 1;
      if (r.clicked_at) s.clicked_any = (s.clicked_any ?? 0) + 1;
      if (r.replied_at) s.replied_any = (s.replied_any ?? 0) + 1;
    }
  }

  return json(res, 200, {
    unsubscribes: unsubs.data ?? [],
    consents: consents.data ?? [],
    campaigns: (camps.data ?? []).map((c) => ({ ...c, stats: stats[c.id] ?? {} })),
  });
}
