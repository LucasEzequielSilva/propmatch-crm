/**
 * A qué propiedad apunta una acción de Mercado Libre y con qué fotos.
 *
 *  - «app»: la propiedad está sincronizada con la app (USD). El servidor toma
 *    las fotos de la fila de la app, como siempre.
 *  - «crm»: solo vive en el CRM (precio en pesos, o todavía sin sincronizar).
 *    Antes de publicar, las fotos nuevas se suben a
 *    property-photos/<agencia>/crm/<id>/ y se mandan esas URLs; el servidor
 *    valida la ficha y solo acepta fotos de esa carpeta.
 * En los dos casos se manda el id del CRM y, si este navegador recuerda un
 * aviso, `previous` (para no crear otro). Ver api/_lib/integrations/meliRequest.ts.
 */
import type { Property } from "@/types/db";
import { isLinkedAgencyId } from "@/data/store";
import { isSample, SAMPLE_PUBLISH_BLOCKED } from "@/lib/samples";
import { previousFor } from "@/lib/crmPublications";
import { uploadCrmPhotos } from "@/lib/propertySync";

export type MeliTargetKind = "app" | "crm";

export interface MeliTargetBody {
  propertyId?: string;
  crmPropertyId: string;
  photos?: string[];
  previous?: { externalId: string };
  isSample?: boolean;
}

export function meliTargetKind(p: Property): MeliTargetKind {
  return p.app_property_id ? "app" : "crm";
}

/** Por qué no se puede publicar en Mercado Libre (null = se puede). */
export function meliBlockReason(p: Property, agencyId: string): string | null {
  if (isSample(p)) return `${SAMPLE_PUBLISH_BLOCKED}.`;
  if (!p.app_property_id && !isLinkedAgencyId(agencyId)) {
    return "Tu cuenta no está vinculada a una inmobiliaria: sin eso no hay dónde subir las fotos ni con qué cuenta publicar.";
  }
  return null;
}

/** Cuerpo base (sin ficha) para /api/meli/publish o el motor. */
export function meliTargetBody(p: Property, agencyId: string): MeliTargetBody {
  const previous = previousFor(agencyId, p.id);
  return p.app_property_id
    ? { propertyId: p.app_property_id, crmPropertyId: p.id, previous, isSample: isSample(p) }
    : { crmPropertyId: p.id, previous, isSample: isSample(p) };
}

/**
 * Fotos a validar en la pantalla. App: solo las que ya tienen URL pública.
 * Solo-CRM: todas (las locales se suben al publicar); a las locales se les da
 * un nombre con su formato real para que el aviso de JPG/PNG sea correcto.
 */
export function photosForValidation(p: Property, photos: string[]): string[] {
  if (p.app_property_id) return photos.filter((u) => /^https:\/\//.test(u));
  return photos
    .map((u, i) => {
      if (/^https:\/\//.test(u)) return u;
      const mime = /^data:(image\/[a-z+.-]+);/i.exec(u)?.[1]?.toLowerCase();
      if (!mime) return null;
      const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("png") ? "png" : "webp";
      return `local-${i}.${ext}`;
    })
    .filter((u): u is string => !!u);
}

/**
 * Sube las fotos locales de una propiedad solo-CRM y devuelve las URLs a mandar.
 * Si subió alguna, reemplaza las fotos guardadas por sus URLs (así no se suben
 * dos veces). Lanza si falla la subida.
 */
export async function prepareCrmPhotos(
  p: Property,
  agencyId: string,
  photos: string[],
  replace: (id: string, photos: string[]) => void,
): Promise<string[]> {
  const urls = await uploadCrmPhotos(agencyId, p.id, photos);
  if (urls.some((u, i) => u !== photos[i])) replace(p.id, urls);
  return urls.filter((u) => /^https:\/\//.test(u));
}

export const CRM_PHOTO_UPLOAD_ERROR =
  "No pudimos subir las fotos a tu carpeta de la inmobiliaria. Revisá la conexión y probá de nuevo.";

/** Aviso cuando la publicación quedó solo en este navegador (falta la migración). */
export const LOCAL_ONLY_NOTICE =
  "La publicación quedó guardada en este navegador. Para que el resto del equipo vea su estado, hay que aplicar la migración de publicaciones solo-CRM (ver docs/integraciones-multitenant.md).";
