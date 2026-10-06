/**
 * Carga por voz: forma de los datos que se extraen de un dictado, esquemas
 * JSON para la extracción con Claude (structured outputs) y saneamiento.
 *
 * Lo usan el servidor (api/_lib/proppi/extract.ts) y el navegador
 * (src/lib/voz/*). Sin imports, como el resto de shared/: así también lo
 * puede correr `node --test` sin compilar.
 *
 * Regla: nada fuera de catálogo. Una zona o amenity que no está en las listas
 * del CRM no se inventa en el campo: va a `notes` para que el agente decida.
 */

export const VOZ_OPERATIONS = ["venta", "alquiler", "alquiler_temporal"] as const;
export const VOZ_PROPERTY_TYPES = ["casa", "departamento", "ph", "terreno", "local", "oficina"] as const;
export const VOZ_CURRENCIES = ["USD", "ARS"] as const;

export type VozOperation = (typeof VOZ_OPERATIONS)[number];
export type VozPropertyType = (typeof VOZ_PROPERTY_TYPES)[number];
export type VozCurrency = (typeof VOZ_CURRENCIES)[number];
export type VozKind = "propiedad" | "busqueda";

/** Listas cerradas del CRM con las que se matchea (zonas y amenities). */
export interface VozCatalog {
  zones: string[];
  amenities: string[];
}

export interface VozPropiedad {
  operation: VozOperation | null;
  type: VozPropertyType | null;
  subtype: string | null;
  /** Zona del catálogo del CRM. */
  zone: string | null;
  street: string | null;
  street_number: string | null;
  floor: string | null;
  unit: string | null;
  price: number | null;
  currency: VozCurrency | null;
  expenses: number | null;
  expenses_currency: VozCurrency | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  toilettes: number | null;
  garages: number | null;
  surface_total: number | null;
  surface_covered: number | null;
  age_years: number | null;
  /** Solo amenities del catálogo. */
  features: string[];
  title: string | null;
  description: string | null;
  credit_eligible: boolean | null;
  accepts_swap: boolean | null;
  /** Lo que se dijo y no tiene campo (o no está en catálogo). */
  notes: string[];
}

export interface VozBusqueda {
  contact_name: string | null;
  contact_phone: string | null;
  operation: VozOperation | null;
  property_types: VozPropertyType[];
  zones: string[];
  budget_min: number | null;
  budget_max: number | null;
  currency: VozCurrency | null;
  rooms_min: number | null;
  bedrooms_min: number | null;
  bathrooms_min: number | null;
  surface_min: number | null;
  features: string[];
  /** "en 3 meses", "urgente", "para marzo". */
  timeframe: string | null;
  notes: string[];
}

export type VozData = { kind: "propiedad"; data: VozPropiedad } | { kind: "busqueda"; data: VozBusqueda };

export const MAX_DICTATION_CHARS = 5000;

export function emptyPropiedad(): VozPropiedad {
  return {
    operation: null,
    type: null,
    subtype: null,
    zone: null,
    street: null,
    street_number: null,
    floor: null,
    unit: null,
    price: null,
    currency: null,
    expenses: null,
    expenses_currency: null,
    rooms: null,
    bedrooms: null,
    bathrooms: null,
    toilettes: null,
    garages: null,
    surface_total: null,
    surface_covered: null,
    age_years: null,
    features: [],
    title: null,
    description: null,
    credit_eligible: null,
    accepts_swap: null,
    notes: [],
  };
}

export function emptyBusqueda(): VozBusqueda {
  return {
    contact_name: null,
    contact_phone: null,
    operation: null,
    property_types: [],
    zones: [],
    budget_min: null,
    budget_max: null,
    currency: null,
    rooms_min: null,
    bedrooms_min: null,
    bathrooms_min: null,
    surface_min: null,
    features: [],
    timeframe: null,
    notes: [],
  };
}

/* ── Catálogo ──────────────────────────────────────────────────────────── */

const MAX_CATALOG = 80;
const MAX_ITEM = 60;

/** Para lo que llega del cliente: strings cortos, sin repetir, con tope. */
export function sanitizeCatalog(raw: unknown): VozCatalog {
  const list = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter((s) => s && s.length <= MAX_ITEM))].slice(0, MAX_CATALOG)
      : [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { zones: list(r.zones), amenities: list(r.amenities) };
}

/** Minúsculas, sin tildes y con espacios simples: para comparar contra el catálogo. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El valor exacto del catálogo que corresponde, o null. */
export function matchCatalog(value: string, list: string[]): string | null {
  const v = fold(value);
  if (!v) return null;
  return list.find((x) => fold(x) === v) ?? null;
}

/* ── Esquemas JSON (structured outputs) ───────────────────────────────── */

type Schema = Record<string, unknown>;

const nullable = (s: Schema): Schema => ({ anyOf: [s, { type: "null" }] });
const str = (description?: string): Schema => nullable(description ? { type: "string", description } : { type: "string" });
const int = (description: string): Schema => nullable({ type: "integer", description });
const numb = (description: string): Schema => nullable({ type: "number", description });
const bool = (description: string): Schema => nullable({ type: "boolean", description });
const strEnum = (values: readonly string[], description?: string): Schema =>
  values.length ? { type: "string", enum: [...values], ...(description ? { description } : {}) } : { type: "string" };

function object(properties: Record<string, Schema>): Schema {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const NOTES: Schema = {
  type: "array",
  items: { type: "string" },
  description: "Datos dichos que no tienen campo o no están en el catálogo (zona o amenity desconocidos, horarios, condiciones). Frases cortas.",
};

export function propiedadSchema(c: VozCatalog): Schema {
  return object({
    operation: nullable(strEnum(VOZ_OPERATIONS)),
    type: nullable(strEnum(VOZ_PROPERTY_TYPES, "ph = propiedad horizontal; terreno = lote")),
    subtype: str("Ej.: Chalet, Monoambiente, Dúplex, Lote en barrio cerrado"),
    zone: c.zones.length ? nullable(strEnum(c.zones, "Solo si coincide con una zona del catálogo")) : str(),
    street: str("Calle, sin el número"),
    street_number: str(),
    floor: str("Piso: '3', 'PB'"),
    unit: str("Departamento/unidad: 'B'"),
    price: numb("Precio total en unidades (85 mil = 85000)"),
    currency: nullable(strEnum(VOZ_CURRENCIES)),
    expenses: numb("Expensas mensuales"),
    expenses_currency: nullable(strEnum(VOZ_CURRENCIES)),
    rooms: int("Ambientes"),
    bedrooms: int("Dormitorios"),
    bathrooms: int("Baños completos"),
    toilettes: int(""),
    garages: int("Cocheras"),
    surface_total: numb("m² totales"),
    surface_covered: numb("m² cubiertos"),
    age_years: int("Antigüedad en años (a estrenar = 0)"),
    features: { type: "array", items: strEnum(c.amenities), description: "Solo amenities del catálogo" },
    title: str("Título sugerido para el aviso, 30 a 70 caracteres, sin precio"),
    description: str("Descripción redactada para el aviso, 2 o 3 párrafos breves, solo con lo dictado"),
    credit_eligible: bool("Apto crédito"),
    accepts_swap: bool("Acepta permuta"),
    notes: NOTES,
  });
}

export function busquedaSchema(c: VozCatalog): Schema {
  return object({
    contact_name: str("Nombre del interesado, si se dijo"),
    contact_phone: str("Teléfono del interesado, si se dijo"),
    operation: nullable(strEnum(VOZ_OPERATIONS, "Compra = venta")),
    property_types: { type: "array", items: strEnum(VOZ_PROPERTY_TYPES) },
    zones: { type: "array", items: strEnum(c.zones), description: "Solo zonas del catálogo" },
    budget_min: numb("Presupuesto mínimo"),
    budget_max: numb("Presupuesto máximo ('hasta 100 mil' = 100000)"),
    currency: nullable(strEnum(VOZ_CURRENCIES)),
    rooms_min: int("Ambientes mínimos"),
    bedrooms_min: int("Dormitorios mínimos"),
    bathrooms_min: int("Baños mínimos"),
    surface_min: numb("m² mínimos"),
    features: { type: "array", items: strEnum(c.amenities), description: "Solo amenities del catálogo" },
    timeframe: str("Plazo: 'urgente', 'en 3 meses'"),
    notes: NOTES,
  });
}

/* ── Saneamiento (salida del modelo o del parser local) ──────────────── */

type Rec = Record<string, unknown>;

const pickEnum = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;

function text(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown, { int = false, max = 1e12 } = {}): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max) return null;
  return int ? Math.round(n) : n;
}

const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** Separa lo que está en el catálogo de lo que no (eso va a notas). */
function splitCatalog(v: unknown, list: string[], label: string, notes: string[]): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || !item.trim()) continue;
    const hit = list.length ? matchCatalog(item, list) : item.trim();
    if (hit) {
      if (!out.includes(hit)) out.push(hit);
    } else notes.push(`${label}: ${item.trim()}`);
  }
  return out;
}

function notesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.map((s) => text(s, 300)).filter((s): s is string => !!s).slice(0, 20) : [];
}

export function sanitizePropiedad(raw: unknown, c: VozCatalog): VozPropiedad {
  const r = (raw && typeof raw === "object" ? raw : {}) as Rec;
  const notes = notesOf(r.notes);
  let zone: string | null = null;
  const z = text(r.zone, 80);
  if (z) {
    zone = c.zones.length ? matchCatalog(z, c.zones) : z;
    if (!zone) notes.push(`Zona mencionada: ${z} (no está en la lista de zonas)`);
  }
  const features = splitCatalog(r.features, c.amenities, "Amenity", notes);
  return {
    operation: pickEnum(r.operation, VOZ_OPERATIONS),
    type: pickEnum(r.type, VOZ_PROPERTY_TYPES),
    subtype: text(r.subtype, 60),
    zone,
    street: text(r.street, 120),
    street_number: text(r.street_number, 20),
    floor: text(r.floor, 10),
    unit: text(r.unit, 10),
    price: num(r.price),
    currency: pickEnum(r.currency, VOZ_CURRENCIES),
    expenses: num(r.expenses),
    expenses_currency: pickEnum(r.expenses_currency, VOZ_CURRENCIES),
    rooms: num(r.rooms, { int: true, max: 50 }),
    bedrooms: num(r.bedrooms, { int: true, max: 50 }),
    bathrooms: num(r.bathrooms, { int: true, max: 30 }),
    toilettes: num(r.toilettes, { int: true, max: 20 }),
    garages: num(r.garages, { int: true, max: 30 }),
    surface_total: num(r.surface_total, { max: 1e7 }),
    surface_covered: num(r.surface_covered, { max: 1e7 }),
    age_years: num(r.age_years, { int: true, max: 300 }),
    features,
    title: text(r.title, 120),
    description: text(r.description, 3000),
    credit_eligible: asBool(r.credit_eligible),
    accepts_swap: asBool(r.accepts_swap),
    notes: [...new Set(notes)],
  };
}

export function sanitizeBusqueda(raw: unknown, c: VozCatalog): VozBusqueda {
  const r = (raw && typeof raw === "object" ? raw : {}) as Rec;
  const notes = notesOf(r.notes);
  const types = Array.isArray(r.property_types)
    ? [...new Set(r.property_types.map((t) => pickEnum(t, VOZ_PROPERTY_TYPES)).filter((t): t is VozPropertyType => !!t))]
    : [];
  let budget_min = num(r.budget_min);
  let budget_max = num(r.budget_max);
  if (budget_min !== null && budget_max !== null && budget_min > budget_max) [budget_min, budget_max] = [budget_max, budget_min];
  return {
    contact_name: text(r.contact_name, 80),
    contact_phone: text(r.contact_phone, 40),
    operation: pickEnum(r.operation, VOZ_OPERATIONS),
    property_types: types,
    zones: splitCatalog(r.zones, c.zones, "Zona", notes),
    budget_min,
    budget_max,
    currency: pickEnum(r.currency, VOZ_CURRENCIES),
    rooms_min: num(r.rooms_min, { int: true, max: 50 }),
    bedrooms_min: num(r.bedrooms_min, { int: true, max: 50 }),
    bathrooms_min: num(r.bathrooms_min, { int: true, max: 30 }),
    surface_min: num(r.surface_min, { max: 1e7 }),
    features: splitCatalog(r.features, c.amenities, "Amenity", notes),
    timeframe: text(r.timeframe, 80),
    notes: [...new Set(notes)],
  };
}
