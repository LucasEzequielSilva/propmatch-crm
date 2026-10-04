/**
 * Lectura y validación de los archivos que sube la persona (fotos y videos propios) y captura
 * de la portada de un video. No recorta ni recomprime video: eso requeriría ffmpeg (ver README).
 */

import { useEffect, useRef, useState } from "react";
import { IMAGE_UPLOAD_MIME, UPLOAD_MAX_IMAGE_BYTES, VIDEO_SPECS } from "./imageSpecs";
import { getMedia } from "./mediaStore";
import type { PostMedia } from "./postStore";

export type MediaKind = "image" | "video";

export interface Probed {
  kind: MediaKind;
  width: number;
  height: number;
  durationSec?: number;
}

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** Tipo MIME confiable: algunos navegadores dejan `file.type` vacío para .mov. */
export function mimeOf(file: File): string {
  if (file.type) return file.type;
  const e = ext(file.name);
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime" } as Record<string, string>)[e] ?? "";
}

export type UploadVerdict = { ok: true; kind: MediaKind; mime: string } | { ok: false; message: string };

/** Valida tipo y peso antes de leer el archivo. Mensajes pensados para mostrarse tal cual. */
export function validateUpload(file: File, accepts: MediaKind[]): UploadVerdict {
  const mime = mimeOf(file);
  const isImage = (IMAGE_UPLOAD_MIME as readonly string[]).includes(mime);
  const isVideo = (VIDEO_SPECS.acceptedMime as readonly string[]).includes(mime);
  if (!isImage && !isVideo) {
    const hint = /^(image\/(heic|heif|gif|avif)|video\/)/.test(mime)
      ? " Convertila a JPEG (fotos) o a MP4/MOV (videos): Instagram solo acepta esos formatos."
      : " Subí fotos JPEG, PNG o WebP, o videos MP4/MOV.";
    return { ok: false, message: `«${file.name}»: formato no admitido${mime ? ` (${mime})` : ""}.${hint}` };
  }
  const kind: MediaKind = isImage ? "image" : "video";
  if (!accepts.includes(kind)) {
    return { ok: false, message: `«${file.name}»: este tipo de publicación no admite ${kind === "image" ? "fotos" : "videos"}.` };
  }
  if (kind === "image" && file.size > UPLOAD_MAX_IMAGE_BYTES) {
    return { ok: false, message: `«${file.name}»: pesa ${(file.size / 1024 / 1024).toFixed(0)} MB; el tope para guardarla acá es ${UPLOAD_MAX_IMAGE_BYTES / 1024 / 1024} MB.` };
  }
  if (kind === "video" && file.size > VIDEO_SPECS.reel.maxBytes) {
    return { ok: false, message: `«${file.name}»: pesa ${(file.size / 1024 / 1024).toFixed(0)} MB y el máximo de Instagram para un video es ${VIDEO_SPECS.reel.maxBytes / 1024 / 1024} MB.` };
  }
  return { ok: true, kind, mime };
}

/** Dimensiones reales (y duración si es video). Rechaza si el navegador no puede decodificarlo. */
export function probeFile(file: Blob, kind: MediaKind): Promise<Probed> {
  const url = URL.createObjectURL(file);
  return new Promise<Probed>((resolve, reject) => {
    const done = (fn: () => void) => {
      URL.revokeObjectURL(url);
      fn();
    };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done(() => resolve({ kind, width: img.naturalWidth, height: img.naturalHeight }));
      img.onerror = () => done(() => reject(new Error("No pudimos leer la imagen: puede estar dañada o ser de un formato que este navegador no abre.")));
      img.src = url;
    } else {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => done(() => resolve({ kind, width: v.videoWidth, height: v.videoHeight, durationSec: v.duration }));
      v.onerror = () => done(() => reject(new Error("Este navegador no puede abrir el video (códec no compatible). Probá exportarlo en MP4 con H.264.")));
      v.src = url;
    }
  });
}

/** Captura el fotograma en `timeSec` como JPEG. */
export function captureFrame(videoUrl: string, timeSec: number, maxWidth = 1080): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    if (/^https?:/i.test(videoUrl)) v.crossOrigin = "anonymous";
    v.onerror = () => reject(new Error("No se pudo leer el video."));
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(Math.max(0, timeSec), Math.max(0, v.duration - 0.05));
    };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, maxWidth / v.videoWidth);
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo generar la portada."))), "image/jpeg", 0.9);
      } catch {
        reject(new Error("No se pudo capturar el fotograma."));
      }
    };
    v.src = videoUrl;
  });
}

/**
 * URLs de objeto para los medios (blobs de IndexedDB o URL remota). Las crea al montar y las
 * revoca al desmontar o cuando el medio sale de la lista. `missing` lista los que no se encontraron
 * (se borraron del navegador): la pantalla avisa en vez de mostrar una imagen rota.
 */
export function useMediaUrls(media: PostMedia[]): { urls: Record<string, string>; covers: Record<string, string>; missing: string[] } {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const owned = useRef<Record<string, string>>({});

  const key = media.map((m) => `${m.id}:${m.source}:${m.url ?? ""}:${m.hasCover ? m.coverTimeSec ?? 0 : "x"}`).join("|");

  useEffect(() => {
    let alive = true;
    const keep = new Set<string>();
    (async () => {
      const miss: string[] = [];
      for (const m of media) {
        const ids = [m.id, ...(m.hasCover ? [`${m.id}:cover`] : [])];
        for (const id of ids) {
          keep.add(id);
          const isCover = id !== m.id;
          if (!isCover && m.source === "remote" && m.url) {
            if (alive) setUrls((p) => (p[id] === m.url ? p : { ...p, [id]: m.url! }));
            continue;
          }
          if (isCover && owned.current[id]) {
            // se regenera siempre: la portada puede cambiar
            URL.revokeObjectURL(owned.current[id]);
            delete owned.current[id];
          }
          if (owned.current[id]) continue;
          const rec = await getMedia(id);
          if (!alive) return;
          if (!rec) {
            if (!isCover) miss.push(m.id);
            continue;
          }
          const u = URL.createObjectURL(rec.blob);
          owned.current[id] = u;
          (isCover ? setCovers : setUrls)((p) => ({ ...p, [isCover ? m.id : id]: u }));
        }
      }
      if (alive) setMissing(miss);
      for (const id of Object.keys(owned.current)) {
        if (!keep.has(id)) {
          URL.revokeObjectURL(owned.current[id]);
          delete owned.current[id];
        }
      }
    })();
    return () => {
      alive = false;
    };
    // `key` resume todo lo que cambia el resultado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const o = owned.current;
    return () => Object.values(o).forEach((u) => URL.revokeObjectURL(u));
  }, []);

  return { urls, covers, missing };
}
