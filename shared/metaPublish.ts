/**
 * Reglas de publicación en Instagram y Facebook (Página) compartidas entre el
 * navegador y el servidor. Lógica pura: sin red, sin DOM, sin Node.
 *
 * Fuentes oficiales (consultadas 2026-10-05):
 * - Publicación de contenido en Instagram (Facebook Login):
 *   https://developers.facebook.com/docs/instagram-platform/content-publishing
 * - POST /{ig-user-id}/media (specs de imagen, caption, carrusel):
 *   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 * - Límite de publicación (content_publishing_limit):
 *   https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
 * - Fotos de una Página (published=false + attached_media):
 *   https://developers.facebook.com/docs/graph-api/reference/page/photos/
 * - Posteos de una Página (feed, borrar):
 *   https://developers.facebook.com/docs/pages-api/posts
 */

export const META_PUBLISH_LIMITS = {
  /** "Carousels can have up to 10 total images, videos, or a mix of the two." */
  carouselMax: 10,
  carouselMin: 2,
  /** Caption: hasta 2.200 caracteres, 30 hashtags y 20 @menciones. */
  captionMax: 2200,
  hashtagsMax: 30,
  mentionsMax: 20,
  /** alt_text de imágenes: hasta 1.000 caracteres. */
  altTextMax: 1000,
  /** Imagen de feed: JPEG, relación 4:5 a 1,91:1, hasta 8 MB. */
  igImageMaxBytes: 8 * 1024 * 1024,
  igRatioMin: 4 / 5,
  igRatioMax: 1.91,
  /** Ancho 320–1440 px: fuera de eso Instagram la escala (no es error). */
  igWidthMin: 320,
  igWidthMax: 1440,
  /** Fotos de Página: "Los archivos no pueden superar los 4 MB". */
  fbImageMaxBytes: 4 * 1024 * 1024,
  /** Fotos por posteo de Página que mandamos (criterio propio: Facebook no documenta un tope claro). */
  fbPhotosMax: 10,
  /** Texto de un posteo de Página (criterio propio, holgado). */
  fbMessageMax: 5000,
} as const;

/** Tolerancia de redondeo para la relación de aspecto (1080×1350 da 0,8 exacto, otros tamaños no). */
const RATIO_EPS = 0.005;

export type IgPublishKind = "image" | "carousel" | "story";

export interface ImageFacts {
  url: string;
  /** `null` = no se pudo leer el tipo. */
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

export interface MediaIssue {
  url: string;
  /** Código estable para la UI. */
  code: "not_jpeg" | "too_big" | "ratio" | "unreadable";
  message: string;
}

const isJpegType = (t: string | null) => !!t && /^image\/(jpeg|jpg|pjpeg)\b/i.test(t);

/** Valida una imagen para Instagram según el tipo de publicación. */
export function checkIgImage(f: ImageFacts, kind: IgPublishKind): MediaIssue | null {
  if (!isJpegType(f.contentType)) {
    return { url: f.url, code: "not_jpeg", message: "Instagram solo acepta fotos JPEG. Exportala desde el Estudio de Instagram." };
  }
  if (f.bytes != null && f.bytes > META_PUBLISH_LIMITS.igImageMaxBytes) {
    return { url: f.url, code: "too_big", message: "La foto pesa más de 8 MB, el máximo de Instagram." };
  }
  if (kind === "story") return null; // 9:16 recomendado; Instagram recorta el resto.
  if (!f.width || !f.height) {
    return { url: f.url, code: "unreadable", message: "No pudimos leer el tamaño de la foto." };
  }
  const r = f.width / f.height;
  if (r < META_PUBLISH_LIMITS.igRatioMin - RATIO_EPS || r > META_PUBLISH_LIMITS.igRatioMax + RATIO_EPS) {
    return {
      url: f.url,
      code: "ratio",
      message: `La foto mide ${f.width}×${f.height}: Instagram acepta de 4:5 (vertical) a 1,91:1 (apaisada). Recortala en el Estudio.`,
    };
  }
  return null;
}

/** Valida una imagen para un posteo de Página de Facebook. */
export function checkFbImage(f: ImageFacts): MediaIssue | null {
  if (!f.contentType || !/^image\/(jpeg|jpg|pjpeg|png|gif|bmp|tiff)\b/i.test(f.contentType)) {
    return { url: f.url, code: "not_jpeg", message: "Facebook acepta JPEG, PNG, GIF, BMP o TIFF (no WebP)." };
  }
  if (f.bytes != null && f.bytes > META_PUBLISH_LIMITS.fbImageMaxBytes) {
    return { url: f.url, code: "too_big", message: "La foto pesa más de 4 MB, el máximo de Facebook." };
  }
  return null;
}

const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const MENTION_RE = /(^|\s)@[\w.]+/g;

/** Problemas del texto de Instagram (`null` = ok). */
export function checkIgCaption(caption: string): string | null {
  if (caption.length > META_PUBLISH_LIMITS.captionMax) return `El texto supera los ${META_PUBLISH_LIMITS.captionMax.toLocaleString("es-AR")} caracteres.`;
  if ((caption.match(HASHTAG_RE) ?? []).length > META_PUBLISH_LIMITS.hashtagsMax) return `Instagram admite hasta ${META_PUBLISH_LIMITS.hashtagsMax} hashtags.`;
  if ((caption.match(MENTION_RE) ?? []).length > META_PUBLISH_LIMITS.mentionsMax) return `Instagram admite hasta ${META_PUBLISH_LIMITS.mentionsMax} menciones.`;
  return null;
}

/** Cantidad de fotos válida para el tipo (`null` = ok). */
export function checkIgCount(kind: IgPublishKind, n: number): string | null {
  if (kind === "carousel") {
    if (n < META_PUBLISH_LIMITS.carouselMin) return "Un carrusel necesita al menos 2 fotos.";
    if (n > META_PUBLISH_LIMITS.carouselMax) return `Un carrusel admite hasta ${META_PUBLISH_LIMITS.carouselMax} fotos.`;
    return null;
  }
  return n === 1 ? null : "Elegí una sola foto.";
}

/** Tipo de publicación de Instagram según la cantidad de fotos (feed). */
export const igKindFor = (n: number): IgPublishKind => (n > 1 ? "carousel" : "image");

/**
 * Ancho y alto de un JPEG leyendo sus primeros bytes (marcador SOFn). Alcanza
 * con los primeros 64 KB en casi todas las fotos (el EXIF va antes del SOF).
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // Relleno y marcadores sin longitud.
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (marker === 0xda || len < 2) return null; // empezó la imagen sin SOF
    i += 2 + len;
  }
  return null;
}

/** Estado de un contenedor de Instagram (campo `status_code`). */
export type IgContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

/** Mensaje para la inmobiliaria a partir del código de error que devuelve /api/meta/*. */
export function metaPublishErrorText(code: string | null | undefined): string {
  switch (code) {
    case "publish_disabled":
      return "Requiere aprobación de Meta.";
    case "not_configured":
      return "La conexión con Meta todavía no está configurada en PropMatch.";
    case "not_connected":
      return "Conectá tu Página de Facebook para publicar.";
    case "no_instagram":
      return "Tu Página no tiene una cuenta de Instagram profesional vinculada.";
    case "needs_reauth":
      return "La conexión con Facebook venció: volvé a conectarla.";
    case "forbidden":
      return "Solo los administradores de la inmobiliaria pueden hacer esto.";
    case "quota_exceeded":
      return "Llegaste al límite de publicaciones por API de Instagram en las últimas 24 horas. Probá más tarde.";
    case "media_invalid":
      return "Alguna foto no cumple los requisitos.";
    case "bad_property":
      return "La propiedad no está sincronizada con tu cuenta o no está disponible.";
    case "container_error":
      return "Instagram no pudo procesar las fotos. Revisalas y probá de nuevo.";
    case "container_expired":
      return "La preparación venció (pasaron más de 24 h). Volvé a publicar.";
    case "rate_limited":
      return "Demasiados intentos seguidos. Esperá un minuto.";
    case "no_pages":
      return "Tu usuario no administra ninguna Página de Facebook.";
    case "page_in_use":
      return "Esa Página ya está conectada a otra inmobiliaria en PropMatch.";
    case "no_create_content":
      return "Tu rol en la Página no permite publicar (necesitás poder crear contenido).";
    default:
      return "No pudimos completar la publicación. Probá de nuevo en un rato.";
  }
}
