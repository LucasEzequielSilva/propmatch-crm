/**
 * Criptografía de marketing (SOLO servidor y pruebas: usa node:crypto; el
 * navegador nunca importa este archivo).
 *
 * - Token del link de baja: `v1.<payload>.<firma>` en base64url.
 *   payload = JSON { r: id del destinatario (uuid aleatorio) }.
 *   firma   = HMAC-SHA256(secreto, "v1." + payload), truncada a 24 bytes.
 *   No lleva ids del CRM ni emails. No vence (la baja debe funcionar "en cualquier momento").
 * - Firma de webhooks de Resend (Svix):
 *   https://docs.svix.com/receiving/verifying-payloads/how-manual
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sig(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest().subarray(0, 24);
}

export function signUnsubTokenWith(recipientId: string, secret: string): string {
  if (!UUID.test(recipientId)) throw new Error("bad_id");
  if (!secret || secret.length < 16) throw new Error("weak_secret");
  const payload = Buffer.from(JSON.stringify({ r: recipientId })).toString("base64url");
  const data = `v1.${payload}`;
  return `${data}.${sig(data, secret).toString("base64url")}`;
}

/** id del destinatario, o null si el token no es válido. */
export function verifyUnsubTokenWith(token: string, secret: string): string | null {
  if (typeof token !== "string" || token.length > 400 || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const got = Buffer.from(parts[2], "base64url");
  const want = sig(`v1.${parts[1]}`, secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { r?: unknown };
    return typeof p.r === "string" && UUID.test(p.r) ? p.r : null;
  } catch {
    return null;
  }
}

/** Tolerancia de reloj para el timestamp de Svix (la que usan sus librerías). */
export const SVIX_TOLERANCE_S = 5 * 60;

/**
 * HMAC-SHA256 con la clave (base64 después de "whsec_") sobre
 * `${svix-id}.${svix-timestamp}.${cuerpo crudo}`. El header puede traer varias
 * firmas "v1,<base64>" separadas por espacio.
 */
export function verifySvix(
  raw: Uint8Array,
  h: { id?: string; timestamp?: string; signature?: string },
  secret: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!h.id || !h.timestamp || !h.signature || !secret) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > SVIX_TOLERANCE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const want = createHmac("sha256", key).update(`${h.id}.${h.timestamp}.`).update(raw).digest();
  for (const part of h.signature.split(" ")) {
    const [ver, b64] = part.split(",");
    if (ver !== "v1" || !b64) continue;
    const got = Buffer.from(b64, "base64");
    if (got.length === want.length && timingSafeEqual(got, want)) return true;
  }
  return false;
}
