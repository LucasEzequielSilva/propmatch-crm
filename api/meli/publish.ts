/**
 * POST /api/meli/publish — publica y gestiona el aviso de una propiedad en
 * Mercado Libre Inmuebles con la cuenta conectada de la inmobiliaria.
 *
 * Body: { action, propertyId, listing?, listingType? }
 *   action: "check"    valida (atributos en vivo, fotos públicas, cupo) sin publicar
 *           "publish"  crea el aviso (si ya hay uno activo/pausado, lo actualiza)
 *           "update"   sincroniza título, precio, fotos, atributos y descripción
 *           "pause" | "activate" | "close" (cerrar es definitivo: solo admins)
 *           "sync"     relee el estado del aviso en Mercado Libre
 *   propertyId: uuid de `properties` (Property.app_property_id del CRM).
 *   listing: MeliListingInput (datos del CRM; las fotos NO se aceptan del
 *            cliente: salen de `properties.photos`, que son URLs públicas del
 *            bucket de la app).
 *
 * Reglas y endpoints: ver shared/meliListing.ts (fuentes) y
 * docs/multipublicador-puesta-en-marcha.md.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../_lib/auth.js";
import { env, isConfigured } from "../_lib/env.js";
import { allowMethod, fail, json } from "../_lib/http.js";
import { getMeliSession, type MeliSession } from "../_lib/meli.js";
import {
  categoryAttributes,
  isPubliclyReachable,
  meliFetch,
  readPublication,
  savePublication,
  type MeliItem,
  type PublicationRow,
} from "../_lib/meliItems.js";
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import {
  MELI_LISTING_TYPES,
  buildMeliItem,
  buildMeliUpdate,
  categoryFor,
  isPublishable,
  mapMeliItemStatus,
  pickListingType,
  plainDescription,
  readableMeliError,
  validateMeliListing,
  type MeliIssue,
  type MeliListingInput,
  type MeliListingType,
  type MeliOperation,
  type MeliPropertyType,
} from "../../shared/meliListing.js";

const ACTIONS = ["check", "publish", "update", "pause", "activate", "close", "sync"] as const;
type Action = (typeof ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_ID = /^MLA\d{6,15}$/;
const TYPES: MeliPropertyType[] = ["casa", "departamento", "ph", "terreno", "local", "oficina"];
const OPERATIONS: MeliOperation[] = ["venta", "alquiler", "alquiler_temporal"];

const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : null);

/** Normaliza lo que manda el cliente: nunca se confía en tipos ni largos. */
function parseListing(raw: unknown): MeliListingInput | null {
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
    surfaceTotal: numOrNull(r.surfaceTotal),
    surfaceCovered: numOrNull(r.surfaceCovered),
    rooms: numOrNull(r.rooms),
    bedrooms: numOrNull(r.bedrooms),
    bathrooms: numOrNull(r.bathrooms),
    garages: numOrNull(r.garages),
    ageYears: numOrNull(r.ageYears),
    features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string").slice(0, 50) : [],
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

/** Solo URLs del Storage público del propio proyecto de Supabase. */
function publicPhotos(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const prefix = `${env("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1/object/public/`;
  return photos.filter((u): u is string => typeof u === "string" && u.startsWith(prefix));
}

interface Prepared {
  issues: MeliIssue[];
  photos: string[];
  allowed?: Set<string>;
}

/** Validación completa del lado servidor: atributos requeridos en vivo + fotos descargables. */
async function prepare(listing: MeliListingInput, photos: string[]): Promise<Prepared> {
  const categoryId = categoryFor(listing.type, listing.operation);
  const live = categoryId ? await categoryAttributes(categoryId) : null;
  const issues = validateMeliListing(listing, photos, live?.required);
  if (photos.length > 0 && !(await isPubliclyReachable(photos[0]))) {
    issues.push({
      field: "pictures",
      blocking: true,
      message: "Mercado Libre no va a poder descargar las fotos: la URL no es pública (revisá que el bucket property-photos sea público).",
    });
  }
  return { issues, photos, allowed: live?.allowed };
}

async function readItem(session: MeliSession, itemId: string) {
  return meliFetch<MeliItem>(session.token, `/items/${itemId}`);
}

/** Carga o reemplaza la descripción. Devuelve un aviso legible si falla (no bloquea). */
async function putDescription(session: MeliSession, itemId: string, text: string, isNew: boolean): Promise<string | null> {
  if (!text) return null;
  const body = { plain_text: text };
  let r = isNew
    ? await meliFetch(session.token, `/items/${itemId}/description`, { method: "POST", body })
    : await meliFetch(session.token, `/items/${itemId}/description?api_version=2`, { method: "PUT", body });
  // Si el ítem todavía no tenía descripción, el PUT falla: se crea con POST.
  if (!r.ok && !isNew && (r.status === 400 || r.status === 404)) {
    r = await meliFetch(session.token, `/items/${itemId}/description`, { method: "POST", body });
  }
  return r.ok ? null : `El aviso quedó publicado pero la descripción no se cargó: ${readableMeliError(r.status, r.body)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "POST")) return;
  if (!isConfigured()) return fail(res, 503, "not_configured");
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;

    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const action = b.action as Action;
    const propertyId = typeof b.propertyId === "string" ? b.propertyId : "";
    if (!ACTIONS.includes(action) || !UUID.test(propertyId)) return fail(res, 400, "bad_request");
    if (action === "close" && ctx.role !== "admin") {
      return json(res, 403, { error: "forbidden", message: "Solo un administrador puede finalizar un aviso (no se puede deshacer)." });
    }

    const db = supabaseAdmin();
    const { data: prop } = await db.from("properties").select("id, agency_id, photos").eq("id", propertyId).maybeSingle();
    if (!prop || prop.agency_id !== ctx.agencyId) {
      return json(res, 404, { error: "property_not_found", message: "La propiedad no está sincronizada con la app o no es de tu inmobiliaria." });
    }

    let session: MeliSession;
    try {
      session = await getMeliSession(ctx.agencyId);
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const message =
        code === "meli_needs_reauth"
          ? "La conexión con Mercado Libre venció. Un administrador tiene que volver a conectar la cuenta."
          : code === "meli_unavailable"
            ? "Mercado Libre no respondió al renovar la sesión. Probá de nuevo en un rato."
            : "La inmobiliaria no tiene Mercado Libre conectado.";
      return json(res, 409, { error: code || "meli_not_connected", message });
    }

    const existing = await readPublication(db, propertyId);
    const key = { agencyId: ctx.agencyId, propertyId, userId: ctx.userId, isNew: !existing };
    const itemId = existing?.external_id && ITEM_ID.test(existing.external_id) ? existing.external_id : null;
    const done = (row: PublicationRow | null, extra: Record<string, unknown> = {}) => json(res, 200, { row, ...extra });

    /* ── acciones sobre un aviso existente ─────────────────────────────── */
    if (action === "sync" || action === "pause" || action === "activate" || action === "close") {
      if (!itemId) return json(res, 409, { error: "not_published", message: "Esta propiedad todavía no tiene aviso en Mercado Libre." });
      if (action !== "sync") {
        const status = action === "pause" ? "paused" : action === "activate" ? "active" : "closed";
        const r = await meliFetch(session.token, `/items/${itemId}`, { method: "PUT", body: { status } });
        if (!r.ok) return json(res, 422, { error: "meli_rejected", message: readableMeliError(r.status, r.body), row: existing });
      }
      const item = await readItem(session, itemId);
      if (!item.ok || !item.body) return json(res, 502, { error: "meli_unavailable", message: readableMeliError(item.status, item.body), row: existing });
      const mapped = mapMeliItemStatus(item.body);
      const row = await savePublication(db, key, {
        status: mapped.status,
        error_message: mapped.message,
        external_url: item.body.permalink ?? existing?.external_url ?? null,
      });
      return done(row);
    }

    /* ── check / publish / update: hace falta la ficha ─────────────────── */
    const listing = parseListing(b.listing);
    if (!listing) return fail(res, 400, "bad_listing");
    const prep = await prepare(listing, publicPhotos(prop.photos));
    const wanted: MeliListingType = MELI_LISTING_TYPES.some((t) => t.id === b.listingType) ? (b.listingType as MeliListingType) : "silver";

    // Si ya hay un aviso vivo, "publicar" es actualizarlo (no se duplica).
    const live = !!itemId && existing?.status !== "removed";
    const mode: Action = action === "publish" && live ? "update" : action;

    if (mode === "update" && !itemId) return json(res, 409, { error: "not_published", message: "Esta propiedad todavía no tiene aviso en Mercado Libre." });
    // Al actualizar, la ubicación ya está en el aviso: solo se manda si se eligió una nueva.
    if (mode === "update") prep.issues = prep.issues.filter((i) => i.field !== "location");

    let packNote: string | null = null;
    let listingType = wanted;
    if (mode !== "update") {
      // Cupo del paquete [shared/meliListing.ts PACK]. Si la consulta falla, se intenta igual y ML decide.
      const packs = await meliFetch<unknown[]>(
        session.token,
        `/users/${encodeURIComponent(session.userId)}/classifieds_promotion_packs?package_content=publications&status=active`,
      );
      if (packs.ok && Array.isArray(packs.body)) {
        const pick = pickListingType(packs.body as Parameters<typeof pickListingType>[0], wanted);
        if (pick.ok) listingType = pick.listingType;
        else prep.issues.push({ field: "listing_type", blocking: true, message: pick.message });
      } else {
        packNote = "No pudimos consultar el cupo del paquete; Mercado Libre lo valida al publicar.";
      }
    }

    if (mode === "check" || !isPublishable(prep.issues)) {
      return json(res, mode === "check" ? 200 : 422, {
        error: mode === "check" ? undefined : "invalid",
        issues: prep.issues,
        listingType,
        packNote,
        row: existing,
      });
    }

    const description = plainDescription(listing.description);

    if (mode === "update") {
      const r = await meliFetch(session.token, `/items/${itemId}`, {
        method: "PUT",
        body: buildMeliUpdate(listing, prep.photos, prep.allowed),
      });
      if (!r.ok) {
        const message = readableMeliError(r.status, r.body);
        const row = await savePublication(db, key, { error_message: message });
        return json(res, 422, { error: "meli_rejected", message, row });
      }
      const descWarning = await putDescription(session, itemId!, description, false);
      const item = await readItem(session, itemId!);
      const mapped = item.body ? mapMeliItemStatus(item.body) : null;
      const row = await savePublication(db, key, {
        ...(mapped ? { status: mapped.status } : {}),
        error_message: descWarning ?? mapped?.message ?? null,
        external_url: item.body?.permalink ?? existing?.external_url ?? null,
      });
      return done(row, { warnings: descWarning ? [descWarning] : [] });
    }

    // publish (aviso nuevo). Evita duplicados por doble clic: si hay un intento en curso reciente, no se repite.
    if (existing?.status === "pending" && !itemId && Date.now() - new Date(existing.updated_at).getTime() < 2 * 60 * 1000) {
      return json(res, 409, { error: "in_progress", message: "Ya hay una publicación en curso para esta propiedad. Esperá unos segundos." });
    }
    await savePublication(db, key, { status: "pending", error_message: null, external_id: null, external_url: null });
    key.isNew = false;

    const created = await meliFetch<MeliItem>(session.token, "/items", {
      method: "POST",
      body: buildMeliItem(listing, prep.photos, listingType, prep.allowed),
      timeoutMs: 25000,
    });
    if (!created.ok || !created.body?.id) {
      // Sin respuesta (timeout/red) no se sabe si el aviso se creó: se avisa para no duplicarlo.
      const message =
        created.status === 0
          ? "Mercado Libre no respondió a tiempo. Antes de reintentar, revisá en tu cuenta de Mercado Libre si el aviso se creó, para no duplicarlo."
          : readableMeliError(created.status, created.body);
      const row = await savePublication(db, key, { status: "error", error_message: message });
      return json(res, 422, { error: "meli_rejected", message, row });
    }

    const item = created.body;
    const descWarning = await putDescription(session, item.id, description, true);
    const mapped = mapMeliItemStatus(item);
    const row = await savePublication(db, key, {
      status: mapped.status,
      external_id: item.id,
      external_url: item.permalink ?? null,
      error_message: descWarning ?? mapped.message,
      published_at: new Date().toISOString(),
    });
    const warnings = [descWarning, packNote].filter((w): w is string => !!w);
    return done(row, { warnings });
  } catch {
    fail(res, 500, "server_error");
  }
}
