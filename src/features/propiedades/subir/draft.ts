/**
 * Borrador del formulario de propiedades en este navegador.
 *
 * Es una red de seguridad (se cortó la luz, se cerró la pestaña), no una
 * propiedad: no entra al store, no aparece en el listado y nunca se
 * sincroniza con la app ni con ningún canal.
 *
 * localStorage tiene ~5 MB para TODA la app, y las fotos nuevas son data
 * URLs de cientos de KB. Si el borrador con fotos pasa el tope, se guarda sin
 * las fotos nuevas antes que arriesgar que el store deje de poder guardarse.
 */

import type { FormState } from "./form";

const PREFIX = "propmatch.spp-draft.v1:";
/** Tope para un borrador con fotos. El store comparte la misma cuota. */
const MAX_DRAFT_CHARS = 600_000;

export interface StoredDraft {
  form: FormState;
  savedAt: string;
  /** `true` si las fotos nuevas no entraron y se guardó sin ellas. */
  photosDropped: boolean;
}

export const draftKey = (propertyId: string | undefined) => PREFIX + (propertyId ?? "nueva");

export function loadDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed?.form || !parsed.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Devuelve lo guardado, o `null` si el navegador no dejó guardar nada. */
export function saveDraft(key: string, form: FormState): StoredDraft | null {
  const savedAt = new Date().toISOString();
  const attempt = (draft: StoredDraft) => {
    const raw = JSON.stringify(draft);
    if (raw.length > MAX_DRAFT_CHARS) return false;
    try {
      localStorage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  };

  const full: StoredDraft = { form, savedAt, photosDropped: false };
  if (attempt(full)) return full;

  // Sin las fotos que todavía no están subidas (las URLs del Storage pesan poco).
  const light: StoredDraft = {
    form: { ...form, photos: form.photos.filter((p) => !p.startsWith("data:")) },
    savedAt,
    photosDropped: true,
  };
  return attempt(light) ? light : null;
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nada que limpiar */
  }
}
