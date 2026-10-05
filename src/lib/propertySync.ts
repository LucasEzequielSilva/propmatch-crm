/**
 * Traducción CRM ↔ app real (Supabase `properties`).
 *
 * El CRM modela una inmobiliaria de servicio completo; la app modela un
 * marketplace de alquiler tipo swipe. Comparten "propiedad" pero no el mismo
 * esquema: acá vive la traducción, para que `store.tsx` no se llene de SQL.
 *
 * Campos que el CRM tiene y la app no modela en absoluto (expensas,
 * impuestos, comisión, autorización, superficie, baños, cocheras,
 * antigüedad, provincia) NO se sincronizan: siguen viviendo solo en
 * localStorage, exactamente como antes. No es una regresión, es lo mismo
 * que ya pasaba.
 */

import { supabase } from "./supabase";
import type { CurrencyCode, OperationType, PropertyStatus, PropertyType } from "@/types/db";
import type { NewPropertyInput } from "@/data/store";

/** CRM → app. Los 6 valores del CRM ya existen en el enum de la app (se amplió para esto). */
const TYPE_TO_APP: Record<PropertyType, string> = {
  casa: "casa",
  departamento: "depto",
  ph: "ph",
  terreno: "terreno",
  local: "local",
  oficina: "oficina",
};

const OPERATION_TO_APP: Record<OperationType, string> = {
  venta: "venta",
  alquiler: "alquiler",
  alquiler_temporal: "temporario",
};

/**
 * La app solo tiene 3 estados (`active/paused/deleted`); el CRM tiene 6.
 * "Vendida"/"alquilada" son cierres definitivos → `deleted` (no vuelve a
 * estar disponible desde la app). El resto son estados reversibles → `paused`.
 */
const STATUS_TO_APP: Record<PropertyStatus, "active" | "paused" | "deleted"> = {
  disponible: "active",
  pausada: "paused",
  reservada: "paused",
  en_revision: "paused",
  vendida: "deleted",
  alquilada: "deleted",
};

/** app → CRM. Se usa solo al descubrir una propiedad de agencia creada desde otro navegador. */
export const TYPE_FROM_APP: Record<string, PropertyType> = {
  casa: "casa",
  depto: "departamento",
  ph: "ph",
  terreno: "terreno",
  local: "local",
  oficina: "oficina",
  // La app también admite "loft"/"monoambiente" para publicaciones propias de
  // usuarios (no de agencia). No debería aparecer acá porque solo se leen
  // filas con agency_id, pero si pasara, lo más parecido que ofrece el CRM:
  loft: "departamento",
  monoambiente: "departamento",
};

export const OPERATION_FROM_APP: Record<string, OperationType> = {
  venta: "venta",
  alquiler: "alquiler",
  temporario: "alquiler_temporal",
};

/**
 * `deleted` no distingue vendida/alquilada/pausada: se resuelve como
 * "pausada", la opción que no afirma nada que no se pueda verificar.
 */
export const STATUS_FROM_APP: Record<string, PropertyStatus> = {
  active: "disponible",
  paused: "pausada",
  deleted: "pausada",
};

/**
 * Condiciones para publicar en la app: precio en USD (la app no tiene otro) y
 * que NO sea un dato de ejemplo (`is_sample`): esos nunca salen del navegador.
 */
export function canPublishToApp(input: { currency: CurrencyCode; is_sample?: boolean }): boolean {
  if (input.is_sample) return false;
  return input.currency === "USD";
}

/**
 * Ambientes de la propiedad. Si el formulario los mandó (aunque sea `null`,
 * "no sé"), manda eso; si no vinieron (importador, datos viejos), se usa la
 * regla de siempre: dormitorios + 1 (estar).
 */
export function roomsOf(input: { rooms?: number | null; bedrooms: number }): number | null {
  return input.rooms !== undefined ? input.rooms : input.bedrooms + 1;
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? "image/webp";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes("jpeg") ? "jpg" : mime.includes("png") ? "png" : "webp";
  return { blob: new Blob([bytes], { type: mime }), ext };
}

/**
 * Sube las fotos nuevas (data URLs) al bucket `property-photos`, bajo
 * `{agencyId}/{propertyId}/...` — la policy de Storage habilita esa carpeta
 * para cualquier miembro de la agencia, no solo para el owner_id de la fila.
 * Las que ya son una URL (sincronizadas antes) se dejan igual.
 */
export async function uploadPropertyPhotos(
  agencyId: string,
  propertyId: string,
  photos: string[],
): Promise<string[]> {
  const urls: string[] = [];
  for (const photo of photos) {
    if (!photo.startsWith("data:")) {
      urls.push(photo);
      continue;
    }
    const { blob, ext } = dataUrlToBlob(photo);
    const path = `${agencyId}/${propertyId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("property-photos").upload(path, blob, {
      contentType: blob.type,
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from("property-photos").getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  return urls;
}

export interface AppPropertyContext {
  agencyId: string;
  agencyOwnerUserId: string;
  managedByUserId: string;
}

function buildAppPayload(input: NewPropertyInput, ctx: AppPropertyContext, photoUrls: string[]) {
  const address = [input.street, input.street_number].filter(Boolean).join(" ") || input.locality;
  const isRent = input.operation !== "venta";

  return {
    owner_id: ctx.agencyOwnerUserId,
    agency_id: ctx.agencyId,
    managed_by_user_id: ctx.managedByUserId,
    title: input.title,
    description: input.description ?? "",
    photos: photoUrls,
    address,
    barrio: input.locality,
    type: TYPE_TO_APP[input.type],
    operation_type: OPERATION_TO_APP[input.operation],
    rooms: roomsOf(input),
    // lat/lng NO se mandan todavía: pendiente de decidir con Lucas. La app
    // oculta la ubicación exacta hasta el match (ver AGENCY_PROPERTY_COLUMNS)
    // y no está definido cómo debería tratar el pin que carga la agencia.
    amenities: input.features,
    price_usd_month: isRent ? input.price : null,
    price_usd_sale: isRent ? null : input.price,
    status: STATUS_TO_APP[input.status],
  };
}

/** Inserta o actualiza la fila de `properties`. Devuelve su id real (uuid). */
export async function upsertAppProperty(
  input: NewPropertyInput,
  ctx: AppPropertyContext,
  photoUrls: string[],
  existingAppId: string | null,
): Promise<string> {
  const payload = buildAppPayload(input, ctx, photoUrls);

  if (existingAppId) {
    const { error } = await supabase.from("properties").update(payload).eq("id", existingAppId);
    if (error) throw error;
    return existingAppId;
  }

  const { data, error } = await supabase.from("properties").insert(payload).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Solo el estado — para los toggles rápidos (`updateProperty`), sin tocar el resto de la fila. */
export async function pushStatusToApp(appPropertyId: string, status: PropertyStatus): Promise<void> {
  const { error } = await supabase
    .from("properties")
    .update({ status: STATUS_TO_APP[status] })
    .eq("id", appPropertyId);
  if (error) throw error;
}

export interface AppPropertyRow {
  id: string;
  title: string;
  description: string | null;
  photos: string[];
  address: string | null;
  barrio: string | null;
  type: string;
  operation_type: string;
  rooms: number | null;
  amenities: string[] | null;
  price_usd_month: number | null;
  price_usd_sale: number | null;
  status: string;
  agency_id: string;
  managed_by_user_id: string | null;
  owner_contact_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Columnas explícitas, no `select("*")`: `lat`/`lng` no son legibles para
 * `authenticated` a propósito (la app oculta la ubicación exacta hasta el
 * match) y pedirlas tira "permission denied" para toda la fila.
 */
const AGENCY_PROPERTY_COLUMNS =
  "id, title, description, photos, address, barrio, type, operation_type, rooms, amenities, " +
  "price_usd_month, price_usd_sale, status, agency_id, managed_by_user_id, owner_contact_id, created_at, updated_at";

export async function fetchAgencyProperties(agencyId: string): Promise<AppPropertyRow[]> {
  const { data, error } = await supabase
    .from("properties")
    .select(AGENCY_PROPERTY_COLUMNS)
    .eq("agency_id", agencyId);
  if (error) throw error;
  return data as unknown as AppPropertyRow[];
}
