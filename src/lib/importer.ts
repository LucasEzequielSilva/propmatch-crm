/**
 * Importación desde Excel / CSV.
 *
 * Ninguna inmobiliaria arranca de cero: tienen la cartera en una planilla
 * propia, en un export de Tokko o de otro CRM. Cada una nombra las columnas
 * distinto ("Celular", "Tel.", "WhatsApp"), escribe precios como "u$s 185.000"
 * y tipos como "Depto". Este módulo traduce todo eso al modelo del CRM, sin
 * interfaz: la pantalla solo muestra lo que devuelve.
 */

import type { NewContactInput, NewPropertyInput, RequirementInput } from "@/data/store";
import type {
  Contact,
  ContactKind,
  ContactStatus,
  CurrencyCode,
  OperationType,
  Property,
  PropertyStatus,
  PropertyType,
} from "@/types/db";
import { normalizeWhatsappNumber } from "./whatsapp";

/* ── Lectura del archivo ─────────────────────────────────────────────────── */

export interface Sheet {
  headers: string[];
  rows: string[][];
}

/** Lee la primera hoja de un .xlsx/.xls/.csv. SheetJS se carga recién acá. */
export async function readSheet(file: File): Promise<Sheet> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const isCsv = /\.(csv|txt)$/i.test(file.name);

  let workbook;
  if (isCsv) {
    // Los CSV de Excel en español vienen con ";" y a veces en Windows-1252.
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buffer);
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const FS = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
    workbook = XLSX.read(text, { type: "string", FS, raw: true });
  } else {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const clean = matrix
    .map((row) => row.map((c) => String(c ?? "").trim()))
    .filter((row) => row.some((c) => c !== ""));
  const [headers = [], ...rows] = clean;
  return { headers, rows };
}

/* ── Campos y mapeo de columnas ──────────────────────────────────────────── */

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface FieldDef<K extends string = string> {
  key: K;
  label: string;
  required?: boolean;
  /** Encabezados que se reconocen para este campo (ya normalizados). */
  synonyms: string[];
  hint?: string;
}

export type Mapping = Record<string, number>; // campo -> índice de columna (-1 = ninguna)

export function autoMap(headers: string[], fields: FieldDef[]): Mapping {
  const normalized = headers.map(normalizeText);
  const mapping: Mapping = Object.fromEntries(fields.map((f) => [f.key, -1]));

  // Todos los candidatos (campo, columna) con qué tan específica es la
  // coincidencia. Se asigna de la más específica a la menos: así "Sup. cubierta
  // m2" va a superficie cubierta y no a total por contener "m2", y "Tipo de
  // propiedad" no se lo queda el campo "tipo".
  const candidates: { key: string; col: number; score: number }[] = [];
  fields.forEach((field) => {
    normalized.forEach((h, col) => {
      if (!h) return;
      for (const syn of field.synonyms) {
        if (h === syn) candidates.push({ key: field.key, col, score: 1000 + syn.length });
        else if (h.split(" ").length <= 5 && ` ${h} `.includes(` ${syn} `)) candidates.push({ key: field.key, col, score: syn.length });
      }
    });
  });
  candidates.sort((x, y) => y.score - x.score);

  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.key] >= 0 || usedCols.has(c.col)) continue;
    mapping[c.key] = c.col;
    usedCols.add(c.col);
  }
  return mapping;
}

const cell = (row: string[], mapping: Mapping, key: string) => {
  const idx = mapping[key];
  return idx !== undefined && idx >= 0 ? (row[idx] ?? "").trim() : "";
};

/* ── Parsers de valores ──────────────────────────────────────────────────── */

/**
 * Número en cualquiera de los formatos que aparecen en planillas argentinas:
 * "185.000", "185000", "1.234,50", "1,234.50", "85 m2", "USD 95.000".
 */
export function parseNumber(raw: string): number | null {
  if (!raw) return null;
  // Las unidades traen dígitos que no son parte del número: "85 m2", "40 m²".
  let s = raw.replace(/m\s*[2²]|mts?\.?\s*2?|metros?\s*cuadrados?/gi, " ").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // El último separador es el decimal.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "185,000" (miles) contra "3,5" (decimal).
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Moneda escrita en el precio o en su propia columna. */
export function parseCurrency(raw: string): CurrencyCode | null {
  const t = normalizeText(raw.replace(/\$/g, " $ "));
  if (/\b(usd|us|u s|dolar|dolares|dls)\b/.test(t) || /u\$s|us\$|u\$d/i.test(raw)) return "USD";
  if (/\b(ars|pesos|peso)\b/.test(t) || /\$/.test(raw)) return "ARS";
  return null;
}

/**
 * Busca la primera palabra clave que aparezca al principio de alguna palabra.
 * Primero mira solo la primera palabra del valor: "Casa de campo" es casa y no
 * terreno, "Depto con cochera" es departamento. Prefijos y no "contiene": así
 * "activ" reconoce "activa" pero no "inactiva".
 */
function pick<T extends string>(raw: string, table: [T, string[]][]): T | null {
  const t = normalizeText(raw);
  if (!t) return null;
  const first = t.split(" ")[0];
  for (const scope of [` ${first}`, ` ${t}`]) {
    for (const [value, words] of table) if (words.some((w) => scope.includes(` ${w}`))) return value;
  }
  return null;
}

export const parsePropertyType = (raw: string) =>
  pick<PropertyType>(raw, [
    ["departamento", ["departamento", "depto", "dpto", "depa", "monoambiente", "duplex"]],
    ["ph", ["ph", "p h", "propiedad horizontal"]],
    ["terreno", ["terreno", "lote", "campo", "fraccion"]],
    ["local", ["local", "comercio", "galpon", "deposito"]],
    ["oficina", ["oficina", "consultorio"]],
    ["casa", ["casa", "chalet", "quinta", "vivienda"]],
  ]);

export const parseOperation = (raw: string) =>
  pick<OperationType>(raw, [
    ["alquiler_temporal", ["temporal", "temporario", "vacacional"]],
    ["alquiler", ["alquiler", "alquila", "renta", "locacion"]],
    ["venta", ["venta", "vende", "compra", "compra venta"]],
  ]);

export const parseContactKind = (raw: string) =>
  pick<ContactKind>(raw, [
    ["propietario", ["propietari", "duen", "vendedor", "locador"]],
    ["inquilino", ["inquilin", "locatari", "alquila"]],
    ["inversor", ["inversor", "inversion"]],
    ["comprador", ["comprador", "compra", "cliente", "interesado", "lead"]],
  ]);

export const parsePropertyStatus = (raw: string) =>
  pick<PropertyStatus>(raw, [
    ["reservada", ["reservad", "senad", "señad"]],
    ["vendida", ["vendid"]],
    ["alquilada", ["alquilad"]],
    ["pausada", ["pausad", "suspendid", "retirad", "inactiv"]],
    ["disponible", ["disponible", "activ", "publicad", "en venta"]],
  ]);

/** Links (fotos): se separan por coma, punto y coma, barra vertical o espacios, nunca por "/" (es parte del link). */
const splitUrls = (raw: string) =>
  raw
    .split(/[\s,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const splitList = (raw: string) =>
  raw
    .split(/[,;/|]| y /)
    .map((s) => s.trim())
    .filter(Boolean);

const cleanEmail = (raw: string) => {
  const m = raw.match(/[^\s<>;,]+@[^\s<>;,]+\.[^\s<>;,]+/);
  return m ? m[0].toLowerCase() : null;
};

/* ── Contactos ───────────────────────────────────────────────────────────── */

export const CONTACT_FIELDS: FieldDef[] = [
  { key: "full_name", label: "Nombre completo", required: true, synonyms: ["nombre completo", "nombre y apellido", "apellido y nombre", "contacto", "cliente", "nombre"] },
  { key: "last_name", label: "Apellido", synonyms: ["apellido", "apellidos"], hint: "Se suma al nombre si viene aparte" },
  { key: "phone", label: "Teléfono", synonyms: ["telefono", "celular", "movil", "whatsapp", "tel", "cel", "telefono celular"] },
  { key: "email", label: "Email", synonyms: ["email", "e mail", "mail", "correo", "correo electronico"] },
  { key: "kind", label: "Tipo de contacto", synonyms: ["tipo", "tipo de contacto", "categoria", "rol"], hint: "comprador, inquilino, propietario, inversor" },
  { key: "notes", label: "Notas", synonyms: ["notas", "observaciones", "comentarios", "nota", "obs"] },
  { key: "search_operation", label: "Busca: operación", synonyms: ["operacion", "busca operacion", "operacion buscada"] },
  { key: "search_type", label: "Busca: tipo de propiedad", synonyms: ["tipo de propiedad", "busca tipo", "tipo buscado", "propiedad buscada", "busca"] },
  { key: "search_zones", label: "Busca: zonas", synonyms: ["zona", "zonas", "barrio", "barrios", "localidad", "zona buscada"] },
  { key: "budget_min", label: "Presupuesto mínimo", synonyms: ["presupuesto minimo", "precio minimo", "desde", "min"] },
  { key: "budget_max", label: "Presupuesto máximo", synonyms: ["presupuesto", "presupuesto maximo", "precio maximo", "hasta", "max"] },
  { key: "bedrooms_min", label: "Dormitorios mínimos", synonyms: ["dormitorios", "habitaciones", "dormitorios minimos", "cuartos"] },
];

export interface Draft<T> {
  row: number; // fila del archivo (1 = encabezado)
  input: T | null;
  errors: string[];
  warnings: string[];
  duplicate: string | null; // nombre de lo que ya existe
  /** Id de la propiedad que ya está en el CRM, cuando el repetido es contra algo ya cargado. */
  existingId?: string;
}

export function buildContactDrafts(
  sheet: Sheet,
  mapping: Mapping,
  existing: Contact[],
  ownerId: string,
): Draft<NewContactInput>[] {
  const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [normalizeWhatsappNumber(c.phone), c]));
  const byEmail = new Map(existing.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));
  const seenInFile = new Set<string>();

  return sheet.rows.map((row, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const get = (k: string) => cell(row, mapping, k);

    const name = [get("full_name"), get("last_name")].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!name) errors.push("Falta el nombre");

    const phoneRaw = get("phone");
    const phone = phoneRaw || null;
    if (phoneRaw && !normalizeWhatsappNumber(phoneRaw)) warnings.push("Teléfono con formato raro");
    const emailRaw = get("email");
    const email = emailRaw ? cleanEmail(emailRaw) : null;
    if (emailRaw && !email) warnings.push("Email inválido, se omite");
    if (!phone && !email) warnings.push("Sin teléfono ni email");

    const kindRaw = get("kind");
    const kind = parseContactKind(kindRaw) ?? "comprador";
    if (kindRaw && !parseContactKind(kindRaw)) warnings.push(`Tipo "${kindRaw}" no reconocido: queda como comprador`);

    // Búsqueda: solo si trae algún criterio. Sin esto el contacto no genera matches.
    const types = splitList(get("search_type")).map(parsePropertyType).filter((t): t is PropertyType => !!t);
    const zones = splitList(get("search_zones"));
    const budgetMaxRaw = get("budget_max");
    const budgetMinRaw = get("budget_min");
    const budget_max = parseNumber(budgetMaxRaw);
    const budget_min = parseNumber(budgetMinRaw);
    const bedrooms_min = parseNumber(get("bedrooms_min"));
    const hasSearch = types.length > 0 || zones.length > 0 || budget_max !== null || budget_min !== null;
    const requirement: RequirementInput | null = hasSearch
      ? {
          label: null,
          operation: parseOperation(get("search_operation")) ?? (kind === "inquilino" ? "alquiler" : "venta"),
          property_types: types,
          zones,
          budget_min,
          budget_max,
          currency: parseCurrency(budgetMaxRaw || budgetMinRaw) ?? "USD",
          bedrooms_min: bedrooms_min !== null ? Math.round(bedrooms_min) : null,
          bathrooms_min: null,
          surface_min: null,
          surface_max: null,
          features: [],
        }
      : null;

    const dup =
      (phone && byPhone.get(normalizeWhatsappNumber(phone))) || (email && byEmail.get(email)) || undefined;
    const fileKey = normalizeWhatsappNumber(phone) ?? email ?? normalizeText(name);
    let duplicate = dup ? dup.full_name : null;
    if (!duplicate && fileKey && seenInFile.has(fileKey)) duplicate = "otra fila de este archivo";
    if (fileKey) seenInFile.add(fileKey);

    const input: NewContactInput | null = errors.length
      ? null
      : {
          full_name: name,
          phone,
          email,
          kind,
          status: "nuevo" as ContactStatus,
          profile_type: null,
          notes: get("notes") || null,
          owner_id: ownerId,
          requirement,
        };

    return { row: i + 2, input, errors, warnings, duplicate };
  });
}

/* ── Propiedades ─────────────────────────────────────────────────────────── */

export const PROPERTY_FIELDS: FieldDef[] = [
  { key: "title", label: "Título", synonyms: ["titulo", "titulo aviso", "nombre", "aviso", "publicacion"], hint: "Si falta, se arma con tipo y zona" },
  { key: "type", label: "Tipo", required: true, synonyms: ["tipo", "tipo de propiedad", "tipologia", "categoria"] },
  { key: "operation", label: "Operación", synonyms: ["operacion", "tipo de operacion", "venta alquiler"] },
  { key: "price", label: "Precio", required: true, synonyms: ["precio", "valor", "monto", "precio venta", "precio publicado"] },
  { key: "currency", label: "Moneda", synonyms: ["moneda", "divisa"], hint: "Si falta, se detecta del precio (u$s, $)" },
  { key: "street", label: "Calle", synonyms: ["calle", "direccion", "domicilio", "ubicacion"] },
  { key: "street_number", label: "Altura", synonyms: ["altura", "numero", "nro", "n"] },
  { key: "locality", label: "Barrio / localidad", synonyms: ["barrio", "localidad", "zona", "ciudad", "partido"] },
  { key: "province", label: "Provincia", synonyms: ["provincia"] },
  { key: "surface_total", label: "Sup. total (m²)", synonyms: ["superficie total", "sup total", "m2 totales", "superficie", "metros", "m2"] },
  { key: "surface_covered", label: "Sup. cubierta (m²)", synonyms: ["superficie cubierta", "sup cubierta", "m2 cubiertos", "cubierta"] },
  { key: "rooms", label: "Ambientes", synonyms: ["ambientes", "amb", "cantidad de ambientes"] },
  { key: "bedrooms", label: "Dormitorios", synonyms: ["dormitorios", "habitaciones", "cuartos", "dorm"] },
  { key: "bathrooms", label: "Baños", synonyms: ["banos", "bano"] },
  { key: "garages", label: "Cocheras", synonyms: ["cocheras", "cochera", "garage", "garajes"] },
  { key: "age_years", label: "Antigüedad (años)", synonyms: ["antiguedad", "anos", "edad"] },
  { key: "expenses", label: "Expensas", synonyms: ["expensas"] },
  { key: "status", label: "Estado", synonyms: ["estado", "situacion"] },
  { key: "description", label: "Descripción", synonyms: ["descripcion", "detalle", "comentarios", "observaciones"] },
  { key: "photo", label: "Foto (URL)", synonyms: ["foto", "fotos", "imagen", "url foto", "link foto"], hint: "Links separados por coma" },
];

/** Link de la publicación original que el exportador deja al final de la descripción. */
export function sourceUrlOf(description: string | null | undefined): string | null {
  const m = (description ?? "").match(/Fuente:\s*(https?:\/\/\S+)/i);
  return m ? m[1].replace(/[).,;]+$/, "").toLowerCase() : null;
}

export function buildPropertyDrafts(
  sheet: Sheet,
  mapping: Mapping,
  existing: Property[],
  agentId: string,
  defaultProvince: string,
): Draft<NewPropertyInput & { photos: string[] }>[] {
  // Repetido = misma dirección Y mismo título y precio. Solo la calle no alcanza: muchas webs
  // publican direcciones aproximadas ("Av. de los Lagos al 100") para varias propiedades.
  // La descripción entra en la clave (recortada): distingue lotes o unidades con mismo título y precio.
  const key = (street: string | null, number: string | null, title: string, price: number | null, description: string | null) =>
    normalizeText(`${street ?? ""} ${number ?? ""} ${title} ${price ?? ""} ${(description ?? "").slice(-300)}`);
  const existingKeys = new Map(existing.map((p) => [key(p.street, p.street_number, p.title, p.price, p.description), p]));
  // Si la descripción trae el link de la publicación original ("Fuente: https://…"),
  // ese link identifica la propiedad aunque el texto o el precio hayan cambiado en la web.
  const existingBySource = new Map<string, Property>();
  for (const p of existing) {
    const src = sourceUrlOf(p.description);
    if (src && !existingBySource.has(src)) existingBySource.set(src, p);
  }
  const seenInFile = new Set<string>();

  return sheet.rows.map((row, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const get = (k: string) => cell(row, mapping, k);

    const typeRaw = get("type");
    const type = parsePropertyType(typeRaw) ?? parsePropertyType(get("title"));
    if (!type) errors.push(typeRaw ? `Tipo "${typeRaw}" no reconocido` : "Falta el tipo");

    const priceRaw = get("price");
    const price = parseNumber(priceRaw);
    if (price === null) errors.push("Falta el precio");
    const currency = parseCurrency(get("currency")) ?? parseCurrency(priceRaw);
    if (price !== null && !currency) warnings.push("Sin moneda: se asume USD");

    const operationRaw = get("operation");
    const operation = parseOperation(operationRaw) ?? "venta";
    if (operationRaw && !parseOperation(operationRaw)) warnings.push(`Operación "${operationRaw}" no reconocida: venta`);

    let street = get("street") || null;
    let street_number = get("street_number") || null;
    // "Calle 13 450" en una sola columna: se separa la altura.
    if (street && !street_number) {
      const m = street.match(/^(.*\D)\s+(\d{1,5})$/);
      if (m && !/^calle\s*\d+$/i.test(street)) {
        street = m[1].trim();
        street_number = m[2];
      }
    }
    const locality = get("locality") || null;
    if (!locality) warnings.push("Sin barrio: el matching por zona no va a funcionar");

    const title =
      get("title") ||
      [type ? { casa: "Casa", departamento: "Departamento", ph: "PH", terreno: "Terreno", local: "Local", oficina: "Oficina" }[type] : null, locality ? `en ${locality}` : null]
        .filter(Boolean)
        .join(" ");

    const statusRaw = get("status");
    const status = parsePropertyStatus(statusRaw) ?? "disponible";
    const bedrooms = parseNumber(get("bedrooms"));
    const rooms = parseNumber(get("rooms"));
    const photos = splitUrls(get("photo")).filter((u) => /^https?:\/\//.test(u));

    const k = key(street, street_number, title, price, get("description") || null);
    const dup = existingKeys.get(k) ?? (sourceUrlOf(get("description")) ? existingBySource.get(sourceUrlOf(get("description"))!) : undefined);
    let duplicate = dup ? dup.title : null;
    if (!duplicate && seenInFile.has(k)) duplicate = "otra fila de este archivo";
    seenInFile.add(k);

    const input = errors.length
      ? null
      : {
          title,
          description: get("description") || null,
          type: type!,
          operation,
          status,
          street,
          street_number,
          locality,
          province: get("province") || defaultProvince,
          price,
          currency: currency ?? ("USD" as CurrencyCode),
          expenses: parseNumber(get("expenses")),
          taxes: null,
          commission_pct: null,
          surface_total: parseNumber(get("surface_total")),
          surface_covered: parseNumber(get("surface_covered")),
          // Sin columna de ambientes se deja sin definir: el store estima dormitorios + 1.
          ...(rooms !== null && rooms > 0 ? { rooms: Math.round(rooms) } : {}),
          bedrooms: bedrooms !== null ? Math.round(bedrooms) : 0,
          bathrooms: Math.round(parseNumber(get("bathrooms")) ?? 0),
          garages: Math.round(parseNumber(get("garages")) ?? 0),
          age_years: parseNumber(get("age_years")),
          features: [],
          owner_agent_id: agentId,
          owner_contact_id: null,
          authorization_type: null,
          authorization_expires_at: null,
          photos,
        };

    return { row: i + 2, input, errors, warnings, duplicate, existingId: dup?.id };
  });
}

/* ── Plantillas ──────────────────────────────────────────────────────────── */

export const CONTACT_TEMPLATE: string[][] = [
  ["Nombre", "Apellido", "Celular", "Email", "Tipo", "Operación", "Tipo de propiedad", "Zonas", "Presupuesto máximo", "Dormitorios", "Notas"],
  ["Martín", "Rodríguez", "0221 15 444-5566", "martin@email.com", "Comprador", "Venta", "Casa", "City Bell, Gonnet", "USD 190.000", "3", "Quiere mudarse antes de fin de año"],
  ["Graciela", "Benítez", "+54 221 520 1144", "", "Propietario", "", "", "", "", "", "Dueña de la casa de calle 13"],
];

export const PROPERTY_TEMPLATE: string[][] = [
  ["Título", "Tipo", "Operación", "Precio", "Calle", "Altura", "Barrio", "Sup. total", "Sup. cubierta", "Dormitorios", "Baños", "Cocheras", "Antigüedad", "Expensas", "Estado", "Descripción", "Foto"],
  ["Casa moderna en City Bell", "Casa", "Venta", "u$s 185.000", "Calle 13", "450", "City Bell", "220", "180", "3", "2", "2", "0", "", "Disponible", "A estrenar con jardín", "https://…"],
  ["", "Depto", "Alquiler", "$ 450.000", "Calle 7", "1220", "La Plata Centro", "85", "78", "2", "1", "0", "8", "45.000", "Disponible", "", ""],
];
