/**
 * Datos del CRM en la base propia (tabla `crm_records`). Ver docs/datos-en-la-base.md.
 *
 *   GET  pull?since=N     registros con versión > N del ámbito del usuario, de a
 *                         PULL_PAGE_SIZE → { scope, records, version, more }
 *   POST push { items }   crea/actualiza/borra (tumbas) en una transacción → { version }
 *   POST upload { propertyId, dataUrl }   foto al bucket público crm-photos → { url }
 *
 * El ámbito (`scope`) sale del JWT: la inmobiliaria del usuario o, si no está
 * vinculado, su propio uuid. El cuerpo nunca lo nombra. La primera vez que un
 * usuario vinculado entra, lo que cargó solo pasa a la inmobiliaria si esta
 * estaba vacía (`crm_adopt_scope`).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { requireUser, type UserContext } from "../auth.js";
import { allowMethod, fail, json } from "../http.js";
import { crmDb } from "../inbox/db.js";
import { NO_DB_MESSAGE, missingTable } from "../gcal/db.js";
import { authConfigured, crmDbConfigured } from "../gcal/env.js";
import { PULL_PAGE_SIZE, parsePushBody, parseSince, parseUploadBody, type CrmStoredRecord } from "../../../shared/crmSync.js";

const body = (req: VercelRequest) => (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;

const scopeOf = (ctx: UserContext) => ctx.agencyId ?? ctx.userId;

async function guard(req: VercelRequest, res: VercelResponse, method: "GET" | "POST"): Promise<UserContext | null> {
  if (!allowMethod(req, res, method)) return null;
  if (!authConfigured()) {
    fail(res, 503, "not_configured");
    return null;
  }
  if (!crmDbConfigured()) {
    json(res, 503, { error: "no_db", message: NO_DB_MESSAGE });
    return null;
  }
  return requireUser(req, res);
}

function dbError(res: VercelResponse, e: unknown) {
  if (missingTable(e as { code?: string; message?: string })) return json(res, 503, { error: "no_db", message: NO_DB_MESSAGE });
  fail(res, 500, "server_error");
}

/* ── Lectura ──────────────────────────────────────────────────────────────── */

export async function pull(req: VercelRequest, res: VercelResponse) {
  const ctx = await guard(req, res, "GET");
  if (!ctx) return;
  const scope = scopeOf(ctx);
  const since = parseSince(req.query?.since);
  const db = crmDb();
  try {
    // Cuenta recién vinculada: lo que cargó a su nombre pasa a la inmobiliaria (si está vacía).
    if (ctx.agencyId && since === 0) {
      const { error } = await db.rpc("crm_adopt_scope", { p_from: ctx.userId, p_to: ctx.agencyId });
      if (error) return dbError(res, error);
    }
    const { data, error } = await db
      .from("crm_records")
      .select("kind, id, data, deleted, version, updated_by")
      .eq("scope_id", scope)
      .gt("version", since)
      .order("version", { ascending: true })
      .limit(PULL_PAGE_SIZE);
    if (error) return dbError(res, error);
    const records = (data ?? []) as CrmStoredRecord[];
    const version = records.length ? records[records.length - 1].version : since;
    json(res, 200, { scope, records, version, more: records.length === PULL_PAGE_SIZE });
  } catch (e) {
    dbError(res, e);
  }
}

/* ── Escritura ────────────────────────────────────────────────────────────── */

export async function push(req: VercelRequest, res: VercelResponse) {
  const ctx = await guard(req, res, "POST");
  if (!ctx) return;
  const items = parsePushBody(body(req));
  if (!items) return fail(res, 400, "bad_request");
  try {
    const { data, error } = await crmDb().rpc("crm_push", { p_scope: scopeOf(ctx), p_user: ctx.userId, p_items: items });
    if (error) return dbError(res, error);
    json(res, 200, { version: Number(data ?? 0) });
  } catch (e) {
    dbError(res, e);
  }
}

/* ── Fotos ────────────────────────────────────────────────────────────────── */

const BUCKET = "crm-photos";

export async function upload(req: VercelRequest, res: VercelResponse) {
  const ctx = await guard(req, res, "POST");
  if (!ctx) return;
  const file = parseUploadBody(body(req));
  if (!file) return fail(res, 400, "bad_request");
  const path = `${scopeOf(ctx)}/${file.propertyId}/${randomUUID()}.${file.ext}`;
  try {
    const storage = crmDb().storage.from(BUCKET);
    const { error } = await storage.upload(path, file.bytes, { contentType: file.mime, upsert: false, cacheControl: "31536000" });
    if (error) return fail(res, 502, "upload_failed");
    json(res, 200, { url: storage.getPublicUrl(path).data.publicUrl });
  } catch {
    fail(res, 500, "server_error");
  }
}
