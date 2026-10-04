/**
 * Publicaciones del Estudio de Instagram: metadatos en localStorage, esquema versionado (`v: 1`).
 * Los archivos NO van acá: viven en IndexedDB (`mediaStore.ts`) y se referencian por `PostMedia.id`.
 *
 * Migrar a la base más adelante: `PostStore` es la única interfaz que usan las pantallas
 * (`list/get/save/remove`). Alcanza con otra implementación que hable con una tabla de
 * publicaciones por agencia (una fila por `InstagramPost`, `media`/`options` como JSON) y que
 * devuelva promesas; `usePosts` es el único consumidor reactivo. El estado derivado
 * («lista para publicar», «vencida») nunca se guarda: sale de `scheduledAt` (ver `schedule.ts`).
 */

import { useCallback, useEffect, useState } from "react";
import type { CaptionOptions } from "./caption";
import type { IgFormatId, PostKind } from "./imageSpecs";
import type { PhotoEdits } from "./photoEdits";

export interface PostMedia {
  id: string;
  kind: "image" | "video";
  /** `upload` = blob en IndexedDB; `remote` = URL de una foto de propiedad (puede fallar por CORS al exportar). */
  source: "upload" | "remote";
  url?: string;
  name: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  durationSec?: number;
  alt: string;
  edits: PhotoEdits;
  /** Video: segundo elegido como portada; el JPEG de la portada se guarda como media `${id}:cover`. */
  coverTimeSec?: number;
  hasCover?: boolean;
}

/** Guardado: `draft` (sin recordatorio), `scheduled` (con recordatorio) o `published` (marcada a mano). */
export type StoredStatus = "draft" | "scheduled" | "published";

export interface InstagramPost {
  v: 1;
  id: string;
  kind: PostKind;
  title: string;
  /** Formato de las imágenes (feed 4:5, 1:1, 1,91:1 o 9:16). Story y Reel usan 9:16. */
  format: IgFormatId;
  media: PostMedia[];
  body: string;
  hashtags: string[];
  options: CaptionOptions;
  /** Propiedad usada para autocompletar el texto, si hubo. */
  propertyId: string | null;
  status: StoredStatus;
  /** ISO. */
  scheduledAt: string | null;
  /** Evento de la Agenda del CRM que hace de recordatorio. */
  reminderEventId: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PostStore {
  list(): InstagramPost[];
  get(id: string): InstagramPost | null;
  /** `false` si no se pudo guardar (almacenamiento bloqueado o lleno). */
  save(post: InstagramPost): boolean;
  remove(id: string): void;
}

const KEY = "propmatch.instagram-posts.v1";
const EVENT = "propmatch:instagram-posts";

interface Persisted {
  v: 1;
  posts: InstagramPost[];
}

function read(): InstagramPost[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const d = JSON.parse(raw) as Partial<Persisted>;
    // Esquema desconocido: se ignora sin pisarlo (otra versión de la app puede entenderlo).
    if (d?.v !== 1 || !Array.isArray(d.posts)) return [];
    return d.posts.filter((p) => p && typeof p.id === "string" && Array.isArray(p.media));
  } catch {
    return [];
  }
}

function write(posts: InstagramPost[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, posts } satisfies Persisted));
    window.dispatchEvent(new Event(EVENT));
    return true;
  } catch {
    return false;
  }
}

export const postStore: PostStore = {
  list: read,
  get: (id) => read().find((p) => p.id === id) ?? null,
  save(post) {
    const all = read();
    const i = all.findIndex((p) => p.id === post.id);
    const next = { ...post, updatedAt: new Date().toISOString() };
    if (i >= 0) all[i] = next;
    else all.push(next);
    return write(all);
  },
  remove(id) {
    write(read().filter((p) => p.id !== id));
  },
};

/** Lista reactiva: se refresca al guardar desde cualquier pantalla y desde otras pestañas. */
export function usePosts(): InstagramPost[] {
  const [posts, setPosts] = useState<InstagramPost[]>(read);
  const refresh = useCallback(() => setPosts(read()), []);
  useEffect(() => {
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  return posts;
}

let uid = 0;
export const newPostId = (prefix = "igp") => `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
