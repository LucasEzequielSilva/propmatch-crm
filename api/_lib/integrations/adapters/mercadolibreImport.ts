/**
 * «Importar mis avisos de Mercado Libre»: lee los avisos de Inmuebles de la
 * cuenta conectada de LA agencia del usuario y los devuelve ya traducidos a la
 * ficha del CRM (shared/meliImport.ts). No crea nada en Mercado Libre.
 *
 * Endpoints (documentación oficial, consultada el 2026-10-07):
 *  - Avisos del vendedor: GET /users/{USER_ID}/items/search?status=active|paused
 *    con search_type=scan + scroll_id para pasar de 1000 (limit máx. 100; el
 *    scroll_id vence a los 5 minutos y llega null al final).
 *    https://developers.mercadolibre.com.ar/es_ar/items-y-busquedas
 *    («Buscar ítems por vendedor», «Por estado», «Buscar más de 1000 registros»).
 *  - Detalle en lote (multiget, hasta 20 ids por llamada):
 *    GET /items/bulk?ids=ID1,ID2 (reemplaza a /items?ids=, que convive hasta el
 *    25/10/2026; si /items/bulk no responde se usa el viejo).
 *    Misma página, «Multiget» y «Migración de consultas múltiples».
 *  - Descripción: GET /items/{ITEM_ID}/description → plain_text.
 *    https://developers.mercadolibre.com.ar/es_ar/descripcion-de-articulos
 *  - Categoría: GET /categories/{CATEGORY_ID} → path_from_root (público).
 *    Solo se importan descendientes de MLA1459 (Inmuebles).
 *  - Forma del ítem de inmuebles (location, attributes, pictures):
 *    https://developers.mercadolibre.com.ar/en_us/list-properties
 *
 * Rate limits: ML no publica un número fijo por app; responde 429 si se pasa
 * (ver «Rate Limit / Error 429» en las FAQ). Por eso: una página de búsqueda
 * por llamada del cliente, multiget en lotes de 20 en serie, descripciones de
 * a 4 en paralelo, y la paginación la maneja el cliente con un cursor.
 */
import { getMeliSession, type MeliSession } from "../../meli.js";
import { meliFetch, readPublication, saveCrmPublication, savePublication, readCrmPublication, type PublicationRow } from "../../meliItems.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { mapMeliItemStatus } from "../../../../shared/meliListing.js";
import { isRealEstatePath, mapMeliItemToProperty, type CategoryPath, type ImportedPropertyDraft, type MeliImportItem } from "../../../../shared/meliImport.js";
import { chunk, nextImportCursor, parseMultiget, type ImportCursor, type ImportLinkRequest } from "../meliRequest.js";
import type { AgencyScope } from "../types.js";

export interface ImportCandidate {
  externalId: string;
  title: string;
  price: number | null;
  currency: string | null;
  meliStatus: string | null;
  /** Estado de property_publications que le corresponde (mapMeliItemStatus). */
  publication: { status: string; message: string | null };
  permalink: string | null;
  thumbnail: string | null;
  ok: boolean;
  /** Por qué no se puede importar (si ok = false). */
  reason?: string;
  draft?: ImportedPropertyDraft;
  unmapped?: string[];
  meliLocation?: { stateId: string | null; cityId: string | null; neighborhoodId: string | null } | null;
  /** Solo en import-details: si se pudo leer la descripción. */
  hasDescription?: boolean;
}

export type ImportError = { http: number; error: string; message: string };

const SESSION_ERRORS: Record<string, string> = {
  meli_needs_reauth: "La conexión con Mercado Libre venció. Un administrador tiene que volver a conectar la cuenta.",
  meli_unavailable: "Mercado Libre no respondió al renovar la sesión. Probá de nuevo en un rato.",
  meli_not_connected: "Tu inmobiliaria no tiene Mercado Libre conectado.",
};

async function openSession(agencyId: string): Promise<MeliSession | ImportError> {
  try {
    return await getMeliSession(agencyId);
  } catch (e) {
    const code = e instanceof Error && SESSION_ERRORS[e.message] ? e.message : "meli_not_connected";
    return { http: 409, error: code, message: SESSION_ERRORS[code] };
  }
}

const isError = (x: unknown): x is ImportError => !!x && typeof x === "object" && "error" in x && "http" in x;

/** Caché por proceso de path_from_root (las categorías casi no cambian). */
const categoryCache = new Map<string, CategoryPath | null>();

async function categoryPath(categoryId: string | undefined): Promise<CategoryPath | null> {
  if (!categoryId || !/^MLA\d{1,12}$/.test(categoryId)) return null;
  if (categoryCache.has(categoryId)) return categoryCache.get(categoryId)!;
  const r = await meliFetch<{ path_from_root?: CategoryPath }>(null, `/categories/${categoryId}`, { timeoutMs: 8000 });
  const path = r.ok && Array.isArray(r.body?.path_from_root) ? r.body!.path_from_root! : null;
  if (r.ok) categoryCache.set(categoryId, path);
  return path;
}

/** Detalle de hasta 20 avisos (multiget). Solo los de la cuenta conectada. */
async function fetchItems(session: MeliSession, ids: string[]): Promise<MeliImportItem[]> {
  const out: MeliImportItem[] = [];
  for (const group of chunk(ids, 20)) {
    const q = group.join(",");
    let r = await meliFetch<unknown>(session.token, `/items/bulk?ids=${q}`);
    if (!r.ok && r.status !== 429 && r.status !== 401) r = await meliFetch<unknown>(session.token, `/items?ids=${q}`);
    if (r.status === 429) throw new Error("rate_limited");
    for (const item of parseMultiget<MeliImportItem>(r.body)) {
      // Defensa: solo avisos de la cuenta de ESTA agencia.
      if (item?.id && String(item.seller_id ?? "") === session.userId) out.push(item);
    }
  }
  return out;
}

async function toCandidate(item: MeliImportItem, description: string | null): Promise<ImportCandidate | null> {
  const path = await categoryPath(item.category_id);
  // Si la categoría no se pudo leer, el mapeo cae a los atributos PROPERTY_TYPE/OPERATION.
  if (path && !isRealEstatePath(path)) return null;
  const m = mapMeliItemToProperty(item, path, description);
  const base = {
    externalId: item.id,
    title: (item.title ?? "").trim(),
    price: typeof item.price === "number" ? item.price : null,
    currency: item.currency_id ?? null,
    meliStatus: item.status ?? null,
    publication: mapMeliItemStatus(item),
    permalink: m.listing.permalink,
    thumbnail: m.listing.thumbnail,
    meliLocation: m.listing.meliLocation,
  };
  return m.ok ? { ...base, ok: true, draft: m.draft, unmapped: m.unmapped } : { ...base, ok: false, reason: m.reason };
}

/**
 * Una página del listado: ids de un estado (scan) + detalle + mapeo.
 * El cliente repite con `next` hasta que venga null.
 */
export async function meliImportList(
  scope: AgencyScope,
  cursor: ImportCursor,
): Promise<ImportError | { candidates: ImportCandidate[]; skipped: number; next: ImportCursor | null; total: number | null }> {
  const session = await openSession(scope.agencyId);
  if (isError(session)) return session;

  const params = new URLSearchParams({ search_type: "scan", status: cursor.status, limit: "100" });
  if (cursor.scrollId) params.set("scroll_id", cursor.scrollId);
  const search = await meliFetch<{ results?: unknown[]; scroll_id?: string | null; paging?: { total?: number } }>(
    session.token,
    `/users/${encodeURIComponent(session.userId)}/items/search?${params.toString()}`,
  );
  if (search.status === 429) return { http: 429, error: "rate_limited", message: "Mercado Libre está limitando las llamadas. Esperá unos segundos y seguí." };
  if (!search.ok) {
    // El scroll_id vence a los 5 minutos: se avisa para empezar de nuevo.
    if (cursor.scrollId && (search.status === 400 || search.status === 404)) {
      return { http: 409, error: "cursor_expired", message: "La búsqueda en Mercado Libre venció (pasaron más de 5 minutos). Volvé a empezar la importación." };
    }
    return { http: 502, error: "meli_unavailable", message: "No pudimos leer tus avisos de Mercado Libre. Probá de nuevo en un rato." };
  }
  const ids = (search.body?.results ?? []).filter((x): x is string => typeof x === "string" && /^MLA\d{6,15}$/.test(x));
  let items: MeliImportItem[];
  try {
    items = await fetchItems(session, ids);
  } catch {
    return { http: 429, error: "rate_limited", message: "Mercado Libre está limitando las llamadas. Esperá unos segundos y seguí." };
  }
  const candidates: ImportCandidate[] = [];
  let skipped = 0;
  for (const item of items) {
    const c = await toCandidate(item, null);
    if (c) candidates.push(c);
    else skipped++;
  }
  return {
    candidates,
    skipped,
    next: nextImportCursor(cursor, { scrollId: search.body?.scroll_id ?? null, count: ids.length }),
    total: typeof search.body?.paging?.total === "number" ? search.body.paging.total : null,
  };
}

/** Detalle completo (con descripción) de hasta 20 avisos elegidos para importar. */
export async function meliImportDetails(scope: AgencyScope, ids: string[]): Promise<ImportError | { candidates: ImportCandidate[] }> {
  const session = await openSession(scope.agencyId);
  if (isError(session)) return session;
  let items: MeliImportItem[];
  try {
    items = await fetchItems(session, ids);
  } catch {
    return { http: 429, error: "rate_limited", message: "Mercado Libre está limitando las llamadas. Esperá unos segundos y seguí." };
  }
  const candidates: ImportCandidate[] = [];
  for (const group of chunk(items, 4)) {
    const done = await Promise.all(
      group.map(async (item) => {
        const d = await meliFetch<{ plain_text?: string }>(session.token, `/items/${item.id}/description`);
        const text = d.ok && typeof d.body?.plain_text === "string" ? d.body.plain_text : null;
        const c = await toCandidate(item, text);
        return c ? { ...c, hasDescription: text !== null } : null;
      }),
    );
    for (const c of done) if (c) candidates.push(c);
  }
  return { candidates };
}

export interface ImportLinkResult {
  crmPropertyId: string;
  externalId: string;
  ok: boolean;
  message: string | null;
  row: PublicationRow | null;
  storedOnServer: boolean;
}

/**
 * Deja vinculada la publicación de ML de cada propiedad importada (external_id,
 * permalink, estado mapeado, connection_id), así «Actualizar aviso» edita ESE
 * aviso. Verifica que cada aviso sea de la cuenta conectada de la agencia.
 * Idempotente: si ya está vinculado al mismo aviso, solo refresca el estado; si
 * la propiedad ya tiene OTRO aviso vivo, no lo pisa.
 */
export async function meliImportLink(scope: AgencyScope, links: ImportLinkRequest[]): Promise<ImportError | { results: ImportLinkResult[] }> {
  const session = await openSession(scope.agencyId);
  if (isError(session)) return session;
  let items: MeliImportItem[];
  try {
    items = await fetchItems(session, links.map((l) => l.externalId));
  } catch {
    return { http: 429, error: "rate_limited", message: "Mercado Libre está limitando las llamadas. Esperá unos segundos y seguí." };
  }
  const db = supabaseAdmin();
  const results: ImportLinkResult[] = [];
  for (const l of links) {
    const item = items.find((i) => i.id === l.externalId);
    const fail = (message: string): ImportLinkResult => ({ ...l, ok: false, message, row: null, storedOnServer: false });
    if (!item) {
      results.push(fail("Ese aviso no es de la cuenta de Mercado Libre conectada a tu inmobiliaria."));
      continue;
    }
    const mapped = mapMeliItemStatus(item);
    const patch = {
      status: mapped.status,
      external_id: item.id,
      external_url: item.permalink ?? null,
      error_message: mapped.message,
    };

    if (l.propertyId) {
      const { data: prop } = await db.from("properties").select("id, agency_id").eq("id", l.propertyId).maybeSingle();
      if (!prop || prop.agency_id !== scope.agencyId) {
        results.push(fail("La propiedad no es de tu inmobiliaria."));
        continue;
      }
      const existing = await readPublication(db, l.propertyId);
      if (existing?.external_id && existing.external_id !== item.id && existing.status !== "removed") {
        results.push(fail(`La propiedad ya tiene otro aviso de Mercado Libre (${existing.external_id}): no lo reemplazamos.`));
        continue;
      }
      const row = await savePublication(
        db,
        { agencyId: scope.agencyId, propertyId: l.propertyId, userId: scope.userId, isNew: !existing, connectionId: session.connectionId },
        { ...patch, published_at: existing?.published_at ?? null },
      );
      results.push({ ...l, ok: !!row, message: row ? null : "No pudimos guardar el vínculo.", row, storedOnServer: !!row });
      continue;
    }

    const existing = await readCrmPublication(db, scope.agencyId, l.crmPropertyId);
    if (existing.row?.external_id && existing.row.external_id !== item.id && existing.row.status !== "removed") {
      results.push(fail(`La propiedad ya tiene otro aviso de Mercado Libre (${existing.row.external_id}): no lo reemplazamos.`));
      continue;
    }
    const row = await saveCrmPublication(
      db,
      { agencyId: scope.agencyId, crmPropertyId: l.crmPropertyId, userId: scope.userId, isNew: !existing.row, connectionId: session.connectionId },
      patch,
      existing.row,
    );
    results.push({ ...l, ok: true, message: null, row, storedOnServer: !(row as { local_only?: boolean }).local_only });
  }
  return { results };
}
