/**
 * Cliente de /api/integrations/* (Configuración → Integraciones y «Publicar
 * en portales»). Nunca recibe ni manda tokens: el servidor resuelve la
 * agencia por la sesión. Si /api no está disponible (vite dev no corre
 * funciones), se informa tal cual, sin datos simulados.
 */
import { supabase } from "@/lib/supabase";
import { isDemoActive } from "@/lib/demo";
import type { PortalAuthMethod, PortalId } from "@/lib/integrations/registry";
import type { PropertyPublication } from "@/types/db";

export type ConnectionState = "connected" | "not_connected" | "error" | "needs_reauth" | "unavailable";

export type Availability =
  | { state: "available" }
  | { state: "needs_approval" | "coming_soon" | "not_configured"; reason: string };

export interface PortalStatus {
  portal: PortalId;
  state: ConnectionState;
  accountLabel: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastCheckedAt: string | null;
  authMethod: PortalAuthMethod;
  availability: Availability;
}

export interface PortalIssue {
  field: string;
  message: string;
  blocking: boolean;
}

export type PublishOutcome =
  | "ready"
  | "published"
  | "updated"
  | "pending_payment"
  | "invalid"
  | "rejected"
  | "not_connected"
  | "needs_reauth"
  | "unavailable"
  | "in_progress"
  | "not_published"
  | "property_not_found"
  | "error";

export interface PortalResult {
  portal: PortalId;
  outcome: PublishOutcome;
  ok: boolean;
  message: string | null;
  issues: PortalIssue[];
  warnings: string[];
  row: PropertyPublication | null;
}

export const NO_SERVER = "El servidor de integraciones no está disponible en este entorno.";

const GENERIC: Record<string, string> = {
  unauthorized: "Tu sesión venció. Volvé a iniciar sesión.",
  forbidden: "Solo los administradores de la inmobiliaria pueden conectar o desconectar cuentas.",
  unknown_portal: "Ese portal no existe.",
  bad_request: "El pedido no es válido.",
  server_error: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message: string; field?: string };

async function call<T>(action: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<ApiResult<T>> {
  try {
    if (isDemoActive()) {
      return { ok: false, status: 403, error: "demo", message: "En la demo no se conectan portales. Creá tu cuenta para conectar los de tu inmobiliaria." };
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, status: 401, error: "unauthorized", message: GENERIC.unauthorized };
    const r = await fetch(`/api/integrations/${action}`, {
      method: init.method,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!r.headers.get("content-type")?.includes("application/json")) {
      return { ok: false, status: r.status, error: "no_server", message: NO_SERVER };
    }
    const j = (await r.json()) as T & { error?: string; message?: string; field?: string };
    if (!r.ok) {
      const error = j.error ?? "server_error";
      return { ok: false, status: r.status, error, message: j.message ?? GENERIC[error] ?? GENERIC.server_error, field: j.field };
    }
    return { ok: true, data: j };
  } catch {
    return { ok: false, status: 0, error: "network", message: "No hay conexión con el servidor. Probá de nuevo." };
  }
}

export const integrationsApi = {
  list: () => call<{ isAdmin: boolean; portals: PortalStatus[] }>("list", { method: "GET" }),
  connect: (portal: PortalId, ret: "integraciones" | "publicador" = "integraciones") =>
    call<{ url?: string; form?: boolean }>("connect", { method: "POST", body: { portal, return: ret } }),
  disconnect: (portal: PortalId) => call<{ ok: true }>("disconnect", { method: "POST", body: { portal } }),
  saveCredentials: (portal: "argenprop", credentials: Record<string, string>) =>
    call<{ ok: true }>("credentials", { method: "POST", body: { portal, credentials } }),
  check: (body: EngineBody) => call<{ results: PortalResult[] }>("check", { method: "POST", body }),
  publish: (body: EngineBody) => call<{ results: PortalResult[] }>("publish", { method: "POST", body }),
};

export interface EngineBody {
  propertyId: string;
  portals: PortalId[];
  inputs: Partial<Record<PortalId, Record<string, unknown>>>;
  isSample?: boolean;
}
