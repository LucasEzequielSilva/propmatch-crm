/**
 * Datos de la web pública de la inmobiliaria. Se leen con la service role
 * (la tabla `properties` de la app no es legible por anónimos) y SOLO salen
 * las columnas de la lista blanca: nada de dueño (owner_contact_id), DNI,
 * dirección exacta, lat/lng de la app ni datos internos del CRM (que además
 * no viven en esta base: precio mínimo de reserva, comisión, etc.).
 *
 * Reglas para que una propiedad aparezca:
 *   1. es de la agencia (`agency_id`) y está disponible (`status = 'active'`);
 *   2. la inmobiliaria no la ocultó (fila web de property_publications con
 *      status 'removed' = oculta);
 *   3. por construcción nunca es de ejemplo: las de ejemplo no salen del
 *      navegador, así que no existen en esta base.
 */
import { supabaseAdmin } from "../supabaseAdmin.js";
import {
  decodeExactGeo,
  deriveAgencySlug,
  idPrefixFromSlug,
  isValidSlug,
  type PublicAgency,
  type PublicOperation,
  type PublicProperty,
  type PublicPropertyType,
} from "../../../shared/publicSite.js";
import { BRAND_BUCKET, brandLogoPrefix, brandObjectPath, decodeBrandPng, sanitizeBrand, type AgencyBrand } from "../../../shared/brand.js";

const PROPERTY_COLUMNS =
  "id, title, description, photos, barrio, type, operation_type, rooms, amenities, price_usd_month, price_usd_sale, updated_at";

interface AgencyRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  slug?: string | null;
}

/** Busca la agencia por slug: primero la columna `slug` (si existe), si no el slug derivado. */
export async function agencyBySlug(slug: string): Promise<{ row: AgencyRow; canonical: string } | null> {
  if (!isValidSlug(slug)) return null;
  const db = supabaseAdmin();

  // Columna opcional (supabase/drafts/agencies_slug.sql). Si no existe, Postgres responde 42703.
  const bySlug = await db.from("agencies").select("id, name, owner_user_id, slug").eq("slug", slug).limit(1);
  if (!bySlug.error && bySlug.data?.[0]) {
    const row = bySlug.data[0] as AgencyRow;
    return { row, canonical: row.slug ?? slug };
  }

  const prefix = idPrefixFromSlug(slug);
  if (!prefix) return null;
  const { data, error } = await db
    .from("agencies")
    .select("id, name, owner_user_id")
    .gte("id", `${prefix}-0000-0000-0000-000000000000`)
    .lte("id", `${prefix}-ffff-ffff-ffff-ffffffffffff`)
    .limit(5);
  if (error || !data?.length) return null;
  const rows = data as AgencyRow[];
  const row = rows.find((r) => deriveAgencySlug(r) === slug) ?? (rows.length === 1 ? rows[0] : null);
  if (!row) return null;
  return { row, canonical: deriveAgencySlug(row) };
}

/** Slug público de una agencia por id (para armar links desde el servidor). */
export async function agencySlugById(agencyId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("agencies").select("id, name").eq("id", agencyId).maybeSingle();
  return data ? deriveAgencySlug(data as { id: string; name: string }) : null;
}

/**
 * Contacto público: el de la cuenta de la inmobiliaria en la app
 * (`agencies.owner_user_id`, la "cuenta paraguas" de la Opción B). No se usa
 * el de cada agente para no publicar datos personales sin que lo elijan.
 */
async function agencyContact(ownerUserId: string | null): Promise<{ phone: string | null; email: string | null }> {
  if (!ownerUserId) return { phone: null, email: null };
  const { data } = await supabaseAdmin().from("users").select("phone, email").eq("id", ownerUserId).maybeSingle();
  return { phone: (data?.phone as string | null) ?? null, email: (data?.email as string | null) ?? null };
}

/**
 * Marca publicada de la agencia. Primero la columna `agencies.branding`
 * (supabase/drafts/agencies_branding.sql, SIN aplicar: si no existe, Postgres
 * responde 42703 y se sigue), después `property-photos/<id>/branding/brand.png`
 * (ver shared/brand.ts). Siempre pasa por la lista blanca y el logo tiene que
 * estar en la carpeta de la agencia.
 */
export async function agencyBrand(agencyId: string): Promise<AgencyBrand | null> {
  const db = supabaseAdmin();
  const logoPrefix = brandLogoPrefix(process.env.SUPABASE_URL ?? "", agencyId);
  try {
    const col = await db.from("agencies").select("branding").eq("id", agencyId).maybeSingle();
    const value = !col.error ? (col.data as { branding?: unknown } | null)?.branding : null;
    if (value) return sanitizeBrand(value, { logoPrefix });
  } catch {
    /* sin columna: sigue con el Storage */
  }
  try {
    const { data, error } = await db.storage.from(BRAND_BUCKET).download(brandObjectPath(agencyId));
    if (error || !data) return null;
    const text = decodeBrandPng(new Uint8Array(await data.arrayBuffer()));
    return text ? sanitizeBrand(JSON.parse(text), { logoPrefix }) : null;
  } catch {
    return null;
  }
}

export async function publicAgency(row: AgencyRow, canonical: string): Promise<PublicAgency> {
  const [c, brand] = await Promise.all([agencyContact(row.owner_user_id), agencyBrand(row.id)]);
  return {
    // El nombre comercial de la marca, si lo cargaron, es el que ve el público.
    name: brand?.displayName || row.name,
    slug: canonical,
    whatsapp: brand?.whatsapp ?? brand?.phone ?? c.phone,
    email: brand?.email ?? c.email,
    brand,
  };
}

interface PropertyRow {
  id: string;
  title: string;
  description: string | null;
  photos: string[] | null;
  barrio: string | null;
  type: string;
  operation_type: string;
  rooms: number | null;
  amenities: string[] | null;
  price_usd_month: number | string | null;
  price_usd_sale: number | string | null;
  updated_at: string;
}

const num = (v: number | string | null) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function toPublic(r: PropertyRow, web: { status: string; external_id: string | null } | undefined): PublicProperty {
  const rent = r.operation_type !== "venta";
  return {
    id: r.id,
    title: r.title,
    description: (r.description ?? "").slice(0, 5000),
    type: r.type as PublicPropertyType,
    operation: r.operation_type as PublicOperation,
    price: rent ? num(r.price_usd_month) : num(r.price_usd_sale),
    pricePeriod: rent ? "mes" : null,
    rooms: r.rooms,
    amenities: (r.amenities ?? []).slice(0, 40),
    area: r.barrio,
    photos: (r.photos ?? []).filter((u) => /^https:\/\//.test(u)).slice(0, 30),
    exact: decodeExactGeo(web?.external_id),
    updatedAt: r.updated_at,
  };
}

async function webRows(agencyId: string): Promise<Map<string, { status: string; external_id: string | null }>> {
  const { data } = await supabaseAdmin()
    .from("property_publications")
    .select("property_id, status, external_id")
    .eq("agency_id", agencyId)
    .eq("channel", "web");
  return new Map((data ?? []).map((r) => [r.property_id as string, { status: r.status as string, external_id: r.external_id as string | null }]));
}

/** Propiedades visibles en la web, más nuevas primero. */
export async function publicProperties(agencyId: string, limit = 300): Promise<PublicProperty[]> {
  const [{ data, error }, web] = await Promise.all([
    supabaseAdmin()
      .from("properties")
      .select(PROPERTY_COLUMNS)
      .eq("agency_id", agencyId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(limit),
    webRows(agencyId),
  ]);
  if (error || !data) return [];
  return (data as unknown as PropertyRow[]).filter((r) => web.get(r.id)?.status !== "removed").map((r) => toPublic(r, web.get(r.id)));
}

export async function publicProperty(agencyId: string, id: string): Promise<PublicProperty | null> {
  const [{ data }, web] = await Promise.all([
    supabaseAdmin().from("properties").select(PROPERTY_COLUMNS).eq("agency_id", agencyId).eq("id", id).eq("status", "active").maybeSingle(),
    webRows(agencyId),
  ]);
  if (!data || web.get(id)?.status === "removed") return null;
  return toPublic(data as unknown as PropertyRow, web.get(id));
}
