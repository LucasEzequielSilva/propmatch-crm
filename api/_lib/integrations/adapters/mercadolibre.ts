/**
 * MercadoLibreAdapter: TODA la lógica de Mercado Libre que antes vivía en los
 * handlers de api/_lib/routes/meli/* (connect, callback, status, disconnect,
 * publish). Los handlers siguen existiendo con las MISMAS URLs y respuestas
 * (/api/meli/callback y /api/meli/notifications están registradas en ML) y
 * ahora solo delegan acá; el motor multi-portal usa este mismo adapter.
 *
 * Multi-inmobiliaria: MELI_CLIENT_ID/SECRET son de la app PropMatch (una sola);
 * cada inmobiliaria autoriza con su cuenta por OAuth + PKCE y sus tokens
 * quedan cifrados en SU fila de agency_integrations (api/_lib/meli.ts).
 *
 * Reglas y endpoints de publicación: shared/meliListing.ts (fuentes) y
 * docs/multipublicador-puesta-en-marcha.md.
 */
import { decrypt, encrypt, safeEqual } from "../../crypto.js";
import { appUrl, env, isConfigured } from "../../env.js";
import { MELI_API, MELI_AUTH_URL, getMeliSession, meliTokenRequest, type MeliSession } from "../../meli.js";
import {
  adoptCrmPublication,
  categoryAttributes,
  isPubliclyReachable,
  meliFetch,
  readCrmPublication,
  readPublication,
  saveCrmPublication,
  savePublication,
  type MeliItem,
  type PublicationRow,
} from "../../meliItems.js";
import { challengeS256, newVerifier, randomToken } from "../../pkce.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
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
} from "../../../../shared/meliListing.js";
import { readConnection, recordConnectionCheck, toConnectionStatus } from "../connections.js";
import { withOptionalColumns } from "../dbCompat.js";
import { meliOutcome, type MeliActionResponse } from "../meliOutcome.js";
import { ITEM_ID, filterCrmPhotos, parseListing, parsePrevious, parseTarget, type MeliTarget } from "../meliRequest.js";
import { buildReturnUrl, parseReturnTarget, type ReturnTarget } from "../returnTo.js";
import type { AgencyScope, Availability, PortalAdapter, PublishRequest } from "../types.js";

/* ════════════════════════════ conexión (OAuth + PKCE) ═══════════════════ */

export const MELI_OAUTH_COOKIE = "meli_oauth";
const COOKIE_ATTRS = "HttpOnly; Secure; SameSite=Lax; Path=/api/meli";
export const MELI_CLEAR_COOKIE = `${MELI_OAUTH_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;

interface OauthCookie {
  state: string;
  verifier: string;
  agencyId: string;
  userId: string;
  exp: number;
  /** Destino al volver (nombre de una lista cerrada, ver returnTo.ts). Ausente en cookies viejas. */
  ret?: ReturnTarget;
}

/** URL de autorización + cookie cifrada con state/verifier/agencia. */
export function meliStartConnect(scope: AgencyScope, returnTo: unknown): { url: string; setCookie: string } {
  const state = randomToken(32);
  const verifier = newVerifier();
  const cookie = encrypt(
    JSON.stringify({
      state,
      verifier,
      agencyId: scope.agencyId,
      userId: scope.userId,
      exp: Date.now() + 10 * 60 * 1000,
      ret: parseReturnTarget(returnTo),
    } satisfies OauthCookie),
  );
  const url = new URL(MELI_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env("MELI_CLIENT_ID"));
  url.searchParams.set("redirect_uri", env("MELI_REDIRECT_URI"));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeS256(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url: url.toString(), setCookie: `${MELI_OAUTH_COOKIE}=${cookie}; ${COOKIE_ATTRS}; Max-Age=600` };
}

/** Texto legible para last_error según el motivo del callback. */
const CALLBACK_ERROR_TEXT: Record<string, string> = {
  token: "Mercado Libre no entregó la autorización.",
  offline: "La app de Mercado Libre no tiene el permiso para mantener la conexión abierta.",
  identity: "No pudimos leer los datos de la cuenta de Mercado Libre.",
  in_use: "Esa cuenta de Mercado Libre ya está conectada a otra inmobiliaria.",
  save: "No pudimos guardar la conexión.",
};

/**
 * Procesa la vuelta del login de Mercado Libre. Devuelve a dónde redirigir
 * (siempre APP_URL + un path fijo) y el motivo si falló (para los logs).
 */
export async function meliHandleCallback(
  query: { code?: string; state?: string; error?: string },
  rawCookie: string | null,
): Promise<{ location: string; reason?: string }> {
  let ret: ReturnTarget | undefined;
  let agencyForError: string | null = null;
  const back = async (reason?: string) => {
    if (reason && agencyForError && CALLBACK_ERROR_TEXT[reason]) {
      await recordConnectionCheck(agencyForError, "mercadolibre", CALLBACK_ERROR_TEXT[reason]).catch(() => undefined);
    }
    return { location: buildReturnUrl(appUrl(), ret, "meli", reason), reason };
  };

  try {
    // El destino sale de la cookie aunque el resto falle (si se puede leer).
    let c: OauthCookie | null = null;
    if (rawCookie) {
      try {
        c = JSON.parse(decrypt(rawCookie)) as OauthCookie;
        ret = parseReturnTarget(c.ret);
      } catch {
        c = null;
      }
    }
    if (query.error) return back("denied");
    const { code, state } = query;
    if (!code || !state || !rawCookie) return back("invalid");
    if (!c) return back("invalid");
    if (typeof c.exp !== "number" || Date.now() > c.exp) return back("expired");
    if (typeof c.state !== "string" || !safeEqual(c.state, state)) return back("state");
    agencyForError = c.agencyId;

    let tokens;
    try {
      tokens = await meliTokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: env("MELI_REDIRECT_URI"),
        code_verifier: c.verifier,
      });
    } catch {
      return back("token");
    }
    // Sin refresh token la conexión muere a las 6 h: la app tiene que tener el scope offline_access.
    if (!tokens.refresh_token) return back("offline");

    const me = await fetch(`${MELI_API}/users/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!me.ok) return back("identity");
    const who = (await me.json()) as { id?: number | string; nickname?: string };
    if (who.id == null) return back("identity");

    const db = supabaseAdmin();
    // Una cuenta de Mercado Libre pertenece a una sola inmobiliaria: si no, las
    // notificaciones (que solo traen el user_id) no sabrían a quién actualizar.
    const { data: taken } = await db
      .from("agency_integrations")
      .select("agency_id")
      .eq("provider", "mercadolibre")
      .eq("external_account_id", String(who.id))
      .neq("agency_id", c.agencyId)
      .limit(1);
    if (taken && taken.length > 0) return back("in_use");

    const row = {
      agency_id: c.agencyId,
      provider: "mercadolibre",
      status: "connected",
      external_account_id: String(who.id),
      account_label: who.nickname ?? null,
      access_token_enc: encrypt(tokens.access_token),
      refresh_token_enc: encrypt(tokens.refresh_token),
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : null,
      connected_by: c.userId,
      // Columnas de la migración 20261006120000 (si no está aplicada, se omiten).
      auth_method: "oauth",
      last_error: null,
      last_checked_at: new Date().toISOString(),
    };
    const { error } = await withOptionalColumns("connection", row, (r) =>
      db.from("agency_integrations").upsert(r, { onConflict: "agency_id,provider" }),
    );
    if (error) return back("save");
    return back();
  } catch {
    return back("server");
  }
}

/** Mismo shape que devolvía GET /api/meli/status. */
export async function meliStatusBody(scope: AgencyScope): Promise<Record<string, unknown>> {
  const isAdmin = scope.role === "admin";
  // Nunca se seleccionan las columnas de tokens acá.
  const { data, error } = await supabaseAdmin()
    .from("agency_integrations")
    .select("status, account_label, created_at")
    .eq("agency_id", scope.agencyId)
    .eq("provider", "mercadolibre")
    .maybeSingle();
  // Tabla inexistente (borrador SQL sin aplicar) u otro fallo: no rompe.
  if (error || !data) return { configured: true, connected: false, isAdmin };
  return {
    configured: true,
    connected: data.status === "connected",
    needsReauth: data.status === "needs_reauth",
    status: data.status,
    nickname: data.account_label ?? undefined,
    connectedAt: data.created_at,
    isAdmin,
  };
}

/** Revoca (mejor esfuerzo) y borra la conexión. Lanza si no se pudo borrar. */
export async function meliDisconnect(scope: AgencyScope): Promise<void> {
  const db = supabaseAdmin();
  const { data: row } = await db
    .from("agency_integrations")
    .select("external_account_id, access_token_enc")
    .eq("agency_id", scope.agencyId)
    .eq("provider", "mercadolibre")
    .maybeSingle();

  // Mejor esfuerzo: revocar la autorización de la app en Mercado Libre.
  // Su falla nunca bloquea el borrado local.
  if (row?.external_account_id && row.access_token_enc) {
    try {
      const user = encodeURIComponent(row.external_account_id);
      const app = encodeURIComponent(env("MELI_CLIENT_ID"));
      await fetch(`${MELI_API}/users/${user}/applications/${app}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${decrypt(row.access_token_enc)}` },
      });
    } catch {
      /* ignorado a propósito */
    }
  }

  const { error } = await db.from("agency_integrations").delete().eq("agency_id", scope.agencyId).eq("provider", "mercadolibre");
  if (error) throw new Error("server_error");
}

/* ════════════════════════════ publicación ═══════════════════════════════ */

export const MELI_ACTIONS = ["check", "publish", "update", "pause", "activate", "close", "sync"] as const;
export type MeliAction = (typeof MELI_ACTIONS)[number];

/** Compatibilidad: la lista blanca de la ficha vive en meliRequest.ts (se prueba sin red). */
export { parseListing };

/** Fotos de la fila de la app: Storage público del propio proyecto, o fotos que el aviso ya tiene en ML. */
function publicPhotos(photos: unknown, existing: string[] = []): string[] {
  if (!Array.isArray(photos)) return [];
  const prefix = `${env("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1/object/public/`;
  const known = new Set(existing);
  return photos.filter((u): u is string => typeof u === "string" && (u.startsWith(prefix) || known.has(u)));
}

/** URLs de las fotos que el aviso ya tiene en Mercado Libre. */
const itemPictureUrls = (item: MeliItem | null | undefined) =>
  (item?.pictures ?? []).flatMap((p) => [p.secure_url, p.url]).filter((u): u is string => !!u);

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

type PubPatch = Parameters<typeof savePublication>[2];

/** Dónde se lee y guarda la publicación según el destino (app o solo-CRM). */
interface PublicationStore {
  read(): Promise<PublicationRow | null>;
  save(patch: PubPatch): Promise<PublicationRow | null>;
  /** false = la base no tiene la migración de solo-CRM: la fila vuelve al navegador. */
  persisted: boolean;
}

async function openStore(
  db: ReturnType<typeof supabaseAdmin>,
  scope: AgencyScope,
  target: MeliTarget,
  connectionId: string,
): Promise<PublicationStore> {
  if (target.kind === "app") {
    const key = { agencyId: scope.agencyId, propertyId: target.propertyId, userId: scope.userId, isNew: true, connectionId };
    return {
      persisted: true,
      async read() {
        let row = await readPublication(db, target.propertyId);
        // Publicada como solo-CRM antes de sincronizarse con la app: se adopta esa fila.
        if (!row && target.crmPropertyId) row = await adoptCrmPublication(db, scope.agencyId, target.crmPropertyId, target.propertyId);
        key.isNew = !row;
        return row;
      },
      async save(patch) {
        const row = await savePublication(db, key, patch);
        key.isNew = false;
        return row;
      },
    };
  }
  const first = await readCrmPublication(db, scope.agencyId, target.crmPropertyId);
  let base = first.row;
  let isNew = !base;
  const store: PublicationStore = {
    persisted: first.available,
    async read() {
      return base;
    },
    async save(patch) {
      const row = await saveCrmPublication(
        db,
        { agencyId: scope.agencyId, crmPropertyId: target.crmPropertyId, userId: scope.userId, isNew, connectionId },
        patch,
        base,
      );
      isNew = false;
      base = row;
      store.persisted = !(row as { local_only?: boolean }).local_only;
      return row;
    },
  };
  return store;
}

/**
 * Una acción sobre el aviso de Mercado Libre de una propiedad de la agencia.
 * Devuelve EXACTAMENTE el status HTTP y el cuerpo que respondía
 * POST /api/meli/publish (el handler lo pasa tal cual). Agrega solo
 * `updatedExisting` cuando "publicar" terminó actualizando un aviso vivo, y
 * `storedOnServer` (false = la publicación quedó solo en el navegador).
 *
 * Destinos (ver meliRequest.ts):
 *  - `propertyId` (uuid de la app): como siempre; fotos de `properties.photos`.
 *  - `crmPropertyId` (solo CRM: pesos o sin sincronizar): ficha + `photos`
 *    del cliente, solo del bucket y carpeta de la agencia.
 *  - `previous: { externalId }`: aviso que el navegador recuerda (sin
 *    migración). Se usa SOLO si el aviso es de la cuenta conectada de la agencia.
 */
export async function runMeliAction(scope: AgencyScope, b: Record<string, unknown>): Promise<MeliActionResponse> {
  const out = (http: number, body: Record<string, unknown>): MeliActionResponse => ({ http, body });
  const action = b.action as MeliAction;
  const target = parseTarget(b);
  if (!MELI_ACTIONS.includes(action) || !target) return out(400, { error: "bad_request" });
  if (b.isSample === true) return out(422, { error: "sample", message: "Es una propiedad de ejemplo: no se publica en ningún portal." });
  if (action === "close" && scope.role !== "admin") {
    return out(403, { error: "forbidden", message: "Solo un administrador puede finalizar un aviso (no se puede deshacer)." });
  }

  const db = supabaseAdmin();
  let appPhotos: unknown = null;
  if (target.kind === "app") {
    const { data: prop } = await db.from("properties").select("id, agency_id, photos").eq("id", target.propertyId).maybeSingle();
    if (!prop || prop.agency_id !== scope.agencyId) {
      return out(404, { error: "property_not_found", message: "La propiedad no está sincronizada con la app o no es de tu inmobiliaria." });
    }
    appPhotos = prop.photos;
  }

  let session: MeliSession;
  try {
    session = await getMeliSession(scope.agencyId);
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const message =
      code === "meli_needs_reauth"
        ? "La conexión con Mercado Libre venció. Un administrador tiene que volver a conectar la cuenta."
        : code === "meli_unavailable"
          ? "Mercado Libre no respondió al renovar la sesión. Probá de nuevo en un rato."
          : "La inmobiliaria no tiene Mercado Libre conectado.";
    return out(409, { error: code || "meli_not_connected", message });
  }

  const store = await openStore(db, scope, target, session.connectionId);
  let existing = await store.read();
  let itemId = existing?.external_id && ITEM_ID.test(existing.external_id) ? existing.external_id : null;

  // El aviso actual en ML (fotos ya cargadas, si sigue vivo y de quién es).
  let current: MeliItem | null = null;
  let currentStatus = 0;
  const previous = itemId ? null : parsePrevious(b.previous);
  const lookup = itemId ?? previous?.externalId ?? null;
  if (lookup) {
    const r = await readItem(session, lookup);
    currentStatus = r.status;
    current = r.ok ? r.body : null;
  }
  if (!itemId && previous) {
    // Pista del navegador: solo vale si el aviso es de la cuenta conectada de ESTA agencia.
    if (current && String(current.seller_id ?? "") === session.userId) {
      itemId = previous.externalId;
      const mapped = mapMeliItemStatus(current);
      existing = {
        ...(existing ?? ({} as PublicationRow)),
        status: mapped.status,
        external_id: itemId,
        external_url: current.permalink ?? null,
        error_message: mapped.message,
      } as PublicationRow;
    } else {
      current = null;
      currentStatus = 0;
    }
  }

  const done = (row: PublicationRow | null, extra: Record<string, unknown> = {}) =>
    out(200, { row, storedOnServer: store.persisted, ...extra });

  /* ── acciones sobre un aviso existente ─────────────────────────────── */
  if (action === "sync" || action === "pause" || action === "activate" || action === "close") {
    if (!itemId) return out(409, { error: "not_published", message: "Esta propiedad todavía no tiene aviso en Mercado Libre." });
    if (action !== "sync") {
      const status = action === "pause" ? "paused" : action === "activate" ? "active" : "closed";
      const r = await meliFetch(session.token, `/items/${itemId}`, { method: "PUT", body: { status } });
      if (!r.ok) return out(422, { error: "meli_rejected", message: readableMeliError(r.status, r.body), row: existing });
    }
    const item = action === "sync" && current ? { ok: true, status: 200, body: current } : await readItem(session, itemId);
    if (!item.ok || !item.body) return out(502, { error: "meli_unavailable", message: readableMeliError(item.status, item.body), row: existing });
    const mapped = mapMeliItemStatus(item.body);
    const row = await store.save({
      status: mapped.status,
      error_message: mapped.message,
      external_id: itemId,
      external_url: item.body.permalink ?? existing?.external_url ?? null,
    });
    return done(row);
  }

  /* ── check / publish / update: hace falta la ficha ─────────────────── */
  const listing = parseListing(b.listing);
  if (!listing) return out(400, { error: "bad_listing" });
  const known = itemPictureUrls(current);
  let photos: string[];
  let rejectedPhotos = 0;
  if (target.kind === "app") photos = publicPhotos(appPhotos, known);
  else {
    const f = filterCrmPhotos(b.photos, {
      supabaseUrl: env("SUPABASE_URL"),
      agencyId: scope.agencyId,
      crmPropertyId: target.crmPropertyId,
      existing: known,
    });
    photos = f.photos;
    rejectedPhotos = f.rejected;
  }
  const prep = await prepare(listing, photos);
  if (rejectedPhotos > 0) {
    prep.issues.push({
      field: "pictures",
      blocking: false,
      message: `${rejectedPhotos} foto(s) no se mandan: solo se aceptan las subidas a la carpeta de tu inmobiliaria.`,
    });
  }
  const wanted: MeliListingType = MELI_LISTING_TYPES.some((t) => t.id === b.listingType) ? (b.listingType as MeliListingType) : "silver";

  // Si ya hay un aviso vivo, "publicar" es actualizarlo (no se duplica). Se mira el estado
  // real en Mercado Libre: un aviso cerrado (finalizado o sin cupo) no se puede editar.
  let live = !!itemId && existing?.status !== "removed";
  if (live && action === "publish" && (currentStatus === 404 || current?.status === "closed")) live = false;
  const mode: MeliAction = action === "publish" && live ? "update" : action;

  if (mode === "update" && !itemId) return out(409, { error: "not_published", message: "Esta propiedad todavía no tiene aviso en Mercado Libre." });
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
    return out(mode === "check" ? 200 : 422, {
      error: mode === "check" ? undefined : "invalid",
      issues: prep.issues,
      listingType,
      packNote,
      row: existing,
      storedOnServer: store.persisted,
    });
  }

  const description = plainDescription(listing.description);

  if (mode === "update") {
    const r = await meliFetch(session.token, `/items/${itemId}`, {
      method: "PUT",
      body: buildMeliUpdate(listing, prep.photos, prep.allowed, current?.pictures),
    });
    if (!r.ok) {
      const message = readableMeliError(r.status, r.body);
      const row = await store.save({ error_message: message, external_id: itemId });
      return out(422, { error: "meli_rejected", message, row, storedOnServer: store.persisted });
    }
    const descWarning = await putDescription(session, itemId!, description, false);
    const item = await readItem(session, itemId!);
    const mapped = item.body ? mapMeliItemStatus(item.body) : null;
    const row = await store.save({
      ...(mapped ? { status: mapped.status } : {}),
      external_id: itemId,
      error_message: descWarning ?? mapped?.message ?? null,
      external_url: item.body?.permalink ?? existing?.external_url ?? null,
    });
    return done(row, { warnings: descWarning ? [descWarning] : [], ...(action === "publish" ? { updatedExisting: true } : {}) });
  }

  // publish (aviso nuevo). Evita duplicados por doble clic: si hay un intento en curso reciente, no se repite.
  if (existing?.status === "pending" && !itemId && existing.updated_at && Date.now() - new Date(existing.updated_at).getTime() < 2 * 60 * 1000) {
    return out(409, { error: "in_progress", message: "Ya hay una publicación en curso para esta propiedad. Esperá unos segundos." });
  }
  await store.save({ status: "pending", error_message: null, external_id: null, external_url: null });

  const created = await meliFetch<MeliItem>(session.token, "/items", {
    method: "POST",
    body: buildMeliItem(listing, prep.photos, listingType, prep.allowed),
    timeoutMs: 25000,
  });
  // 402 (pago requerido): ML igual CREA el aviso, pero lo deja pendiente de pago
  // (sin cupo en un paquete de Inmuebles). Se guarda el id para no crear otro en
  // cada reintento y se explica qué falta.
  if (!created.ok && created.status === 402 && created.body?.id) {
    const pendingItem = created.body;
    console.warn("[meli/publish] creado pendiente de pago", pendingItem.id, pendingItem.status);
    const row = await store.save({
      status: "error",
      external_id: pendingItem.id,
      external_url: pendingItem.permalink ?? null,
      error_message:
        "Mercado Libre creó el aviso pero quedó pendiente de pago: tu cuenta no tiene cupo en un paquete de Inmuebles. Contratá o renová un paquete en Mercado Libre y después tocá «Actualizar estado».",
    });
    return out(422, { error: "meli_payment_required", message: row?.error_message ?? null, row, storedOnServer: store.persisted });
  }
  if (!created.ok || !created.body?.id) {
    // Sin respuesta (timeout/red) no se sabe si el aviso se creó: se avisa para no duplicarlo.
    const message =
      created.status === 0
        ? "Mercado Libre no respondió a tiempo. Antes de reintentar, revisá en tu cuenta de Mercado Libre si el aviso se creó, para no duplicarlo."
        : readableMeliError(created.status, created.body);
    // Para diagnosticar desde los logs de Vercel: estado + error/causas de ML (sin tokens ni datos personales).
    console.warn("[meli/publish] rechazo", created.status, JSON.stringify(created.body ?? null).slice(0, 1500));
    const row = await store.save({ status: "error", error_message: message });
    return out(422, { error: "meli_rejected", message, row, storedOnServer: store.persisted });
  }

  const item = created.body;
  const descWarning = await putDescription(session, item.id, description, true);
  const mapped = mapMeliItemStatus(item);
  const row = await store.save({
    status: mapped.status,
    external_id: item.id,
    external_url: item.permalink ?? null,
    error_message: descWarning ?? mapped.message,
    published_at: new Date().toISOString(),
  });
  const warnings = [descWarning, packNote].filter((w): w is string => !!w);
  return done(row, { warnings });
}

/* ════════════════════════════ adapter ═══════════════════════════════════ */

function availability(): Availability {
  return isConfigured()
    ? { state: "available" }
    : { state: "not_configured", reason: "La conexión con Mercado Libre todavía no está configurada en el servidor." };
}

const body = (req: PublishRequest, action: MeliAction) => ({
  action,
  ...(req.propertyId ? { propertyId: req.propertyId } : {}),
  crmPropertyId: req.crmPropertyId ?? undefined,
  listing: req.input.listing,
  listingType: req.input.listingType,
  // Solo-CRM: fotos (se filtran a la carpeta de la agencia) y aviso que recuerda el navegador.
  photos: req.input.photos,
  previous: req.input.previous,
});

export const MercadoLibreAdapter: PortalAdapter = {
  id: "mercadolibre",
  name: "Mercado Libre Inmuebles",
  authMethod: "oauth",
  channels: ["mercadolibre"],
  supportsCrmOnly: true,
  availability,

  async status(scope) {
    const av = availability();
    if (av.state !== "available") return toConnectionStatus("mercadolibre", "oauth", av, null);
    return toConnectionStatus("mercadolibre", "oauth", av, await readConnection(scope.agencyId, "mercadolibre"));
  },
  async connect(scope, { returnTo }) {
    return meliStartConnect(scope, returnTo);
  },
  disconnect: meliDisconnect,
  async refresh(scope) {
    await getMeliSession(scope.agencyId);
  },

  async validate(req) {
    return meliOutcome(await runMeliAction(req.scope, body(req, "check")), "check");
  },
  async publish(req) {
    return meliOutcome(await runMeliAction(req.scope, body(req, "publish")), "publish");
  },
  async update(req) {
    return meliOutcome(await runMeliAction(req.scope, body(req, "update")), "update");
  },
  async lifecycle(req, action) {
    return meliOutcome(await runMeliAction(req.scope, { ...body(req, action), listing: undefined }), "lifecycle");
  },
  mapStatus(raw) {
    return mapMeliItemStatus(raw as MeliItem);
  },
};
