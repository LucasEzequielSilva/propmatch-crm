import { env } from "./env.js";
import { decrypt, encrypt } from "./crypto.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

export const MELI_AUTH_URL = "https://auth.mercadolibre.com.ar/authorization";
export const MELI_API = "https://api.mercadolibre.com";

export interface MeliTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  user_id?: number;
}

/** POST /oauth/token. Lanza Error genérico: el cuerpo de la respuesta nunca se propaga ni se loguea. */
export async function meliTokenRequest(params: Record<string, string>): Promise<MeliTokenResponse> {
  const r = await fetch(`${MELI_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: env("MELI_CLIENT_ID"),
      client_secret: env("MELI_CLIENT_SECRET"),
      ...params,
    }),
  });
  if (!r.ok) throw new Error(`meli_token_${r.status}`);
  const j = (await r.json()) as MeliTokenResponse;
  if (!j.access_token || typeof j.expires_in !== "number") throw new Error("meli_token_shape");
  return j;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Devuelve un access token vigente para la agencia (refrescando si faltan <5 min).
 * Si el refresh falla marca la integración como `needs_reauth` y lanza.
 * Queda lista para el paso de publicar.
 */
export async function getValidMeliToken(agencyId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("agency_integrations")
    .select("access_token_enc, refresh_token_enc, expires_at, status")
    .eq("agency_id", agencyId)
    .eq("provider", "mercadolibre")
    .maybeSingle();
  if (error || !data || data.status === "needs_reauth" || !data.access_token_enc) throw new Error("meli_not_connected");

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt - Date.now() > REFRESH_MARGIN_MS) return decrypt(data.access_token_enc);

  try {
    if (!data.refresh_token_enc) throw new Error("no_refresh");
    const t = await meliTokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(data.refresh_token_enc) });
    const patch: Record<string, unknown> = {
      access_token_enc: encrypt(t.access_token),
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      status: "connected",
    };
    // Mercado Libre rota el refresh token: el anterior deja de servir.
    if (t.refresh_token) patch.refresh_token_enc = encrypt(t.refresh_token);
    const { error: upErr } = await db
      .from("agency_integrations")
      .update(patch)
      .eq("agency_id", agencyId)
      .eq("provider", "mercadolibre");
    if (upErr) throw new Error("persist");
    return t.access_token;
  } catch {
    await db
      .from("agency_integrations")
      .update({ status: "needs_reauth" })
      .eq("agency_id", agencyId)
      .eq("provider", "mercadolibre");
    throw new Error("meli_needs_reauth");
  }
}
