/**
 * Token del link de suscripción (.ics). Se le muestra UNA vez al agente y en
 * la base solo queda el sha256: si se filtra la base, los links no.
 *
 * Solo importa node:crypto (lo usan las pruebas sin red).
 */
import { createHash, randomBytes } from "node:crypto";

/** 32 bytes aleatorios → 43 caracteres base64url. */
export function newFeedToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashFeedToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
