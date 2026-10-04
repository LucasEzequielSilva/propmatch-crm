import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyAdmin } from "../_lib/auth.js";
import { encrypt } from "../_lib/crypto.js";
import { env, isConfigured } from "../_lib/env.js";
import { allowMethod, fail, json } from "../_lib/http.js";
import { MELI_AUTH_URL } from "../_lib/meli.js";
import { challengeS256, newVerifier, randomToken } from "../_lib/pkce.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyAdmin(req, res);
    if (!ctx) return;

    const state = randomToken(32);
    const verifier = newVerifier();
    const cookie = encrypt(
      JSON.stringify({ state, verifier, agencyId: ctx.agencyId, userId: ctx.userId, exp: Date.now() + 10 * 60 * 1000 }),
    );
    res.setHeader("Set-Cookie", `meli_oauth=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/api/meli; Max-Age=600`);

    const url = new URL(MELI_AUTH_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", env("MELI_CLIENT_ID"));
    url.searchParams.set("redirect_uri", env("MELI_REDIRECT_URI"));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challengeS256(verifier));
    url.searchParams.set("code_challenge_method", "S256");
    json(res, 200, { url: url.toString() });
  } catch {
    fail(res, 500, "server_error");
  }
}
