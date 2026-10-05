import type { VercelRequest, VercelResponse } from "@vercel/node";
import { decrypt, encrypt, safeEqual } from "../../crypto.js";
import { appUrl, env, isConfigured } from "../../env.js";
import { allowMethod, fail, readCookie, redirect } from "../../http.js";
import { MELI_API, meliTokenRequest } from "../../meli.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";

const CLEAR_COOKIE = "meli_oauth=; HttpOnly; Secure; SameSite=Lax; Path=/api/meli; Max-Age=0";

interface OauthCookie {
  state: string;
  verifier: string;
  agencyId: string;
  userId: string;
  exp: number;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");

  const back = (reason?: string) => {
    // Solo el motivo (sin códigos ni tokens): para diagnosticar desde los logs de Vercel.
    if (reason) console.warn(`[meli/callback] fallo: ${reason}`);
    res.setHeader("Set-Cookie", CLEAR_COOKIE);
    redirect(res, `${appUrl()}/publicador?meli=${reason ? `error&reason=${reason}` : "connected"}`);
  };

  try {
    const raw = readCookie(req, "meli_oauth");
    if (one(req.query.error)) return back("denied");
    const code = one(req.query.code);
    const state = one(req.query.state);
    if (!code || !state || !raw) return back("invalid");

    let c: OauthCookie;
    try {
      c = JSON.parse(decrypt(raw)) as OauthCookie;
    } catch {
      return back("invalid");
    }
    if (typeof c.exp !== "number" || Date.now() > c.exp) return back("expired");
    if (typeof c.state !== "string" || !safeEqual(c.state, state)) return back("state");

    let tokens;
    try {
      tokens = await meliTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: env("MELI_REDIRECT_URI"),
        code_verifier: c.verifier,
      });
    } catch {
      return back("token");
    }
    // Sin refresh token la conexión muere a las 6 h: la app tiene que tener el scope offline_access.
    if (!tokens.refresh_token) return back("offline");

    const me = await fetch(`${MELI_API}/users/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!me.ok) return back("identity");
    const who = (await me.json()) as { id?: number | string; nickname?: string };
    if (who.id == null) return back("identity");

    const db = supabaseAdmin();
    // Una cuenta de Mercado Libre pertenece a una sola inmobiliaria: si no, las
    // notificaciones (que solo traen el user_id) no sabrían a quién actualizar.
    const { data: taken } = await db
      .from("agency_integrations")
      .select("agency_id")
      .eq("provider", "mercadolibre")
      .eq("external_account_id", String(who.id))
      .neq("agency_id", c.agencyId)
      .limit(1);
    if (taken && taken.length > 0) return back("in_use");

    const { error } = await db
      .from("agency_integrations")
      .upsert(
        {
          agency_id: c.agencyId,
          provider: "mercadolibre",
          status: "connected",
          external_account_id: String(who.id),
          account_label: who.nickname ?? null,
          access_token_enc: encrypt(tokens.access_token),
          refresh_token_enc: encrypt(tokens.refresh_token),
          expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : null,
          connected_by: c.userId,
        },
        { onConflict: "agency_id,provider" },
      );
    if (error) return back("save");
    back();
  } catch {
    back("server");
  }
}
