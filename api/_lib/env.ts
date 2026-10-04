/** Variables de entorno SOLO del servidor. Nunca llevan prefijo VITE_. */
const KEYS = [
  "MELI_CLIENT_ID",
  "MELI_CLIENT_SECRET",
  "MELI_REDIRECT_URI",
  "APP_URL",
  "INTEGRATIONS_ENC_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type EnvKey = (typeof KEYS)[number];

export function env(key: EnvKey): string {
  const v = process.env[key];
  if (!v) throw new Error("config");
  return v;
}

/** true si están todas; no expone cuáles faltan. */
export function isConfigured(): boolean {
  return KEYS.every(k => !!process.env[k]);
}

export function appUrl(): string {
  return env("APP_URL").replace(/\/+$/, "");
}
