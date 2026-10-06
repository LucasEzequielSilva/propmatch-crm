/**
 * Web pública de la inmobiliaria (canal "web" del multipublicador): tipos y
 * reglas compartidas entre el navegador y api/web.ts. Lógica pura.
 *
 * SLUG. La tabla `agencies` de la app no tiene columna `slug` (verificado
 * 2026-10-05). Se deriva: `<nombre-en-minúsculas>-<primeros 8 del uuid>`,
 * p. ej. "inmobiliaria-lopez-1ffdbb92". Los 8 hex alcanzan para encontrar la
 * agencia (búsqueda por rango de uuid) y el nombre es solo decorativo: si la
 * inmobiliaria cambia de nombre, el link viejo sigue andando y la web
 * redirige al nuevo. Para un slug elegido a mano ("lopez-propiedades") hace
 * falta la columna: ver supabase/drafts/agencies_slug.sql (SIN aplicar); el
 * servidor ya la usa si existe.
 *
 * UBICACIÓN. La app oculta la ubicación exacta y el CRM no sincroniza lat/lng
 * (ver src/lib/propertySync.ts). Por defecto la web muestra solo barrio/zona.
 * Si la inmobiliaria activa «Mostrar ubicación exacta» en una propiedad que
 * tiene coordenadas cargadas en el CRM, se guardan en la fila web de
 * `property_publications` (`external_id = "geo:<lat>,<lng>"`). Es un
 * almacenamiento provisorio hasta tener una columna propia (mismo borrador).
 */

import type { AgencyBrand } from "./brand.js";

export type PublicOperation = "venta" | "alquiler" | "temporario";
export type PublicPropertyType = "depto" | "casa" | "loft" | "monoambiente" | "ph" | "terreno" | "local" | "oficina";

export interface PublicAgency {
  name: string;
  slug: string;
  /** Contacto de la cuenta de la inmobiliaria en la app. Puede faltar. */
  whatsapp: string | null;
  email: string | null;
  /** Marca publicada (logo, colores, contacto). Ver shared/brand.ts. Puede faltar. */
  brand?: AgencyBrand | null;
}

/** Lista blanca de lo que sale a internet. Nada de dueño, DNI, precio mínimo ni dirección exacta. */
export interface PublicProperty {
  id: string;
  title: string;
  description: string;
  type: PublicPropertyType;
  operation: PublicOperation;
  /** USD. `null` = consultar. */
  price: number | null;
  /** "mes" para alquileres, `null` para venta. */
  pricePeriod: "mes" | null;
  rooms: number | null;
  amenities: string[];
  /** Barrio o localidad. */
  area: string | null;
  photos: string[];
  /** Solo si la inmobiliaria lo activó para esta propiedad. */
  exact: { lat: number; lng: number } | null;
  updatedAt: string;
}

export interface PublicSite {
  agency: PublicAgency;
  properties: PublicProperty[];
  /** ISO de cuando se armó la respuesta (sirve para ver el caché). */
  generatedAt: string;
}

export const TYPE_LABEL: Record<PublicPropertyType, string> = {
  depto: "Departamento",
  casa: "Casa",
  loft: "Loft",
  monoambiente: "Monoambiente",
  ph: "PH",
  terreno: "Terreno",
  local: "Local",
  oficina: "Oficina",
};

export const OPERATION_LABEL: Record<PublicOperation, string> = {
  venta: "Venta",
  alquiler: "Alquiler",
  temporario: "Alquiler temporario",
};

export function slugifyName(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "inmobiliaria"
  );
}

/** Slug derivado de una agencia (ver arriba). */
export function deriveAgencySlug(agency: { id: string; name: string }): string {
  return `${slugifyName(agency.name)}-${agency.id.replace(/-/g, "").slice(0, 8).toLowerCase()}`;
}

/** Los 8 hex del final del slug derivado, o `null` si no tiene esa forma. */
export function idPrefixFromSlug(slug: string): string | null {
  const m = /(?:^|-)([0-9a-f]{8})$/i.exec(slug.trim());
  return m ? m[1].toLowerCase() : null;
}

export const isValidSlug = (s: string) => /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/.test(s);

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** `external_id` de la fila web con la ubicación exacta autorizada. */
export function encodeExactGeo(lat: number, lng: number): string {
  return `geo:${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function decodeExactGeo(v: string | null | undefined): { lat: number; lng: number } | null {
  const m = /^geo:(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(v ?? "");
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** Link a Google Maps: al pin exacto si está autorizado, si no a la zona. */
export function mapsLink(p: Pick<PublicProperty, "exact" | "area">): string | null {
  if (p.exact) return `https://www.google.com/maps/search/?api=1&query=${p.exact.lat},${p.exact.lng}`;
  if (p.area) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.area)}`;
  return null;
}

/** Solo dígitos, con 54 adelante si parece un número argentino sin prefijo. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("54") && d.length <= 11) d = `54${d}`;
  return d;
}

export interface SiteFilters {
  operation: PublicOperation | "";
  type: PublicPropertyType | "";
  area: string;
  priceMin: number | null;
  priceMax: number | null;
  /** Ambientes mínimos. */
  rooms: number | null;
}

export const EMPTY_FILTERS: SiteFilters = { operation: "", type: "", area: "", priceMin: null, priceMax: null, rooms: null };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filterProperties(list: PublicProperty[], f: SiteFilters): PublicProperty[] {
  const area = fold(f.area.trim());
  return list.filter((p) => {
    if (f.operation && p.operation !== f.operation) return false;
    if (f.type && p.type !== f.type) return false;
    if (area && !fold(`${p.area ?? ""} ${p.title}`).includes(area)) return false;
    if (f.priceMin != null && (p.price == null || p.price < f.priceMin)) return false;
    if (f.priceMax != null && (p.price == null || p.price > f.priceMax)) return false;
    if (f.rooms != null && (p.rooms == null || p.rooms < f.rooms)) return false;
    return true;
  });
}

export function formatUsd(n: number | null, period: "mes" | null): string {
  if (n == null) return "Consultar precio";
  const v = `USD ${Math.round(n).toLocaleString("es-AR")}`;
  return period ? `${v} / mes` : v;
}

/** Descripción corta para SEO / Open Graph. */
export function metaDescription(p: Pick<PublicProperty, "description" | "type" | "operation" | "area" | "rooms">): string {
  const head = [OPERATION_LABEL[p.operation], TYPE_LABEL[p.type].toLowerCase(), p.area ? `en ${p.area}` : null, p.rooms ? `${p.rooms} amb.` : null]
    .filter(Boolean)
    .join(" ");
  const body = p.description.replace(/\s+/g, " ").trim();
  const text = body ? `${head}. ${body}` : head;
  return text.length > 160 ? `${text.slice(0, 157).replace(/\s+\S*$/, "")}…` : text;
}
