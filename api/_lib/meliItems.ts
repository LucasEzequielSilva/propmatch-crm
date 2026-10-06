/**
 * Llamadas a la API de ítems de Mercado Libre y persistencia del resultado en
 * `property_publications`. Solo servidor: usa el token de la agencia y la
 * service role. Nunca devuelve ni loguea tokens.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MELI_API } from "./meli.js";
import { withOptionalColumns } from "./integrations/dbCompat.js";

export interface MeliResponse<T = unknown> {
  ok: boolean;
  status: number;
  body: T | null;
}

/** fetch a api.mercadolibre.com con timeout. Un error de red se informa como status 0. */
export async function meliFetch<T = unknown>(
  token: string | null,
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<MeliResponse<T>> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(`${MELI_API}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
    });
    const text = await r.text();
    let body: T | null = null;
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export interface MeliItem {
  id: string;
  status?: string;
  sub_status?: string[];
  permalink?: string;
  seller_id?: number;
  category_id?: string;
  currency_id?: string;
}

interface CategoryAttribute {
  id: string;
  tags?: Record<string, unknown>;
}

/**
 * Atributos de la categoría en vivo (GET /categories/{id}/attributes, público).
 * `required` = tags.required; `allowed` = todo lo que no es read_only.
 * `null` si la API no respondió (se cae a la tabla estática de shared/meliListing).
 */
export async function categoryAttributes(categoryId: string): Promise<{ required: string[]; allowed: Set<string> } | null> {
  const r = await meliFetch<CategoryAttribute[]>(null, `/categories/${encodeURIComponent(categoryId)}/attributes`, { timeoutMs: 8000 });
  if (!r.ok || !Array.isArray(r.body)) return null;
  const required = r.body.filter((a) => a.tags?.required).map((a) => a.id);
  const allowed = new Set(r.body.filter((a) => !a.tags?.read_only).map((a) => a.id));
  return { required, allowed };
}

/** Comprueba que una foto se pueda descargar sin credenciales (Mercado Libre la baja por URL). */
export async function isPubliclyReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

export const PUBLICATION_COLUMNS =
  "id, agency_id, property_id, channel, status, external_id, external_url, error_message, published_at, last_synced_at, created_at, updated_at";

export interface PublicationRow {
  id: string;
  agency_id: string;
  property_id: string;
  channel: string;
  status: string;
  external_id: string | null;
  external_url: string | null;
  error_message: string | null;
  published_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function readPublication(db: SupabaseClient, propertyId: string): Promise<PublicationRow | null> {
  const { data } = await db
    .from("property_publications")
    .select(PUBLICATION_COLUMNS)
    .eq("property_id", propertyId)
    .eq("channel", "mercadolibre")
    .maybeSingle();
  return (data as PublicationRow | null) ?? null;
}

/** Crea o actualiza la fila de Mercado Libre de la propiedad y la devuelve. */
export async function savePublication(
  db: SupabaseClient,
  key: { agencyId: string; propertyId: string; userId: string; isNew: boolean; connectionId?: string | null },
  patch: Partial<Pick<PublicationRow, "status" | "external_id" | "external_url" | "error_message" | "published_at">>,
): Promise<PublicationRow | null> {
  const row: Record<string, unknown> = {
    agency_id: key.agencyId,
    property_id: key.propertyId,
    channel: "mercadolibre",
    last_synced_at: new Date().toISOString(),
    ...patch,
  };
  if (key.isNew) row.created_by = key.userId;
  // Conexión con la que se publicó (migración 20261006120000; sin ella se omite).
  if (key.connectionId) row.connection_id = key.connectionId;
  const { data, error } = await withOptionalColumns("publication", row, (r) =>
    db.from("property_publications").upsert(r, { onConflict: "property_id,channel" }).select(PUBLICATION_COLUMNS).single(),
  );
  if (error) return null;
  return data as PublicationRow;
}
