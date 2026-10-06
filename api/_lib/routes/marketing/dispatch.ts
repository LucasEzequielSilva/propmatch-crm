import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fail, json, noStore } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { safeEqualStr } from "../../inbox/crypto.js";
import { inboxAuth, jsonBody, str } from "../../inbox/request.js";
import { marketingDbConfigured } from "../../marketing/env.js";
import { dispatchCampaign, type DispatchResult } from "../../marketing/dispatch.js";

/**
 * Despachador.
 *
 * POST { localId }  (admin) → manda la próxima tanda de esa campaña (lo llama
 *   la pantalla de Marketing cada minuto mientras está abierta y la campaña
 *   está "enviando").
 * GET con "Authorization: Bearer <CRON_SECRET>" → todas las campañas vencidas
 *   de todas las agencias (para Vercel Cron; ver docs/marketing-puesta-en-marcha.md).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (!marketingDbConfigured()) return fail(res, 503, "not_configured");

  if (req.method === "GET") {
    const secret = process.env.CRON_SECRET;
    const got = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
    if (!secret || !got || !safeEqualStr(got, secret)) return fail(res, 401, "unauthorized");
    const started = Date.now();
    const { data } = await crmDb()
      .from("marketing_campaigns")
      .select("id, agency_id")
      .in("status", ["scheduled", "sending"])
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(50);
    const out: Record<string, DispatchResult | string> = {};
    for (const c of data ?? []) {
      if (Date.now() - started > 45_000) break; // margen dentro de los 60 s
      try {
        out[c.id] = await dispatchCampaign(c.agency_id, c.id);
      } catch {
        out[c.id] = "error";
      }
    }
    return json(res, 200, { ok: true, campaigns: Object.keys(out).length });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }
  const ctx = await inboxAuth(req, res, { admin: true, bucket: "mkt_dispatch", limit: 30 });
  if (!ctx) return;
  const localId = str(jsonBody(req).localId, 80);
  if (!localId) return fail(res, 400, "bad_request");
  const { data: c } = await crmDb().from("marketing_campaigns").select("id").eq("agency_id", ctx.agencyId).eq("local_id", localId).maybeSingle();
  if (!c) return fail(res, 404, "not_found");
  try {
    const r = await dispatchCampaign(ctx.agencyId, c.id);
    return json(res, 200, r);
  } catch {
    return fail(res, 500, "server_error");
  }
}
