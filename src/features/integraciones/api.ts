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
import type { ImportedPropertyDraft } from "../../../shared/meliImport";
import type { AppWatermarkTarget, WatermarkResponse } from "../../../shared/appWatermark";

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
  /** Una página de avisos de la cuenta de ML conectada (repetir con `next` hasta null). */
  meliImportList: (cursor: ImportCursor | null) =>
    call<{ candidates: ImportCandidate[]; skipped: number; next: ImportCursor | null; total: number | null }>("import", {
      method: "POST",
      body: { portal: "mercadolibre", cursor },
    }),
  /** Detalle (con descripción) de hasta 20 avisos. */
  meliImportDetails: (ids: string[]) =>
    call<{ candidates: ImportCandidate[] }>("import-details", { method: "POST", body: { portal: "mercadolibre", ids } }),
  /** Vincula propiedades del CRM con su aviso (hasta 20). */
  meliImportLink: (links: { crmPropertyId: string; externalId: string; propertyId: string | null }[]) =>
    call<{ results: ImportLinkResult[] }>("import-link", { method: "POST", body: { portal: "mercadolibre", links } }),
  /** «Publicar todas en la app»: copia fotos externas de UNA propiedad al bucket de PropMatch (solo admins). */
  copyPhotos: (crmPropertyId: string, urls: string[]) =>
    call<{ results: { url: string; ok: boolean; publicUrl?: string; reason?: string }[]; skipped: string[] }>("copy-photos", {
      method: "POST",
      body: { crmPropertyId, urls },
    }),
  /**
   * «Poner el logo en las fotos de la app»: copias con el logo quemado de fotos
   * de la agencia (hasta 12 por pedido). Ver shared/appWatermark.ts.
   */
  watermarkPhotos: (crmPropertyId: string, urls: string[], target: AppWatermarkTarget) =>
    call<WatermarkResponse>("watermark-photos", {
      method: "POST",
      body: { crmPropertyId, urls, logoUrl: target.logoUrl, position: target.position, size: target.size, backdrop: target.backdrop },
    }),
};

export interface ImportCursor {
  status: "active" | "paused";
  scrollId: string | null;
}

/** Aviso de ML listo para revisar (ver api/_lib/integrations/adapters/mercadolibreImport.ts). */
export interface ImportCandidate {
  externalId: string;
  title: string;
  price: number | null;
  currency: string | null;
  meliStatus: string | null;
  publication: { status: PropertyPublication["status"]; message: string | null };
  permalink: string | null;
  thumbnail: string | null;
  ok: boolean;
  reason?: string;
  draft?: ImportedPropertyDraft;
  unmapped?: string[];
  meliLocation?: { stateId: string | null; cityId: string | null; neighborhoodId: string | null } | null;
  hasDescription?: boolean;
}

export interface ImportLinkResult {
  crmPropertyId: string;
  externalId: string;
  ok: boolean;
  message: string | null;
  row: PropertyPublication | null;
  storedOnServer: boolean;
}

export interface EngineBody {
  /** uuid de la app. Sin él, `crmPropertyId` (propiedad solo-CRM: pesos o sin sincronizar). */
  propertyId?: string;
  crmPropertyId?: string;
  portals: PortalId[];
  inputs: Partial<Record<PortalId, Record<string, unknown>>>;
  isSample?: boolean;
}
