import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ienv } from "./env.js";

/** AES-256-GCM con INBOX_ENC_KEY. Formato: iv.tag.cipher en base64url. */
function key(): Buffer {
  const k = Buffer.from(ienv("INBOX_ENC_KEY"), "base64");
  if (k.length !== 32) throw new Error("config");
  return k;
}

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function openToken(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("crypto");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/**
 * Valida X-Hub-Signature-256 ("sha256=<hex>") = HMAC-SHA256(App Secret, cuerpo crudo).
 * Comparación en tiempo constante.
 */
export function validMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", appSecret).update(rawBody).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

export function safeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PIN numérico de 6 dígitos para registrar un número en Cloud API. */
export function randomPin(): string {
  return String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0");
}
