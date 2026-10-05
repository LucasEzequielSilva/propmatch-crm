import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";
import { fail } from "./http.js";

export interface AgencyContext {
  userId: string;
  agencyId: string;
  role: string;
}

/**
 * Valida el JWT de Supabase y busca la membresía del usuario con un cliente
 * que lleva ese mismo JWT (así RLS también la respeta).
 * Responde 401/403 por sí misma y devuelve null en ese caso.
 */
async function resolve(req: VercelRequest, res: VercelResponse, adminOnly: boolean): Promise<AgencyContext | null> {
  const header = req.headers.authorization ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) {
    fail(res, 401, "unauthorized");
    return null;
  }
  const jwt = m[1];
  const url = env("SUPABASE_URL");
  const anon = env("SUPABASE_ANON_KEY");
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };

  const { data: userData, error: userErr } = await createClient(url, anon, opts).auth.getUser(jwt);
  if (userErr || !userData.user) {
    fail(res, 401, "unauthorized");
    return null;
  }
  const userId = userData.user.id;

  const asUser = createClient(url, anon, { ...opts, global: { headers: { Authorization: `Bearer ${jwt}` } } });
  let q = asUser.from("agency_members").select("agency_id, role").eq("user_id", userId);
  if (adminOnly) q = q.eq("role", "admin");
  const { data, error } = await q.limit(1);
  const row = data?.[0] as { agency_id: string; role: string } | undefined;
  if (error || !row) {
    fail(res, 403, "forbidden");
    return null;
  }
  return { userId, agencyId: row.agency_id, role: row.role };
}

export const requireAgencyAdmin = (req: VercelRequest, res: VercelResponse) => resolve(req, res, true);
export const requireAgencyMember = (req: VercelRequest, res: VercelResponse) => resolve(req, res, false);
