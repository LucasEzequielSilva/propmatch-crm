/**
 * Variables de entorno de marketing (SOLO servidor, nunca con prefijo VITE_).
 * La base es el Supabase PROPIO del CRM (las mismas CRM_SUPABASE_* del inbox).
 */
import { inboxCoreConfigured, metaConfigured } from "../inbox/env.js";

const KEYS = [
  // 32+ bytes aleatorios: firma los links de baja (HMAC-SHA256).
  "MARKETING_UNSUB_SECRET",
  // Resend
  "RESEND_API_KEY",
  // "Inmobiliaria X <novedades@mail.inmobiliaria.com>" en un dominio verificado en Resend.
  "MARKETING_FROM_EMAIL",
  // whsec_... del webhook de Resend.
  "RESEND_WEBHOOK_SECRET",
  // Base pública del CRM (https://crm.ejemplo.com) para armar los links de baja.
  "APP_URL",
  // Para el despachador programado (Vercel Cron manda "Authorization: Bearer <CRON_SECRET>").
  "CRON_SECRET",
] as const;

export type MarketingEnvKey = (typeof KEYS)[number];

export function menv(key: MarketingEnvKey): string {
  const v = process.env[key];
  if (!v) throw new Error("config");
  return v;
}

const has = (k: MarketingEnvKey) => !!process.env[k];

/** Base del CRM + secreto de baja: alcanza para registrar bajas/consentimientos. */
export function marketingDbConfigured(): boolean {
  return inboxCoreConfigured() && has("MARKETING_UNSUB_SECRET") && has("APP_URL");
}

export function emailConfigured(): boolean {
  return marketingDbConfigured() && has("RESEND_API_KEY") && has("MARKETING_FROM_EMAIL");
}

export function whatsappConfigured(): boolean {
  return marketingDbConfigured() && metaConfigured();
}

/**
 * Interruptor general: aunque todo esté configurado, NO sale nada real hasta
 * que el dueño ponga MARKETING_SEND_ENABLED=1 (después de probar).
 */
export function sendEnabled(): boolean {
  return process.env.MARKETING_SEND_ENABLED === "1";
}

/** Tope diario por agencia (todas las campañas), además del de cada campaña. */
export function agencyDailyCap(): number {
  const n = Number(process.env.MARKETING_AGENCY_DAILY_CAP);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 50_000) : 1000;
}

export function appBase(): string {
  return menv("APP_URL").replace(/\/+$/, "");
}

/** Reply-To opcional (si no, las respuestas van al From). */
export function replyTo(): string | undefined {
  return process.env.MARKETING_REPLY_TO || undefined;
}
