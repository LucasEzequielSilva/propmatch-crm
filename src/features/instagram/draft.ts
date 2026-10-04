/**
 * Borrador de la publicación, por propiedad, en localStorage.
 * Solo se guardan referencias a las fotos de la propiedad (no las subidas desde el equipo
 * ni los datos de las imágenes). Esquema versionado: si cambia, se descarta el borrador viejo.
 */

import type { CaptionOptions } from "./caption";
import type { IgFormatId } from "./imageSpecs";

export interface DraftPhotoRef {
  /** URL de la foto, o `idx:N` si era un data URL (muy pesado para localStorage). */
  key: string;
  included: boolean;
  fx: number;
  fy: number;
  alt: string;
}

export interface IgDraft {
  v: 1;
  format: IgFormatId;
  photos: DraftPhotoRef[];
  body: string;
  hashtags: string[];
  options: CaptionOptions;
  savedAt: string;
}

const keyOf = (propertyId: string) => `propmatch.instagram-draft.v1.${propertyId}`;

export const photoKey = (url: string, index: number) => (url.startsWith("data:") ? `idx:${index}` : url);

export function loadDraft(propertyId: string): IgDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(propertyId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<IgDraft>;
    if (d?.v !== 1 || !Array.isArray(d.photos) || typeof d.body !== "string" || !Array.isArray(d.hashtags) || !d.options) return null;
    return d as IgDraft;
  } catch {
    return null;
  }
}

/** `false` si no se pudo guardar (modo privado, cuota llena). */
export function saveDraft(propertyId: string, draft: IgDraft): boolean {
  try {
    localStorage.setItem(keyOf(propertyId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(propertyId: string) {
  try {
    localStorage.removeItem(keyOf(propertyId));
  } catch {
    /* sin almacenamiento: no hay nada que borrar */
  }
}
