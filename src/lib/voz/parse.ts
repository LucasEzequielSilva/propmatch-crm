/**
 * Parser LOCAL de dictados (sin IA). Es el plan B de la carga por voz: se usa
 * en la demo, cuando Proppi no está activo o cuando la extracción con Claude
 * falla. Reconoce lo básico en español rioplatense con reglas:
 *
 *   "venta / alquiler / temporario", tipos ("depto", "PH", "lote"…),
 *   "2 ambientes", "3 dormitorios", "1 baño", "2 cocheras",
 *   "85 mil dólares", "USD 85.000", "120 mil pesos", "expensas 50 mil",
 *   "80 metros" (cubiertos / totales), "a estrenar", "15 años de antigüedad",
 *   "con balcón / cochera / pileta…", zonas del catálogo, "apto crédito",
 *   "acepta permuta", y para búsquedas "hasta / desde / entre", plazo y nombre.
 *
 * Solo imports de tipos: `node --test` lo corre sin compilar (npm run test:voz).
 * Nunca devuelve valores fuera del catálogo que recibe.
 */
import type { VozBusqueda, VozCatalog, VozCurrency, VozOperation, VozPropertyType, VozPropiedad } from "../../../shared/voz";

/* ── Normalización ─────────────────────────────────────────────────────── */

function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const WORD_NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
};

const UNIT_WORDS =
  "ambientes?|dormitorios?|habitacion(?:es)?|cuartos?|banos?|cocheras?|garages?|garajes?|toilettes?|meses|mes|anos?|semanas?|mil|millon(?:es)?|palos?|lucas|metros|plantas?|pisos?";

/** "dos ambientes" → "2 ambientes" (solo antes de una unidad: "una casa" queda igual). */
function wordsToDigits(t: string): string {
  const re = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})\\s+(?=(?:${UNIT_WORDS})\\b)`, "g");
  return t.replace(re, (_, w: string) => `${WORD_NUMBERS[w]} `);
}

function prepare(text: string): string {
  return wordsToDigits(fold(text))
    .replace(/m²|m2\b|mts2?\b|mt2\b/g, " metros")
    .replace(/\bu\$d\b|\bu\$s|\bus\$|\busd\b|\bu s d\b/g, " usd ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Operación y tipo ──────────────────────────────────────────────────── */

function findOperation(t: string): VozOperation | null {
  if (/\b(alquiler(?:es)? temporario|alquiler temporal|temporari[oa]s?|por temporada|temporada)\b/.test(t)) return "alquiler_temporal";
  const venta = t.search(/\b(venta|vendo|vende|vender|se vende|compra|comprar|compraria)\b/);
  const alquiler = t.search(/\b(alquiler|alquilo|alquila|alquilar|alquilaria|renta)\b/);
  if (venta < 0 && alquiler < 0) return null;
  if (venta < 0) return "alquiler";
  if (alquiler < 0) return "venta";
  return venta < alquiler ? "venta" : "alquiler";
}

const TYPE_PATTERNS: [VozPropertyType, RegExp][] = [
  ["ph", /\b(ph|p ?h|propiedad horizontal)\b/g],
  ["departamento", /\b(departamentos?|deptos?|dptos?|monoambientes?|semipiso|loft|penthouse)\b/g],
  ["casa", /\b(casas?|chalets?|casa quinta|quinta)\b/g],
  ["terreno", /\b(terrenos?|lotes?|fraccion)\b/g],
  ["local", /\b(locales?|local comercial|local a la calle)\b/g],
  ["oficina", /\b(oficinas?|consultorios?)\b/g],
];

/** Tipos en el orden en que se mencionan. */
function findTypes(t: string): VozPropertyType[] {
  const hits: { type: VozPropertyType; at: number }[] = [];
  for (const [type, re] of TYPE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      // "departamento B" / "depto 3" como unidad no es un tipo si ya hubo otro antes; se resuelve abajo por posición.
      // "lote de 300 metros" en una casa: queda después de "casa" y se ignora para la propiedad.
      // "local" como adjetivo es raro en un dictado inmobiliario.
      hits.push({ type, at: m.index ?? 0 });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.type))];
}

const SUBTYPE_PATTERNS: [RegExp, string][] = [
  [/\bmonoambiente\b/, "Monoambiente"],
  [/\bcasa quinta\b/, "Casa quinta"],
  [/\bchalet\b/, "Chalet"],
  [/\bduplex\b/, "Dúplex"],
  [/\bloft\b/, "Loft"],
  [/\bsemipiso\b/, "Semipiso"],
  [/\bpenthouse\b/, "Penthouse"],
  [/\bph al frente\b/, "PH al frente"],
  [/\bph interno\b/, "PH interno"],
  [/\blote en barrio cerrado\b|\bbarrio cerrado\b/, "Lote en barrio cerrado"],
  [/\bconsultorio\b/, "Consultorio"],
  [/\blocal a la calle\b/, "Local a la calle"],
  [/\blocal en galeria\b/, "Local en galería"],
  [/\bprefabricada\b/, "Prefabricada"],
];

function findSubtype(t: string): string | null {
  for (const [re, label] of SUBTYPE_PATTERNS) if (re.test(t)) return label;
  return null;
}

/* ── Plata ─────────────────────────────────────────────────────────────── */

interface Money {
  value: number;
  currency: VozCurrency | null;
  hasMultiplier: boolean;
  multiplier: number;
  at: number;
  before: string;
}

const MONEY_RE =
  /(?:(usd|\$)\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?:\s*(mil|millones|millon|palos?|lucas|k)\b)?(?:\s*(?:de\s+)?(dolares|dolar|usd|verdes|pesos|ars)\b)?/g;

const NOT_MONEY_AFTER = /^\s*(metros|ambientes?|amb\b|dormitorios?|habitacion|cuartos?|banos?|cocheras?|garages?|garajes?|toilettes?|anos?|meses|mes\b|semanas?|pisos?|plantas?|hs\b|horas?|por ciento|%)/;
const MONEY_CONTEXT = /(precio|vale|valor|sale|piden|pide|pedimos|cuesta|tasad[ao]|presupuesto|hasta|desde|entre|tope|maximo|minimo|expensas|alquiler de|a partir de|no mas de|mensuales?|por mes)\W*(?:de\s+|en\s+|unos?\s+|los\s+|es\s+)*$/;

function amountOf(num: string, mult: string | undefined): number {
  let n: number;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(num)) n = Number(num.replace(/\./g, "").replace(",", "."));
  else n = Number(num.replace(",", "."));
  const m = !mult ? 1 : mult === "mil" || mult === "lucas" || mult === "k" ? 1e3 : 1e6;
  return Math.round(n * m);
}

function findMoney(t: string): Money[] {
  const out: Money[] = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    // Que el número no sea la cola de otra palabra/número ("a2", "12.5" ya consumido).
    if (at > 0 && /[a-z0-9]/.test(t[at - 1])) continue;
    const pre = m[1];
    const suf = m[4];
    const mult = m[3];
    const currency: VozCurrency | null =
      pre === "usd" || suf === "dolares" || suf === "dolar" || suf === "usd" || suf === "verdes"
        ? "USD"
        : pre === "$" || suf === "pesos" || suf === "ars"
          ? "ARS"
          : null;
    const before = t.slice(Math.max(0, at - 30), at);
    if (!currency && !mult) {
      if (NOT_MONEY_AFTER.test(t.slice(end))) continue;
      const rangeTail = /entre\s+\S+\s*(?:usd|\$)?\s*\d[\d.,]*\s*(?:mil|millones)?\s*(?:y|a)\s*$/.test(before) || /entre\s+(?:usd\s*|\$\s*)?$/.test(before);
      if (!MONEY_CONTEXT.test(before) && !rangeTail) continue;
    }
    if (!currency && mult && NOT_MONEY_AFTER.test(t.slice(end))) continue;
    out.push({ value: amountOf(m[2], mult), currency, hasMultiplier: !!mult, multiplier: mult ? amountOf("1", mult) : 1, at, before });
  }
  return out;
}

/** "expensas 50 mil" sí; "expensas 50 mil, precio 85 mil" no (para el segundo monto). */
function isExpenses(m: Money): boolean {
  const i = m.before.lastIndexOf("expensas");
  return i >= 0 && !/\d/.test(m.before.slice(i));
}

/* ── Conteos y superficies ─────────────────────────────────────────────── */

function count(t: string, unit: string): number | null {
  const m = new RegExp(`\\b(\\d{1,2})\\s*(?:${unit})\\b`).exec(t);
  return m ? Number(m[1]) : null;
}

const ROOMS = "ambientes?|amb";
const BEDROOMS = "dormitorios?|dorm|habitaciones|habitacion|cuartos?";
const BATHS = "banos?";
const GARAGES = "cocheras?|garages?|garajes?";
const TOILETTES = "toilettes?";

function surfaces(t: string): { total: number | null; covered: number | null; plain: number | null } {
  let total: number | null = null;
  let covered: number | null = null;
  let plain: number | null = null;
  const re = /(\d{1,3}(?:\.\d{3})+|\d+(?:,\d+)?)\s*metros(?:\s*cuadrados)?(\s*(?:cubiertos?|totales?|de terreno|de lote|propios?|descubiertos?|semicubiertos?))?/g;
  for (const m of t.matchAll(re)) {
    const n = Number(m[1].replace(/\./g, "").replace(",", "."));
    const q = (m[2] ?? "").trim();
    const before = t.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    if (/descubiert|semicubiert/.test(q)) continue;
    if (/cubiert/.test(q)) covered ??= n;
    else if (/total|terreno|lote/.test(q) || /(terreno|lote) de\s*$/.test(before)) total ??= n;
    else if (/cubiert/.test(before)) covered ??= n;
    else plain ??= n;
  }
  return { total, covered, plain };
}

function age(t: string): number | null {
  if (/\ba estrenar\b|\bnuev[oa] a estrenar\b/.test(t)) return 0;
  const m =
    /\b(\d{1,3})\s*anos? de antiguedad\b/.exec(t) ??
    /\bantiguedad(?: de)?\s*(\d{1,3})\s*anos?\b/.exec(t) ??
    /\btiene\s*(\d{1,3})\s*anos?\b/.exec(t);
  return m ? Number(m[1]) : null;
}

/* ── Catálogos ─────────────────────────────────────────────────────────── */

/** Sinónimos dichos → nombre del amenity en el catálogo (se usa solo si existe ahí). */
const AMENITY_SYNONYMS: [RegExp, string][] = [
  [/\bbalcon(?:es)?\b/, "Balcón"],
  [/\b(?:cochera|garage|garaje)s?\b/, "Cochera"],
  [/\b(?:pileta|piscina)s?\b/, "Piscina"],
  [/\b(?:jardin|parque)(?:es)?\b/, "Jardín"],
  [/\bterrazas?\b/, "Terraza"],
  [/\b(?:parrillas?|quinchos?|asador)\b/, "Parrilla"],
  [/\bseguridad (?:las )?24\b|\bvigilancia (?:las )?24\b/, "Seguridad 24 hs"],
  [/\b(?:seguridad|vigilancia)\b(?! (?:las )?24)/, "Seguridad"],
  [/\b(?:acepta |apto )?mascotas\b|\bpet friendly\b/, "Mascotas"],
  [/\bluminos[oa]\b/, "Luminoso"],
  [/\b(?:gimnasio|gym)\b/, "Gimnasio"],
  [/\bsolarium\b/, "Solarium"],
  [/\bsum\b|\bsalon de usos multiples\b/, "SUM"],
  [/\blavadero\b/, "Lavadero"],
  [/\baire acondicionado\b|\bsplits?\b|\bcon aire\b/, "Aire acondicionado"],
  [/\bascensor(?:es)?\b/, "Ascensor"],
  [/\bplacard(?:s|es)?\b|\bplacares\b/, "Placards"],
  [/\bapto profesional\b/, "Apto profesional"],
];

function negated(t: string, at: number): boolean {
  return /\b(sin|no tiene|no hay|no acepta|no)\s+(?:\w+\s+)?$/.test(t.slice(Math.max(0, at - 18), at));
}

function catalogHit(name: string, list: string[]): string | null {
  const f = fold(name);
  return list.find((x) => fold(x) === f) ?? null;
}

function findAmenities(t: string, catalog: string[]): string[] {
  const hits: { name: string; at: number; end: number }[] = [];
  const overlaps = (at: number, end: number) => hits.some((h) => at < h.end && end > h.at);
  const add = (name: string | null, at: number, end: number) => {
    if (!name || overlaps(at, end) || hits.some((h) => h.name === name)) return;
    hits.push({ name, at, end });
  };
  for (const [re, name] of AMENITY_SYNONYMS) {
    for (const hit of t.matchAll(new RegExp(re.source, "g"))) {
      const at = hit.index ?? 0;
      if (negated(t, at)) continue;
      add(catalogHit(name, catalog), at, at + hit[0].length);
      break;
    }
  }
  // Cualquier otro amenity del catálogo nombrado tal cual.
  for (const a of catalog) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(fold(a))}(?=[^a-z0-9]|$)`, "g");
    for (const m of t.matchAll(re)) {
      const at = (m.index ?? 0) + m[1].length;
      if (!negated(t, at)) add(a, at, at + fold(a).length);
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

function findZones(t: string, zones: string[]): string[] {
  const hits: { zone: string; at: number }[] = [];
  for (const z of zones) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(fold(z))}([^a-z0-9]|$)`);
    const m = re.exec(t);
    if (m) hits.push({ zone: z, at: m.index });
  }
  // "La Plata Norte" contiene "La Plata": se queda la más larga que arranca en el mismo lugar.
  hits.sort((a, b) => a.at - b.at || b.zone.length - a.zone.length);
  const out: string[] = [];
  for (const h of hits) if (!out.some((o) => fold(o).includes(fold(h.zone)))) out.push(h.zone);
  return out;
}

const NOT_PLACES = new Set([
  "venta", "alquiler", "dolares", "pesos", "usd", "planta", "planta baja", "pozo",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
]);

/** Lugares nombrados con mayúscula que no están en el catálogo: van a notas. */
function unknownPlaces(original: string, zones: string[], known: string[]): string[] {
  const out: string[] = [];
  const re = /\b(?:barrio|zona|en)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)(?:\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)*)/g;
  for (const m of original.matchAll(re)) {
    const place = m[1].trim();
    const f = fold(place);
    if (NOT_PLACES.has(f) || known.some((k) => fold(k) === f)) continue;
    if (zones.some((z) => fold(z).includes(f) || f.includes(fold(z)))) continue;
    if (!out.includes(place)) out.push(place);
  }
  return out;
}

/* ── Otros datos ───────────────────────────────────────────────────────── */

function flag(t: string, yes: RegExp, no: RegExp): boolean | null {
  if (no.test(t)) return false;
  if (yes.test(t)) return true;
  return null;
}

function floorOf(t: string): string | null {
  if (/\bplanta baja\b|\bpb\b/.test(t)) return "PB";
  const m = /\bpiso\s*(\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})\s*(?:º|°|er|ero|do|to|vo|no|mo)?\s*piso\b/.exec(t);
  return m ? m[1] : null;
}

function unitOf(t: string): string | null {
  const m = /\b(?:unidad|depto|dpto|departamento)\s+([b-h])\b/.exec(t) ?? /\bunidad\s+([a-z0-9]{1,3})\b/.exec(t);
  return m ? m[1].toUpperCase() : null;
}

function addressOf(original: string): { street: string | null; number: string | null } {
  const o = original.replace(/\s+/g, " ");
  const m =
    /\b(?:calle|direcci[oó]n|ubicad[oa] en|queda en|sobre)\s+((?:\d{1,3}|[A-ZÁÉÍÓÚÑa-záéíóúñ.]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ.]+){0,3}))\s+(?:n(?:[uú]mero|ro|°|º)?\.?\s*|al\s+)?(\d{1,5})\b/i.exec(o);
  if (!m) return { street: null, number: null };
  const isCalle = /^calle$/i.test(o.slice(m.index, m.index + 5));
  const name = m[1].trim();
  const street = /^\d+$/.test(name) || isCalle ? `Calle ${name}` : name;
  // "calle 12 entre 45 y 46": el segundo número no es la altura.
  if (/^entre$/i.test(m[2])) return { street, number: null };
  return { street, number: m[2] };
}

function nameOf(original: string): string | null {
  const m = /\b(?:[Cc]liente|[Ss]e llama|[Ii]nteresad[oa]|[Pp]ara|[Dd]e parte de|[Cc]ontacto)\s*:?\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/.exec(original);
  return m ? m[1] : null;
}

function phoneOf(t: string): string | null {
  const m = /\b(?:telefono|tel|celular|cel|whatsapp|wsp)\s*:?\s*(?:es\s+)?(\+?[\d][\d\s-]{6,}\d)/.exec(t);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function timeframeOf(t: string): string | null {
  const m =
    /\b(urgente|cuanto antes|ya mismo|lo antes posible)\b/.exec(t) ??
    /\b(?:en|dentro de)\s+(?:los proximos\s+)?(\d{1,2}|un|una|dos|tres|seis)\s+(mes(?:es)?|semanas?|anos?)\b/.exec(t) ??
    /\b(?:para|antes de|en)\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|fin de ano|el verano|el invierno)\b/.exec(t);
  if (!m) return null;
  if (m.length === 2) return m[0].startsWith("urg") || m[0].startsWith("cuanto") || m[0].startsWith("ya") || m[0].startsWith("lo ") ? m[1] : m[0];
  return m[0];
}

/* ── Armado ────────────────────────────────────────────────────────────── */

const TYPE_LABEL: Record<VozPropertyType, string> = {
  casa: "Casa",
  departamento: "Departamento",
  ph: "PH",
  terreno: "Terreno",
  local: "Local",
  oficina: "Oficina",
};
const OP_LABEL: Record<VozOperation, string> = { venta: "venta", alquiler: "alquiler", alquiler_temporal: "alquiler temporario" };

function draftTitle(p: VozPropiedad): string | null {
  if (!p.type) return null;
  const parts = [p.subtype && p.subtype !== "Monoambiente" ? p.subtype : TYPE_LABEL[p.type]];
  if (p.subtype === "Monoambiente") parts[0] = "Monoambiente";
  else if (p.rooms) parts.push(`${p.rooms} ${p.rooms === 1 ? "ambiente" : "ambientes"}`);
  else if (p.bedrooms) parts.push(`${p.bedrooms} ${p.bedrooms === 1 ? "dormitorio" : "dormitorios"}`);
  if (p.zone) parts.push(`en ${p.zone}`);
  const extra = p.features.find((f) => ["Piscina", "Jardín", "Balcón", "Terraza", "Cochera"].includes(f));
  let title = parts.join(" ");
  if (extra) title += ` con ${extra.toLowerCase()}`;
  return title;
}

function draftDescription(p: VozPropiedad): string | null {
  if (!p.type) return null;
  const s: string[] = [];
  let first = `${p.subtype ?? TYPE_LABEL[p.type]}`;
  if (p.operation) first += ` en ${OP_LABEL[p.operation]}`;
  if (p.zone) first += ` en ${p.zone}`;
  s.push(`${first}.`);
  const dist: string[] = [];
  if (p.rooms) dist.push(`${p.rooms} ${p.rooms === 1 ? "ambiente" : "ambientes"}`);
  if (p.bedrooms) dist.push(`${p.bedrooms} ${p.bedrooms === 1 ? "dormitorio" : "dormitorios"}`);
  if (p.bathrooms) dist.push(`${p.bathrooms} ${p.bathrooms === 1 ? "baño" : "baños"}`);
  if (p.garages) dist.push(`${p.garages} ${p.garages === 1 ? "cochera" : "cocheras"}`);
  if (dist.length) s.push(`Cuenta con ${dist.join(", ").replace(/, ([^,]*)$/, " y $1")}.`);
  const sup = p.surface_covered ?? p.surface_total;
  if (sup) s.push(`Superficie de ${sup} m²${p.surface_covered ? " cubiertos" : ""}.`);
  const feats = p.features.filter((f) => f !== "Cochera" || !p.garages).map((f) => f.toLowerCase());
  if (feats.length) s.push(`Tiene ${feats.join(", ").replace(/, ([^,]*)$/, " y $1")}.`);
  if (p.age_years === 0) s.push("A estrenar.");
  if (p.credit_eligible) s.push("Apta crédito.");
  return s.join(" ");
}

export function parsePropiedad(text: string, catalog: VozCatalog): VozPropiedad {
  const t = prepare(text);
  const notes: string[] = [];
  const types = findTypes(t);
  const money = findMoney(t);
  const expenses = money.find(isExpenses) ?? null;
  const price = money.find((m) => !isExpenses(m)) ?? null;
  const sup = surfaces(t);
  const features = findAmenities(t, catalog.amenities);
  const zones = findZones(t, catalog.zones);
  const addr = addressOf(text);
  let rooms = count(t, ROOMS);
  const subtype = findSubtype(t);
  if (subtype === "Monoambiente") rooms ??= 1;
  let garages = count(t, GARAGES);
  if (garages === null && features.includes(catalogHit("Cochera", catalog.amenities) ?? "\0")) garages = 1;

  for (const place of unknownPlaces(text, catalog.zones, zones)) notes.push(`Zona mencionada: ${place} (no está en la lista de zonas)`);
  if (zones.length > 1) notes.push(`También se nombró: ${zones.slice(1).join(", ")}`);

  const p: VozPropiedad = {
    operation: findOperation(t),
    type: types[0] ?? (subtype === "Monoambiente" ? "departamento" : null),
    subtype,
    zone: zones[0] ?? null,
    street: addr.street,
    street_number: addr.number,
    floor: floorOf(t),
    unit: unitOf(t),
    price: price?.value ?? null,
    currency: price?.currency ?? null,
    expenses: expenses?.value ?? null,
    expenses_currency: expenses ? (expenses.currency ?? "ARS") : null,
    rooms,
    bedrooms: count(t, BEDROOMS),
    bathrooms: count(t, BATHS),
    toilettes: count(t, TOILETTES),
    garages,
    surface_total: sup.total ?? (sup.covered === null ? null : sup.plain),
    surface_covered: sup.covered ?? (sup.total === null ? sup.plain : null),
    age_years: age(t),
    features,
    title: null,
    description: null,
    credit_eligible: flag(t, /\bapt[oa] (?:a )?credito\b|\bacepta credito\b/, /\bno (?:es )?apt[oa] (?:a )?credito\b/),
    accepts_swap: flag(t, /\b(?:acepta |toma )?permutas?\b/, /\bno (?:acepta|toma) permutas?\b|\bsin permuta\b/),
    notes,
  };
  // Si solo se dijo "80 metros", va a cubiertos (lo más habitual al dictar) y no a los dos.
  if (sup.total === null && sup.covered === null && sup.plain !== null) {
    p.surface_covered = sup.plain;
    p.surface_total = null;
  }
  p.title = draftTitle(p);
  p.description = draftDescription(p);
  return p;
}

export function parseBusqueda(text: string, catalog: VozCatalog): VozBusqueda {
  const t = prepare(text);
  const notes: string[] = [];
  const money = findMoney(t).filter((m) => !isExpenses(m));
  let budget_min: number | null = null;
  let budget_max: number | null = null;
  let currency: VozCurrency | null = null;

  const between = /\bentre\b/.test(t) && money.length >= 2 ? [money[0], money[1]] : null;
  if (between) {
    const [a, b] = between;
    // "entre 80 y 100 mil dólares": el "mil" y la moneda valen para los dos.
    const aVal = !a.hasMultiplier && b.hasMultiplier ? a.value * b.multiplier : a.value;
    budget_min = Math.min(aVal, b.value);
    budget_max = Math.max(aVal, b.value);
    currency = b.currency ?? a.currency;
  } else {
    for (const m of money) {
      if (/(desde|minimo|a partir de|mas de)\W*(?:de\s+|unos?\s+|los\s+)*$/.test(m.before)) budget_min ??= m.value;
      else budget_max ??= m.value;
      currency ??= m.currency;
    }
  }

  const zones = findZones(t, catalog.zones);
  for (const place of unknownPlaces(text, catalog.zones, zones)) notes.push(`Zona: ${place} (no está en la lista de zonas)`);
  const sup = surfaces(t);
  const subtype = findSubtype(t);
  if (subtype && subtype !== "Monoambiente") notes.push(`Prefiere: ${subtype}`);

  return {
    contact_name: nameOf(text),
    contact_phone: phoneOf(t),
    operation: findOperation(t),
    property_types: findTypes(t),
    zones,
    budget_min,
    budget_max,
    currency,
    rooms_min: count(t, ROOMS) ?? (subtype === "Monoambiente" ? 1 : null),
    bedrooms_min: count(t, BEDROOMS),
    bathrooms_min: count(t, BATHS),
    surface_min: sup.covered ?? sup.plain ?? sup.total,
    features: findAmenities(t, catalog.amenities),
    timeframe: timeframeOf(t),
    notes,
  };
}
