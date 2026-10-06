/**
 * Traduce la respuesta de la acción de Mercado Libre (la misma que devuelve
 * POST /api/meli/publish, que no cambia) a un resultado del motor.
 *
 * Archivo sin imports de runtime: lo usan las pruebas sin red.
 */
import type { PortalIssue, PublishOutcome, PublishResult } from "./types.js";

export interface MeliActionResponse {
  http: number;
  body: Record<string, unknown>;
}

const strOr = (v: unknown) => (typeof v === "string" && v ? v : null);

const ERROR_OUTCOME: Record<string, PublishOutcome> = {
  invalid: "invalid",
  bad_listing: "invalid",
  meli_payment_required: "pending_payment",
  meli_rejected: "rejected",
  meli_needs_reauth: "needs_reauth",
  meli_not_connected: "not_connected",
  meli_unavailable: "error",
  in_progress: "in_progress",
  not_published: "not_published",
  property_not_found: "property_not_found",
  forbidden: "error",
  bad_request: "error",
};

const FALLBACK: Partial<Record<PublishOutcome, string>> = {
  invalid: "Faltan datos para publicar en Mercado Libre.",
  needs_reauth: "La conexión con Mercado Libre venció. Un administrador tiene que volver a conectar la cuenta.",
  not_connected: "La inmobiliaria no tiene Mercado Libre conectado.",
  error: "No se pudo completar la acción en Mercado Libre. Probá de nuevo en un rato.",
};

export function meliOutcome(r: MeliActionResponse, mode: "check" | "publish" | "update" | "lifecycle"): PublishResult {
  const b = r.body ?? {};
  const issues = (Array.isArray(b.issues) ? b.issues : []) as PortalIssue[];
  const warnings = [
    ...((Array.isArray(b.warnings) ? b.warnings : []) as string[]),
    ...(strOr(b.packNote) ? [b.packNote as string] : []),
  ];
  const row = (b.row && typeof b.row === "object" ? b.row : null) as Record<string, unknown> | null;
  const base = { portal: "mercadolibre" as const, issues, warnings, row };

  if (r.http >= 200 && r.http < 300) {
    if (mode === "check") {
      const ok = !issues.some((i) => i.blocking);
      return { ...base, outcome: ok ? "ready" : "invalid", ok, message: ok ? null : FALLBACK.invalid! };
    }
    // "publicar" sobre un aviso vivo lo actualiza: se distingue por published_at previo.
    const outcome: PublishOutcome = mode === "publish" && !b.updatedExisting ? "published" : "updated";
    return { ...base, outcome, ok: true, message: null };
  }

  const code = strOr(b.error) ?? "";
  const outcome: PublishOutcome =
    ERROR_OUTCOME[code] ?? (r.http === 401 ? "error" : r.http === 404 ? "property_not_found" : "error");
  return { ...base, outcome, ok: false, message: strOr(b.message) ?? FALLBACK[outcome] ?? FALLBACK.error! };
}
