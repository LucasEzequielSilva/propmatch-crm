import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fail, json, noStore, redirect } from "../../http.js";
import { crmDb, rateHit } from "../../inbox/db.js";
import { clientIp, jsonBody, readRawBody } from "../../inbox/request.js";
import { appBase, marketingDbConfigured } from "../../marketing/env.js";
import { recipientById, recordUnsubscribe } from "../../marketing/db.js";
import { verifyUnsubToken } from "../../marketing/token.js";
import { maskEmail, maskPhoneDigits, type UnsubscribeScope } from "../../../../shared/marketing.js";

/**
 * Baja PÚBLICA (sin login). El token va firmado con HMAC (no lleva ids crudos).
 *
 * GET  ?t=…&format=json → datos para la página /baja/:token (agencia, destino enmascarado, si ya está de baja)
 * GET  ?t=…             → redirige a /baja/:token (nunca da de baja por GET: los
 *                          antivirus y previsualizadores abren los links solos)
 * POST ?t=…  body "List-Unsubscribe=One-Click"  → baja en un clic (RFC 8058), 200 sin más
 * POST { t, scope: "email" | "whatsapp" | "all" } → baja desde la página
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  res.setHeader("X-Robots-Tag", "noindex");
  if (!marketingDbConfigured()) return fail(res, 503, "not_configured");
  if (!(await rateHit(`mkt_unsub:${clientIp(req)}`, 60, 60))) return fail(res, 429, "rate_limited");

  const qt = typeof req.query.t === "string" ? req.query.t : "";

  if (req.method === "GET") {
    const rid = verifyUnsubToken(qt);
    if (req.query.format !== "json") {
      return redirect(res, rid ? `${appBase()}/baja/${encodeURIComponent(qt)}` : `${appBase()}/baja/invalido`);
    }
    if (!rid) return fail(res, 400, "invalid_token");
    const r = await recipientById(rid);
    if (!r) return fail(res, 404, "not_found");
    const { data: camp } = await crmDb().from("marketing_campaigns").select("template").eq("id", r.campaign_id).maybeSingle();
    const agencyName = String(((camp?.template ?? {}) as { agencyName?: string }).agencyName ?? "").slice(0, 120) || null;
    const { data: active } = await crmDb()
      .from("marketing_unsubscribes")
      .select("scope")
      .eq("agency_id", r.agency_id)
      .is("revoked_at", null)
      .or(r.email_norm ? `email_norm.eq."${r.email_norm}"` : `phone_norm.eq."${r.phone_norm}"`);
    const scopes = new Set((active ?? []).map((x) => x.scope as UnsubscribeScope));
    return json(res, 200, {
      agencyName,
      channel: r.channel,
      target: r.email_norm ? maskEmail(r.email_norm) : maskPhoneDigits(r.phone_norm),
      unsubscribed: scopes.has("all") ? "all" : scopes.has(r.channel) ? r.channel : null,
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method_not_allowed");
  }

  // ¿One-click (form) o JSON desde la página?
  const ctype = String(req.headers["content-type"] ?? "");
  let token = qt;
  let scope: UnsubscribeScope | null = null;
  let oneClick = false;
  if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
    const raw = (await readRawBody(req, 10_000)).toString("utf8");
    // Vercel puede haber parseado ya el form: se mira el cuerpo crudo y el parseado.
    oneClick = /List-Unsubscribe=One-Click/i.test(raw) || String(jsonBody(req)["List-Unsubscribe"] ?? "") === "One-Click";
    if (!oneClick) return fail(res, 400, "bad_request");
  } else {
    const b = jsonBody(req);
    if (typeof b.t === "string") token = b.t;
    if (b.scope === "email" || b.scope === "whatsapp" || b.scope === "all") scope = b.scope;
  }

  const rid = verifyUnsubToken(token);
  if (!rid) return fail(res, 400, "invalid_token");
  const r = await recipientById(rid);
  if (!r) return fail(res, 404, "not_found");
  const finalScope: UnsubscribeScope = scope ?? r.channel;
  try {
    await recordUnsubscribe({
      agencyId: r.agency_id,
      scope: finalScope,
      contactRef: r.contact_ref,
      email: r.email_norm,
      phone: r.phone_norm,
      source: oneClick ? "one_click" : "link_email",
      campaignId: r.campaign_id,
      recipientId: r.id,
    });
    await crmDb()
      .from("marketing_recipients")
      .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
      .eq("id", r.id);
  } catch {
    return fail(res, 500, "server_error");
  }
  return json(res, 200, { ok: true, scope: finalScope });
}
