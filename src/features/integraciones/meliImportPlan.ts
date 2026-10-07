/**
 * Del aviso de Mercado Libre (ya traducido por shared/meliImport.ts) a lo que
 * guarda el CRM: la ficha (como si se cargara a mano), la publicación de ML
 * vinculada y la nota con lo que no tiene lugar en la ficha.
 *
 * Sin imports de runtime: lo prueban scripts/meliImport.test.ts.
 */
import type { NewPropertyInput } from "@/data/store";
import type { PropertyPublication } from "@/types/db";
import type { ImportedPropertyDraft } from "../../../shared/meliImport";

/**
 * Ficha para `addProperty`. Dormitorios, baños y cocheras que el aviso no
 * informa quedan vacíos (null): no se inventa un 0. `Property` los admite
 * vacíos; `NewPropertyInput` los tipa como número porque el formulario siempre
 * manda uno.
 */
export function draftToPropertyInput(d: ImportedPropertyDraft, ownerAgentId: string | null): NewPropertyInput {
  const n = (v: number | null) => v as unknown as number;
  return {
    title: d.title,
    description: d.description,
    type: d.type,
    operation: d.operation,
    status: d.status,
    street: d.street,
    street_number: d.street_number,
    locality: d.locality,
    province: d.province,
    lat: d.lat,
    lng: d.lng,
    price: d.price,
    currency: d.currency,
    expenses: d.expenses,
    expenses_currency: d.expenses_currency,
    taxes: null,
    commission_pct: null,
    surface_total: d.surface_total,
    surface_covered: d.surface_covered,
    rooms: d.rooms,
    bedrooms: n(d.bedrooms),
    bathrooms: n(d.bathrooms),
    garages: n(d.garages),
    age_years: d.age_years,
    features: d.features,
    layout: d.layout,
    orientation: d.orientation,
    floor: d.floor,
    unit: d.unit,
    owner_agent_id: ownerAgentId,
    owner_contact_id: null,
    authorization_type: null,
    authorization_expires_at: null,
    photos: d.photos,
  };
}

/** Publicación de ML vinculada, tal como la guarda el navegador hasta que responde el servidor. */
export function linkedPublicationRow(
  agencyId: string,
  crmPropertyId: string,
  c: { externalId: string; permalink: string | null; publication: { status: PropertyPublication["status"]; message: string | null } },
  now = new Date().toISOString(),
): PropertyPublication {
  return {
    id: `local:${crmPropertyId}`,
    agency_id: agencyId,
    property_id: null,
    crm_property_id: crmPropertyId,
    channel: "mercadolibre",
    status: c.publication.status,
    external_id: c.externalId,
    external_url: c.permalink,
    error_message: c.publication.message,
    published_at: null,
    last_synced_at: now,
    created_at: now,
    updated_at: now,
    local_only: true,
  };
}

/** Nota para el historial de la propiedad con lo que el aviso tenía y la ficha no modela. */
export function importNote(externalId: string, unmapped: string[], hasDescription: boolean | undefined): string {
  const parts = [`Importada del aviso ${externalId} de Mercado Libre.`];
  if (hasDescription === false) parts.push("No pudimos leer la descripción del aviso: completala a mano.");
  if (unmapped.length > 0) parts.push(`Datos del aviso sin lugar en la ficha: ${unmapped.join("; ")}.`);
  return parts.join(" ");
}
