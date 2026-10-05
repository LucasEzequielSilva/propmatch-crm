import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ienv } from "./env.js";

let cached: SupabaseClient | null = null;

/**
 * Service role del Supabase PROPIO del CRM. Se saltea RLS: solo servidor.
 * (No confundir con api/_lib/supabaseAdmin.ts, que es la base de la app.)
 */
export function crmDb(): SupabaseClient {
  if (!cached) {
    cached = createClient(ienv("CRM_SUPABASE_URL"), ienv("CRM_SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Rate limit de ventana fija en la base (sirve entre instancias serverless). */
export async function rateHit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await crmDb().rpc("inbox_rate_hit", {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  // Si la tabla no está (migración sin aplicar) no bloqueamos: falla abierto
  // solo el límite, no la autenticación.
  if (error) return true;
  return data === true;
}

export interface IngestInput {
  agencyId: string;
  channel: "whatsapp" | "instagram" | "messenger";
  channelAccountId: string;
  threadId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactUsername?: string | null;
  direction: "in" | "out";
  type: string;
  body?: string | null;
  mediaId?: string | null;
  mediaUrl?: string | null;
  mediaMime?: string | null;
  externalId?: string | null;
  createdAt?: string | null;
  echo?: boolean;
  status?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  sentBy?: string | null;
  countUnread?: boolean;
}

export async function ingestMessage(i: IngestInput): Promise<{ messageId: string; conversationId: string; inserted: boolean }> {
  const { data, error } = await crmDb().rpc("inbox_ingest_message", {
    p_agency_id: i.agencyId,
    p_channel: i.channel,
    p_channel_account_id: i.channelAccountId,
    p_thread_id: i.threadId,
    p_contact_name: i.contactName ?? null,
    p_contact_phone: i.contactPhone ?? null,
    p_contact_username: i.contactUsername ?? null,
    p_direction: i.direction,
    p_type: i.type,
    p_body: i.body ?? null,
    p_media_id: i.mediaId ?? null,
    p_media_url: i.mediaUrl ?? null,
    p_media_mime: i.mediaMime ?? null,
    p_external_id: i.externalId ?? null,
    p_created_at: i.createdAt ?? null,
    p_echo: i.echo ?? false,
    p_status: i.status ?? null,
    p_template_name: i.templateName ?? null,
    p_template_language: i.templateLanguage ?? null,
    p_sent_by: i.sentBy ?? null,
    p_count_unread: i.countUnread ?? true,
  });
  if (error) throw new Error("ingest");
  const row = (Array.isArray(data) ? data[0] : data) as { message_id: string; conversation_id: string; inserted: boolean };
  return { messageId: row.message_id, conversationId: row.conversation_id, inserted: row.inserted };
}

export async function applyStatus(
  externalId: string,
  status: "sent" | "delivered" | "read" | "failed",
  at: string | null,
  errorCode?: string | null,
  errorTitle?: string | null,
): Promise<boolean> {
  const { data, error } = await crmDb().rpc("inbox_apply_status", {
    p_external_id: externalId,
    p_status: status,
    p_at: at,
    p_error_code: errorCode ?? null,
    p_error_title: errorTitle ?? null,
  });
  if (error) throw new Error("status");
  return data === true;
}

/** Columnas de channel_accounts que se pueden mandar al navegador (sin tokens ni PIN). */
export const PUBLIC_ACCOUNT_COLUMNS =
  "id, channel, status, display_name, display_phone, username, waba_id, phone_number_id, page_id, ig_user_id, coexistence, last_error, connected_at";
