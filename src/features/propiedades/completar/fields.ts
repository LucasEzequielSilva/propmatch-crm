/**
 * "Completar lo que falta ahí mismo": qué dato de la propiedad resuelve cada
 * faltante (del diagnóstico, de Mercado Libre o de lo opcional) y adónde
 * llevar el foco en el editor. No define reglas nuevas: las reglas siguen en
 * src/lib/listingDiagnostics.ts y shared/meliListing.ts; esto solo traduce
 * "qué falta" → "qué campo se edita".
 */

import { PHOTOS_MIN, type DiagnosticCheck } from "@/lib/listingDiagnostics";
import type { Property, PropertyLayout, PropertyOrientation } from "@/types/db";

/** Datos que se editan con un control (inline en el publicador; campo exacto en el editor). */
export type FieldKey =
  | "title"
  | "description"
  | "price"
  | "expenses"
  | "surface_total"
  | "surface_covered"
  | "rooms"
  | "bedrooms"
  | "bathrooms"
  | "garages"
  | "age_years"
  | "orientation"
  | "layout"
  | "address"
  | "coords"
  | "features";

/** Datos que no se editan con un input: se lleva al lugar exacto del editor. */
export type LinkKey = "photos" | "authorization" | "type" | "currency";

/** Datos propios del aviso de Mercado Libre (viven en su panel, no en la propiedad). */
export type MeliExtraKey = "meli_location" | "meli_guests" | "meli_land_access";

export type FixKey = FieldKey | LinkKey | MeliExtraKey;

export const FIELD_KEYS: readonly FieldKey[] = [
  "title",
  "description",
  "price",
  "expenses",
  "surface_total",
  "surface_covered",
  "rooms",
  "bedrooms",
  "bathrooms",
  "garages",
  "age_years",
  "orientation",
  "layout",
  "address",
  "coords",
  "features",
];

export const isFieldKey = (k: FixKey): k is FieldKey => (FIELD_KEYS as readonly string[]).includes(k);

export const FIX_LABEL: Record<FixKey, string> = {
  title: "Título",
  description: "Descripción",
  price: "Precio",
  expenses: "Expensas",
  surface_total: "Superficie total",
  surface_covered: "Superficie cubierta",
  rooms: "Ambientes",
  bedrooms: "Dormitorios",
  bathrooms: "Baños",
  garages: "Cocheras",
  age_years: "Antigüedad",
  orientation: "Orientación",
  layout: "Disposición",
  address: "Dirección",
  coords: "Ubicación en el mapa",
  features: "Amenities",
  photos: "Fotos",
  authorization: "Autorización del propietario",
  type: "Tipo y operación",
  currency: "Moneda",
  meli_location: "Ubicación de Mercado Libre",
  meli_guests: "Huéspedes",
  meli_land_access: "Acceso del terreno",
};

/** id del control exacto en el editor (/propiedades/:id/editar). */
export const editorFieldId = (k: FieldKey | LinkKey) => `campo-${k}`;

/** Link al editor con el foco en el campo, y la vuelta al publicador al guardar. */
export const editorHref = (propertyId: string, k: FieldKey | LinkKey) =>
  `/propiedades/${propertyId}/editar?volver=publicador#${editorFieldId(k)}`;

/** ids de los controles del panel de Mercado Libre en /publicador/:id. */
export const MELI_EXTRA_ID: Record<MeliExtraKey, string> = {
  meli_location: "meli-ubicacion",
  meli_guests: "meli-huespedes",
  meli_land_access: "meli-acceso",
};

export const LAYOUTS: { value: PropertyLayout; label: string }[] = [
  { value: "frente", label: "Frente" },
  { value: "contrafrente", label: "Contrafrente" },
  { value: "lateral", label: "Lateral" },
  { value: "interno", label: "Interno" },
];

export const ORIENTATIONS: { value: PropertyOrientation; label: string }[] = [
  { value: "N", label: "Norte" },
  { value: "NE", label: "Noreste" },
  { value: "NO", label: "Noroeste" },
  { value: "S", label: "Sur" },
  { value: "SE", label: "Sudeste" },
  { value: "SO", label: "Sudoeste" },
  { value: "E", label: "Este" },
  { value: "O", label: "Oeste" },
];

/** Partes del check "Superficie, ambientes y baños" que faltan (misma regla que diagnose). */
export function missingSizeParts(p: Property): FieldKey[] {
  const out: FieldKey[] = [];
  if (!p.surface_total) out.push("surface_total");
  if (!p.rooms) out.push("rooms");
  if (!(p.bathrooms != null && p.bathrooms > 0)) out.push("bathrooms");
  return out;
}

/** Qué se completa para que pase un check del diagnóstico (vacío si ya pasa). */
export function fixesForCheck(c: DiagnosticCheck, p: Property): FixKey[] {
  if (c.ok) return [];
  switch (c.id) {
    case "title":
      return ["title"];
    case "description":
      return ["description"];
    case "photos":
      return ["photos"];
    case "price":
      return ["price"];
    case "coords":
      return ["coords"];
    case "size": {
      const parts = missingSizeParts(p);
      return parts.length ? parts : ["surface_total"];
    }
    case "authorization":
      return ["authorization"];
    default:
      return [];
  }
}

/** Primera letra en minúscula, sin tocar nombres propios ("Mercado Libre"). */
export const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Faltante corto para "Falta: …" (en minúscula, para encadenar con comas). */
export function shortMissingForCheck(c: DiagnosticCheck, p: Property, photoCount: number): string[] {
  if (c.ok) return [];
  switch (c.id) {
    case "photos": {
      const n = Math.max(PHOTOS_MIN - photoCount, 1);
      return [n === 1 ? "1 foto más" : `${n} fotos más`];
    }
    case "title":
      return ["título de 20 a 100 caracteres"];
    case "description":
      return ["descripción más larga"];
    case "size":
      return missingSizeParts(p).map((k) => lc(FIX_LABEL[k]));
    case "authorization":
      return ["autorización vigente"];
    case "coords":
      return ["ubicación en el mapa"];
    case "price":
      return ["precio"];
    default:
      return [lc(c.label)];
  }
}

/** Campo de la propiedad (o dato del panel) que resuelve cada `field` de un MeliIssue. */
export function fixForMeliField(field: string): FixKey | null {
  switch (field) {
    case "title":
      return "title";
    case "description":
      return "description";
    case "price":
    case "currency":
      return "price";
    case "TOTAL_AREA":
      return "surface_total";
    case "COVERED_AREA":
      return "surface_covered";
    case "ROOMS":
      return "rooms";
    case "BEDROOMS":
      return "bedrooms";
    case "FULL_BATHROOMS":
      return "bathrooms";
    case "PARKING_LOTS":
      return "garages";
    case "GUESTS":
      return "meli_guests";
    case "LAND_ACCESS":
      return "meli_land_access";
    case "location":
      return "meli_location";
    case "address":
      return "address";
    case "coords":
      return "coords";
    case "pictures":
      return "photos";
    case "category":
      return "type";
    default:
      return null;
  }
}

/** Faltante corto de un issue bloqueante de Mercado Libre, para "Falta: …". */
export function shortMissingForMeli(field: string): string {
  const k = fixForMeliField(field);
  if (k === "photos") return "fotos sincronizadas con la app";
  if (k === "type") return "tipo u operación que acepte Mercado Libre";
  if (k === "price" && field === "currency") return "moneda ARS o USD";
  return k ? lc(FIX_LABEL[k]) : field;
}

const noInterior = (p: Property) => p.type === "terreno";

/**
 * Datos opcionales sin cargar: no bloquean ningún canal, pero mejoran la ficha
 * y el matching. `exclude` saca lo que ya aparece como faltante obligatorio.
 */
export function optionalMissing(p: Property, exclude: Iterable<FixKey> = []): FieldKey[] {
  const skip = new Set<FixKey>(exclude);
  const out: FieldKey[] = [];
  const add = (k: FieldKey, missing: boolean) => {
    if (missing && !skip.has(k)) out.push(k);
  };
  add("address", !(p.street ?? "").trim());
  add("coords", !(typeof p.lat === "number" && typeof p.lng === "number"));
  add("surface_covered", !noInterior(p) && !p.surface_covered);
  add("bedrooms", (p.type === "casa" || p.type === "departamento" || p.type === "ph") && p.bedrooms == null);
  add("garages", !noInterior(p) && p.garages == null);
  add("expenses", p.expenses == null);
  add("age_years", !noInterior(p) && p.age_years == null);
  add("orientation", !p.orientation);
  add("layout", (p.type === "departamento" || p.type === "ph" || p.type === "oficina" || p.type === "local") && !p.layout);
  add("features", p.features.length === 0);
  return out;
}
