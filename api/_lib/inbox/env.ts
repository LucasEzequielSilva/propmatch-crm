/**
 * Variables de entorno del inbox (SOLO servidor, nunca con prefijo VITE_).
 * Separadas de api/_lib/env.ts para no pisar a Mercado Libre.
 */
const CORE = [
  // Supabase PROPIO del CRM (conversaciones, mensajes, tokens).
  "CRM_SUPABASE_URL",
  "CRM_SUPABASE_SERVICE_ROLE_KEY",
  // Supabase de la app: solo para validar el JWT y leer agency_members.
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  // 32 bytes en base64 para cifrar tokens de Meta.
  "INBOX_ENC_KEY",
] as const;

const META = ["META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"] as const;

export type InboxEnvKey = (typeof CORE)[number] | (typeof META)[number];

export function ienv(key: InboxEnvKey): string {
  const v = process.env[key];
  if (!v) throw new Error("config");
  return v;
}

/** Base del CRM + auth listas (se puede listar/leer aunque Meta no esté). */
export function inboxCoreConfigured(): boolean {
  return CORE.every((k) => !!process.env[k]);
}

/** Además, credenciales de la app de Meta (webhooks, envío, conexión). */
export function metaConfigured(): boolean {
  return inboxCoreConfigured() && META.every((k) => !!process.env[k]);
}

/** Instagram/Messenger quedan apagados hasta que Meta apruebe los permisos. */
export function metaMessagingEnabled(): boolean {
  return metaConfigured() && process.env.META_MESSAGING_ENABLED === "1";
}

/**
 * Mensajes de Instagram/Messenger fuera de la ventana de 24 h con la etiqueta
 * HUMAN_AGENT (hasta 7 días). Requiere el permiso "Human Agent" aprobado.
 */
export function humanAgentTagEnabled(): boolean {
  return process.env.META_HUMAN_AGENT_ENABLED === "1";
}
