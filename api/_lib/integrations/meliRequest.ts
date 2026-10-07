/**
 * Lectura y validación de lo que manda el cliente para publicar en Mercado
 * Libre. Sin imports de runtime: lo usan el adapter y las pruebas sin red.
 *
 * Dos destinos posibles:
 *  - "app": la propiedad está en `public.properties` (uuid). Las fotos salen
 *    de la fila de la app, como siempre.
 *  - "crm": la propiedad solo vive en el CRM (precio en pesos, o todavía sin
 *    sincronizar). El cliente manda la ficha y las URLs de las fotos, y el
 *    servidor solo acepta fotos del bucket público `property-photos` dentro de
 *    la carpeta `<agency_id>/crm/<crm_property_id>/` de SU agencia (o las que
 *    el aviso ya tiene en Mercado Libre). Nunca URLs arbitrarias.
 * En los dos casos la ficha pasa por una lista blanca de campos
 * (`parseListing`): un dato confidencial como `reserve_min_price` no tiene
 * por dónde entrar.
 */
import type { MeliListingInput, MeliOperation, MeliPropertyType } from "../../../shared/meliListing.js";

const TYPES: MeliPropertyType[] = ["casa", "departamento", "ph", "terreno", "local", "oficina"];
const OPERATIONS: MeliOperation[] = ["venta", "alquiler", "alquiler_temporal"];
/** Tope sano para precios y superficies (evita números absurdos o notación rara). */
const MAX_NUMBER = 1e12;

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_NUMBER ? v : null);
const strOrNull = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : null);
const currencyOrEmpty = (v: unknown) => (v === "ARS" || v === "USD" ? v : "");

/** Normaliza la ficha: lista blanca de campos, tipos y largos. Nunca se confía en el cliente. */
export function parseListing(raw: unknown): MeliListingInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!TYPES.includes(r.type as MeliPropertyType) || !OPERATIONS.includes(r.operation as MeliOperation)) return null;
  const loc = (r.location && typeof r.location === "object" ? r.location : null) as Record<string, unknown> | null;
  return {
    type: r.type as MeliPropertyType,
    operation: r.operation as MeliOperation,
    title: strOrNull(r.title, 300) ?? "",
    description: strOrNull(r.description, 60000),
    price: numOrNull(r.price),
    currency: strOrNull(r.currency, 5) ?? "",
    expenses: numOrNull(r.expenses),
    expensesCurrency: currencyOrEmpty(r.expensesCurrency) || null,
    surfaceTotal: numOrNull(r.surfaceTotal),
    surfaceCovered: numOrNull(r.surfaceCovered),
    rooms: numOrNull(r.rooms),
    bedrooms: numOrNull(r.bedrooms),
    bathrooms: numOrNull(r.bathrooms),
    garages: numOrNull(r.garages),
    ageYears: numOrNull(r.ageYears),
    features: Array.isArray(r.features)
      ? r.features.filter((f): f is string => typeof f === "string").map((f) => f.slice(0, 60)).slice(0, 50)
      : [],
    street: strOrNull(r.street, 200),
    streetNumber: strOrNull(r.streetNumber, 20),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    propertyCode: strOrNull(r.propertyCode, 60),
    location: loc ? { neighborhoodId: strOrNull(loc.neighborhoodId, 80), cityId: strOrNull(loc.cityId, 80) } : null,
    guests: numOrNull(r.guests),
    landAccess: strOrNull(r.landAccess, 20),
  };
}

/** Id local del CRM (p. ej. "p_k3x9…"). Sin barras ni puntos: se usa como carpeta de Storage. */
const CRM_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const ITEM_ID = /^MLA\d{6,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCrmPropertyId(v: unknown): string | null {
  return typeof v === "string" && CRM_ID.test(v) ? v : null;
}

/** Prefijo público del bucket de fotos de la app. */
export function photosBucketPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/property-photos/`;
}

/** Carpeta de Storage donde el CRM sube las fotos de una propiedad que no está en la app. */
export function crmPhotoFolder(agencyId: string, crmPropertyId: string): string {
  return `${agencyId}/crm/${crmPropertyId}/`;
}

const SAFE_FILE = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * Fotos aceptadas para una propiedad solo-CRM: URLs del bucket público
 * `property-photos` dentro de `<agency_id>/crm/<crm_property_id>/` (un solo
 * nivel, nombre de archivo simple: sin `..`, `%2F` ni query), o fotos que el
 * aviso YA tiene en Mercado Libre (`existing`, leídas del propio aviso con el
 * token de la agencia). Todo lo demás se descarta y se informa.
 */
export function filterCrmPhotos(
  raw: unknown,
  opts: { supabaseUrl: string; agencyId: string; crmPropertyId: string; existing?: string[] },
): { photos: string[]; rejected: number } {
  if (!Array.isArray(raw)) return { photos: [], rejected: 0 };
  const prefix = photosBucketPrefix(opts.supabaseUrl) + crmPhotoFolder(opts.agencyId, opts.crmPropertyId);
  const existing = new Set((opts.existing ?? []).filter(Boolean));
  const photos: string[] = [];
  let rejected = 0;
  for (const u of raw.slice(0, 60)) {
    if (typeof u !== "string" || u.length > 2000) {
      rejected++;
      continue;
    }
    const ok = existing.has(u) || (u.startsWith(prefix) && SAFE_FILE.test(u.slice(prefix.length)));
    if (ok && !photos.includes(u)) photos.push(u);
    else if (!ok) rejected++;
  }
  return { photos, rejected };
}

/** Publicación que el navegador recuerda (antes de la migración, o de otro equipo): solo una pista. */
export interface PreviousPublication {
  externalId: string;
}

/** Solo el id del aviso; el servidor después verifica que sea de la cuenta conectada de la agencia. */
export function parsePrevious(raw: unknown): PreviousPublication | null {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as Record<string, unknown>).externalId;
  return typeof id === "string" && ITEM_ID.test(id) ? { externalId: id } : null;
}

export type MeliTarget =
  | { kind: "app"; propertyId: string; crmPropertyId: string | null }
  | { kind: "crm"; crmPropertyId: string };

/**
 * A qué propiedad apunta el pedido: uuid de la app (`propertyId`) o id del CRM
 * (`crmPropertyId`). Con los dos, manda la app (y el id del CRM sirve para
 * adoptar un aviso publicado antes de sincronizar).
 */
export function parseTarget(b: Record<string, unknown>): MeliTarget | null {
  const crm = parseCrmPropertyId(b.crmPropertyId);
  if (typeof b.propertyId === "string" && b.propertyId) {
    return UUID.test(b.propertyId) ? { kind: "app", propertyId: b.propertyId, crmPropertyId: crm } : null;
  }
  return crm ? { kind: "crm", crmPropertyId: crm } : null;
}

/* ───────────────────── importador de avisos (piezas puras) ───────────────────── */

/** Estados que se importan, en este orden [users/{id}/items/search?status=…]. */
export const IMPORT_STATUSES = ["active", "paused"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export interface ImportCursor {
  status: ImportStatus;
  /** scroll_id de search_type=scan (vence a los 5 minutos según la doc). */
  scrollId: string | null;
}

const SCROLL_ID = /^[A-Za-z0-9+/=:_-]{1,600}$/;

/** Cursor que manda el cliente para seguir paginando. Sin cursor = empezar por los activos. */
export function parseImportCursor(raw: unknown): ImportCursor | null {
  if (raw == null) return { status: "active", scrollId: null };
  if (typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!IMPORT_STATUSES.includes(r.status as ImportStatus)) return null;
  const scrollId = r.scrollId == null ? null : typeof r.scrollId === "string" && SCROLL_ID.test(r.scrollId) ? r.scrollId : undefined;
  if (scrollId === undefined) return null;
  return { status: r.status as ImportStatus, scrollId };
}

/**
 * Próximo cursor después de una página de search_type=scan: se sigue con el
 * mismo scroll_id mientras vengan resultados; al terminar un estado se pasa
 * al siguiente (activos → pausados); `null` = no hay más.
 */
export function nextImportCursor(cur: ImportCursor, page: { scrollId: string | null; count: number }): ImportCursor | null {
  if (page.count > 0 && page.scrollId) return { status: cur.status, scrollId: page.scrollId };
  const i = IMPORT_STATUSES.indexOf(cur.status);
  const next = IMPORT_STATUSES[i + 1];
  return next ? { status: next, scrollId: null } : null;
}

/** Lista de ids de avisos (MLA…), sin repetidos, hasta `max`. `null` si algo no es un id válido. */
export function parseItemIds(raw: unknown, max = 20): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !ITEM_ID.test(v)) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Respuesta de multiget. Acepta los dos formatos documentados:
 *  - /items/bulk?ids=  → [{ id, status_code, body }]  (nuevo)
 *  - /items?ids=       → [{ code, body }]             (deprecado; convive hasta el 25/10/2026)
 * Devuelve solo los cuerpos con 200.
 */
export function parseMultiget<T extends { id?: string }>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const e = el as { status_code?: unknown; code?: unknown; body?: unknown };
    const code = typeof e.status_code === "number" ? e.status_code : typeof e.code === "number" ? e.code : 0;
    if (code === 200 && e.body && typeof e.body === "object") out.push(e.body as T);
  }
  return out;
}

export interface ImportLinkRequest {
  crmPropertyId: string;
  externalId: string;
  /** uuid de la app si la propiedad ya está sincronizada. */
  propertyId: string | null;
}

/** Vínculos propiedad del CRM ↔ aviso que pide guardar el importador (hasta 20). */
export function parseImportLinks(raw: unknown): ImportLinkRequest[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const out: ImportLinkRequest[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    const crm = parseCrmPropertyId(r.crmPropertyId);
    const ext = typeof r.externalId === "string" && ITEM_ID.test(r.externalId) ? r.externalId : null;
    const app = r.propertyId == null ? null : typeof r.propertyId === "string" && UUID.test(r.propertyId) ? r.propertyId : undefined;
    if (!crm || !ext || app === undefined) return null;
    out.push({ crmPropertyId: crm, externalId: ext, propertyId: app });
  }
  return out;
}
