/**
 * Opción B: link de suscripción iCal por agente (Google Calendar → «Otros
 * calendarios» → «Desde URL»). Ver docs/google-calendar.md.
 *
 *   GET  gcal-feed-status            ¿tengo un link activo? (nunca devuelve el link: no lo guardamos)
 *   POST gcal-feed-create  { items? } genera el link (UNA vez) y guarda el snapshot inicial
 *   POST gcal-feed-rotate  { items? } link nuevo; el anterior deja de andar en el acto
 *   POST gcal-feed-revoke             desactiva el link
 *   POST gcal-feed-push    { items }  snapshot de la agenda del agente (ver shared/gcal.ts)
 *   GET  /api/integrations/calendar/<token>.ics   PÚBLICO: el .ics (404 si no existe o se desactivó)
 *
 * En la base (Supabase PROPIO del CRM, tabla calendar_feeds) queda solo el
 * sha256 del token y los ítems ya validados; el .ics lo arma el servidor en
 * cada pedido. El navegador nunca manda texto .ics.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAgencyMember } from "../auth.js";
import { allowMethod, fail, json, noStore } from "../http.js";
import { crmDb } from "../inbox/db.js";
import { appBaseUrl, authConfigured, crmDbConfigured } from "./env.js";
import { hashFeedToken, newFeedToken } from "./feedToken.js";
import { NO_DB_MESSAGE, NoDb, missingTable } from "./db.js";
import { buildIcsCalendar } from "../../../shared/ics.js";
import {
  FEED_FUTURE_DAYS,
  FEED_MAX_BODY_CHARS,
  FEED_MIN_PUSH_SECONDS,
  FEED_PAST_DAYS,
  feedIcsEvents,
  feedTokenFromFile,
  parseFeedBody,
  parseItem,
  type GcalItem,
} from "../../../shared/gcal.js";

const TABLE = "calendar_feeds";

const body = (req: VercelRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

function feedUrl(token: string): string | null {
  const base = appBaseUrl();
  return base ? `${base}/api/integrations/calendar/${token}.ics` : null;
}

interface ActiveRow {
  id: string;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  event_count: number;
}

async function activeFeed(userId: string): Promise<ActiveRow | null> {
  const { data, error } = await crmDb()
    .from(TABLE)
    .select("id, created_at, updated_at, pushed_at, event_count")
    .eq("app_user_id", userId)
    .is("revoked_at", null)
    .maybeSingle();
  if (missingTable(error)) throw new NoDb();
  if (error) throw new Error("db");
  return (data as ActiveRow | null) ?? null;
}

const statusBody = (row: ActiveRow | null) => ({
  db: true,
  active: !!row,
  createdAt: row?.created_at ?? null,
  pushedAt: row?.pushed_at ?? null,
  eventCount: row?.event_count ?? 0,
  window: { pastDays: FEED_PAST_DAYS, futureDays: FEED_FUTURE_DAYS },
});

/** Común a las acciones autenticadas: base configurada + sesión. */
async function guard(req: VercelRequest, res: VercelResponse, method: "GET" | "POST") {
  if (!allowMethod(req, res, method)) return null;
  if (!authConfigured()) {
    fail(res, 503, "not_configured");
    return null;
  }
  if (!crmDbConfigured()) {
    json(res, method === "GET" ? 200 : 503, method === "GET" ? { db: false, active: false } : { error: "no_db", message: NO_DB_MESSAGE });
    return null;
  }
  return requireAgencyMember(req, res);
}

function handleError(res: VercelResponse, e: unknown, isGet = false) {
  if (e instanceof NoDb) {
    return isGet ? json(res, 200, { db: false, active: false }) : json(res, 503, { error: "no_db", message: NO_DB_MESSAGE });
  }
  fail(res, 500, "server_error");
}

/** Ítems opcionales para el snapshot inicial; si vienen mal, arranca vacío. */
function initialItems(req: VercelRequest): GcalItem[] {
  return parseFeedBody(body(req), new Date()) ?? [];
}

export async function feedStatus(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "GET");
    if (!ctx) return;
    json(res, 200, statusBody(await activeFeed(ctx.userId)));
  } catch (e) {
    handleError(res, e, true);
  }
}

async function insertFeed(ctx: { userId: string; agencyId: string }, items: GcalItem[]) {
  const token = newFeedToken();
  const now = new Date().toISOString();
  const { data, error } = await crmDb()
    .from(TABLE)
    .insert({
      app_user_id: ctx.userId,
      agency_id: ctx.agencyId,
      token_hash: hashFeedToken(token),
      events: items,
      event_count: items.length,
      pushed_at: items.length ? now : null,
    })
    .select("id, created_at, updated_at, pushed_at, event_count")
    .single();
  if (missingTable(error)) throw new NoDb();
  // 23505: carrera con otro pedido que creó el link activo al mismo tiempo.
  if (error?.code === "23505") return { conflict: true as const };
  if (error || !data) throw new Error("db");
  return { conflict: false as const, token, row: data as ActiveRow };
}

export async function feedCreate(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    if (!appBaseUrl()) return fail(res, 503, "not_configured");
    if (await activeFeed(ctx.userId)) {
      return json(res, 409, {
        error: "exists",
        message: "Ya tenés un link activo. Si no lo tenés a mano, generá uno nuevo (el anterior deja de andar).",
      });
    }
    const r = await insertFeed(ctx, initialItems(req));
    if (r.conflict) return json(res, 409, { error: "exists", message: "Ya tenés un link activo." });
    json(res, 200, { url: feedUrl(r.token), ...statusBody(r.row) });
  } catch (e) {
    handleError(res, e);
  }
}

async function revokeActive(userId: string) {
  const { error } = await crmDb()
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString(), events: [], event_count: 0 })
    .eq("app_user_id", userId)
    .is("revoked_at", null);
  if (missingTable(error)) throw new NoDb();
  if (error) throw new Error("db");
}

export async function feedRotate(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    if (!appBaseUrl()) return fail(res, 503, "not_configured");
    // Se conservan los eventos del link anterior si el navegador no manda nuevos.
    let items = initialItems(req);
    if (items.length === 0) {
      const { data } = await crmDb().from(TABLE).select("events").eq("app_user_id", ctx.userId).is("revoked_at", null).maybeSingle();
      const prev = Array.isArray(data?.events) ? (data!.events as unknown[]) : [];
      items = prev.map(parseItem).filter((i): i is GcalItem => !!i);
    }
    await revokeActive(ctx.userId);
    const r = await insertFeed(ctx, items);
    if (r.conflict) return json(res, 409, { error: "exists", message: "Ya tenés un link activo." });
    json(res, 200, { url: feedUrl(r.token), ...statusBody(r.row) });
  } catch (e) {
    handleError(res, e);
  }
}

export async function feedRevoke(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    await revokeActive(ctx.userId);
    json(res, 200, { ok: true, ...statusBody(null) });
  } catch (e) {
    handleError(res, e);
  }
}

export async function feedPush(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await guard(req, res, "POST");
    if (!ctx) return;
    const b = body(req);
    if (JSON.stringify(b).length > FEED_MAX_BODY_CHARS) return json(res, 413, { error: "too_large", message: "La agenda es demasiado grande para el link." });
    const items = parseFeedBody(b, new Date());
    if (!items) return fail(res, 400, "bad_request");
    const row = await activeFeed(ctx.userId);
    if (!row) return json(res, 404, { error: "no_feed", message: "No tenés un link activo." });
    if (row.pushed_at && Date.now() - Date.parse(row.pushed_at) < FEED_MIN_PUSH_SECONDS * 1000) {
      res.setHeader("Retry-After", String(FEED_MIN_PUSH_SECONDS));
      return json(res, 429, { error: "rate_limited", message: "Demasiados cambios seguidos. Probá en unos segundos." });
    }
    const now = new Date().toISOString();
    const { error } = await crmDb()
      .from(TABLE)
      .update({ events: items, event_count: items.length, pushed_at: now, updated_at: now })
      .eq("id", row.id)
      .is("revoked_at", null);
    if (error) throw new Error("db");
    json(res, 200, statusBody({ ...row, pushed_at: now, event_count: items.length }));
  } catch (e) {
    handleError(res, e);
  }
}

/**
 * GET/HEAD /api/integrations/calendar/<token>.ics — público (lo pide Google
 * desde sus servidores). Cualquier problema → 404 sin detalles.
 */
export async function feedServe(req: VercelRequest, res: VercelResponse) {
  const notFound = () => {
    noStore(res);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(404).send("Not found");
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    noStore(res);
    return res.status(405).end();
  }
  const token = feedTokenFromFile(req.query.file);
  const base = appBaseUrl();
  if (!token || !base || !crmDbConfigured()) return notFound();
  try {
    const { data, error } = await crmDb()
      .from(TABLE)
      .select("events")
      .eq("token_hash", hashFeedToken(token))
      .is("revoked_at", null)
      .maybeSingle();
    if (error || !data) return notFound();
    const raw = Array.isArray(data.events) ? (data.events as unknown[]) : [];
    const items = raw.map(parseItem).filter((i): i is GcalItem => !!i);
    const ics = buildIcsCalendar(feedIcsEvents(items, base), { product: "Agenda", name: "PropMatch — Mi agenda", refreshMinutes: 60 });
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'inline; filename="propmatch-agenda.ics"');
    // Corto: si el agente desactiva el link, deja de servirse en minutos.
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method === "HEAD") return res.status(200).end();
    res.status(200).send(ics);
  } catch {
    notFound();
  }
}
