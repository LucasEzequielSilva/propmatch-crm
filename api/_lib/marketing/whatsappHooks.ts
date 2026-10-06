/**
 * Ganchos de marketing dentro del webhook de WhatsApp del inbox.
 *
 * - Mensaje entrante "BAJA" / botón "No recibir más mensajes" → baja de WhatsApp.
 * - Cualquier otro mensaje entrante → el destinatario de una campaña reciente "respondió".
 * - Estados (sent/delivered/read/failed) → actualizan el registro por destinatario.
 * - Campo `user_preferences` (el usuario frenó/reanudó el marketing desde WhatsApp).
 *
 * Todo es best effort: si las tablas de marketing no existen todavía, el
 * inbox sigue funcionando igual (cada función se traga sus errores).
 */
import { crmDb } from "../inbox/db.js";
import { tokenOf, type AccountRow } from "../inbox/accounts.js";
import { graph } from "../inbox/graph.js";
import { recordUnsubscribe } from "./db.js";
import { sendEnabled } from "./env.js";
import { advanceStatus, isOptOutMessage, normalizePhone, WA_OPT_OUT_PAYLOAD, type RecipientStatus } from "../../../shared/marketing.js";

const REPLY_WINDOW_DAYS = 7;

interface InboundLike {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string } };
}

export const OPT_OUT_CONFIRMATION =
  "Listo, te dimos de baja: no vas a recibir más mensajes promocionales nuestros por WhatsApp. Si fue un error, escribinos.";

/** true si el mensaje era un pedido de baja (para que el inbox no dispare automatizaciones). */
export async function marketingOnInbound(acc: AccountRow, m: InboundLike): Promise<boolean> {
  try {
    const phone = normalizePhone(m.from);
    if (!phone) return false;
    const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? null;
    const payload = m.button?.payload ?? m.interactive?.button_reply?.id ?? null;
    const db = crmDb();
    const since = new Date(Date.now() - REPLY_WINDOW_DAYS * 86_400_000).toISOString();

    if (isOptOutMessage(text, payload)) {
      const viaButton = m.type === "button" || m.type === "interactive" || payload === WA_OPT_OUT_PAYLOAD;
      const { data: last } = await db
        .from("marketing_recipients")
        .select("id, campaign_id, contact_ref")
        .eq("agency_id", acc.agency_id)
        .eq("channel", "whatsapp")
        .eq("phone_norm", phone)
        .not("sent_at", "is", null)
        .order("sent_at", { ascending: false })
        .limit(1);
      const r = last?.[0] as { id: string; campaign_id: string; contact_ref: string | null } | undefined;
      const { created } = await recordUnsubscribe({
        agencyId: acc.agency_id,
        scope: "whatsapp",
        phone,
        contactRef: r?.contact_ref ?? null,
        source: viaButton ? "whatsapp_boton" : "whatsapp_texto",
        campaignId: r?.campaign_id ?? null,
        recipientId: r?.id ?? null,
      });
      if (r) await db.from("marketing_recipients").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() }).eq("id", r.id);
      // Confirmación dentro de la ventana de 24 h que abrió el propio mensaje (texto libre permitido).
      if (created && sendEnabled() && acc.phone_number_id) {
        try {
          await graph(`${acc.phone_number_id}/messages`, {
            method: "POST",
            token: tokenOf(acc),
            body: { messaging_product: "whatsapp", recipient_type: "individual", to: m.from, type: "text", text: { preview_url: false, body: OPT_OUT_CONFIRMATION } },
          });
        } catch {
          /* la baja ya quedó registrada */
        }
      }
      return true;
    }

    // Respondió a una campaña reciente.
    await db
      .from("marketing_recipients")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("agency_id", acc.agency_id)
      .eq("channel", "whatsapp")
      .eq("phone_norm", phone)
      .gte("sent_at", since)
      .in("status", ["sent", "delivered", "opened", "clicked"]);
  } catch {
    /* tablas sin crear o error de red: no afecta al inbox */
  }
  return false;
}

const WA_TO_STATUS: Record<string, RecipientStatus> = { sent: "sent", delivered: "delivered", read: "opened", failed: "failed" };

export async function marketingOnStatus(externalId: string, status: string, errorCode: string | null): Promise<void> {
  try {
    const next = WA_TO_STATUS[status];
    if (!next) return;
    const db = crmDb();
    const { data } = await db
      .from("marketing_recipients")
      .select("id, agency_id, campaign_id, contact_ref, phone_norm, status")
      .eq("provider", "whatsapp_cloud")
      .eq("provider_message_id", externalId)
      .maybeSingle();
    const r = data as { id: string; agency_id: string; campaign_id: string; contact_ref: string | null; phone_norm: string | null; status: RecipientStatus } | null;
    if (!r) return;
    if (next === "failed" && errorCode === "131050") {
      await recordUnsubscribe({ agencyId: r.agency_id, scope: "whatsapp", phone: r.phone_norm, contactRef: r.contact_ref, source: "whatsapp_meta", campaignId: r.campaign_id, recipientId: r.id });
      await db.from("marketing_recipients").update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString(), error_code: errorCode }).eq("id", r.id);
      return;
    }
    const patch: Record<string, unknown> = { status: next === "failed" ? "failed" : advanceStatus(r.status, next) };
    const now = new Date().toISOString();
    if (next === "delivered") patch.delivered_at = now;
    if (next === "opened") patch.opened_at = now;
    if (next === "failed") patch.error_code = errorCode ?? "failed";
    await db.from("marketing_recipients").update(patch).eq("id", r.id);
  } catch {
    /* idem */
  }
}

/**
 * Webhook `user_preferences`: el usuario frenó ("stop") o reanudó ("resume")
 * el marketing desde WhatsApp. La forma exacta del payload no está del todo
 * documentada: se lee de manera tolerante. "resume" NO reactiva solo: hace
 * falta un consentimiento nuevo registrado en el CRM.
 */
export async function marketingOnUserPreferences(acc: AccountRow, value: unknown): Promise<number> {
  let n = 0;
  try {
    const prefs = (value as { user_preferences?: { wa_id?: string; category?: string; value?: string }[] })?.user_preferences ?? [];
    for (const p of prefs) {
      if (!/marketing/i.test(p.category ?? "") || !/stop/i.test(p.value ?? "")) continue;
      const phone = normalizePhone(p.wa_id);
      if (!phone) continue;
      await recordUnsubscribe({ agencyId: acc.agency_id, scope: "whatsapp", phone, source: "whatsapp_meta", note: "El usuario frenó el marketing desde WhatsApp" });
      n++;
    }
  } catch {
    /* idem */
  }
  return n;
}
