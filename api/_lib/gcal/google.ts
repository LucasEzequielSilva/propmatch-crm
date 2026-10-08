/**
 * Llamadas a Google (OAuth y Calendar API v3). Nada de SDKs: fetch directo.
 * Nunca se loguean tokens ni códigos.
 */
import { googleClient } from "./env.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleTokens {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

/** Error de token: `revoked` = el usuario sacó el acceso o venció (invalid_grant). */
export class GoogleTokenError extends Error {
  constructor(public kind: "revoked" | "failed") {
    super(kind);
  }
}

async function tokenRequest(params: Record<string, string>): Promise<GoogleTokens> {
  const { id, secret } = googleClient();
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: id, client_secret: secret }),
  });
  const j = (await r.json().catch(() => ({}))) as GoogleTokens & { error?: string };
  if (!r.ok || !j.access_token) throw new GoogleTokenError(j.error === "invalid_grant" ? "revoked" : "failed");
  return j;
}

export function exchangeCode(code: string, verifier: string): Promise<GoogleTokens> {
  return tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: googleClient().redirectUri });
}

export function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Mejor esfuerzo: si falla, igual se borra la conexión del lado nuestro. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

export interface CalResponse<T = unknown> {
  status: number;
  body: T | null;
}

export async function calendarRequest<T = unknown>(
  accessToken: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<CalResponse<T>> {
  const u = new URL(`${CALENDAR_API}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) u.searchParams.set(k, v);
  const r = await fetch(u, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: r.status, body };
}
