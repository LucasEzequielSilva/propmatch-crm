import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../../http.js";
import { crmDb } from "../../inbox/db.js";
import { inboxAuth, jsonBody, str } from "../../inbox/request.js";
import { marketingDbConfigured } from "../../marketing/env.js";
import { recordUnsubscribe } from "../../marketing/db.js";
import { normalizeEmail, normalizePhone, type MarketingChannel, type UnsubscribeScope } from "../../../../shared/marketing.js";

/**
 * POST /api/marketing/consent { items: [...] } (hasta 200 por request)
 *
 * Cada item:
 *  { op: "grant",  channel, contactRef, email?, phone?, method, evidence?, givenAt }
 *     → consentimiento. Si había una baja vigente para ese canal, se revierte
 *       (es la ÚNICA forma de revertir una baja) y queda enlazada.
 *  { op: "revoke", channel, contactRef, email?, phone?, method }
 *  { op: "unsubscribe", scope, contactRef, email?, phone?, note? }  → baja manual
 *
 * Devuelve { results: [{ ok, error? }] } en el mismo orden.
 */
const METHODS = new Set(["formulario_web", "whatsapp", "verbal", "escrito", "importacion", "app", "email", "otro"]);
const isChannel = (v: unknown): v is MarketingChannel => v === "email" || v === "whatsapp";
const isScope = (v: unknown): v is UnsubscribeScope => isChannel(v) || v === "all";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!marketingDbConfigured()) return fail(res, 503, "not_configured");
  const ctx = await inboxAuth(req, res, { bucket: "mkt_consent", limit: 60 });
  if (!ctx) return;
  const items = jsonBody(req).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > 200) return fail(res, 400, "bad_request");
  const db = crmDb();
  const results: { ok: boolean; error?: string }[] = [];

  for (const raw of items) {
    const it = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const contactRef = str(it.contactRef, 120);
    const email = normalizeEmail(typeof it.email === "string" ? it.email : null);
    const phone = normalizePhone(typeof it.phone === "string" ? it.phone : null);
    try {
      if (it.op === "grant" || it.op === "revoke") {
        if (!isChannel(it.channel)) throw new Error("bad_channel");
        const target = it.channel === "email" ? email : phone;
        if (!target) throw new Error(it.channel === "email" ? "sin_email" : "sin_telefono");
        const method = typeof it.method === "string" && METHODS.has(it.method) ? it.method : "otro";
        const givenAt = typeof it.givenAt === "string" && !Number.isNaN(Date.parse(it.givenAt)) ? new Date(it.givenAt) : new Date();
        if (givenAt.getTime() > Date.now() + 5 * 60_000) throw new Error("fecha_futura");
        const row = {
          agency_id: ctx.agencyId,
          channel: it.channel,
          contact_ref: contactRef,
          email_norm: it.channel === "email" ? email : null,
          phone_norm: it.channel === "whatsapp" ? phone : null,
          status: it.op === "grant" ? "granted" : "revoked",
          method,
          evidence: str(it.evidence, 500),
          given_at: givenAt.toISOString(),
          recorded_by: ctx.userId,
        };
        const { data: ins, error } = await db.from("marketing_consents").insert(row).select("id").single();
        if (error || !ins) throw new Error("db");

        if (it.op === "grant") {
          // Revertir bajas vigentes que alcanzan a este canal.
          const col = it.channel === "email" ? "email_norm" : "phone_norm";
          const orParts = [`${col}.eq."${target}"`];
          if (contactRef && /^[\w.:-]+$/.test(contactRef)) orParts.push(`contact_ref.eq."${contactRef}"`);
          const { data: active } = await db
            .from("marketing_unsubscribes")
            .select("id, scope, contact_ref, email_norm, phone_norm")
            .eq("agency_id", ctx.agencyId)
            .is("revoked_at", null)
            .in("scope", [it.channel, "all"])
            .or(orParts.join(","));
          for (const u of active ?? []) {
            await db
              .from("marketing_unsubscribes")
              .update({ revoked_at: new Date().toISOString(), resubscribe_consent_id: ins.id })
              .eq("id", u.id);
            // Una baja de "todos los canales" sigue valiendo para el OTRO canal.
            if (u.scope === "all") {
              const other: MarketingChannel = it.channel === "email" ? "whatsapp" : "email";
              await db.from("marketing_unsubscribes").insert({
                agency_id: ctx.agencyId,
                scope: other,
                contact_ref: u.contact_ref,
                email_norm: u.email_norm,
                phone_norm: u.phone_norm,
                source: "manual",
                note: `Sigue vigente para ${other === "email" ? "email" : "WhatsApp"} (volvió a dar consentimiento solo por ${it.channel === "email" ? "email" : "WhatsApp"})`,
                recorded_by: ctx.userId,
              });
            }
          }
        }
        results.push({ ok: true });
      } else if (it.op === "unsubscribe") {
        if (!isScope(it.scope)) throw new Error("bad_scope");
        if (!email && !phone && !contactRef) throw new Error("sin_destino");
        await recordUnsubscribe({
          agencyId: ctx.agencyId,
          scope: it.scope,
          contactRef,
          email,
          phone,
          source: "manual",
          note: str(it.note, 500),
          recordedBy: ctx.userId,
        });
        // Para canales con dato, registrar también por destino (por si el contacto cambia de id).
        results.push({ ok: true });
      } else throw new Error("bad_op");
    } catch (e) {
      results.push({ ok: false, error: e instanceof Error ? e.message.slice(0, 40) : "error" });
    }
  }
  return json(res, 200, { results });
}
