import type { VercelRequest, VercelResponse } from "@vercel/node";
import { noStore } from "../_lib/http.js";
import { crmDb } from "../_lib/inbox/db.js";
import { ienv, metaConfigured } from "../_lib/inbox/env.js";
import { safeEqualStr, validMetaSignature } from "../_lib/inbox/crypto.js";
import { clientIp, readRawBody } from "../_lib/inbox/request.js";
import { rateHit } from "../_lib/inbox/db.js";
import { processWaEntry, type WaEntry } from "../_lib/inbox/whatsapp.js";
import { processMessagingEntry, type MessagingEntry } from "../_lib/inbox/meta.js";

/**
 * Webhook ÚNICO de Meta: WhatsApp (object=whatsapp_business_account),
 * Messenger (object=page) e Instagram (object=instagram). Se configura la
 * misma URL en los tres productos del App Dashboard.
 *
 * GET  → verificación (hub.mode / hub.verify_token / hub.challenge).
 * POST → valida X-Hub-Signature-256 con el App Secret sobre el cuerpo crudo,
 *        guarda el evento crudo, lo procesa (idempotente por id externo) y
 *        responde 200. Si no se pudo ni guardar el evento, 500 para que Meta
 *        reintente (reintenta hasta 7 días).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  noStore(res);
  if (!metaConfigured()) return res.status(503).send("not_configured");

  if (req.method === "GET") {
    const q = req.query;
    const mode = String(q["hub.mode"] ?? "");
    const token = String(q["hub.verify_token"] ?? "");
    const challenge = String(q["hub.challenge"] ?? "");
    if (mode === "subscribe" && token && safeEqualStr(token, ienv("META_WEBHOOK_VERIFY_TOKEN")) && /^[\w-]{1,128}$/.test(challenge)) {
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("forbidden");
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("method_not_allowed");
  }

  // Corta floods sin firma antes de tocar nada caro.
  if (!(await rateHit(`wh:${clientIp(req)}`, 600, 60))) return res.status(429).send("rate_limited");

  const raw = await readRawBody(req);
  const sig = req.headers["x-hub-signature-256"];
  if (!validMetaSignature(raw, Array.isArray(sig) ? sig[0] : sig, ienv("META_APP_SECRET"))) {
    console.warn("[webhook] firma inválida", { bytes: raw.length });
    return res.status(401).send("invalid_signature");
  }

  let payload: { object?: string; entry?: unknown[] };
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).send("bad_json");
  }
  const object = String(payload.object ?? "");
  const provider =
    object === "whatsapp_business_account" ? "whatsapp" : object === "page" ? "messenger" : object === "instagram" ? "instagram" : "unknown";

  const db = crmDb();
  const { data: ev, error: evErr } = await db
    .from("webhook_events")
    .insert({ provider, object, signature_valid: true, payload })
    .select("id")
    .single();
  if (evErr || !ev) {
    console.error("[webhook] no se pudo guardar el evento");
    return res.status(500).send("retry");
  }

  let handled = 0;
  let skipped = 0;
  let error: string | null = null;
  try {
    for (const entry of payload.entry ?? []) {
      const r =
        provider === "whatsapp"
          ? await processWaEntry(entry as WaEntry)
          : provider === "messenger" || provider === "instagram"
            ? await processMessagingEntry(object as "page" | "instagram", entry as MessagingEntry)
            : { handled: 0, skipped: 1 };
      handled += r.handled;
      skipped += r.skipped;
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 120) : "process_error";
  }

  await db
    .from("webhook_events")
    .update({ processed_at: error ? null : new Date().toISOString(), attempts: 1, error })
    .eq("id", ev.id);

  // Log sin datos personales: solo contadores.
  console.log("[webhook]", { provider, event: ev.id, handled, skipped, error: error ?? undefined });
  // Evento guardado: 200 igual (si falló el proceso queda para reprocesar).
  return res.status(200).send("EVENT_RECEIVED");
}
