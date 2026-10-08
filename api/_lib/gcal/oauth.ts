/**
 * OAuth de Google (opción A): piezas puras del state / PKCE. Mismo patrón que
 * Mercado Libre: `state` aleatorio + `code_verifier` viajan en una cookie
 * HttpOnly cifrada con AES-256-GCM (autenticada: no se puede fabricar ni
 * tocar) atada al navegador que empezó el flujo → anti-CSRF. La vuelta va
 * siempre a APP_URL + un path de lista cerrada (shared/gcal.ts).
 *
 * Solo importa node:crypto (lo usan las pruebas sin red).
 */
import { timingSafeEqual } from "node:crypto";

export const GCAL_OAUTH_COOKIE = "gcal_oauth";
/** El callback es /api/integrations/gcal-callback: la cookie no viaja a ninguna otra ruta del sitio. */
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/api/integrations";
export const GCAL_CLEAR_COOKIE = `${GCAL_OAUTH_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;
export const OAUTH_TTL_MS = 10 * 60 * 1000;

export const oauthCookieHeader = (encrypted: string) => `${GCAL_OAUTH_COOKIE}=${encrypted}; ${COOKIE_ATTRS}; Max-Age=600`;

export interface GcalOauthCookie {
  state: string;
  verifier: string;
  userId: string;
  agencyId: string;
  exp: number;
  ret: string;
}

export function parseOauthCookie(json: string): GcalOauthCookie | null {
  try {
    const c = JSON.parse(json) as Partial<GcalOauthCookie>;
    if (
      typeof c.state !== "string" ||
      typeof c.verifier !== "string" ||
      typeof c.userId !== "string" ||
      typeof c.agencyId !== "string" ||
      typeof c.exp !== "number"
    )
      return null;
    return { state: c.state, verifier: c.verifier, userId: c.userId, agencyId: c.agencyId, exp: c.exp, ret: typeof c.ret === "string" ? c.ret : "agenda" };
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type CallbackCheck = { ok: true; code: string; cookie: GcalOauthCookie } | { ok: false; reason: string };

/** Valida la vuelta de Google antes de canjear el code. */
export function checkCallback(
  query: { code?: string; state?: string; error?: string },
  cookie: GcalOauthCookie | null,
  now: number,
): CallbackCheck {
  if (query.error) return { ok: false, reason: query.error === "access_denied" ? "denied" : "google" };
  if (!query.code || !query.state || query.code.length > 2048 || query.state.length > 256) return { ok: false, reason: "invalid" };
  if (!cookie) return { ok: false, reason: "invalid" };
  if (now > cookie.exp) return { ok: false, reason: "expired" };
  if (!safeEqual(cookie.state, query.state)) return { ok: false, reason: "state" };
  return { ok: true, code: query.code, cookie };
}

/** URL de consentimiento de Google con PKCE (S256). */
export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; scopes: readonly string[] }): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", p.scopes.join(" "));
  // offline + consent: Google entrega refresh_token (sin él la conexión muere en 1 h).
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}
