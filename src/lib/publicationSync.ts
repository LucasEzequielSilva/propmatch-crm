/**
 * Publicaciones externas de las propiedades (tabla `property_publications`).
 *
 * `property_id` acá es el uuid real de la propiedad en Supabase
 * (`Property.app_property_id`), no el id local del CRM.
 *
 * Si la tabla todavía no existe en la base (migración sin aplicar), `fetch`
 * devuelve `null` y la pantalla cae al modo local en vez de romperse.
 */

import { supabase } from "./supabase";
import type { PropertyPublication, PublicationChannel, PublicationStatus } from "@/types/db";

const COLUMNS =
  "id, agency_id, property_id, channel, status, external_id, external_url, error_message, published_at, last_synced_at, created_at, updated_at";

/** `null` = la tabla no está disponible (modo local). */
export async function fetchAgencyPublications(agencyId: string): Promise<PropertyPublication[] | null> {
  const { data, error } = await supabase
    .from("property_publications")
    .select(COLUMNS)
    .eq("agency_id", agencyId);
  if (error) return null;
  return data as PropertyPublication[];
}

export interface PublicationUpsert {
  agencyId: string;
  propertyId: string;
  channel: PublicationChannel;
  status: PublicationStatus;
  externalId?: string | null;
  externalUrl?: string | null;
  errorMessage?: string | null;
}

/** Crea o actualiza la publicación de una propiedad en un canal (única por propiedad+canal). */
export async function upsertPublications(
  items: PublicationUpsert[],
): Promise<{ rows: PropertyPublication[]; error: string | null }> {
  if (items.length === 0) return { rows: [], error: null };
  const payload = items.map((i) => ({
    agency_id: i.agencyId,
    property_id: i.propertyId,
    channel: i.channel,
    status: i.status,
    external_id: i.externalId ?? null,
    external_url: i.externalUrl ?? null,
    error_message: i.errorMessage ?? null,
    published_at: i.status === "published" ? new Date().toISOString() : null,
    last_synced_at: new Date().toISOString(),
  }));
  const { data, error } = await supabase
    .from("property_publications")
    .upsert(payload, { onConflict: "property_id,channel" })
    .select(COLUMNS);
  return { rows: (data ?? []) as PropertyPublication[], error: error?.message ?? null };
}
