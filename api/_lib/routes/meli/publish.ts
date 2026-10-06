/**
 * POST /api/meli/publish — publica y gestiona el aviso de una propiedad en
 * Mercado Libre Inmuebles con la cuenta conectada de la inmobiliaria.
 *
 * Body: { action, propertyId, listing?, listingType? }
 *   action: "check"    valida (atributos en vivo, fotos públicas, cupo) sin publicar
 *           "publish"  crea el aviso (si ya hay uno activo/pausado, lo actualiza)
 *           "update"   sincroniza título, precio, fotos, atributos y descripción
 *           "pause" | "activate" | "close" (cerrar es definitivo: solo admins)
 *           "sync"     relee el estado del aviso en Mercado Libre
 *   propertyId: uuid de `properties` (Property.app_property_id del CRM).
 *   listing: MeliListingInput (datos del CRM; las fotos NO se aceptan del
 *            cliente: salen de `properties.photos`).
 *
 * La lógica vive en MercadoLibreAdapter (api/_lib/integrations/adapters/mercadolibre.ts),
 * que también usa el motor multi-portal (/api/integrations/publish). Esta ruta
 * responde exactamente lo mismo que antes del refactor.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../../auth.js";
import { isConfigured } from "../../env.js";
import { allowMethod, fail, json } from "../../http.js";
import { runMeliAction } from "../../integrations/adapters/mercadolibre.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const r = await runMeliAction(ctx, b);
    json(res, r.http, r.body);
  } catch {
    fail(res, 500, "server_error");
  }
}
