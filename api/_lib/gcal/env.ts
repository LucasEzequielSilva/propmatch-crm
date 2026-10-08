/**
 * Variables de entorno de Google Calendar (SOLO servidor, nunca VITE_).
 * Separadas de api/_lib/env.ts para no exigirle a Mercado Libre lo de Google.
 */

const has = (k: string) => !!process.env[k];

/** Validar la sesión del navegador: JWT de la app + agency_members. */
export const authConfigured = () => has("SUPABASE_URL") && has("SUPABASE_ANON_KEY");

/** Supabase PROPIO del CRM (donde viven calendar_feeds y google_calendar_connections). */
export const crmDbConfigured = () => has("CRM_SUPABASE_URL") && has("CRM_SUPABASE_SERVICE_ROLE_KEY");

/** URL pública del CRM (links del .ics y vuelta del OAuth). */
export function appBaseUrl(): string | null {
  const v = process.env.APP_URL;
  return v ? v.replace(/\/+$/, "") : null;
}

/** OAuth de Google (opción A): cliente web + clave para cifrar tokens. */
export const googleConfigured = () =>
  has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET") && has("INTEGRATIONS_ENC_KEY") && has("APP_URL");

export function googleClient(): { id: string; secret: string; redirectUri: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const base = appBaseUrl();
  if (!id || !secret || !base) throw new Error("config");
  // En previews / localhost se puede fijar a mano (tiene que estar registrada en Google).
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${base}/api/integrations/gcal-callback`;
  return { id, secret, redirectUri };
}
