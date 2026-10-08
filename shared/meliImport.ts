/**
 * «Importar mis avisos de Mercado Libre»: aviso de ML → ficha del CRM.
 * Funciones PURAS y sin imports de runtime (las usan el servidor, la pantalla
 * de revisión y las pruebas sin red).
 *
 * Fuentes (consultadas el 2026-10-07):
 *  [ITEM] Forma del ítem de inmuebles (location, attributes con value_struct,
 *         pictures con secure_url): respuesta de ejemplo de "List properties",
 *         https://developers.mercadolibre.com.ar/en_us/list-properties
 *  [CAT]  Árbol de Inmuebles: GET https://api.mercadolibre.com/categories/MLA1459
 *         (hijas: Casas MLA1466, Departamentos MLA1472, PH MLA105179, Terrenos y
 *         Lotes MLA1493, Locales MLA79242, Oficinas MLA50538, y otras que el CRM no
 *         modela) y GET /categories/{id} → path_from_root (tipo en el nivel 1,
 *         operación en el nivel 2: "Venta", "Alquiler", "Alquiler Temporario").
 *  [ATTR] GET /categories/MLA1473/attributes: ids y valores de PROPERTY_TYPE,
 *         OPERATION, DISPOSITION, FACING, booleanos HAS_* (Sí = 242085).
 *  [CUR]  settings.currencies de MLA1459 = ["USD","ARS"].
 *
 * Regla: lo que no tiene equivalente en el CRM NO se inventa; se devuelve en
 * `unmapped` (texto legible) para dejarlo como nota de la propiedad.
 */
import type { MeliOperation, MeliPropertyType } from "./meliListing.js";

/* ───────────────────────────── forma de entrada ─────────────────────────── */

export interface MeliAttributeValue {
  id: string;
  name?: string;
  value_id?: string | null;
  value_name?: string | null;
  value_struct?: { number?: number; unit?: string } | null;
}

export interface MeliPlace {
  id?: string;
  name?: string;
}

/** Subconjunto del ítem que usa el importador [ITEM]. */
export interface MeliImportItem {
  id: string;
  title?: string;
  category_id?: string;
  price?: number | null;
  currency_id?: string | null;
  status?: string;
  sub_status?: string[];
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
  seller_id?: number | string;
  pictures?: { id?: string; url?: string; secure_url?: string }[];
  attributes?: MeliAttributeValue[];
  location?: {
    address_line?: string;
    street_name?: string;
    street_number?: string | number;
    zip_code?: string;
    neighborhood?: MeliPlace;
    city?: MeliPlace;
    state?: MeliPlace;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  geolocation?: { latitude?: number | null; longitude?: number | null } | null;
  date_created?: string;
}

/* ───────────────────────────── ficha resultante ─────────────────────────── */

/** Mismos nombres de campo que NewPropertyInput del CRM (src/data/store.tsx). */
export interface ImportedPropertyDraft {
  title: string;
  description: string | null;
  type: MeliPropertyType;
  operation: MeliOperation;
  status: "disponible" | "pausada";
  street: string | null;
  street_number: string | null;
  locality: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  currency: "ARS" | "USD";
  expenses: number | null;
  expenses_currency: "ARS" | "USD" | null;
  surface_total: number | null;
  surface_covered: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  age_years: number | null;
  features: string[];
  layout: "frente" | "contrafrente" | "lateral" | "interno" | null;
  orientation: "N" | "S" | "E" | "O" | null;
  floor: string | null;
  unit: string | null;
  photos: string[];
}

export interface ImportedListing {
  externalId: string;
  permalink: string | null;
  /** Estado crudo de ML (active, paused…). */
  meliStatus: string | null;
  thumbnail: string | null;
  /** Ubicación en el árbol de ML (para que «Actualizar aviso» no tenga que volver a elegirla). */
  meliLocation: { stateId: string | null; cityId: string | null; neighborhoodId: string | null } | null;
}

export type ImportMapResult =
  | { ok: true; draft: ImportedPropertyDraft; listing: ImportedListing; unmapped: string[] }
  | { ok: false; reason: string; listing: ImportedListing; title: string };

/* ───────────────────────────── categorías ──────────────────────────────── */

export const MELI_REAL_ESTATE_ROOT = "MLA1459";

/** Hija directa de MLA1459 → tipo del CRM [CAT]. Las que no están no se importan. */
export const MELI_TYPE_BY_PARENT: Record<string, MeliPropertyType> = {
  MLA1466: "casa",
  MLA1472: "departamento",
  MLA105179: "ph",
  MLA1493: "terreno",
  MLA79242: "local",
  MLA50538: "oficina",
};

/** Nombres de las hijas que el CRM no modela, para explicar por qué no se importan [CAT]. */
const UNSUPPORTED_PARENT_NAME: Record<string, string> = {
  MLA1496: "Campos",
  MLA50541: "Cocheras",
  MLA392265: "Consultorios",
  MLA1475: "Depósitos y Galpones",
  MLA50545: "Fondo de Comercio",
  MLA1892: "Otros Inmuebles",
  MLA50544: "Parcelas, Nichos y Bóvedas",
  MLA50547: "Quintas",
  MLA50536: "Tiempo Compartido",
  MLA374730: "Camas Náuticas",
};

/** path_from_root de la categoría: [{ id, name }] desde MLA1459 hasta la hoja. */
export type CategoryPath = MeliPlace[];

/** ¿La categoría es Inmuebles (MLA1459) o una descendiente? */
export function isRealEstatePath(path: CategoryPath | null | undefined): boolean {
  return !!path && path.length > 0 && path[0]?.id === MELI_REAL_ESTATE_ROOT;
}

const norm = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function operationFromName(name: string | null | undefined): MeliOperation | null {
  const n = norm(name);
  if (!n) return null;
  if (n.includes("temporar")) return "alquiler_temporal";
  if (n.includes("alquiler")) return "alquiler";
  if (n.includes("venta")) return "venta";
  return null;
}

const attr = (item: MeliImportItem, id: string) => item.attributes?.find((a) => a.id === id) ?? null;

/** Tipo y operación: primero el árbol de categorías; si no, los atributos PROPERTY_TYPE / OPERATION [ATTR]. */
export function typeAndOperation(
  item: MeliImportItem,
  path: CategoryPath | null,
): { type: MeliPropertyType; operation: MeliOperation } | { error: string } {
  const parent = path?.[1]?.id ?? null;
  if (parent && UNSUPPORTED_PARENT_NAME[parent]) {
    return { error: `Es de «${UNSUPPORTED_PARENT_NAME[parent]}», un tipo de inmueble que el CRM todavía no maneja.` };
  }
  let type: MeliPropertyType | null = parent ? MELI_TYPE_BY_PARENT[parent] ?? null : null;
  if (!type) {
    const t = norm(attr(item, "PROPERTY_TYPE")?.value_name);
    type =
      t === "casa" ? "casa"
      : t === "departamento" ? "departamento"
      : t === "ph" ? "ph"
      : t === "terreno" || t === "lote" || t === "terrenos y lotes" ? "terreno"
      : t === "local" ? "local"
      : t === "oficina" ? "oficina"
      : null;
  }
  let operation = operationFromName(path?.[2]?.name) ?? operationFromName(attr(item, "OPERATION")?.value_name);
  if (!type) return { error: "No pudimos reconocer el tipo de inmueble del aviso." };
  if (!operation) return { error: "No pudimos reconocer si el aviso es de venta o de alquiler." };
  if (type === "terreno" && operation === "alquiler_temporal") operation = "alquiler";
  return { type, operation };
}

/* ───────────────────────────── atributos ───────────────────────────────── */

/** Atributo booleano de ML → chip de características del CRM (src/data/seed.ts FEATURE_CHIPS) [ATTR]. */
export const BOOLEAN_TO_FEATURE: Record<string, string> = {
  HAS_GARDEN: "Jardín",
  HAS_BALCONY: "Balcón",
  HAS_SWIMMING_POOL: "Piscina",
  HAS_TERRACE: "Terraza",
  HAS_SECURITY: "Seguridad",
  IS_SUITABLE_FOR_PETS: "Mascotas",
  HAS_GRILL: "Parrilla",
  HAS_GYM: "Gimnasio",
  HAS_MULTIPURPOSE_ROOM: "SUM",
  HAS_LAUNDRY: "Lavadero",
  HAS_AIR_CONDITIONING: "Aire acondicionado",
  HAS_LIFT: "Ascensor",
  HAS_CLOSETS: "Placards",
  PROFESSIONAL_USE_ALLOWED: "Apto profesional",
};

const YES_VALUE_ID = "242085";

/** Atributos que se leen para la ficha o que son de uso interno de ML (no van a notas). */
const HANDLED = new Set([
  "TOTAL_AREA", "COVERED_AREA", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS", "PROPERTY_AGE",
  "MAINTENANCE_FEE", "DISPOSITION", "FACING", "UNIT_FLOOR", "APARTMENT_NUMBER",
  "PROPERTY_TYPE", "OPERATION", "OPERATION_SUBTYPE", "ITEM_CONDITION", "PROPERTY_CODE",
  // Internos / de calidad / del sitio: no describen la propiedad.
  "CMG_SITE", "CANONICAL_URL", "HAS_LEADS_PENALIZATION", "HAS_LOWER_PRICE", "HAS_GOOD_QUALITY",
  "SUGGESTED_PARENT_ID", "PREVIOUS_PRICE", "ORIGINAL_PUBLICATION_DATE", "PHONE_ID", "CONTACT_SCHEDULE",
  "MONTHLY_RENT_FACTOR", "SOCIAL_STRATUM", "HIGHLIGHTS",
]);

const isYes = (a: MeliAttributeValue) => a.value_id === YES_VALUE_ID || norm(a.value_name) === "si";
const isNo = (a: MeliAttributeValue) => a.value_id === "242084" || norm(a.value_name) === "no";

/** Número del atributo: value_struct.number o el primer número de value_name ("40 m²", "2"). */
function numberOf(a: MeliAttributeValue | null): number | null {
  if (!a) return null;
  if (a.value_struct && typeof a.value_struct.number === "number" && Number.isFinite(a.value_struct.number)) return a.value_struct.number;
  const m = /-?\d+(?:[.,]\d+)?/.exec(a.value_name ?? "");
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function unitOf(a: MeliAttributeValue | null): string | null {
  if (!a) return null;
  if (a.value_struct?.unit) return a.value_struct.unit;
  const m = /[\d.,]+\s*(.+)$/.exec(a.value_name ?? "");
  return m ? m[1].trim() : null;
}

/** Superficie en m² (ML también usa "ha" en terrenos). Otra unidad → null (va a notas). */
function areaM2(a: MeliAttributeValue | null): number | null {
  const n = numberOf(a);
  if (n === null || n <= 0) return null;
  const u = norm(unitOf(a) ?? "m²");
  if (u === "m²" || u === "m2" || u === "") return n;
  if (u === "ha") return Math.round(n * 10000);
  return null;
}

const intOf = (a: MeliAttributeValue | null) => {
  const n = numberOf(a);
  return n === null || n < 0 ? null : Math.round(n);
};

const LAYOUT: Record<string, ImportedPropertyDraft["layout"]> = {
  frente: "frente",
  contrafrente: "contrafrente",
  lateral: "lateral",
  interno: "interno",
};
const FACING: Record<string, ImportedPropertyDraft["orientation"]> = { norte: "N", sur: "S", este: "E", oeste: "O" };

/* ───────────────────────────── dirección ───────────────────────────────── */

/** "Calle 7 1234" → { street: "Calle 7", number: "1234" } (en ML la altura va al final). */
export function splitAddress(line: string | null | undefined): { street: string | null; number: string | null } {
  const s = (line ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { street: null, number: null };
  const m = /^(.*\D)\s+(\d{1,6})$/.exec(s);
  return m ? { street: m[1].trim(), number: m[2] } : { street: s, number: null };
}

const httpsOnly = (u: string | undefined | null) => (u && /^https:\/\//.test(u) ? u : u && /^http:\/\//.test(u) ? u.replace(/^http:/, "https:") : null);

/* ───────────────────────────── mapeo ───────────────────────────────────── */

/**
 * Aviso de ML → ficha del CRM. `path` = path_from_root de su categoría;
 * `description` = plain_text de GET /items/{id}/description (o null).
 */
export function mapMeliItemToProperty(item: MeliImportItem, path: CategoryPath | null, description: string | null): ImportMapResult {
  const loc = item.location ?? null;
  const listing: ImportedListing = {
    externalId: item.id,
    permalink: item.permalink ?? null,
    meliStatus: item.status ?? null,
    thumbnail: httpsOnly(item.secure_thumbnail ?? item.thumbnail ?? item.pictures?.[0]?.secure_url ?? item.pictures?.[0]?.url),
    meliLocation: loc
      ? { stateId: loc.state?.id ?? null, cityId: loc.city?.id ?? null, neighborhoodId: loc.neighborhood?.id ?? null }
      : null,
  };
  const title = (item.title ?? "").trim();
  const fail = (reason: string): ImportMapResult => ({ ok: false, reason, listing, title });

  if (path && !isRealEstatePath(path)) return fail("No es un aviso de Inmuebles.");
  const to = typeAndOperation(item, path);
  if ("error" in to) return fail(to.error);
  const currency = item.currency_id === "ARS" || item.currency_id === "USD" ? item.currency_id : null;
  if (!currency) return fail(`La moneda del aviso (${item.currency_id ?? "sin moneda"}) no es pesos ni dólares.`);
  if (!title) return fail("El aviso no tiene título.");

  const unmapped: string[] = [];
  const a = (id: string) => attr(item, id);

  const surfaceTotal = areaM2(a("TOTAL_AREA"));
  const surfaceCovered = areaM2(a("COVERED_AREA"));
  for (const id of ["TOTAL_AREA", "COVERED_AREA"]) {
    const x = a(id);
    if (x && areaM2(x) === null && x.value_name) unmapped.push(`${x.name ?? id}: ${x.value_name}`);
  }

  // Expensas: number_unit en ARS o USD; UVA u otra unidad no se convierte (va a notas).
  let expenses: number | null = null;
  let expensesCurrency: ImportedPropertyDraft["expenses_currency"] = null;
  const fee = a("MAINTENANCE_FEE");
  if (fee) {
    const n = numberOf(fee);
    const u = (unitOf(fee) ?? "").toUpperCase();
    if (n !== null && n >= 0 && (u === "ARS" || u === "USD")) {
      expenses = n;
      expensesCurrency = u;
    } else if (fee.value_name) unmapped.push(`Expensas: ${fee.value_name}`);
  }

  const age = a("PROPERTY_AGE");
  const ageYears = age && norm(unitOf(age) ?? "años").startsWith("ano") ? intOf(age) : null;
  if (age && ageYears === null && age.value_name) unmapped.push(`Antigüedad: ${age.value_name}`);

  const features: string[] = [];
  for (const x of item.attributes ?? []) {
    const chip = BOOLEAN_TO_FEATURE[x.id];
    if (chip) {
      if (isYes(x) && !features.includes(chip)) features.push(chip);
      continue;
    }
    if (HANDLED.has(x.id)) continue;
    // Un booleano en «No» no aporta nada; el resto con valor queda como nota.
    if (isNo(x)) continue;
    const value = (x.value_name ?? "").trim();
    if (value) unmapped.push(`${x.name ?? x.id}: ${value}`);
  }
  const garages = intOf(a("PARKING_LOTS"));
  if (garages !== null && garages > 0 && !features.includes("Cochera")) features.push("Cochera");

  const disp = a("DISPOSITION");
  const layout = disp ? LAYOUT[norm(disp.value_name)] ?? null : null;
  if (disp?.value_name && !layout) unmapped.push(`Disposición: ${disp.value_name}`);
  const facing = a("FACING");
  const orientation = facing ? FACING[norm(facing.value_name)] ?? null : null;
  if (facing?.value_name && !orientation) unmapped.push(`Orientación: ${facing.value_name}`);
  const floorN = a("UNIT_FLOOR");
  const unitA = a("APARTMENT_NUMBER");
  const code = a("PROPERTY_CODE");
  if (code?.value_name) unmapped.push(`Código en Mercado Libre: ${code.value_name}`);

  // Dirección: street_name/street_number si vienen; si no, se separa la altura del address_line.
  let street: string | null = null;
  let streetNumber: string | null = null;
  if (loc?.street_name) {
    street = loc.street_name.trim() || null;
    streetNumber = loc.street_number != null && String(loc.street_number).trim() ? String(loc.street_number).trim() : null;
  } else {
    const sp = splitAddress(loc?.address_line);
    street = sp.street;
    streetNumber = sp.number;
  }
  const hood = loc?.neighborhood?.name?.trim() || null;
  const city = loc?.city?.name?.trim() || null;
  const locality = hood ?? city;
  if (hood && city && norm(hood) !== norm(city)) unmapped.push(`Ciudad (Mercado Libre): ${city}`);
  if (loc?.zip_code) unmapped.push(`Código postal: ${loc.zip_code}`);
  const lat = typeof loc?.latitude === "number" ? loc.latitude : typeof item.geolocation?.latitude === "number" ? item.geolocation.latitude : null;
  const lng = typeof loc?.longitude === "number" ? loc.longitude : typeof item.geolocation?.longitude === "number" ? item.geolocation.longitude : null;

  const photos = (item.pictures ?? [])
    .map((p) => httpsOnly(p.secure_url ?? p.url))
    .filter((u): u is string => !!u);

  const price = typeof item.price === "number" && Number.isFinite(item.price) && item.price > 0 ? item.price : null;

  const draft: ImportedPropertyDraft = {
    title: title.slice(0, 200),
    description: description && description.trim() ? description.trim() : null,
    type: to.type,
    operation: to.operation,
    status: item.status === "active" ? "disponible" : "pausada",
    street,
    street_number: streetNumber,
    locality,
    province: loc?.state?.name?.trim() || null,
    lat: lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? lat : null,
    lng: lat !== null && lng !== null && (lat !== 0 || lng !== 0) ? lng : null,
    price,
    currency,
    expenses,
    expenses_currency: expensesCurrency,
    surface_total: surfaceTotal,
    surface_covered: surfaceCovered,
    rooms: intOf(a("ROOMS")),
    bedrooms: intOf(a("BEDROOMS")),
    bathrooms: intOf(a("FULL_BATHROOMS")),
    garages,
    age_years: ageYears,
    features,
    layout,
    orientation,
    floor: floorN ? (floorN.value_name ?? "").trim() || null : null,
    unit: unitA ? (unitA.value_name ?? "").trim().slice(0, 20) || null : null,
    photos,
  };
  return { ok: true, draft, listing, unmapped };
}

/* ───────────────────────────── duplicados ──────────────────────────────── */

export interface ExistingPropertyLite {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  street: string | null;
  street_number: string | null;
  is_sample?: boolean;
}

/** Aviso ya vinculado a una propiedad del CRM (publicación con external_id). */
export interface ExistingLink {
  crmPropertyId: string;
  externalId: string;
}

export type DuplicateMatch =
  /** Ese aviso ya está vinculado a esta propiedad: reimportar no hace nada. */
  | { kind: "linked"; propertyId: string }
  /** Hay una propiedad con el mismo título, precio y dirección: probablemente la misma. */
  | { kind: "similar"; propertyId: string };

const addressKey = (street: string | null, number: string | null) => norm([street, number].filter(Boolean).join(" ")).replace(/[^a-z0-9 ]/g, "");

/**
 * Dedupe del importador: primero por external_id (exacto), después por
 * coincidencia de título + precio + moneda + dirección (normalizados). Los
 * datos de ejemplo nunca cuentan: no se importa ni se vincula sobre ellos.
 */
export function findImportDuplicate(
  candidate: { externalId: string; title: string; price: number | null; currency: string; street: string | null; street_number: string | null },
  properties: ExistingPropertyLite[],
  links: ExistingLink[],
): DuplicateMatch | null {
  const real = properties.filter((p) => !p.is_sample);
  const link = links.find((l) => l.externalId === candidate.externalId && real.some((p) => p.id === l.crmPropertyId));
  if (link) return { kind: "linked", propertyId: link.crmPropertyId };
  const t = norm(candidate.title);
  const addr = addressKey(candidate.street, candidate.street_number);
  const same = real.find(
    (p) =>
      norm(p.title) === t &&
      p.price === candidate.price &&
      p.currency === candidate.currency &&
      addressKey(p.street, p.street_number) === addr,
  );
  return same ? { kind: "similar", propertyId: same.id } : null;
}
