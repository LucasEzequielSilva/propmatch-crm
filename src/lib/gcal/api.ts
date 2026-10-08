/**
 * Cliente de las acciones de Google Calendar en /api/integrations/*. El
 * servidor resuelve el usuario y la agencia por la sesión (JWT de la app);
 * acá nunca se manejan tokens de Google. En la demo no se llama a nada.
 */
import { supabase } from "@/lib/supabase";
import { isDemoActive } from "@/lib/demo";
import type { GcalBusy, GcalChange, GcalItem, GcalTimes } from "../../../shared/gcal";

export type GcalApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string };

export const GCAL_MESSAGES: Record<string, string> = {
  unauthorized: "Tu sesión venció. Volvé a iniciar sesión.",
  forbidden: "Tu usuario no está vinculado a una inmobiliaria en PropMatch.",
  no_db: "Falta configurar la base del CRM.",
  not_configured: "Google Calendar todavía no está habilitado en este servidor.",
  not_connected: "Google Calendar no está conectado.",
  needs_reauth: "Google desconectó PropMatch de tu cuenta. Volvé a conectar.",
  rate_limited: "Demasiados cambios seguidos. Probá en unos segundos.",
  google_error: "Google no respondió bien. Reintentamos en un rato.",
  bad_request: "El pedido no es válido.",
  server_error: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
  no_server: "El servidor no está disponible en este entorno.",
  network: "No hay conexión con el servidor. Probá de nuevo.",
  demo: "En la demo no se conecta Google Calendar. Creá tu cuenta para usarlo.",
};

async function call<T>(action: string, method: "GET" | "POST", body?: unknown): Promise<GcalApiResult<T>> {
  const err = (status: number, error: string, message?: string) =>
    ({ ok: false, status, error, message: message ?? GCAL_MESSAGES[error] ?? GCAL_MESSAGES.server_error }) as const;
  try {
    if (isDemoActive()) return err(403, "demo");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return err(401, "unauthorized");
    const r = await fetch(`/api/integrations/${action}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.headers.get("content-type")?.includes("application/json")) return err(r.status, "no_server");
    const j = (await r.json()) as T & { error?: string; message?: string };
    if (!r.ok) return err(r.status, j.error ?? "server_error", j.message);
    return { ok: true, data: j };
  } catch {
    return err(0, "network");
  }
}

/* ── Opción B: link de suscripción ────────────────────────────────────────── */

export interface FeedStatus {
  db: boolean;
  active: boolean;
  createdAt?: string | null;
  pushedAt?: string | null;
  eventCount?: number;
}

export const feedApi = {
  status: () => call<FeedStatus>("gcal-feed-status", "GET"),
  create: (items: GcalItem[]) => call<FeedStatus & { url: string }>("gcal-feed-create", "POST", { items }),
  rotate: (items: GcalItem[]) => call<FeedStatus & { url: string }>("gcal-feed-rotate", "POST", { items }),
  revoke: () => call<FeedStatus>("gcal-feed-revoke", "POST", {}),
  push: (items: GcalItem[]) => call<FeedStatus>("gcal-feed-push", "POST", { items }),
};

/* ── Opción A: conexión directa (OAuth) ───────────────────────────────────── */

export type GcalState = "connected" | "needs_reauth" | "error" | "not_connected";

export interface GcalStatus {
  /** GOOGLE_CLIENT_ID/SECRET cargadas en el servidor. */
  configured: boolean;
  db: boolean;
  state: GcalState;
  email: string | null;
  calendarId: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface UpsertResult {
  propmatchId: string;
  googleEventId: string;
  ok: boolean;
  conflict?: "google_changed" | "google_deleted";
  google?: { times: GcalTimes | null; updated: string | null };
  error?: string;
}

export interface PullResponse {
  changes: GcalChange[];
  busy: GcalBusy[] | null;
  nextSyncToken: string | null;
  nextPageToken: string | null;
  reset: boolean;
  lastSyncAt: string;
}

export const gcalApi = {
  status: () => call<GcalStatus>("gcal-status", "GET"),
  connect: (ret: "agenda" | "integraciones") => call<{ url: string }>("gcal-connect", "POST", { return: ret }),
  disconnect: () => call<{ ok: true }>("gcal-disconnect", "POST", {}),
  upsert: (items: (GcalItem & { crmUpdatedAt: string; known: GcalTimes | null })[]) =>
    call<{ results: UpsertResult[] }>("gcal-upsert", "POST", { items }),
  remove: (propmatchIds: string[]) =>
    call<{ results: { propmatchId: string; ok: boolean }[] }>("gcal-delete", "POST", { items: propmatchIds.map((propmatchId) => ({ propmatchId })) }),
  pull: (body: { syncToken: string | null; pageToken: string | null; busy: { timeMin: string; timeMax: string } | null; titles: boolean }) =>
    call<PullResponse>("gcal-pull", "POST", body),
};
