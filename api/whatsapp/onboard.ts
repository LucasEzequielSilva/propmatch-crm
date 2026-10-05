import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowMethod, fail, json } from "../_lib/http.js";
import { crmDb, PUBLIC_ACCOUNT_COLUMNS } from "../_lib/inbox/db.js";
import { metaConfigured } from "../_lib/inbox/env.js";
import { randomPin, sealToken } from "../_lib/inbox/crypto.js";
import { GraphError } from "../_lib/inbox/graph.js";
import { inboxAuth, jsonBody, str } from "../_lib/inbox/request.js";
import { exchangeCode, phoneInfo, registerNumber, requestSmbSync, subscribeWaba, syncTemplates } from "../_lib/inbox/whatsapp.js";
import type { AccountRow } from "../_lib/inbox/accounts.js";

/**
 * Cierre del Embedded Signup de WhatsApp (v4).
 *
 * El navegador lanza FB.login({ config_id, response_type: "code", ... }) y
 * nos manda: el `code` (vence en ~30 s), y lo que llegó por el evento
 * WA_EMBEDDED_SIGNUP: waba_id, phone_number_id, business_id y si fue el flujo
 * de coexistencia (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING).
 *
 * Pasos (doc "Onboarding customers as a Tech Provider" y "Onboarding WhatsApp
 * Business app users"):
 *  1. code → token de negocio.
 *  2. Datos del número (display_phone_number, verified_name).
 *  3. Suscribir la app a los webhooks del WABA.
 *  4. Registrar el número en Cloud API con un PIN — SALVO coexistencia, donde
 *     el número ya está registrado y en cambio se pide sincronizar contactos
 *     e historial (una sola vez, dentro de las 24 h).
 *  5. Guardar channel_accounts (token cifrado) y traer plantillas.
 *
 * Solo admins de la agencia.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!metaConfigured()) return fail(res, 503, "not_configured");
  const ctx = await inboxAuth(req, res, { admin: true, bucket: "onboard", limit: 10, windowSeconds: 600 });
  if (!ctx) return;

  const b = jsonBody(req);
  const code = str(b.code, 2048);
  const wabaId = str(b.wabaId, 64);
  const phoneNumberId = str(b.phoneNumberId, 64);
  const businessId = str(b.businessId, 64);
  const coexistence = b.coexistence === true;
  if (!code || !wabaId || !phoneNumberId || !/^\d+$/.test(wabaId) || !/^\d+$/.test(phoneNumberId)) {
    return fail(res, 400, "bad_request");
  }

  const db = crmDb();
  let step = "exchange";
  try {
    const { token, expiresIn } = await exchangeCode(code);

    step = "phone";
    const info = await phoneInfo(token, phoneNumberId);

    // ¿Ese número ya lo tiene otra agencia?
    const { data: taken } = await db
      .from("channel_accounts")
      .select("agency_id")
      .eq("channel", "whatsapp")
      .eq("phone_number_id", phoneNumberId)
      .neq("status", "disconnected")
      .limit(1);
    if (taken?.[0] && taken[0].agency_id !== ctx.agencyId) return fail(res, 409, "number_in_use");

    step = "subscribe";
    await subscribeWaba(token, wabaId);

    let pinEnc: string | null = null;
    if (!coexistence) {
      step = "register";
      const pin = randomPin();
      await registerNumber(token, phoneNumberId, pin);
      pinEnc = sealToken(pin);
    }

    step = "save";
    // Si había una conexión previa de esta agencia con el mismo número, se reemplaza.
    await db
      .from("channel_accounts")
      .update({ status: "disconnected" })
      .eq("agency_id", ctx.agencyId)
      .eq("channel", "whatsapp")
      .eq("phone_number_id", phoneNumberId);

    const { data: acc, error } = await db
      .from("channel_accounts")
      .insert({
        agency_id: ctx.agencyId,
        channel: "whatsapp",
        status: "connected",
        display_name: info.verified_name ?? null,
        display_phone: info.display_phone_number ?? null,
        business_id: businessId,
        waba_id: wabaId,
        phone_number_id: phoneNumberId,
        coexistence,
        access_token_enc: sealToken(token),
        token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
        wa_pin_enc: pinEnc,
        connected_by: ctx.userId,
      })
      .select(`${PUBLIC_ACCOUNT_COLUMNS}, agency_id, business_id, access_token_enc`)
      .single();
    if (error || !acc) throw new Error("db");

    // Lo que sigue es "best effort": la conexión ya quedó hecha.
    const warnings: string[] = [];
    if (coexistence) {
      for (const t of ["smb_app_state_sync", "history"] as const) {
        try {
          await requestSmbSync(token, phoneNumberId, t);
        } catch {
          warnings.push(t === "history" ? "history_sync_failed" : "contacts_sync_failed");
        }
      }
    }
    try {
      await syncTemplates(acc as unknown as AccountRow);
    } catch {
      warnings.push("templates_sync_failed");
    }

    const { access_token_enc: _omit, ...publicAcc } = acc as Record<string, unknown>;
    void _omit;
    console.log("[onboard] whatsapp conectado", { agency: ctx.agencyId, coexistence, warnings });
    return json(res, 200, { ok: true, account: publicAcc, warnings });
  } catch (e) {
    const code = e instanceof GraphError ? e.code : null;
    console.warn("[onboard] falló", { step, graphCode: code });
    return fail(res, 502, `onboard_${step}_failed`);
  }
}
