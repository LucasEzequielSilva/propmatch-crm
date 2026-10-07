/**
 * Piezas comunes para adapters cuyo conector todavía no publica: cualquier
 * acción de publicación devuelve "unavailable" con el motivo real.
 */
import type { PortalId, PublishResult } from "../types.js";

export function unavailableResult(portal: PortalId, message: string): PublishResult {
  return { portal, outcome: "unavailable", ok: false, message, issues: [], warnings: [], row: null };
}
