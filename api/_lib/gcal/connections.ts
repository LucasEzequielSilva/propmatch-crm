/**
 * Conexiones de Google Calendar (una por agente) en el Supabase PROPIO del
 * CRM: tabla google_calendar_connections (migración 20261008120100, sin
 * aplicar). Tokens cifrados con AES-256-GCM (INTEGRATIONS_ENC_KEY, el mismo
 * helper que Mercado Libre). Refresh automático del access token.
 */
import { decrypt, encrypt } from "../crypto.js";
import { crmDb } from "../inbox/db.js";
import { NoDb, missingTable } from "./db.js";
import { GoogleTokenError, calendarRequest, refreshAccessToken, type CalResponse } from "./google.js";

const TABLE = "google_calendar_connections";

export type ConnStatus = "connected" | "needs_reauth" | "error";

export interface ConnRow {
  app_user_id: string;
  agency_id: string;
  google_email: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_token_expires_at: string | null;
  calendar_id: string;
  sync_token: string | null;
  status: ConnStatus;
  last_error: string | null;
  last_sync_at: string | null;
  connected_at: string;
}

const COLS =
  "app_user_id, agency_id, google_email, refresh_token_enc, access_token_enc, access_token_expires_at, calendar_id, sync_token, status, last_error, last_sync_at, connected_at";

export const REAUTH_MESSAGE = "Google desconectó PropMatch de tu cuenta. Volvé a conectar.";

/** Error con código para la respuesta (la UI lo traduce). */
export class GcalError extends Error {
  constructor(public code: "not_connected" | "needs_reauth" | "google_error" | "rate_limited") {
    super(code);
  }
}

export async function readConnection(userId: string): Promise<ConnRow | null> {
  const { data, error } = await crmDb().from(TABLE).select(COLS).eq("app_user_id", userId).maybeSingle();
  if (missingTable(error)) throw new NoDb();
  if (error) throw new Error("db");
  return (data as ConnRow | null) ?? null;
}

export async function saveConnection(row: Omit<ConnRow, "last_sync_at"> & { scopes: string[] | null; google_sub: string | null }): Promise<void> {
  const { error } = await crmDb()
    .from(TABLE)
    .upsert({ ...row, last_sync_at: null, updated_at: new Date().toISOString() }, { onConflict: "app_user_id" });
  if (missingTable(error)) throw new NoDb();
  if (error) throw new Error("db");
}

export async function patchConnection(userId: string, patch: Partial<ConnRow>): Promise<void> {
  await crmDb()
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("app_user_id", userId);
}

export async function deleteConnection(userId: string): Promise<void> {
  const { error } = await crmDb().from(TABLE).delete().eq("app_user_id", userId);
  if (missingTable(error)) throw new NoDb();
  if (error) throw new Error("db");
}

/** Sesión lista para llamar a la API de Calendar con el token del agente. */
export class GcalSession {
  private token: string;
  constructor(
    private row: ConnRow,
    token: string,
  ) {
    this.token = token;
  }

  get calendarPath(): string {
    return `/calendars/${encodeURIComponent(this.row.calendar_id || "primary")}`;
  }

  get userId(): string {
    return this.row.app_user_id;
  }

  /** Llama a Calendar; si Google dice 401, refresca una vez y reintenta. */
  async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
  ): Promise<CalResponse<T>> {
    let r = await calendarRequest<T>(this.token, method, path, opts);
    if (r.status === 401) {
      this.token = await refresh(this.row);
      r = await calendarRequest<T>(this.token, method, path, opts);
    }
    if (r.status === 401) throw await reauth(this.row.app_user_id);
    if (r.status === 429 || (r.status === 403 && isRateLimit(r.body))) throw new GcalError("rate_limited");
    if (r.status === 403 && isScopeProblem(r.body)) throw await reauth(this.row.app_user_id, "Falta el permiso del calendario. Volvé a conectar y tildá «Ver y editar eventos».");
    return r;
  }
}

function reason(body: unknown): string {
  const errs = (body as { error?: { errors?: { reason?: string }[]; status?: string } } | null)?.error;
  return [errs?.status, ...(errs?.errors ?? []).map((e) => e.reason)].filter(Boolean).join(" ");
}

const isRateLimit = (b: unknown) => /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason(b));
const isScopeProblem = (b: unknown) => /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(reason(b));

async function reauth(userId: string, message = REAUTH_MESSAGE): Promise<GcalError> {
  await patchConnection(userId, { status: "needs_reauth", last_error: message, access_token_enc: null }).catch(() => undefined);
  return new GcalError("needs_reauth");
}

async function refresh(row: ConnRow): Promise<string> {
  try {
    const t = await refreshAccessToken(decrypt(row.refresh_token_enc));
    const patch: Partial<ConnRow> = {
      access_token_enc: encrypt(t.access_token),
      access_token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    };
    // Google a veces rota el refresh token: si viene uno nuevo, se guarda.
    if (t.refresh_token) patch.refresh_token_enc = encrypt(t.refresh_token);
    await patchConnection(row.app_user_id, patch);
    Object.assign(row, patch);
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleTokenError && e.kind === "revoked") throw await reauth(row.app_user_id);
    throw new GcalError("google_error");
  }
}

export async function getSession(userId: string): Promise<GcalSession> {
  const row = await readConnection(userId);
  if (!row) throw new GcalError("not_connected");
  if (row.status === "needs_reauth") throw new GcalError("needs_reauth");
  const fresh = row.access_token_enc && row.access_token_expires_at && Date.parse(row.access_token_expires_at) - Date.now() > 60_000;
  let token: string;
  try {
    token = fresh ? decrypt(row.access_token_enc!) : await refresh(row);
  } catch (e) {
    if (e instanceof GcalError) throw e;
    token = await refresh(row);
  }
  return new GcalSession(row, token);
}
