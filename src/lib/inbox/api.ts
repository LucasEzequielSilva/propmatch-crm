/**
 * Cliente de /api/inbox/*. El navegador nunca habla con el Supabase del CRM:
 * manda el JWT de la sesión (Supabase de la app) y el servidor resuelve la
 * agencia. Si /api no existe (vite dev sin `vercel dev`) degrada a "no
 * configurado" sin ruido.
 */
import { supabase } from "@/lib/supabase";

export type ExternalChannel = "whatsapp" | "instagram" | "messenger";

export interface ChannelAccount {
  id: string;
  channel: ExternalChannel;
  status: "pending" | "connected" | "disconnected" | "error" | "needs_reauth";
  display_name: string | null;
  display_phone: string | null;
  username: string | null;
  coexistence: boolean;
  last_error: string | null;
  connected_at: string;
}

export interface ChannelConversation {
  id: string;
  channel: ExternalChannel;
  channel_account_id: string;
  external_thread_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_username: string | null;
  crm_contact_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: "in" | "out" | null;
  last_inbound_at: string | null;
  unread_count: number;
  assigned_to: string | null;
  status: "open" | "closed";
  created_at: string;
}

export type DeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed" | "received" | null;

export interface ChannelMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  media_url: string | null;
  media_mime: string | null;
  has_media: boolean;
  template_name: string | null;
  status: DeliveryStatus;
  status_at: string | null;
  error_code: string | null;
  error_title: string | null;
  echo: boolean;
  accepted: boolean;
  sent_by: string | null;
  created_at: string;
}

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: { type?: string; text?: string; format?: string }[];
  body_params: number;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function authHeader(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : null;
}

export async function inboxApi<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const auth = await authHeader();
    if (!auth) return { ok: false, status: 401, data: null, error: "unauthorized" };
    const r = await fetch(path, {
      method: init?.method ?? "GET",
      headers: { ...auth, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const isJson = r.headers.get("content-type")?.includes("application/json");
    if (!isJson) return { ok: false, status: r.status === 200 ? 503 : r.status, data: null, error: "unavailable" };
    const j = (await r.json()) as T & { error?: string };
    return { ok: r.ok, status: r.status, data: r.ok ? j : null, error: r.ok ? null : (j.error ?? "error") };
  } catch {
    return { ok: false, status: 0, data: null, error: "network" };
  }
}

/** Media de WhatsApp: la sirve el proxy con el JWT; devolvemos un object URL. */
export async function fetchMediaUrl(messageId: string): Promise<string | null> {
  try {
    const auth = await authHeader();
    if (!auth) return null;
    const r = await fetch(`/api/inbox/messages?media=${encodeURIComponent(messageId)}`, { headers: auth });
    if (!r.ok) return null;
    return URL.createObjectURL(await r.blob());
  } catch {
    return null;
  }
}

/** Mensajes de error del servidor → texto para el agente. */
export function sendErrorText(code: string | null): string {
  switch (code) {
    case "window_closed_template_required":
    case "window_closed":
      return "Pasaron más de 24 h desde el último mensaje del cliente. En WhatsApp solo podés mandar una plantilla aprobada.";
    case "template_not_approved":
      return "Esa plantilla no está aprobada por Meta.";
    case "template_params":
      return "Completá todas las variables de la plantilla (sin saltos de línea).";
    case "too_long":
      return "El mensaje es demasiado largo para este canal.";
    case "needs_reauth":
      return "La conexión con Meta venció. Reconectá el canal desde Configuración → Canales.";
    case "channel_disconnected":
      return "Este canal está desconectado.";
    case "rate_limited":
      return "Demasiados mensajes seguidos. Esperá un minuto.";
    case "undeliverable":
      return "WhatsApp no pudo entregar el mensaje a ese número.";
    case "not_configured":
    case "unavailable":
      return "El inbox de canales todavía no está configurado en el servidor.";
    default:
      return "No se pudo enviar. Probá de nuevo.";
  }
}
