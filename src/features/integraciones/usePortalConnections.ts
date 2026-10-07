import { useCallback, useEffect, useState } from "react";
import { PORTALS, type PortalId } from "@/lib/integrations/registry";
import { integrationsApi, type PortalStatus } from "./api";

/** Estado mientras no hay respuesta del servidor: lo que dice el registro del cliente. */
function fallback(): PortalStatus[] {
  return PORTALS.map((p) => ({
    portal: p.id,
    state: p.availability === "coming_soon" ? "unavailable" : "not_connected",
    accountLabel: null,
    connectedAt: null,
    lastError: null,
    lastCheckedAt: null,
    authMethod: p.authMethod,
    availability:
      p.availability === "available"
        ? { state: "available" }
        : { state: p.availability, reason: p.availability === "coming_soon" ? "Próximamente." : "Requiere aprobación." },
  }));
}

/**
 * Conexiones de la inmobiliaria con cada portal (GET /api/integrations/list).
 * `serverError` != null → el servidor no respondió (se muestran los portales
 * igual, sin poder conectar).
 */
export function usePortalConnections() {
  const [loading, setLoading] = useState(true);
  const [portals, setPortals] = useState<PortalStatus[]>(fallback);
  const [isAdmin, setIsAdmin] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await integrationsApi.list();
    if (r.ok) {
      setPortals(r.data.portals);
      setIsAdmin(r.data.isAdmin);
      setServerError(null);
    } else {
      setServerError(r.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const statusOf = useCallback((id: PortalId) => portals.find((p) => p.portal === id) ?? null, [portals]);

  return { loading, portals, isAdmin, serverError, refresh, statusOf };
}
