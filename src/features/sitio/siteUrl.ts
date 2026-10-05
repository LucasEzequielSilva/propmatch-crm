import type { Agency } from "@/types/db";
import { deriveAgencySlug, isUuid } from "../../../shared/publicSite";

/**
 * Link público de la web de la inmobiliaria. Solo existe para una agencia
 * real (uuid de Supabase): la demo y las cuentas sin inmobiliaria no tienen web
 * pública, solo la vista previa (`?vista=previa`).
 */
export function agencySiteSlug(agency: Pick<Agency, "id" | "name">): string | null {
  return isUuid(agency.id) ? deriveAgencySlug(agency) : null;
}

export function siteUrl(agency: Pick<Agency, "id" | "name">): string | null {
  const slug = agencySiteSlug(agency);
  return slug ? `${window.location.origin}/sitio/${slug}` : null;
}

export function sitePropertyUrl(agency: Pick<Agency, "id" | "name">, appPropertyId: string | null | undefined): string | null {
  const base = siteUrl(agency);
  return base && appPropertyId ? `${base}/p/${appPropertyId}` : null;
}

/** Vista previa local (con los datos de este navegador, también en la demo). */
export const PREVIEW_SLUG = "vista-previa";
export const previewUrl = () => `/sitio/${PREVIEW_SLUG}`;

/** Código para insertar la web en otro sitio (WordPress, Wix, etc.). */
export function embedCode(url: string, title: string): string {
  return `<iframe src="${url}?embed=1" title="${title.replace(/"/g, "&quot;")}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>`;
}
