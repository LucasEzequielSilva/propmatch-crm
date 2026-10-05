/**
 * Estado del formulario de alta/edición de propiedades.
 *
 * Un solo objeto (y no veinte useState) para poder guardarlo entero como
 * borrador, recuperarlo y compararlo contra el estado inicial.
 */

import type { NewPropertyInput } from "@/data/store";
import { isValidLatLng } from "@/lib/geo";
import type {
  AuthorizationType,
  CurrencyCode,
  OperationType,
  Property,
  PropertyLayout,
  PropertyOrientation,
  PropertyStatus,
  PropertyType,
} from "@/types/db";

export interface FormState {
  // 2 · Información comercial
  type: PropertyType;
  subtype: string;
  operation: OperationType;
  title: string;
  description: string;
  status: PropertyStatus;
  agentId: string;
  // 3 · Precios
  price: string;
  currency: CurrencyCode;
  expenses: string;
  expensesCurrency: CurrencyCode;
  taxes: string;
  commission: string;
  creditEligible: boolean;
  acceptsSwap: boolean;
  reservePrice: string;
  reserveCurrency: CurrencyCode;
  // 4 · Superficies y ambientes
  surfaceTotal: string;
  surfaceCovered: string;
  surfaceSemicovered: string;
  surfaceUncovered: string;
  /** Vacío = se usa dormitorios + 1. */
  rooms: string;
  bedrooms: number;
  bathrooms: number;
  toilettes: number;
  garages: number;
  age: string;
  layout: PropertyLayout | "";
  orientation: PropertyOrientation | "";
  // 5 · Ubicación
  street: string;
  streetNumber: string;
  floor: string;
  unit: string;
  /** Edita la ZONA, que es lo que consume el matching. */
  locality: string;
  province: string;
  lat: string;
  lng: string;
  // 6 · Amenities
  features: string[];
  // 1 · Galería
  photos: string[];
  // 7 · Propietario y autorización
  ownerId: string;
  authType: AuthorizationType | "";
  authExpires: string;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function initialForm(p: Property | undefined, photos: string[], agentId: string): FormState {
  return {
    type: p?.type ?? "casa",
    subtype: p?.subtype ?? "",
    operation: p?.operation ?? "venta",
    title: p?.title ?? "",
    description: p?.description ?? "",
    status: p?.status ?? "disponible",
    agentId: p?.owner_agent_id ?? agentId,
    price: num(p?.price),
    currency: p?.currency ?? "USD",
    expenses: num(p?.expenses),
    expensesCurrency: p?.expenses_currency ?? "ARS",
    taxes: num(p?.taxes),
    commission: p ? num(p.commission_pct) : "3",
    creditEligible: p?.credit_eligible ?? false,
    acceptsSwap: p?.accepts_swap ?? false,
    reservePrice: num(p?.reserve_min_price),
    reserveCurrency: p?.reserve_min_currency ?? p?.currency ?? "USD",
    surfaceTotal: num(p?.surface_total),
    surfaceCovered: num(p?.surface_covered),
    surfaceSemicovered: num(p?.surface_semicovered),
    surfaceUncovered: num(p?.surface_uncovered),
    rooms: num(p?.rooms),
    bedrooms: p?.bedrooms ?? 3,
    bathrooms: p?.bathrooms ?? 2,
    toilettes: p?.toilettes ?? 0,
    garages: p?.garages ?? 1,
    age: num(p?.age_years),
    layout: p?.layout ?? "",
    orientation: p?.orientation ?? "",
    street: p?.street ?? "",
    streetNumber: p?.street_number ?? "",
    floor: p?.floor ?? "",
    unit: p?.unit ?? "",
    // La localidad puede ser más amplia que la zona ("La Plata" vs "La Plata Centro").
    locality: p?.zone ?? p?.locality ?? "City Bell",
    province: p?.province ?? "Buenos Aires",
    lat: num(p?.lat),
    lng: num(p?.lng),
    features: p?.features ?? ["Jardín", "Cochera"],
    photos,
    ownerId: p?.owner_contact_id ?? "",
    authType: p?.authorization_type ?? "",
    authExpires: p?.authorization_expires_at ?? "",
  };
}

const n = (s: string) => (s.trim() ? Number(s) : null);

export const roomsValue = (f: FormState) => (f.rooms ? Number(f.rooms) : f.bedrooms + 1);

/** Las dos o ninguna: media coordenada no sirve para nada. */
export function coordsOf(f: FormState): { lat: number; lng: number } | null {
  if (!f.lat.trim() || !f.lng.trim()) return null;
  const lat = Number(f.lat);
  const lng = Number(f.lng);
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function toInput(f: FormState): NewPropertyInput {
  const coords = coordsOf(f);
  return {
    title: f.title.trim(),
    description: f.description.trim() || null,
    type: f.type,
    operation: f.operation,
    status: f.status,
    street: f.street.trim() || null,
    street_number: f.streetNumber.trim() || null,
    locality: f.locality,
    province: f.province,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
    price: n(f.price),
    currency: f.currency,
    expenses: n(f.expenses),
    taxes: n(f.taxes),
    commission_pct: n(f.commission),
    surface_total: n(f.surfaceTotal),
    surface_covered: n(f.surfaceCovered),
    rooms: roomsValue(f),
    bedrooms: f.bedrooms,
    bathrooms: f.bathrooms,
    garages: f.garages,
    age_years: n(f.age),
    features: f.features,
    owner_agent_id: f.agentId,
    owner_contact_id: f.ownerId || null,
    authorization_type: f.authType || null,
    authorization_expires_at: f.authType ? f.authExpires || null : null,
    photos: f.photos,
    // Solo CRM
    subtype: f.subtype.trim() || null,
    toilettes: f.toilettes || null,
    surface_semicovered: n(f.surfaceSemicovered),
    surface_uncovered: n(f.surfaceUncovered),
    layout: f.layout || null,
    orientation: f.orientation || null,
    floor: f.floor.trim() || null,
    unit: f.unit.trim() || null,
    expenses_currency: f.expenses.trim() ? f.expensesCurrency : null,
    credit_eligible: f.creditEligible,
    accepts_swap: f.acceptsSwap,
    reserve_min_price: n(f.reservePrice),
    reserve_min_currency: f.reservePrice.trim() ? f.reserveCurrency : null,
  };
}

/** La propiedad "como quedaría": la usan el diagnóstico y el matching en vivo. */
export function toDraftProperty(f: FormState, base?: Property): Property {
  const input = toInput(f);
  const nowIso = new Date().toISOString();
  return {
    ...input,
    id: base?.id ?? "draft",
    agency_id: base?.agency_id ?? "",
    zone: input.locality,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    rooms: input.rooms ?? null,
    // Para el matching en vivo cuenta como disponible, aunque se guarde pausada.
    status: "disponible",
    is_featured: base?.is_featured ?? false,
    published_to_marketplace: base?.published_to_marketplace ?? false,
    published_at: base?.published_at ?? null,
    created_at: base?.created_at ?? nowIso,
    updated_at: nowIso,
  };
}
