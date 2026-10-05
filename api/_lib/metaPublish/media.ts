/**
 * Fotos y propiedades para publicar en Meta.
 *
 * Seguridad: solo se mandan a Meta URLs del bucket público `property-photos`
 * de la app que sean (a) fotos de ESA propiedad de la agencia o (b) archivos
 * de la carpeta de la agencia (`<agency_id>/…`, donde el Estudio de Instagram
 * sube los JPEG ya editados). Así nadie puede usar el servidor para publicar
 * (o pedir) URLs arbitrarias.
 */
import { env } from "../env.js";
import { supabaseAdmin } from "../supabaseAdmin.js";
import { jpegSize, type ImageFacts } from "../../../shared/metaPublish.js";

export function bucketPrefix(): string {
  return `${env("SUPABASE_URL").replace(/\/+$/, "")}/storage/v1/object/public/property-photos/`;
}

export function isAllowedImage(url: string, agencyId: string, propertyPhotos: Set<string>): boolean {
  if (typeof url !== "string" || url.length > 1024) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.search || u.hash) return false;
  if (!url.startsWith(bucketPrefix())) return false;
  if (url.includes("..")) return false;
  if (propertyPhotos.has(url)) return true;
  return url.startsWith(`${bucketPrefix()}${agencyId}/`);
}

/** Lee tipo, peso y tamaño (primeros 64 KB) de una foto pública. */
export async function probeImage(url: string): Promise<ImageFacts> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-65535" }, signal: ctrl.signal });
    if (!r.ok) return { url, contentType: null, bytes: null, width: null, height: null };
    const contentType = r.headers.get("content-type");
    const range = r.headers.get("content-range"); // "bytes 0-65535/123456"
    const total = range ? Number(range.split("/")[1]) : Number(r.headers.get("content-length"));
    const buf = new Uint8Array(await r.arrayBuffer());
    const size = contentType && /jpe?g/i.test(contentType) ? jpegSize(buf) : null;
    return {
      url,
      contentType,
      bytes: Number.isFinite(total) && total > 0 ? total : null,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  } catch {
    return { url, contentType: null, bytes: null, width: null, height: null };
  } finally {
    clearTimeout(t);
  }
}

export interface AgencyProperty {
  id: string;
  title: string;
  photos: string[];
  status: string;
}

/** La propiedad tiene que ser de la agencia y estar disponible (active). */
export async function agencyProperty(agencyId: string, propertyId: string): Promise<AgencyProperty | null> {
  const { data, error } = await supabaseAdmin()
    .from("properties")
    .select("id, title, photos, status")
    .eq("id", propertyId)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (error || !data) return null;
  return { id: data.id, title: data.title, photos: data.photos ?? [], status: data.status };
}

const PUBLICATION_COLUMNS =
  "id, agency_id, property_id, channel, status, external_id, external_url, error_message, published_at, last_synced_at, created_at, updated_at";

export async function savePublication(input: {
  agencyId: string;
  propertyId: string;
  channel: "facebook" | "instagram";
  status: "published" | "error" | "removed";
  externalId?: string | null;
  externalUrl?: string | null;
  errorMessage?: string | null;
  userId: string;
}): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    agency_id: input.agencyId,
    property_id: input.propertyId,
    channel: input.channel,
    status: input.status,
    error_message: input.errorMessage ?? null,
    last_synced_at: now,
    created_by: input.userId,
  };
  if (input.externalId !== undefined) row.external_id = input.externalId;
  if (input.externalUrl !== undefined) row.external_url = input.externalUrl;
  if (input.status === "published") row.published_at = now;
  const { data, error } = await supabaseAdmin()
    .from("property_publications")
    .upsert(row, { onConflict: "property_id,channel" })
    .select(PUBLICATION_COLUMNS)
    .maybeSingle();
  if (error) {
    console.warn("[meta] no se pudo guardar la publicación", error.code);
    return null;
  }
  return data;
}

export async function loadPublication(agencyId: string, propertyId: string, channel: "facebook" | "instagram") {
  const { data } = await supabaseAdmin()
    .from("property_publications")
    .select("external_id, status")
    .eq("agency_id", agencyId)
    .eq("property_id", propertyId)
    .eq("channel", channel)
    .maybeSingle();
  return data as { external_id: string | null; status: string } | null;
}
