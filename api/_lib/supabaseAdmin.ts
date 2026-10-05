import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/** Service role: se saltea RLS. Solo para código de servidor. */
export function supabaseAdmin(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
