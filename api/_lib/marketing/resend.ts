/**
 * Resend (https://resend.com/docs).
 *
 * - Envío en lote: POST https://api.resend.com/emails/batch, hasta 100 mails por
 *   request, cada uno con sus `headers` y `tags`. Respuesta { data: [{ id }] } en
 *   el mismo orden. Header Idempotency-Key (24 h).
 *   https://resend.com/docs/api-reference/emails/send-batch-emails
 * - Rate limit: 10 requests/s por team (429 + retry-after).
 *   https://resend.com/docs/api-reference/rate-limit
 * - Webhooks firmados con Svix (svix-id, svix-timestamp, svix-signature).
 *   https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
 *   https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
import { menv } from "./env.js";

export interface ResendEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
}

export class ResendError extends Error {
  constructor(public status: number, public code: string) {
    super(`resend_${status}_${code}`);
  }
}

/** Manda hasta 100 mails. Devuelve los ids en el mismo orden. */
export async function resendBatch(emails: ResendEmail[], idempotencyKey: string): Promise<string[]> {
  if (!emails.length) return [];
  if (emails.length > 100) throw new Error("batch_too_big");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${menv("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify(emails),
      signal: ctrl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { id?: string }[]; name?: string; message?: string };
    if (!r.ok) throw new ResendError(r.status, String(j.name ?? "error").slice(0, 60));
    const ids = (j.data ?? []).map((d) => d.id ?? "");
    if (ids.length !== emails.length) throw new ResendError(502, "bad_response");
    return ids;
  } finally {
    clearTimeout(t);
  }
}

export { verifySvix } from "../../../shared/marketingCrypto.js";

export const resendWebhookSecret = () => menv("RESEND_WEBHOOK_SECRET");
