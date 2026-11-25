/**
 * Feed XML de la propia inmobiliaria → ficha del CRM.
 *
 * No es un crawl de portales. La inmobiliaria pega una URL https que ella
 * controla (el XML que ya le manda a un portal, o uno propio). Se aceptan las
 * dos formas que más se ven en Argentina, sin inventar la API de nadie:
 *
 *   - Aviso (Navent / Zonaprop / Argenprop): <Aviso> con codigoAviso, titulo,
 *     tipoDePropiedad, tipoDeOperacion, precio, moneda, fotos/foto.
 *   - Anuncio (Tokko y exports parecidos): <ad> o <property> con id, title,
 *     operation_type, property_type, price/currency, photos/photo/url.
 *
 * Piezas puras (las pruebas corren sin red). El servidor baja el XML aparte,
 * con las mismas guardas anti-SSRF que la copia de fotos.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

export const FEED_MAX_BYTES = 8_000_000;
export const FEED_MAX_LISTINGS = 1500;
export const FEED_MAX_PHOTOS = 30;

export type FeedPropertyType = "casa" | "departamento" | "ph" | "terreno" | "local" | "oficina";
export type FeedOperation = "venta" | "alquiler" | "alquiler_temporal";
export type FeedStatus = "disponible" | "pausada" | "reservada" | "vendida" | "alquilada";

export interface FeedListing {
  externalId: string;
  title: string;
  description: string | null;
  type: FeedPropertyType;
  operation: FeedOperation;
  status: FeedStatus;
  street: string | null;
  street_number: string | null;
  locality: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  price: number | null;
  currency: "ARS" | "USD";
  /** true si el XML no traía moneda y se asumió por la operación. */
  currencyAssumed: boolean;
  expenses: number | null;
  surface_total: number | null;
  surface_covered: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  garages: number | null;
  age_years: number | null;
  floor: string | null;
  unit: string | null;
  photos: string[];
  permalink: string | null;
  hash: string;
}

export interface FeedParseResult {
  listings: FeedListing[];
  skipped: number;
  truncated: boolean;
  /** null si se pudo leer. Si no, no hay avisos y no se pausa nada. */
  error: string | null;
}

const LISTING_TAGS = new Set(["aviso", "ad", "property", "inmueble", "listing", "propiedad"]);
const PHOTO_TAGS = new Set(["foto", "image", "imagen", "picture", "photo", "src"]);

/* ── URL (sin DNS: el servidor lo vuelve a chequear al conectar) ─────────── */

export type FeedUrlCheck = { ok: true; url: URL } | { ok: false; message: string };

const BLOCKED_SUFFIX = [".localhost", ".local", ".internal", ".lan", ".home", ".intranet", ".corp"];

/** https público, sin usuario ni clave en la URL, sin red local. El query puede llevar un token. */
export function checkFeedUrl(raw: unknown): FeedUrlCheck {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 2048) {
    return { ok: false, message: "Pegá la dirección https del feed. Tiene que empezar con https://" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, message: "Esa dirección no es una URL válida." };
  }
  if (url.protocol !== "https:") return { ok: false, message: "El feed tiene que ser https. No aceptamos http." };
  if (url.username || url.password) return { ok: false, message: "La dirección no puede llevar usuario ni clave. Si hay un token, va en el query." };
  if (url.port && url.port !== "443") return { ok: false, message: "Solo se acepta el puerto 443." };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost") return { ok: false, message: "Esa dirección no es un sitio público." };
  if (BLOCKED_SUFFIX.some((s) => host.endsWith(s))) return { ok: false, message: "Esa dirección no es un sitio público." };
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (isPrivateIp(literal)) return { ok: false, message: "No se aceptan direcciones de una red privada." };
  } else if (!host.includes(".") || /^[0-9.]+$/.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host)) {
    return { ok: false, message: "Esa dirección no es un sitio público." };
  }
  url.hash = "";
  return { ok: true, url };
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (dotted) return isPrivateIp(dotted[1]);
    // Node normaliza ::ffff:8.8.8.8 a ::ffff:808:808.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    return true;
  }
  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/** Identificador estable de la cuenta (no es la URL: esa queda cifrada). */
export function feedAccountKey(url: URL): string {
  return createHash("sha256").update(url.toString()).digest("hex").slice(0, 40);
}

/** Solo el dominio, para mostrar en Integraciones. Nunca el path ni el query. */
export function feedHostLabel(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

/* ── parser ──────────────────────────────────────────────────────────────── */

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

const localName = (raw: string) => {
  const i = raw.indexOf(":");
  return (i >= 0 ? raw.slice(i + 1) : raw).toLowerCase();
};

function decodeText(raw: string): string {
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCode(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function fromCode(n: number): string {
  if (!Number.isFinite(n) || n < 32 || n === 127 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Árbol chico. Rechaza DOCTYPE/ENTITY (XXE) y documentos enormes. */
export function parseXmlTree(xml: string): XmlNode | { error: string } {
  if (xml.length > FEED_MAX_BYTES) return { error: "El archivo pesa más de 8 MB." };
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { error: "Ese XML no es un feed de avisos." };
  const src = xml.replace(/^\uFEFF/, "").replace(/<!--[\s\S]*?-->/g, "");
  const root: XmlNode = { name: "#root", attrs: {}, text: "", children: [] };
  const stack: XmlNode[] = [root];
  let i = 0;
  let nodes = 0;
  const push = (node: XmlNode) => {
    nodes += 1;
    if (nodes > 200_000) throw new Error("too_big");
    stack[stack.length - 1].children.push(node);
  };
  try {
    while (i < src.length) {
      const lt = src.indexOf("<", i);
      if (lt < 0) {
        stack[stack.length - 1].text += decodeText(src.slice(i));
        break;
      }
      if (lt > i) stack[stack.length - 1].text += decodeText(src.slice(i, lt));
      if (src.startsWith("<![CDATA[", lt)) {
        const end = src.indexOf("]]>", lt + 9);
        if (end < 0) return { error: "El XML está cortado." };
        stack[stack.length - 1].text += src.slice(lt + 9, end);
        i = end + 3;
        continue;
      }
      if (src.startsWith("<?", lt)) {
        const end = src.indexOf("?>", lt + 2);
        if (end < 0) return { error: "El XML está cortado." };
        i = end + 2;
        continue;
      }
      const gt = src.indexOf(">", lt + 1);
      if (gt < 0) return { error: "El XML está cortado." };
      const rawTag = src.slice(lt + 1, gt).trim();
      i = gt + 1;
      if (!rawTag || rawTag.startsWith("!")) continue;
      if (rawTag.startsWith("/")) {
        const name = localName(rawTag.slice(1).split(/\s/)[0] ?? "");
        if (stack.length > 1 && stack[stack.length - 1].name === name) stack.pop();
        continue;
      }
      const self = rawTag.endsWith("/");
      const body = self ? rawTag.slice(0, -1).trim() : rawTag;
      const space = body.search(/\s/);
      const name = localName(space < 0 ? body : body.slice(0, space));
      if (!name || !/^[a-z_][\w.-]*$/.test(name)) continue;
      const node: XmlNode = { name, attrs: parseAttrs(space < 0 ? "" : body.slice(space)), text: "", children: [] };
      push(node);
      if (!self) {
        if (stack.length > 40) return { error: "El XML es demasiado profundo." };
        stack.push(node);
      }
    }
  } catch {
    return { error: "El archivo pesa más de lo que podemos leer." };
  }
  if (stack.length !== 1) return { error: "El XML está cortado." };
  return root;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    attrs[localName(m[1])] = decodeText(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

function directText(node: XmlNode): string {
  return node.text.replace(/\s+/g, " ").trim();
}

const PHOTO_SUBTREE = new Set(["fotos", "photos", "images", "pictures", "imagenes", "photo", "foto", "image", "imagen", "picture"]);

/** Primer valor de cada tag, ignorando el bloque de fotos y avisos anidados. */
function indexFields(node: XmlNode, into: Map<string, string>, root = true) {
  if (!root && PHOTO_SUBTREE.has(node.name)) return;
  const own = directText(node);
  if (own && node.name !== "#root" && !into.has(node.name)) into.set(node.name, own);
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v && !into.has(k)) into.set(k, v);
  }
  for (const c of node.children) {
    if (LISTING_TAGS.has(c.name)) continue;
    indexFields(c, into, false);
  }
}

function pick(idx: Map<string, string>, names: string[]): string | null {
  for (const n of names) {
    const v = idx.get(n);
    if (v) return v;
  }
  return null;
}

function collectPhotos(node: XmlNode, parentIsListing: boolean, out: string[]) {
  const attrUrl = node.attrs.url || node.attrs.src || node.attrs.href || "";
  const text = directText(node);
  const isPhotoTag = PHOTO_TAGS.has(node.name);
  const isNestedUrl = node.name === "url" && !parentIsListing;
  if ((isPhotoTag || isNestedUrl) && out.length < FEED_MAX_PHOTOS) {
    const candidate = /^https:\/\//.test(text) ? text : /^https:\/\//.test(attrUrl) ? attrUrl : "";
    if (candidate && candidate.length <= 2048 && !out.includes(candidate)) out.push(candidate);
  }
  // Un <url> hijo directo del aviso es el link público, no una foto.
  const listingChild = LISTING_TAGS.has(node.name);
  for (const c of node.children) collectPhotos(c, listingChild, out);
}

function splitStreet(raw: string): { street: string; number: string | null } {
  const m = /^(.*\D)\s+(\d+[a-zA-Z]?)$/.exec(raw.trim());
  if (!m) return { street: clip(raw, 140), number: null };
  return { street: clip(m[1], 140), number: clip(m[2], 16) };
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).trim();
}

function num(raw: string | null): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const parts = s.split(",");
    s = parts.length === 2 && parts[1].length <= 2 ? `${parts[0].replace(/\./g, "")}.${parts[1]}` : s.replace(/,/g, "");
  } else if ((s.match(/\./g) ?? []).length > 1 || /[.]\d{3}$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return null;
  return n;
}

function intOrNull(raw: string | null): number | null {
  const n = num(raw);
  if (n === null) return null;
  return Math.round(n);
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

function mapType(raw: string | null): FeedPropertyType | null {
  if (!raw) return null;
  const n = norm(raw);
  if (/depart|dpto|depto|apartment|piso\b/.test(n)) return "departamento";
  if (/\bph\b|propiedad horizontal/.test(n)) return "ph";
  if (/terreno|lote|land/.test(n)) return "terreno";
  if (/local|comercial/.test(n)) return "local";
  if (/oficina|office/.test(n)) return "oficina";
  if (/casa|house|chalet|duplex|quinta/.test(n)) return "casa";
  return null;
}

function mapOperation(raw: string | null): FeedOperation | null {
  if (!raw) return null;
  const n = norm(raw);
  if (/tempor/.test(n)) return "alquiler_temporal";
  if (/alquil|rent/.test(n)) return "alquiler";
  if (/venta|sale/.test(n)) return "venta";
  return null;
}

function mapStatus(raw: string | null): FeedStatus {
  if (!raw) return "disponible";
  const n = norm(raw);
  if (/vendid/.test(n)) return "vendida";
  if (/alquilad/.test(n)) return "alquilada";
  if (/reserv/.test(n)) return "reservada";
  if (/paus|inactiv|baja|suspend|off|finaliz/.test(n)) return "pausada";
  return "disponible";
}

function mapCurrency(raw: string | null): "ARS" | "USD" | null {
  if (!raw) return null;
  const n = norm(raw);
  if (/usd|u\$s|dolar/.test(n)) return "USD";
  if (/ars|peso|\$/.test(n)) return "ARS";
  return null;
}

function listingHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

function mapListing(node: XmlNode): FeedListing | null {
  const idx = new Map<string, string>();
  indexFields(node, idx);
  const id = pick(idx, ["codigoaviso", "codigoreferencia", "external_id", "externalid", "idaviso", "code", "codigo", "reference", "referencia", "id"]);
  if (!id) return null;
  const externalId = clip(id, 120);
  if (!externalId) return null;
  const type = mapType(pick(idx, ["tipodepropiedad", "property_type", "propertytype", "tipoinmueble", "tipo", "type"]));
  const operation = mapOperation(pick(idx, ["tipodeoperacion", "operation_type", "operationtype", "operacion", "operation"]));
  const titleRaw = pick(idx, ["titulo", "title", "nombre"]);
  if (!type || !operation || !titleRaw) return null;
  const currencyRaw = pick(idx, ["moneda", "currency", "currency_id"]);
  let currency = mapCurrency(currencyRaw);
  const currencyAssumed = !currency;
  if (!currency) currency = operation === "venta" ? "USD" : "ARS";
  const address = pick(idx, ["direccion", "address", "calle", "street"]);
  const explicitNumber = pick(idx, ["numero", "street_number", "streetnumber", "altura"]);
  const split = address ? splitStreet(address) : { street: null, number: null };
  const photos: string[] = [];
  collectPhotos(node, true, photos);
  const permalinkRaw = pick(idx, ["permalink", "link", "publicurl", "urlaviso", "url"]);
  const permalink = permalinkRaw && /^https:\/\//.test(permalinkRaw) && permalinkRaw.length <= 2048 ? permalinkRaw : null;
  const lat = num(pick(idx, ["latitud", "lat", "latitude"]));
  const lng = num(pick(idx, ["longitud", "lng", "lon", "longitude"]));
  const description = pick(idx, ["descripcion", "description"]);
  const core = {
    externalId,
    title: clip(titleRaw, 180),
    description: description ? clip(description, 8000) : null,
    type,
    operation,
    status: mapStatus(pick(idx, ["estado", "status", "publication_status"])),
    street: explicitNumber ? clip(address ?? "", 140) || null : split.street,
    street_number: explicitNumber ? clip(explicitNumber, 16) : split.number,
    locality:
      clip(pick(idx, ["barrio", "neighborhood", "localidad", "zona", "ciudad", "city"]) || "", 80) || null,
    province: clip(pick(idx, ["provincia", "province", "state"]) || "", 80) || null,
    lat: lat !== null && Math.abs(lat) <= 90 && lat !== 0 ? lat : null,
    lng: lng !== null && Math.abs(lng) <= 180 && lng !== 0 ? lng : null,
    price: num(pick(idx, ["precio", "price", "amount", "valor"])),
    currency,
    currencyAssumed,
    expenses: num(pick(idx, ["expensas", "expenses", "maintenance_fee"])),
    surface_total: num(pick(idx, ["superficietotal", "surface_total", "totalsurface", "total_surface", "superficie"])),
    surface_covered: num(pick(idx, ["superficiecubierta", "surface_covered", "roofed_surface", "covered_surface"])),
    rooms: intOrNull(pick(idx, ["ambientes", "rooms", "room_amount"])),
    bedrooms: intOrNull(pick(idx, ["dormitorios", "bedrooms", "habitaciones", "suite_amount"])),
    bathrooms: intOrNull(pick(idx, ["banos", "bano", "bathrooms", "bathroom_amount"])),
    garages: intOrNull(pick(idx, ["cocheras", "garages", "garage", "parking_lot_amount"])),
    age_years: intOrNull(pick(idx, ["antiguedad", "age", "age_years"])),
    floor: clip(pick(idx, ["piso", "floor"]) || "", 16) || null,
    unit: clip(pick(idx, ["unidad", "unit", "dpto"]) || "", 16) || null,
    photos,
    permalink,
  };
  return { ...core, hash: listingHash(core) };
}

export function parseFeedXml(xml: string): FeedParseResult {
  const tree = parseXmlTree(xml);
  if ("error" in tree) return { listings: [], skipped: 0, truncated: false, error: tree.error };
  const byId = new Map<string, FeedListing>();
  let skipped = 0;
  let truncated = false;
  const walk = (node: XmlNode) => {
    if (LISTING_TAGS.has(node.name)) {
      const listing = mapListing(node);
      if (!listing) skipped += 1;
      else if (byId.size >= FEED_MAX_LISTINGS && !byId.has(listing.externalId)) truncated = true;
      else byId.set(listing.externalId, listing);
      return;
    }
    for (const c of node.children) walk(c);
  };
  for (const c of tree.children) walk(c);
  if (byId.size === 0) {
    return {
      listings: [],
      skipped,
      truncated: false,
      error: "No encontramos avisos en ese XML. Tiene que tener etiquetas aviso, ad o property, cada una con código, título, tipo y operación.",
    };
  }
  return { listings: [...byId.values()], skipped, truncated, error: null };
}

/* ── qué escribir en el CRM ──────────────────────────────────────────────── */

export interface OwnedFeedProperty {
  id: string;
  externalId: string;
  hash: string | null;
  locked: boolean;
  data: Record<string, unknown>;
}

export interface FeedPushItem {
  kind: "property" | "photos";
  id: string;
  data: Record<string, unknown>;
}

export interface FeedSyncPlan {
  items: FeedPushItem[];
  created: number;
  updated: number;
  paused: number;
  unchanged: number;
  locked: number;
}

const STICKY = new Set(["reservada", "vendida", "alquilada"]);

/** Id estable del CRM para un aviso del feed. Cabe en el id del registro. */
export function feedPropertyId(externalId: string): string {
  return `fd_${createHash("sha256").update(externalId).digest("hex").slice(0, 24)}`;
}

/**
 * Arma los registros a subir. No pisa propietario, autorización, precio de
 * reserva ni un estado reservada/vendida/alquilada con un "disponible" del
 * feed. Si el aviso ya no está y `pauseMissing`, pasa a pausada (no se borra).
 * Con el feed truncado no se pausa: faltarían avisos que no llegamos a leer.
 */
export function buildFeedPlan(
  listings: FeedListing[],
  owned: OwnedFeedProperty[],
  photos: Record<string, string[]>,
  now: string,
  agencyId: string,
  pauseMissing: boolean,
): FeedSyncPlan {
  const items: FeedPushItem[] = [];
  const plan: FeedSyncPlan = { items, created: 0, updated: 0, paused: 0, unchanged: 0, locked: 0 };
  const byExternal = new Map(owned.map((o) => [o.externalId, o]));
  const seen = new Set<string>();

  for (const listing of listings) {
    seen.add(listing.externalId);
    const prev = byExternal.get(listing.externalId) ?? null;
    if (prev?.locked) {
      plan.locked += 1;
      continue;
    }
    if (prev && prev.hash === listing.hash) {
      plan.unchanged += 1;
      continue;
    }
    const id = prev?.id ?? feedPropertyId(listing.externalId);
    const base = prev?.data ?? {};
    const prevStatus = typeof base.status === "string" ? base.status : null;
    const status = prevStatus && STICKY.has(prevStatus) && listing.status === "disponible" ? prevStatus : listing.status;
    const data: Record<string, unknown> = {
      ...base,
      id,
      agency_id: agencyId,
      owner_agent_id: base.owner_agent_id ?? null,
      owner_contact_id: base.owner_contact_id ?? null,
      authorization_type: base.authorization_type ?? null,
      authorization_expires_at: base.authorization_expires_at ?? null,
      title: listing.title,
      description: listing.description ?? (typeof base.description === "string" ? base.description : null),
      type: listing.type,
      operation: listing.operation,
      status,
      street: listing.street,
      street_number: listing.street_number,
      locality: listing.locality,
      province: listing.province,
      zone: listing.locality,
      lat: listing.lat,
      lng: listing.lng,
      price: listing.price,
      currency: listing.currency,
      expenses: listing.expenses,
      taxes: base.taxes ?? null,
      commission_pct: base.commission_pct ?? null,
      surface_total: listing.surface_total,
      surface_covered: listing.surface_covered,
      rooms: listing.rooms,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      garages: listing.garages,
      age_years: listing.age_years,
      features: Array.isArray(base.features) ? base.features : [],
      floor: listing.floor,
      unit: listing.unit,
      is_featured: base.is_featured ?? false,
      published_to_marketplace: base.published_to_marketplace ?? false,
      published_at: base.published_at ?? now,
      created_at: typeof base.created_at === "string" ? base.created_at : now,
      updated_at: now,
      app_property_id: base.app_property_id ?? null,
      feed_external_id: listing.externalId,
      feed_hash: listing.hash,
      feed_permalink: listing.permalink,
      feed_missing: false,
      feed_managed: true,
      feed_currency_assumed: listing.currencyAssumed,
    };
    items.push({ kind: "property", id, data });
    const nextPhotos = listing.photos.length > 0 ? listing.photos : (photos[id] ?? []);
    const prevPhotos = photos[id] ?? [];
    if (!prev || nextPhotos.join("\n") !== prevPhotos.join("\n")) {
      items.push({ kind: "photos", id, data: { urls: nextPhotos } });
    }
    if (prev) plan.updated += 1;
    else plan.created += 1;
  }

  if (pauseMissing && listings.length > 0) {
    for (const prev of owned) {
      if (seen.has(prev.externalId)) continue;
      if (prev.locked) {
        plan.locked += 1;
        continue;
      }
      if (prev.data.feed_missing === true || prev.data.status === "pausada") {
        plan.unchanged += 1;
        continue;
      }
      items.push({
        kind: "property",
        id: prev.id,
        data: { ...prev.data, status: "pausada", feed_missing: true, updated_at: now },
      });
      plan.paused += 1;
    }
  }
  return plan;
}
