import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newVerifier(): string {
  return randomBytes(64).toString("base64url"); // 86 caracteres (RFC 7636: 43-128)
}

export function challengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
