/**
 * Mercado Libre Inmuebles (MLA): mapeo Property del CRM → ítem de la API y
 * validación previa. Funciones PURAS, sin imports: las usan la pantalla
 * (para mostrar "qué falta" antes de tocar el botón) y las funciones de
 * Vercel en api/meli/* (que vuelven a validar del lado servidor).
 *
 * De dónde sale cada regla (todo consultado el 2026-10-05):
 *  [CAT]  API pública de categorías: GET https://api.mercadolibre.com/categories/MLA1459
 *         y sus hijas; GET /categories/{id}/attributes (tags.required). La tabla
 *         MELI_CATEGORIES y MELI_REQUIRED salen de ahí. El servidor igual vuelve
 *         a consultar los atributos en vivo antes de publicar.
 *  [LIST] "List properties" (guía de inmuebles):
 *         https://developers.mercadolibre.com.ar/en_us/list-properties
 *         (buying_mode classified, available_quantity 1, channels marketplace,
 *         condition, location con id de barrio o ciudad, address_line con la
 *         altura al final, descripción en texto plano por POST aparte).
 *  [LOC]  "Locate properties": https://developers.mercadolibre.com.ar/en_us/locate-property
 *         (alcanza con el id de barrio, o de ciudad si la ciudad no tiene barrios).
 *  [PACK] "Gestionar paquetes de inmuebles":
 *         https://developers.mercadolibre.com.ar/es_ar/gestionar-paquetes-de-inmuebles
 *         (silver obligatorio para tener cupo; gold/gold_premium destacan; desde
 *         el 20/01/2026 silver exige al menos una imagen en el POST).
 *  [PIC]  "Trabajar con imágenes": https://developers.mercadolibre.com.ar/es_ar/trabajar-con-imagenes
 *         (JPG/JPEG/PNG, hasta 10 MB, mínimo 500 px, máx. por categoría).
 *  [SYNC] "Sync listings": https://developers.mercadolibre.com.ar/en_us/real-estate-sync-listings
 *         (PUT /items/{id} con status paused/active/closed; closed no vuelve).
 */

export type MeliPropertyType = "casa" | "departamento" | "ph" | "terreno" | "local" | "oficina";
export type MeliOperation = "venta" | "alquiler" | "alquiler_temporal";
export type MeliCurrency = "ARS" | "USD";
export type MeliListingType = "silver" | "gold" | "gold_premium";

export const MELI_LISTING_TYPES: { id: MeliListingType; label: string }[] = [
  { id: "silver", label: "Plata (paquete de publicación)" },
  { id: "gold", label: "Oro (destacado)" },
  { id: "gold_premium", label: "Oro Premium (destacado)" },
];

/** Accesos de terreno que acepta el atributo LAND_ACCESS [CAT MLA401687]. */
export const MELI_LAND_ACCESS: { id: string; label: string }[] = [
  { id: "245046", label: "Asfalto" },
  { id: "245048", label: "Ripio" },
  { id: "245049", label: "Tierra" },
  { id: "245045", label: "Arena" },
  { id: "245047", label: "Otro" },
];

/**
 * Categoría hoja por tipo y operación [CAT]. En venta se usa la hoja
 * "Propiedades Individuales" (los "Emprendimientos" piden datos de desarrollo
 * que el CRM no tiene). `null` = la combinación no existe en Mercado Libre.
 */
export const MELI_CATEGORIES: Record<MeliPropertyType, Record<MeliOperation, string | null>> = {
  casa: { venta: "MLA401685", alquiler: "MLA1467", alquiler_temporal: "MLA50278" },
  departamento: { venta: "MLA401686", alquiler: "MLA1473", alquiler_temporal: "MLA50279" },
  ph: { venta: "MLA105182", alquiler: "MLA105181", alquiler_temporal: "MLA105180" },
  terreno: { venta: "MLA401687", alquiler: "MLA1494", alquiler_temporal: null },
  local: { venta: "MLA79244", alquiler: "MLA79243", alquiler_temporal: null },
  oficina: { venta: "MLA401684", alquiler: "MLA50539", alquiler_temporal: null },
};

/** Atributos con tags.required en cada hoja, al 2026-10-05 [CAT]. */
export const MELI_REQUIRED: Record<string, string[]> = {
  MLA1467: ["TOTAL_AREA", "COVERED_AREA", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA50278: ["TOTAL_AREA", "COVERED_AREA", "GUESTS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA401685: ["TOTAL_AREA", "COVERED_AREA", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA1473: ["TOTAL_AREA", "COVERED_AREA", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA50279: ["TOTAL_AREA", "COVERED_AREA", "GUESTS", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA401686: ["TOTAL_AREA", "COVERED_AREA", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA105181: ["TOTAL_AREA", "COVERED_AREA", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA105180: ["TOTAL_AREA", "COVERED_AREA", "GUESTS", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA105182: ["TOTAL_AREA", "COVERED_AREA", "ROOMS", "BEDROOMS", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA1494: ["TOTAL_AREA", "LAND_ACCESS"],
  MLA401687: ["TOTAL_AREA", "LAND_ACCESS"],
  MLA79243: ["TOTAL_AREA", "COVERED_AREA", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA79244: ["TOTAL_AREA", "COVERED_AREA", "FULL_BATHROOMS", "PARKING_LOTS"],
  MLA50539: ["TOTAL_AREA", "COVERED_AREA", "PARKING_LOTS", "FULL_BATHROOMS"],
  MLA401684: ["TOTAL_AREA", "COVERED_AREA", "PARKING_LOTS", "FULL_BATHROOMS"],
};

/** Nombre legible de cada atributo (el mismo que muestra Mercado Libre). */
export const MELI_ATTRIBUTE_LABEL: Record<string, string> = {
  TOTAL_AREA: "Superficie total",
  COVERED_AREA: "Superficie cubierta",
  ROOMS: "Ambientes",
  BEDROOMS: "Dormitorios",
  FULL_BATHROOMS: "Baños",
  PARKING_LOTS: "Cocheras",
  GUESTS: "Huéspedes",
  LAND_ACCESS: "Acceso del terreno",
  PROPERTY_AGE: "Antigüedad",
  MAINTENANCE_FEE: "Expensas",
};

/**
 * Chips de características del CRM (src/data/seed.ts FEATURE_CHIPS) → atributo
 * booleano de Mercado Libre. Solo se manda "Sí" cuando el chip está marcado:
 * que no esté marcado no significa "No". "Luminoso" y "Cochera" no tienen
 * booleano equivalente (las cocheras van por PARKING_LOTS).
 */
const FEATURE_TO_BOOLEAN: Record<string, string> = {
  "Jardín": "HAS_GARDEN",
  "Balcón": "HAS_BALCONY",
  "Piscina": "HAS_SWIMMING_POOL",
  "Terraza": "HAS_TERRACE",
  "Seguridad": "HAS_SECURITY",
  "Mascotas": "IS_SUITABLE_FOR_PETS",
  "Parrilla": "HAS_GRILL",
};
/** value_id de "Sí" en todos los booleanos de inmuebles [CAT]. */
const YES_VALUE_ID = "242085";

/** Datos de la propiedad que hacen falta para publicar. Todo viene del CRM salvo `location`, `guests` y `landAccess`. */
export interface MeliListingInput {
  type: MeliPropertyType;
  operation: MeliOperation;
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  /** Expensas mensuales en ARS. */
  expenses: number | null;
  surfaceTotal: number | null;
  surfaceCovered: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  ageYears: number | null;
  features: string[];
  street: string | null;
  streetNumber: string | null;
  lat: number | null;
  lng: number | null;
  /** Código interno de la propiedad (PROPERTY_CODE). */
  propertyCode?: string | null;
  /** Ubicación elegida en el árbol de Mercado Libre [LOC]. */
  location: { neighborhoodId?: string | null; cityId?: string | null } | null;
  /** Solo alquiler temporario. */
  guests?: number | null;
  /** Solo terrenos: value_id de LAND_ACCESS. */
  landAccess?: string | null;
}

export interface MeliIssue {
  field: string;
  message: string;
  /** `false` = aviso de calidad: no impide publicar. */
  blocking: boolean;
}

export const MELI_LIMITS = {
  /** max_title_length de MLA1459 [CAT]. */
  titleMax: 200,
  /** max_pictures_per_item de MLA1459 [CAT]. */
  picturesMax: 30,
  /** max_description_length de MLA1459 [CAT]. */
  descriptionMax: 50000,
} as const;

/** Fotos mínimas recomendadas para calidad del aviso, por grupo [LIST "Pictures"]. */
export function recommendedPictures(type: MeliPropertyType): number {
  return type === "terreno" || type === "local" ? 6 : 12;
}

export function categoryFor(type: MeliPropertyType, operation: MeliOperation): string | null {
  return MELI_CATEGORIES[type]?.[operation] ?? null;
}

const isPos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const isNonNeg = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
/** Ids de classified_locations: base64 sin espacios. */
const LOCATION_ID = /^[A-Za-z0-9+/=_-]{4,80}$/;
/** Extensiones que documenta Mercado Libre [PIC]. */
const DOCUMENTED_PICTURE = /\.(jpe?g|png)(\?.*)?$/i;

/**
 * Valor que el CRM manda para cada atributo requerido, o `null` si falta.
 * Los requeridos que el CRM no conoce (p. ej. de emprendimientos) devuelven `undefined`.
 */
function requiredValue(attr: string, p: MeliListingInput): unknown {
  switch (attr) {
    case "TOTAL_AREA": return isPos(p.surfaceTotal) ? p.surfaceTotal : null;
    case "COVERED_AREA": return isPos(p.surfaceCovered) ? p.surfaceCovered : null;
    case "ROOMS": return isPos(p.rooms) ? p.rooms : null;
    case "BEDROOMS": return isNonNeg(p.bedrooms) ? p.bedrooms : null;
    case "FULL_BATHROOMS": return isNonNeg(p.bathrooms) ? p.bathrooms : null;
    case "PARKING_LOTS": return isNonNeg(p.garages) ? p.garages : null;
    case "GUESTS": return isPos(p.guests ?? null) ? p.guests : null;
    case "LAND_ACCESS": return MELI_LAND_ACCESS.some((a) => a.id === p.landAccess) ? p.landAccess : null;
    default: return undefined;
  }
}

const FIX_HINT: Record<string, string> = {
  TOTAL_AREA: "Cargá la superficie total en la ficha de la propiedad.",
  COVERED_AREA: "Cargá la superficie cubierta en la ficha de la propiedad.",
  ROOMS: "Cargá la cantidad de ambientes.",
  BEDROOMS: "Cargá la cantidad de dormitorios (0 si es monoambiente).",
  FULL_BATHROOMS: "Cargá la cantidad de baños.",
  PARKING_LOTS: "Cargá la cantidad de cocheras (0 si no tiene).",
  GUESTS: "Indicá para cuántos huéspedes es el alquiler temporario.",
  LAND_ACCESS: "Elegí el tipo de acceso del terreno.",
};

/**
 * Validación previa. `pictureUrls` son las URLs públicas que se van a mandar
 * (las de la app). `required` permite pasar la lista en vivo de la API; si no,
 * se usa la tabla MELI_REQUIRED.
 */
export function validateMeliListing(
  p: MeliListingInput,
  pictureUrls: string[],
  required?: string[],
): MeliIssue[] {
  const issues: MeliIssue[] = [];
  const block = (field: string, message: string) => issues.push({ field, message, blocking: true });
  const warn = (field: string, message: string) => issues.push({ field, message, blocking: false });

  const categoryId = categoryFor(p.type, p.operation);
  if (!categoryId) {
    block("category", "Mercado Libre no tiene alquiler temporario para este tipo de propiedad.");
    return issues;
  }

  const title = p.title.trim();
  if (title.length === 0) block("title", "Falta el título.");
  else if (title.length > MELI_LIMITS.titleMax) block("title", `El título tiene ${title.length} caracteres; Mercado Libre acepta hasta ${MELI_LIMITS.titleMax}.`);
  else if (title.length < 20) warn("title", "Título corto: Mercado Libre recomienda operación + tipo + ambientes + barrio (p. ej. «Departamento Venta 3 ambientes Tolosa»).");

  const desc = (p.description ?? "").trim();
  if (desc.length === 0) warn("description", "Sin descripción: el aviso se publica igual, pero rinde menos.");
  else if (desc.length > MELI_LIMITS.descriptionMax) block("description", `La descripción supera los ${MELI_LIMITS.descriptionMax} caracteres.`);

  if (!isPos(p.price)) block("price", "Falta el precio.");
  if (p.currency !== "ARS" && p.currency !== "USD") block("currency", "La moneda tiene que ser pesos (ARS) o dólares (USD).");

  for (const attr of required ?? MELI_REQUIRED[categoryId] ?? []) {
    const v = requiredValue(attr, p);
    if (v === null) block(attr, `Falta «${MELI_ATTRIBUTE_LABEL[attr] ?? attr}». ${FIX_HINT[attr] ?? ""}`.trim());
    else if (v === undefined) block(attr, `Mercado Libre pide «${attr}», que PropMatch todavía no carga para esta categoría.`);
  }
  if (isPos(p.surfaceTotal) && isPos(p.surfaceCovered) && p.surfaceCovered > p.surfaceTotal && p.type !== "departamento" && p.type !== "oficina") {
    warn("COVERED_AREA", "La superficie cubierta es mayor que la total: revisá los datos.");
  }

  const loc = p.location;
  const locId = loc?.neighborhoodId || loc?.cityId || "";
  if (!locId) block("location", "Elegí la ciudad y el barrio de Mercado Libre donde está la propiedad.");
  else if (!LOCATION_ID.test(locId)) block("location", "La ubicación elegida no es válida. Volvé a elegirla.");
  if (!(p.street ?? "").trim()) warn("address", "Sin calle: el aviso se va a ver sin dirección.");
  const hasCoords = typeof p.lat === "number" && typeof p.lng === "number";
  if (!hasCoords) warn("coords", "Sin coordenadas: Mercado Libre ubica el aviso por barrio, no en el punto exacto.");

  if (pictureUrls.length === 0) block("pictures", "Hace falta al menos una foto con URL pública (la propiedad tiene que estar sincronizada con la app).");
  else {
    if (pictureUrls.length > MELI_LIMITS.picturesMax) warn("pictures", `Hay ${pictureUrls.length} fotos; se van a mandar las primeras ${MELI_LIMITS.picturesMax}.`);
    const min = recommendedPictures(p.type);
    if (pictureUrls.length < min) warn("pictures", `Hay ${pictureUrls.length} fotos; Mercado Libre recomienda al menos ${min} para este tipo de propiedad.`);
    const odd = pictureUrls.filter((u) => !DOCUMENTED_PICTURE.test(u)).length;
    if (odd > 0) warn("pictures", `${odd} foto(s) no son JPG/PNG (p. ej. WebP). Mercado Libre documenta JPG y PNG: si las rechaza, volvé a subirlas.`);
  }

  return issues;
}

export const isPublishable = (issues: MeliIssue[]) => !issues.some((i) => i.blocking);

interface MeliAttribute {
  id: string;
  value_name?: string;
  value_id?: string;
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Atributos a mandar. `allowed` (ids de la categoría en vivo) filtra lo que la categoría no tiene. */
export function buildMeliAttributes(p: MeliListingInput, allowed?: Set<string>): MeliAttribute[] {
  const out: MeliAttribute[] = [];
  const add = (a: MeliAttribute) => {
    if (!allowed || allowed.has(a.id)) out.push(a);
  };
  if (isPos(p.surfaceTotal)) add({ id: "TOTAL_AREA", value_name: `${num(p.surfaceTotal)} m²` });
  if (isPos(p.surfaceCovered)) add({ id: "COVERED_AREA", value_name: `${num(p.surfaceCovered)} m²` });
  if (isPos(p.rooms)) add({ id: "ROOMS", value_name: String(Math.round(p.rooms)) });
  if (isNonNeg(p.bedrooms)) add({ id: "BEDROOMS", value_name: String(Math.round(p.bedrooms)) });
  if (isNonNeg(p.bathrooms)) add({ id: "FULL_BATHROOMS", value_name: String(Math.round(p.bathrooms)) });
  if (isNonNeg(p.garages)) add({ id: "PARKING_LOTS", value_name: String(Math.round(p.garages)) });
  if (isPos(p.guests ?? null)) add({ id: "GUESTS", value_name: String(Math.round(p.guests!)) });
  if (p.landAccess && MELI_LAND_ACCESS.some((a) => a.id === p.landAccess)) add({ id: "LAND_ACCESS", value_id: p.landAccess });
  if (isNonNeg(p.ageYears)) add({ id: "PROPERTY_AGE", value_name: `${Math.round(p.ageYears)} años` });
  // Expensas: number_unit con unidad de moneda; en el CRM se cargan en pesos.
  if (isNonNeg(p.expenses) && p.expenses > 0) add({ id: "MAINTENANCE_FEE", value_name: `${Math.round(p.expenses)} ARS` });
  if (p.propertyCode) add({ id: "PROPERTY_CODE", value_name: p.propertyCode.slice(0, 60) });
  for (const f of p.features) {
    const id = FEATURE_TO_BOOLEAN[f];
    if (id) add({ id, value_id: YES_VALUE_ID });
  }
  return out;
}

/** "Calle 1234": la altura tiene que ir al final [LIST "Location"]. */
export function addressLine(p: MeliListingInput): string | undefined {
  const street = (p.street ?? "").trim();
  if (!street) return undefined;
  const number = (p.streetNumber ?? "").trim();
  return number ? `${street} ${number}` : street;
}

function buildLocation(p: MeliListingInput) {
  const loc: Record<string, unknown> = {};
  const line = addressLine(p);
  if (line) loc.address_line = line;
  // Alcanza con la hoja: barrio, o ciudad si no tiene barrios [LOC].
  if (p.location?.neighborhoodId) loc.neighborhood = { id: p.location.neighborhoodId };
  else if (p.location?.cityId) loc.city = { id: p.location.cityId };
  if (typeof p.lat === "number" && typeof p.lng === "number") {
    loc.latitude = p.lat;
    loc.longitude = p.lng;
  }
  return loc;
}

/** Texto plano: sin HTML ni emojis [LIST "Description"; descripción de artículos]. */
export function plainDescription(text: string | null): string {
  return (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MELI_LIMITS.descriptionMax);
}

/** Cuerpo de POST /items [LIST "List a real estate property"]. La descripción va aparte. */
export function buildMeliItem(
  p: MeliListingInput,
  pictureUrls: string[],
  listingTypeId: MeliListingType,
  allowedAttributes?: Set<string>,
) {
  const categoryId = categoryFor(p.type, p.operation);
  if (!categoryId) throw new Error("category");
  return {
    title: p.title.trim().slice(0, MELI_LIMITS.titleMax),
    category_id: categoryId,
    price: p.price,
    currency_id: p.currency,
    available_quantity: 1,
    buying_mode: "classified",
    listing_type_id: listingTypeId,
    condition: "not_specified",
    channels: ["marketplace"],
    pictures: pictureUrls.slice(0, MELI_LIMITS.picturesMax).map((source) => ({ source })),
    location: buildLocation(p),
    attributes: buildMeliAttributes(p, allowedAttributes),
  };
}

/**
 * Cuerpo de PUT /items/{id} para sincronizar cambios [SYNC]: título, precio,
 * fotos y atributos. La categoría y la moneda no se tocan (la categoría no se
 * puede cambiar por API) y la ubicación solo si se eligió una.
 */
export function buildMeliUpdate(p: MeliListingInput, pictureUrls: string[], allowedAttributes?: Set<string>) {
  const body: Record<string, unknown> = {
    title: p.title.trim().slice(0, MELI_LIMITS.titleMax),
    price: p.price,
    pictures: pictureUrls.slice(0, MELI_LIMITS.picturesMax).map((source) => ({ source })),
    attributes: buildMeliAttributes(p, allowedAttributes),
  };
  if (p.location?.neighborhoodId || p.location?.cityId) body.location = buildLocation(p);
  return body;
}

export type PublicationStatusLike = "pending" | "published" | "error" | "paused" | "removed";

/** Estado del ítem en Mercado Libre → estado de `property_publications`. */
export function mapMeliItemStatus(item: { status?: string; sub_status?: string[] }): {
  status: PublicationStatusLike;
  message: string | null;
} {
  const sub = item.sub_status ?? [];
  if (sub.includes("pack_quota_exceeded")) {
    return { status: "error", message: "Mercado Libre cerró el aviso: se agotó el cupo del paquete de publicación." };
  }
  switch (item.status) {
    case "active": return { status: "published", message: null };
    case "paused": return { status: "paused", message: sub.length ? `Pausado por Mercado Libre (${sub.join(", ")}).` : null };
    case "closed": return { status: "removed", message: null };
    case "under_review": return { status: "pending", message: "Mercado Libre está revisando el aviso." };
    case "inactive": return { status: "error", message: "El aviso quedó inactivo en Mercado Libre." };
    case "payment_required":
      return { status: "error", message: "El aviso está pendiente de pago en Mercado Libre: falta cupo en un paquete de Inmuebles." };
    default: return { status: "pending", message: null };
  }
}

/** Mensajes de error conocidos de la API → texto para la inmobiliaria. */
const KNOWN_CAUSES: { test: RegExp; text: string }[] = [
  { test: /quota|pack|listing_type\.(not_available|invalid)|no_packages|seller\.unable_to_list/i, text: "Tu cuenta de Mercado Libre no tiene cupo en un paquete de publicación de Inmuebles para ese tipo de aviso." },
  { test: /picture|image/i, text: "Mercado Libre no pudo descargar o aceptar alguna foto." },
  { test: /location|neighborhood|city/i, text: "Mercado Libre no aceptó la ubicación: revisá ciudad y barrio." },
  { test: /official_store/i, text: "La cuenta tiene tienda oficial y Mercado Libre pide el id de la tienda." },
  { test: /title/i, text: "Mercado Libre no aceptó el título." },
  { test: /price|currency/i, text: "Mercado Libre no aceptó el precio o la moneda." },
];

/**
 * Error de la API de ítems (`{ message, error, status, cause: [{ code, message }] }`
 * [LIST "Official Stores"]) → mensaje legible. Nunca incluye tokens.
 */
export function readableMeliError(status: number, body: unknown): string {
  if (status === 401) return "La sesión con Mercado Libre venció. Volvé a conectar la cuenta.";
  if (status === 403) return "Mercado Libre rechazó el permiso para publicar con esta cuenta (¿está habilitada como inmobiliaria?).";
  if (status === 429) return "Mercado Libre está limitando las llamadas. Probá de nuevo en unos segundos.";
  if (status >= 500) return "Mercado Libre no respondió bien. Probá de nuevo en un rato.";
  const b = (body && typeof body === "object" ? body : {}) as { message?: unknown; error?: unknown; cause?: unknown };
  const causes = Array.isArray(b.cause) ? (b.cause as { code?: unknown; message?: unknown; type?: unknown }[]) : [];
  const errors = causes.filter((c) => c.type !== "warning");
  const raw = [
    ...errors.map((c) => `${String(c.code ?? "")} ${String(c.message ?? "")}`),
    String(b.error ?? ""),
    String(b.message ?? ""),
  ].join(" | ");
  const known = KNOWN_CAUSES.find((k) => k.test.test(raw));
  // Sin causas detalladas, ML igual manda `error` y `message` (p. ej. "body.invalid_fields"): se muestran.
  const fromCauses = errors
    .map((c) => String(c.message ?? c.code ?? ""))
    .filter(Boolean)
    .slice(0, 3)
    .join(" · ");
  const fromBody = [b.message, b.error].map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean).join(" · ");
  const detail = (fromCauses || fromBody).slice(0, 300);
  if (known) return detail ? `${known.text} (Detalle: ${detail})` : known.text;
  return detail ? `Mercado Libre rechazó el aviso: ${detail}` : "Mercado Libre rechazó el aviso.";
}

/** Elige el listing type según los paquetes activos (GET /users/{id}/classifieds_promotion_packs) [PACK]. */
export function pickListingType(
  packs: { status?: string; listing_details?: { listing_type_id?: string; remaining_listings?: number; available_listings?: number }[] }[],
  wanted: MeliListingType,
): { ok: true; listingType: MeliListingType } | { ok: false; message: string } {
  const remaining = new Map<string, number>();
  for (const pack of packs) {
    if (pack.status && pack.status !== "active") continue;
    for (const d of pack.listing_details ?? []) {
      if (!d.listing_type_id) continue;
      const left = typeof d.remaining_listings === "number" ? d.remaining_listings : d.available_listings ?? 0;
      remaining.set(d.listing_type_id, (remaining.get(d.listing_type_id) ?? 0) + left);
    }
  }
  if ((remaining.get(wanted) ?? 0) > 0) return { ok: true, listingType: wanted };
  if (remaining.size === 0 || [...remaining.values()].every((n) => n <= 0)) {
    return { ok: false, message: "Tu cuenta de Mercado Libre no tiene un paquete de publicación de Inmuebles activo con cupo. Contratalo en Mercado Libre y volvé a intentar." };
  }
  const label = MELI_LISTING_TYPES.find((t) => t.id === wanted)?.label ?? wanted;
  return { ok: false, message: `No te queda cupo de «${label}». Elegí otro tipo de publicación o ampliá el paquete.` };
}
