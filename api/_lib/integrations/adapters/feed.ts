/**
 * Feed XML: la inmobiliaria nos da una URL https y PropMatch trae SUS avisos.
 * No publica en ningún portal y no lee avisos de otras inmobiliarias.
 *
 * La URL queda cifrada (puede traer un token). En Integraciones solo se ve
 * el dominio. Cada corrida crea o actualiza propiedades del CRM (crm_records)
 * y pausa las que desaparecieron del feed. No las borra.
 */
import { encrypt, decrypt } from "../../crypto.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { crmDb } from "../../inbox/db.js";
import { crmDbConfigured } from "../../gcal/env.js";
import { readConnection, recordConnectionCheck, toConnectionStatus } from "../connections.js";
import { withOptionalColumns } from "../dbCompat.js";
import { unavailableResult } from "./unavailable.js";
import { downloadFeed } from "../feedFetch.js";
import type { AgencyScope, Availability, PortalAdapter } from "../types.js";
import {
  buildFeedPlan,
  checkFeedUrl,
  feedAccountKey,
  feedHostLabel,
  parseFeedXml,
  type FeedPushItem,
  type OwnedFeedProperty,
} from "../../../../shared/feedXml.js";
import { PUSH_MAX_ITEMS } from "../../../../shared/crmSync.js";

const INBOUND = "Este feed solo trae avisos a PropMatch. No publica en ningún portal.";
const NO_KEY = "Falta la clave de cifrado en el servidor. Avisanos y lo dejamos listo.";
const NO_DB = "La base del CRM no está disponible. Probá de nuevo en un rato.";

function availability(): Availability {
  return process.env.INTEGRATIONS_ENC_KEY ? { state: "available" } : { state: "not_configured", reason: NO_KEY };
}

export type SaveFeedResult =
  | { ok: true; host: string }
  | { ok: false; code: "invalid" | "in_use" | "disabled" | "server_error"; message: string };

export async function saveFeedUrl(scope: AgencyScope, raw: unknown): Promise<SaveFeedResult> {
  if (!process.env.INTEGRATIONS_ENC_KEY) return { ok: false, code: "disabled", message: NO_KEY };
  const parsed = checkFeedUrl(raw);
  if (!parsed.ok) return { ok: false, code: "invalid", message: parsed.message };
  const accountId = feedAccountKey(parsed.url);
  const db = supabaseAdmin();
  const { data: taken } = await db
    .from("agency_integrations")
    .select("agency_id")
    .eq("provider", "feed")
    .eq("external_account_id", accountId)
    .neq("agency_id", scope.agencyId)
    .limit(1);
  if (taken && taken.length > 0) {
    return { ok: false, code: "in_use", message: "Ese feed ya está conectado a otra inmobiliaria en PropMatch." };
  }
  const row = {
    agency_id: scope.agencyId,
    provider: "feed",
    status: "connected",
    external_account_id: accountId,
    account_label: feedHostLabel(parsed.url),
    access_token_enc: encrypt(JSON.stringify({ url: parsed.url.toString() })),
    refresh_token_enc: null,
    expires_at: null,
    scopes: null,
    connected_by: scope.userId,
    auth_method: "feed",
    last_error: null,
    last_checked_at: null,
  };
  const { error } = await withOptionalColumns("connection", row, (r) =>
    db.from("agency_integrations").upsert(r, { onConflict: "agency_id,provider" }),
  );
  if (error) {
    const check = error.code === "23514" || /provider/i.test(error.message ?? "");
    return {
      ok: false,
      code: "server_error",
      message: check
        ? "Falta habilitar el feed en la base (migración 20261125180000). Avisanos y lo aplicamos."
        : "No pudimos guardar el feed. Probá de nuevo en un rato.",
    };
  }
  return { ok: true, host: feedHostLabel(parsed.url) };
}

async function readFeedUrl(agencyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("agency_integrations")
    .select("access_token_enc, status")
    .eq("agency_id", agencyId)
    .eq("provider", "feed")
    .maybeSingle();
  if (!data || data.status !== "connected" || typeof data.access_token_enc !== "string") return null;
  try {
    const parsed = JSON.parse(decrypt(data.access_token_enc)) as { url?: unknown };
    return typeof parsed.url === "string" ? parsed.url : null;
  } catch {
    return null;
  }
}

export interface FeedSyncResponse {
  created: number;
  updated: number;
  paused: number;
  unchanged: number;
  locked: number;
  skipped: number;
  truncated: boolean;
}

async function loadOwned(scopeId: string): Promise<OwnedFeedProperty[]> {
  const out: OwnedFeedProperty[] = [];
  const page = 1000;
  for (let from = 0; from < 20_000; from += page) {
    const { data, error } = await crmDb()
      .from("crm_records")
      .select("id, data, deleted")
      .eq("scope_id", scopeId)
      .eq("kind", "property")
      .range(from, from + page - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      if (row.deleted) continue;
      const rec = (row.data ?? {}) as Record<string, unknown>;
      if (typeof rec.feed_external_id !== "string") continue;
      out.push({
        id: String(row.id),
        externalId: rec.feed_external_id,
        hash: typeof rec.feed_hash === "string" ? rec.feed_hash : null,
        locked: rec.feed_lock === true,
        data: rec,
      });
    }
    if (rows.length < page) break;
  }
  return out;
}

async function loadPhotos(scopeId: string, ids: string[]): Promise<Record<string, string[]>> {
  const photos: Record<string, string[]> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { data, error } = await crmDb()
      .from("crm_records")
      .select("id, data")
      .eq("scope_id", scopeId)
      .eq("kind", "photos")
      .in("id", slice);
    if (error) throw error;
    for (const row of data ?? []) {
      const urls = (row.data as { urls?: unknown } | null)?.urls;
      photos[String(row.id)] = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string") : [];
    }
  }
  return photos;
}

async function pushItems(scopeId: string, userId: string, items: FeedPushItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += PUSH_MAX_ITEMS) {
    const batch = items.slice(i, i + PUSH_MAX_ITEMS);
    const { error } = await crmDb().rpc("crm_push", { p_scope: scopeId, p_user: userId, p_items: batch });
    if (error) throw error;
  }
}

export type RunFeedResult = { ok: true; data: FeedSyncResponse } | { ok: false; http: number; error: string; message: string };

/** Baja el feed conectado y actualiza el stock de ESA inmobiliaria. */
export async function runFeedSync(scope: AgencyScope): Promise<RunFeedResult> {
  if (!process.env.INTEGRATIONS_ENC_KEY) return { ok: false, http: 409, error: "unavailable", message: NO_KEY };
  if (!crmDbConfigured()) return { ok: false, http: 503, error: "no_db", message: NO_DB };
  const stored = await readFeedUrl(scope.agencyId);
  if (!stored) return { ok: false, http: 409, error: "not_connected", message: "Tu inmobiliaria no tiene un feed conectado." };
  const check = checkFeedUrl(stored);
  if (!check.ok) return { ok: false, http: 422, error: "invalid", message: check.message };
  const downloaded = await downloadFeed(check.url);
  if (!downloaded.ok) {
    await recordConnectionCheck(scope.agencyId, "feed", downloaded.message);
    return { ok: false, http: 502, error: "feed_unavailable", message: downloaded.message };
  }
  const parsed = parseFeedXml(downloaded.xml);
  if (parsed.error || parsed.listings.length === 0) {
    const message = parsed.error ?? "No encontramos avisos en ese XML.";
    await recordConnectionCheck(scope.agencyId, "feed", message);
    return { ok: false, http: 422, error: "invalid", message };
  }
  try {
    const owned = await loadOwned(scope.agencyId);
    const photos = await loadPhotos(scope.agencyId, owned.map((o) => o.id));
    const plan = buildFeedPlan(parsed.listings, owned, photos, new Date().toISOString(), scope.agencyId, !parsed.truncated);
    await pushItems(scope.agencyId, scope.userId, plan.items);
    await recordConnectionCheck(scope.agencyId, "feed", null);
    return {
      ok: true,
      data: {
        created: plan.created,
        updated: plan.updated,
        paused: plan.paused,
        unchanged: plan.unchanged,
        locked: plan.locked,
        skipped: parsed.skipped,
        truncated: parsed.truncated,
      },
    };
  } catch {
    const message = "Leímos el feed pero no pudimos guardar los avisos. Probá de nuevo en un rato.";
    await recordConnectionCheck(scope.agencyId, "feed", message);
    return { ok: false, http: 502, error: "server_error", message };
  }
}

export const FeedAdapter: PortalAdapter = {
  id: "feed",
  name: "Feed XML",
  authMethod: "feed",
  channels: ["feed"],
  availability,
  async status(scope) {
    const av = availability();
    const row = av.state === "available" ? await readConnection(scope.agencyId, "feed") : null;
    return toConnectionStatus("feed", "feed", av, row);
  },
  async connect() {
    if (!process.env.INTEGRATIONS_ENC_KEY) throw new Error("unavailable");
    return { form: true };
  },
  async disconnect(scope) {
    const { error } = await supabaseAdmin().from("agency_integrations").delete().eq("agency_id", scope.agencyId).eq("provider", "feed");
    if (error) throw new Error("server_error");
  },
  async refresh() {
    /* la URL no vence */
  },
  async validate() {
    return unavailableResult("feed", INBOUND);
  },
  async publish() {
    return unavailableResult("feed", INBOUND);
  },
  async update() {
    return unavailableResult("feed", INBOUND);
  },
  async lifecycle() {
    return unavailableResult("feed", INBOUND);
  },
  mapStatus() {
    return { status: "error", message: INBOUND };
  },
};
