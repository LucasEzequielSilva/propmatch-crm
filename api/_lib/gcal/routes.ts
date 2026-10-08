/**
 * Opción A: conexión directa con Google Calendar, por agente (OAuth + PKCE).
 * Ver docs/google-calendar.md.
 *
 *   GET  gcal-status                          estado de MI conexión (sin tokens)
 *   POST gcal-connect   { return? }            → { url } de consentimiento (cookie con state/verifier)
 *   GET  gcal-callback                         vuelta de Google → /agenda?gcal=ok|error
 *   POST gcal-disconnect                       revoca el token en Google y borra la conexión
 *   POST gcal-upsert    { items }  (hasta 10)  crea/actualiza eventos (id determinístico, idempotente)
 *   POST gcal-delete    { items }  (hasta 20)  borra eventos de PropMatch
 *   POST gcal-pull      { syncToken?, pageToken?, busy?, titles? }
 *                       cambios incrementales de los eventos de PropMatch + «Ocupado» de la ventana
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { requireAgencyMember } from "../auth.js";
import { decrypt, encrypt } from "../crypto.js";
import { allowMethod, fail, json, readCookie, redirect } from "../http.js";
import { challengeS256, newVerifier, randomToken } from "../pkce.js";
import {
  GCAL_SCOPES,
  buildGcalReturnUrl,
  buildGoogleEvent,
  busyFromItems,
  changesFromItems,
  detectConflict,
  emailFromIdToken,
  googleEventIdFromDigest,
  grantedCalendarScope,
  parseDeleteBody,
  parseGcalReturn,
  parseGoogleEvent,
  parsePullBody,
  parseUpsertBody,
  timesOf,
  type GcalBusy,
  type GcalChange,
} from "../../../shared/gcal.js";
import { NO_DB_MESSAGE, NoDb } from "./db.js";
import { appBaseUrl, authConfigured, crmDbConfigured, googleClient, googleConfigured } from "./env.js";
import { GoogleTokenError, exchangeCode, revokeToken } from "./google.js";
import { GCAL_CLEAR_COOKIE, GCAL_OAUTH_COOKIE, OAUTH_TTL_MS, buildAuthUrl, checkCallback, oauthCookieHeader, parseOauthCookie } from "./oauth.js";
import { GcalError, deleteConnection, getSession, patchConnection, readConnection, saveConnection, type GcalSession } from "./connections.js";

const body = (req: VercelRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ERROR_HTTP: Record<GcalError["code"], number> = { not_connected: 409, needs_reauth: 409, google_error: 502, rate_limited: 429 };

function handleError(res: VercelResponse, e: unknown) {
  if (e instanceof NoDb) return json(res, 503, { error: "no_db", message: NO_DB_MESSAGE });
  if (e instanceof GcalError) return fail(res, ERROR_HTTP[e.code], e.code);
  fail(res, 500, "server_error");
}

/** Sesión del CRM + base configurada. Para status la falta de Google no corta. */
async function guard(req: VercelRequest, res: VercelResponse, method: "GET" | "POST", needGoogle = true) {
  if (!allowMethod(req, res, method)) return null;
  if (!authConfigured()) {
    fail(res, 503, "not_configured");
    return null;
  }
  if (needGoogle && !googleConfigured()) {
    fail(res, 503, "not_configured");
    return null;
  }
  if (!crmDbConfigured()) {
    json(res, 503, { error: "no_db", message: NO_DB_MESSAGE });
    return null;
  }
  return requireAgencyMember(req, res);
}

/** Id del evento en Google: el mismo para el mismo agente + ítem del CRM, siempre. */
const eventIdFor = (userId: string, pmId: string) =>
  googleEventIdFromDigest(createHash("sha256").update(`${userId}:${pmId}`).digest());

/* ── Estado ───────────────────────────────────────────────────────────────── */

export async function gcalStatus(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  const configured = googleConfigured();
  const empty = { configured, db: false, state: "not_connected", email: null, calendarId: null, connectedAt: null, lastSyncAt: null, lastError: null };
  if (!authConfigured()) return fail(res, 503, "not_configured");
  if (!crmDbConfigured()) return json(res, 200, empty);
  try {
    const ctx = await requireAgencyMember(req, res);
    if (!ctx) return;
    const row = await readConnection(ctx.userId);
    json(res, 200, {
      ...empty,
      db: true,
      state: row ? row.status : "not_connected",
      email: row?.google_email ?? null,
      calendarId: row?.calendar_id ?? null,
      connectedAt: row?.connected_at ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      lastError: row?.last_error ?? null,
    });
  } catch (e) {
    if (e instanceof NoDb) return json(res, 200, empty);
    fail(res, 500, "server_error");
  }
}

/* ── OAuth ────────────────────────────────────────────────────────────────── */

export async function gcalConnect(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    await readConnection(ctx.userId); // si falta la migración, avisa antes de mandar a Google
    const state = randomToken(32);
    const verifier = newVerifier();
    const cookie = encrypt(
      JSON.stringify({ state, verifier, userId: ctx.userId, agencyId: ctx.agencyId, exp: Date.now() + OAUTH_TTL_MS, ret: parseGcalReturn(body(req).return) }),
    );
    const { id, redirectUri } = googleClient();
    res.setHeader("Set-Cookie", oauthCookieHeader(cookie));
    json(res, 200, { url: buildAuthUrl({ clientId: id, redirectUri, state, challenge: challengeS256(verifier), scopes: GCAL_SCOPES }) });
  } catch (e) {
    handleError(res, e);
  }
}

export async function gcalCallback(req: VercelRequest, res: VercelResponse) {
  if (!allowMethod(req, res, "GET")) return;
  const base = appBaseUrl();
  if (!googleConfigured() || !crmDbConfigured() || !base) return fail(res, 503, "not_configured");
  res.setHeader("Set-Cookie", GCAL_CLEAR_COOKIE);

  let cookie = null;
  const raw = readCookie(req, GCAL_OAUTH_COOKIE);
  if (raw) {
    try {
      cookie = parseOauthCookie(decrypt(raw));
    } catch {
      cookie = null;
    }
  }
  const back = (reason?: string) => {
    // Solo el motivo (nunca códigos ni tokens), para diagnosticar desde los logs de Vercel.
    if (reason) console.warn(`[gcal/callback] fallo: ${reason}`);
    redirect(res, buildGcalReturnUrl(base, cookie?.ret, reason));
  };

  const check = checkCallback({ code: one(req.query.code), state: one(req.query.state), error: one(req.query.error) }, cookie, Date.now());
  if (!check.ok) return back(check.reason);
  const c = check.cookie;

  try {
    let tokens;
    try {
      tokens = await exchangeCode(check.code, c.verifier);
    } catch (e) {
      return back(e instanceof GoogleTokenError && e.kind === "revoked" ? "expired" : "token");
    }
    // El agente puede destildar el permiso del calendario en la pantalla de Google.
    if (!grantedCalendarScope(tokens.scope)) {
      await revokeToken(tokens.access_token);
      return back("scope");
    }
    if (!tokens.refresh_token) return back("offline");
    const who = emailFromIdToken(tokens.id_token);
    const now = new Date().toISOString();
    await saveConnection({
      app_user_id: c.userId,
      agency_id: c.agencyId,
      google_email: who.email,
      google_sub: who.sub,
      refresh_token_enc: encrypt(tokens.refresh_token),
      access_token_enc: encrypt(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      scopes: tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : null,
      // Calendario principal: con el scope mínimo (calendar.events) no se pueden crear calendarios.
      calendar_id: "primary",
      sync_token: null,
      status: "connected",
      last_error: null,
      connected_at: now,
    });
    back();
  } catch (e) {
    back(e instanceof NoDb ? "no_db" : "save");
  }
}

export async function gcalDisconnect(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST", false);
    if (!ctx) return;
    const row = await readConnection(ctx.userId);
    if (row) {
      try {
        await revokeToken(decrypt(row.refresh_token_enc));
      } catch {
        // Clave rotada o token ilegible: igual se borra.
      }
      await deleteConnection(ctx.userId);
    }
    json(res, 200, { ok: true });
  } catch (e) {
    handleError(res, e);
  }
}

/* ── CRM → Google ─────────────────────────────────────────────────────────── */

export async function gcalUpsert(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    const items = parseUpsertBody(body(req));
    if (!items) return fail(res, 400, "bad_request");
    const s = await getSession(ctx.userId);
    const appUrl = appBaseUrl()!;
    const results = [];
    for (const item of items) {
      const id = eventIdFor(ctx.userId, item.propmatchId);
      const path = `${s.calendarPath}/events/${id}`;
      const got = await s.request("GET", path);
      if (got.status !== 200 && got.status !== 404 && got.status !== 410) {
        results.push({ propmatchId: item.propmatchId, googleEventId: id, ok: false, error: "google_error" });
        continue;
      }
      const lite = got.status === 200 ? parseGoogleEvent(got.body) : null;
      const conflict = detectConflict({ google: lite, known: item.known, crmUpdatedAt: item.crmUpdatedAt });
      if (conflict !== "none") {
        results.push({ propmatchId: item.propmatchId, googleEventId: id, ok: false, conflict, google: { times: lite ? timesOf(lite) : null, updated: lite?.updated ?? null } });
        continue;
      }
      const event = buildGoogleEvent(item, { googleEventId: id, appUrl });
      let w = lite ? await s.request("PUT", path, { body: event }) : await s.request("POST", `${s.calendarPath}/events`, { body: event });
      // 409: el id ya existe (borrado hace poco, o carrera con otra pestaña) → se actualiza.
      if (!lite && w.status === 409) w = await s.request("PUT", path, { body: event });
      const ok = w.status === 200;
      const updated = ok ? parseGoogleEvent(w.body)?.updated ?? null : null;
      results.push({ propmatchId: item.propmatchId, googleEventId: id, ok, updated, ...(ok ? {} : { error: "google_error" }) });
    }
    json(res, 200, { results });
  } catch (e) {
    handleError(res, e);
  }
}

export async function gcalDelete(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    const ids = parseDeleteBody(body(req));
    if (!ids) return fail(res, 400, "bad_request");
    const s = await getSession(ctx.userId);
    const results = [];
    for (const pmId of ids) {
      const r = await s.request("DELETE", `${s.calendarPath}/events/${eventIdFor(ctx.userId, pmId)}`, { query: { sendUpdates: "none" } });
      // 404/410: ya no estaba (lo borró el agente en Google): para nosotros, listo.
      results.push({ propmatchId: pmId, ok: r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410 });
    }
    json(res, 200, { results });
  } catch (e) {
    handleError(res, e);
  }
}

/* ── Google → CRM ─────────────────────────────────────────────────────────── */

const MAX_PAGES = 4;
const SYNC_FIELDS = "items(id,status,updated,start,end,extendedProperties),nextPageToken,nextSyncToken";
const BUSY_FIELDS = "items(id,status,start,end,summary,transparency,attendees(self,responseStatus),extendedProperties),nextPageToken";

async function incremental(s: GcalSession, syncToken: string | null, pageToken: string | null) {
  const changes: GcalChange[] = [];
  let reset = false;
  let token = syncToken;
  let page = pageToken;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = await s.request<{ items?: unknown[]; nextPageToken?: string; nextSyncToken?: string }>("GET", `${s.calendarPath}/events`, {
      query: { syncToken: token ?? undefined, pageToken: page ?? undefined, showDeleted: token ? "true" : undefined, maxResults: "1000", fields: SYNC_FIELDS },
    });
    // 410: el syncToken venció → sincronización completa desde cero.
    if (r.status === 410 && !reset) {
      reset = true;
      token = null;
      page = null;
      changes.length = 0;
      i = -1;
      continue;
    }
    if (r.status !== 200 || !r.body) throw new GcalError("google_error");
    changes.push(...changesFromItems(r.body.items ?? []));
    if (r.body.nextSyncToken) return { changes, reset, nextSyncToken: r.body.nextSyncToken, nextPageToken: null };
    if (!r.body.nextPageToken) break;
    page = r.body.nextPageToken;
  }
  // Quedan páginas: el navegador vuelve a llamar con nextPageToken (sin perder el syncToken que tiene).
  return { changes, reset, nextSyncToken: null, nextPageToken: page };
}

async function busyWindow(s: GcalSession, w: { timeMin: string; timeMax: string }, titles: boolean): Promise<GcalBusy[]> {
  const out: GcalBusy[] = [];
  let page: string | undefined;
  for (let i = 0; i < 2; i++) {
    const r = await s.request<{ items?: unknown[]; nextPageToken?: string }>("GET", `${s.calendarPath}/events`, {
      query: { timeMin: w.timeMin, timeMax: w.timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250", pageToken: page, fields: BUSY_FIELDS },
    });
    if (r.status !== 200 || !r.body) throw new GcalError("google_error");
    out.push(...busyFromItems(r.body.items ?? [], { titles }));
    page = r.body.nextPageToken;
    if (!page) break;
  }
  return out;
}

export async function gcalPull(req: VercelRequest, res: VercelResponse) {
  let userId: string | null = null;
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    userId = ctx.userId;
    const p = parsePullBody(body(req));
    if (!p) return fail(res, 400, "bad_request");
    const s = await getSession(ctx.userId);
    const inc = await incremental(s, p.syncToken, p.pageToken);
    const busy = p.busy && !p.pageToken ? await busyWindow(s, p.busy, p.titles) : null;
    const lastSyncAt = new Date().toISOString();
    // Copia del último syncToken: hoy manda el del navegador (la agenda es local);
    // queda guardado para cuando haya push notifications (ver docs).
    await patchConnection(ctx.userId, {
      last_sync_at: lastSyncAt,
      last_error: null,
      status: "connected",
      ...(inc.nextSyncToken ? { sync_token: inc.nextSyncToken } : {}),
    });
    json(res, 200, { ...inc, busy, lastSyncAt });
  } catch (e) {
    if (e instanceof GcalError && e.code === "google_error" && userId) {
      await patchConnection(userId, { last_error: "Google no respondió bien en la última sincronización." }).catch(() => undefined);
    }
    handleError(res, e);
  }
}
