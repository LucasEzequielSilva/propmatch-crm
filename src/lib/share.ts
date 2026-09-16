/**
 * Ficha pública de una propiedad.
 *
 * Sin backend, el cliente que abre el link no tiene acceso a los datos (viven
 * en el navegador del agente). Por eso la ficha viaja dentro del link:
 * JSON → deflate → base64url, en el `#` de la URL. El `#` no se manda al
 * servidor, así que los datos tampoco quedan en logs de Vercel.
 *
 * Solo van datos públicos: nunca comisión, propietario, número de calle ni
 * notas. Las fotos subidas desde la compu (data URL) no entran porque harían
 * el link enorme; van solo las que son URLs. Cuando haya Supabase esto se
 * reemplaza por `/ficha/:id` con las fotos del Storage.
 */

import type { Agency, CurrencyCode, OperationType, Profile, Property, PropertyType } from "@/types/db";

export interface SharedListing {
  v: 1;
  title: string;
  description: string | null;
  type: PropertyType;
  operation: OperationType;
  price: number | null;
  currency: CurrencyCode;
  expenses: number | null;
  zone: string | null;
  locality: string | null;
  province: string | null;
  /** Calle sin altura: alcanza para ubicar la zona sin exponer la dirección. */
  street: string | null;
  surface_total: number | null;
  surface_covered: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  age_years: number | null;
  features: string[];
  photos: string[];
  agency: { name: string; phone: string | null; email: string | null };
  agent: { name: string; phone: string | null } | null;
}

const MAX_PHOTOS = 8;

export function buildSharedListing(
  property: Property,
  photos: string[],
  agency: Agency,
  agent: Profile | undefined,
): SharedListing {
  return {
    v: 1,
    title: property.title,
    description: property.description,
    type: property.type,
    operation: property.operation,
    price: property.price,
    currency: property.currency,
    expenses: property.expenses,
    zone: property.zone,
    locality: property.locality,
    province: property.province,
    street: property.street,
    surface_total: property.surface_total,
    surface_covered: property.surface_covered,
    rooms: property.rooms,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    garages: property.garages,
    age_years: property.age_years,
    features: property.features,
    photos: photos.filter((u) => /^https?:\/\//.test(u)).slice(0, MAX_PHOTOS),
    agency: { name: agency.name, phone: agency.phone, email: agency.email },
    agent: agent ? { name: agent.full_name, phone: agent.phone } : null,
  };
}

/** Cuántas fotos quedaron afuera por ser subidas desde la compu. */
export const localOnlyPhotos = (photos: string[]) => photos.filter((u) => !/^https?:\/\//.test(u)).length;

const toBase64Url = (bytes: Uint8Array) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string) => {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeListing(listing: SharedListing): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(listing));
  return toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeListing(token: string): Promise<SharedListing | null> {
  try {
    const bytes = await pipe(fromBase64Url(token), new DecompressionStream("deflate-raw"));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as SharedListing;
    return parsed?.v === 1 && typeof parsed.title === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** URL completa de la ficha, lista para pegar en WhatsApp. */
export async function listingUrl(listing: SharedListing): Promise<string> {
  return `${window.location.origin}/ficha#${await encodeListing(listing)}`;
}
