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

/** Error del endpoint de tokens. `status` permite distinguir "credencial inválida" de "Mercado Libre caído". */
export class MeliTokenError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`meli_token_${status}`);
    this.status = status;
  }
}

/** POST /oauth/token. Lanza error genérico: el cuerpo de la respuesta nunca se propaga ni se loguea. */
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
  if (!r.ok) throw new MeliTokenError(r.status);
  const j = (await r.json()) as MeliTokenResponse;
  if (!j.access_token || typeof j.expires_in !== "number") throw new MeliTokenError(502);
  return j;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export interface MeliSession {
  token: string;
  /** id de usuario de Mercado Libre (seller_id). */
  userId: string;
}

interface TokenRow {
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string;
  external_account_id: string | null;
}

const fresh = (row: TokenRow) =>
  !!row.access_token_enc && !!row.expires_at && new Date(row.expires_at).getTime() - Date.now() > REFRESH_MARGIN_MS;

/**
 * Devuelve un access token vigente para la agencia (refrescando si faltan <5 min).
 *
 * El refresh token de Mercado Libre es de UN solo uso y solo vale el último
 * emitido (https://developers.mercadolibre.com.ar/es_ar/autenticacion-y-autorizacion,
 * "Refresh token"). Si dos requests refrescan a la vez, una pierde: por eso
 *  - la actualización es condicional al refresh token que se leyó (compare-and-swap), y
 *  - si el refresh falla, se relee la fila: si otra request ya lo renovó, se usa ese.
 * Solo se marca `needs_reauth` si Mercado Libre rechaza la credencial (400/401),
 * no ante un error de red o un 5xx.
 */
export async function getMeliSession(agencyId: string): Promise<MeliSession> {
  const db = supabaseAdmin();
  const read = async () => {
    const { data, error } = await db
      .from("agency_integrations")
      .select("access_token_enc, refresh_token_enc, expires_at, status, external_account_id")
      .eq("agency_id", agencyId)
      .eq("provider", "mercadolibre")
      .maybeSingle();
    if (error || !data) throw new Error("meli_not_connected");
    return data as TokenRow;
  };

  const row = await read();
  if (row.status === "needs_reauth") throw new Error("meli_needs_reauth");
  if (!row.external_account_id || !row.access_token_enc) throw new Error("meli_not_connected");
  const userId = row.external_account_id;
  if (fresh(row)) return { token: decrypt(row.access_token_enc), userId };
  if (!row.refresh_token_enc) throw new Error("meli_needs_reauth");

  let t: MeliTokenResponse;
  try {
    t = await meliTokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(row.refresh_token_enc) });
  } catch (e) {
    const again = await read().catch(() => null);
    if (again && fresh(again) && again.access_token_enc) return { token: decrypt(again.access_token_enc), userId };
    const rejected = e instanceof MeliTokenError && (e.status === 400 || e.status === 401);
    if (rejected) {
      await db
        .from("agency_integrations")
        .update({ status: "needs_reauth" })
        .eq("agency_id", agencyId)
        .eq("provider", "mercadolibre")
        .eq("refresh_token_enc", row.refresh_token_enc);
      throw new Error("meli_needs_reauth");
    }
    throw new Error("meli_unavailable");
  }

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
    .eq("provider", "mercadolibre")
    .eq("refresh_token_enc", row.refresh_token_enc);
  if (upErr) throw new Error("persist");
  return { token: t.access_token, userId };
}

/** Compatibilidad: solo el token. */
export async function getValidMeliToken(agencyId: string): Promise<string> {
  return (await getMeliSession(agencyId)).token;
}
