/**
 * Motor de publicación multi-portal.
 *
 *   POST /api/integrations/publish { propertyId, portals: ["mercadolibre", …], inputs: { mercadolibre: {…} } }
 *   POST /api/integrations/check   (mismo cuerpo: valida sin publicar)
 *
 * Para cada portal pedido:
 *   1. ¿El conector existe y está disponible?        no → "unavailable" + motivo real
 *   2. ¿La agencia DEL USUARIO tiene la conexión?    no → "not_connected" / "needs_reauth"
 *      (el scope sale del JWT; nunca se acepta un agencyId del cliente)
 *   3. check → adapter.validate · publish → adapter.publish (idempotente: si
 *      ya hay aviso vivo lo actualiza; respeta el 402 "pendiente de pago" de ML)
 *   4. El adapter guarda property_publications con connection_id.
 * Devuelve un resultado POR PORTAL (uno que falla no frena a los demás).
 *
 * Propiedades de ejemplo: nunca. No existen en la base (no se sincronizan), y
 * si el cliente avisa que es de ejemplo se corta antes de tocar ningún portal.
 *
 * Sin imports de runtime (dependencias inyectadas): se prueba sin red.
 */
import type { AgencyScope, PortalAdapter, PortalId, PortalInput, PublishResult } from "./types.js";

export interface EngineDeps {
  adapterFor(id: unknown): PortalAdapter | null;
  /** La propiedad SOLO si es de esa agencia (si no, null). */
  loadProperty(agencyId: string, propertyId: string): Promise<{ id: string } | null>;
}

export interface EngineRequest {
  scope: AgencyScope;
  mode: "check" | "publish";
  body: Record<string, unknown>;
}

export interface EngineResponse {
  http: number;
  body: { results?: PublishResult[]; error?: string; message?: string };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_PORTALS = 10;
export const SAMPLE_MESSAGE = "Es una propiedad de ejemplo: no se publica en ningún portal.";

const result = (portal: PortalId, outcome: PublishResult["outcome"], message: string | null): PublishResult => ({
  portal,
  outcome,
  ok: false,
  message,
  issues: [],
  warnings: [],
  row: null,
});

export async function runEngine(req: EngineRequest, deps: EngineDeps): Promise<EngineResponse> {
  const b = req.body ?? {};
  const propertyId = typeof b.propertyId === "string" ? b.propertyId : "";
  const rawPortals = Array.isArray(b.portals) ? b.portals : null;
  if (!UUID.test(propertyId) || !rawPortals || rawPortals.length === 0 || rawPortals.length > MAX_PORTALS) {
    return { http: 400, body: { error: "bad_request" } };
  }
  const adapters: PortalAdapter[] = [];
  for (const p of rawPortals) {
    const a = deps.adapterFor(p);
    if (!a) return { http: 400, body: { error: "unknown_portal" } };
    if (!adapters.includes(a)) adapters.push(a);
  }
  if (b.isSample === true) return { http: 422, body: { error: "sample", message: SAMPLE_MESSAGE } };

  // Aislamiento: la propiedad tiene que ser de la agencia del usuario.
  const prop = await deps.loadProperty(req.scope.agencyId, propertyId);
  if (!prop) {
    return {
      http: 404,
      body: { error: "property_not_found", message: "La propiedad no está sincronizada con la app o no es de tu inmobiliaria." },
    };
  }

  const inputs = (b.inputs && typeof b.inputs === "object" ? b.inputs : {}) as Record<string, unknown>;

  const results = await Promise.all(
    adapters.map(async (a): Promise<PublishResult> => {
      try {
        const av = a.availability();
        if (av.state !== "available") return result(a.id, "unavailable", av.reason);

        const conn = await a.status(req.scope);
        if (conn.state === "needs_reauth")
          return result(a.id, "needs_reauth", `La conexión con ${a.name} venció. Un administrador tiene que volver a conectarla en Integraciones.`);
        if (conn.state !== "connected")
          return result(a.id, "not_connected", `Tu inmobiliaria no tiene ${a.name} conectado. Conectalo en Configuración → Integraciones.`);

        const input = (inputs[a.id] && typeof inputs[a.id] === "object" ? inputs[a.id] : {}) as PortalInput;
        const pr = { scope: req.scope, propertyId, input };
        return req.mode === "check" ? await a.validate(pr) : await a.publish(pr);
      } catch {
        return result(a.id, "error", `No se pudo completar la acción en ${a.name}. Probá de nuevo en un rato.`);
      }
    }),
  );
  return { http: 200, body: { results } };
}
