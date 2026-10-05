/**
 * Especificaciones de Instagram para publicar fotos, en un solo lugar.
 *
 * Fuentes (consultadas 2026-10):
 *  [A] Meta, Instagram Platform > Content Publishing
 *      https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing
 *      -> solo JPEG (no MPO/JPS), carrusel hasta 10, el carrusel se recorta según la
 *         primera imagen (1:1 por defecto), 100 posts por API en 24 h móviles
 *         (carrusel = 1), alt text solo para imágenes (no reels ni stories).
 *  [B] Meta, referencia IG User Media
 *      https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 *      -> imagen: 8 MB máx., relación 4:5 a 1.91:1, ancho mínimo 320 px (se escala);
 *         caption 2.200 caracteres, 30 hashtags, 20 @tags; alt text hasta 1.000 caracteres;
 *         Story imagen: 8 MB, JPEG, 9:16 recomendado.
 *
 * A VERIFICAR (no figuran en la doc oficial de la API; vienen de guías de terceros o de la práctica):
 *  - 1080 px como ancho ideal y los tamaños 1080x1350 / 1080x1080 / 1080x566.
 *  - Corte del «más…» en ~125 caracteres (varía por dispositivo y por saltos de línea).
 *  - Zonas seguras de Story (250 px arriba / 340 px abajo sobre 1920).
 *  - Cantidad "ideal" de hashtags: la API permite 30; no afirmamos una cifra recomendada.
 *  - El límite diario: la doc dice 100, otro endpoint habla de 50 (usar GET /content_publishing_limit).
 */

export type IgFormatId = "feed45" | "square" | "landscape" | "story";

export interface IgFormat {
  id: IgFormatId;
  label: string;
  /** Etiqueta corta de la relación. */
  ratioLabel: string;
  /** ancho / alto */
  ratio: number;
  /** Tamaño de exportación en píxeles. */
  width: number;
  height: number;
  recommended?: boolean;
  hint: string;
}

export const IG_FORMATS: IgFormat[] = [
  { id: "feed45", label: "Feed 4:5", ratioLabel: "4:5", ratio: 4 / 5, width: 1080, height: 1350, recommended: true, hint: "Retrato: ocupa más pantalla en el feed." },
  { id: "square", label: "Cuadrado 1:1", ratioLabel: "1:1", ratio: 1, width: 1080, height: 1080, hint: "Clásico; es el recorte por defecto de la API en carruseles." },
  { id: "landscape", label: "Apaisado 1.91:1", ratioLabel: "1.91:1", ratio: 1.91, width: 1080, height: 566, hint: "El más ancho que acepta la API; ocupa poco alto." },
  { id: "story", label: "Story 9:16", ratioLabel: "9:16", ratio: 9 / 16, width: 1080, height: 1920, hint: "Pantalla completa vertical. No lleva texto de publicación." },
];

export const getFormat = (id: IgFormatId): IgFormat => IG_FORMATS.find((f) => f.id === id) ?? IG_FORMATS[0];

export const IG_LIMITS = {
  captionMax: 2200,
  hashtagsMax: 30,
  mentionsMax: 20,
  altTextMax: 1000,
  carouselMin: 2,
  carouselMax: 10,
  fileMaxBytes: 8 * 1024 * 1024,
  /** Relación aceptada por la API para imágenes de feed: 4:5 a 1.91:1. */
  apiRatioMin: 4 / 5,
  apiRatioMax: 1.91,
  apiMinWidthPx: 320,
  idealWidthPx: 1080,
  /** Caracteres visibles antes del «más…» (aprox., a verificar). */
  captionVisibleChars: 125,
  apiPostsPer24h: 100,
  exportJpegQuality: 0.9,
} as const;

/** Zonas donde la interfaz de Instagram tapa la Story (a verificar), sobre 1920 px de alto. */
export const STORY_SAFE = { topPx: 250, bottomPx: 340, heightPx: 1920 } as const;

export interface Focal {
  /** 0 = borde izquierdo/superior del sobrante, 1 = derecho/inferior. Equivale a `object-position`. */
  x: number;
  y: number;
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Mayor recuadro de relación `ratio` dentro de la imagen, posicionado por el punto focal.
 * Es exactamente lo que hace `object-fit: cover` + `object-position`, así la vista previa
 * y el JPEG exportado coinciden.
 */
export function cropRect(natW: number, natH: number, ratio: number, focal: Focal): CropRect {
  let sw = natW;
  let sh = natW / ratio;
  if (sh > natH) {
    sh = natH;
    sw = natH * ratio;
  }
  return { sx: (natW - sw) * clamp01(focal.x), sy: (natH - sh) * clamp01(focal.y), sw, sh };
}

/* ── Chequeos de calidad por foto ─────────────────────────────────────────── */

export type CheckLevel = "ok" | "warn" | "error" | "unknown";

export interface PhotoCheck {
  id: "resolution" | "ratio" | "crop" | "weight" | "format";
  level: CheckLevel;
  label: string;
  detail: string;
}

export interface ImageFacts {
  width: number;
  height: number;
  /** `null` = no disponible (CORS u otro). */
  bytes: number | null;
  /** `null` = no se pudo determinar. */
  mime: string | null;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

export function checkPhoto(img: ImageFacts, format: IgFormat, focal: Focal): PhotoCheck[] {
  const crop = cropRect(img.width, img.height, format.ratio, focal);
  const ratio = img.width / img.height;
  const lost = Math.round((1 - (crop.sw * crop.sh) / (img.width * img.height)) * 100);
  const out: PhotoCheck[] = [];

  const cropW = Math.round(crop.sw);
  if (cropW < IG_LIMITS.apiMinWidthPx) {
    out.push({ id: "resolution", level: "error", label: "Resolución", detail: `El recorte mide ${cropW} px de ancho; Instagram pide al menos ${IG_LIMITS.apiMinWidthPx} px.` });
  } else if (cropW < format.width) {
    out.push({ id: "resolution", level: "warn", label: "Resolución", detail: `El recorte mide ${cropW} px de ancho y el ideal es ${format.width} px: se agranda al exportar y puede verse blanda.` });
  } else {
    out.push({ id: "resolution", level: "ok", label: "Resolución", detail: `El recorte mide ${cropW} px de ancho (ideal ${format.width} px).` });
  }

  if (ratio >= IG_LIMITS.apiRatioMin - 0.005 && ratio <= IG_LIMITS.apiRatioMax + 0.005) {
    out.push({ id: "ratio", level: "ok", label: "Relación de aspecto", detail: "La foto original está dentro de lo que acepta la API (4:5 a 1.91:1)." });
  } else {
    out.push({ id: "ratio", level: "warn", label: "Relación de aspecto", detail: "La original está fuera de 4:5 a 1.91:1 y Instagram la rechazaría tal cual. Al exportar se recorta al formato elegido, así que no la subas sin exportar." });
  }

  if (lost > 40) {
    out.push({ id: "crop", level: "warn", label: "Recorte", detail: `Se pierde el ${lost}% de la imagen. Ajustá el punto focal para dejar lo importante adentro.` });
  } else {
    out.push({ id: "crop", level: "ok", label: "Recorte", detail: lost === 0 ? "No se recorta nada." : `Se recorta el ${lost}% de la imagen.` });
  }

  if (img.bytes == null) {
    out.push({ id: "weight", level: "unknown", label: "Peso", detail: "No disponible: el servidor de la imagen no deja leerla desde el navegador." });
  } else if (img.bytes > IG_LIMITS.fileMaxBytes) {
    out.push({ id: "weight", level: "warn", label: "Peso", detail: `El original pesa ${mb(img.bytes)} y el máximo es 8 MB. Al exportar se recomprime a JPEG.` });
  } else {
    out.push({ id: "weight", level: "ok", label: "Peso", detail: `El original pesa ${mb(img.bytes)} (máximo 8 MB).` });
  }

  if (img.mime == null) {
    out.push({ id: "format", level: "unknown", label: "Formato", detail: "No pudimos determinar el formato. Se exporta siempre como JPEG." });
  } else if (img.mime === "image/jpeg") {
    out.push({ id: "format", level: "ok", label: "Formato", detail: "JPEG: es el único formato que acepta la API." });
  } else {
    out.push({ id: "format", level: "warn", label: "Formato", detail: `La original es ${img.mime.replace("image/", "").toUpperCase()}. Instagram solo acepta JPEG; se convierte al exportar.` });
  }
  return out;
}

export const worstLevel = (checks: { level: CheckLevel }[]): CheckLevel =>
  checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : checks.some((c) => c.level === "unknown") ? "unknown" : "ok";

export const LEVEL_STYLE: Record<CheckLevel, { dot: string; text: string; bg: string; word: string }> = {
  ok: { dot: "#16A34A", text: "#15803D", bg: "#DCFCE7", word: "Bien" },
  warn: { dot: "#D97706", text: "#B45309", bg: "#FEF3C7", word: "Atención" },
  error: { dot: "#E11D48", text: "#BE123C", bg: "#FFE4E6", word: "Problema" },
  unknown: { dot: "#9CA3AF", text: "#4B5563", bg: "#F3F4F6", word: "Sin datos" },
};

/* ── Video, Reels y Stories (agregado por el Estudio) ─────────────────────── */

/**
 * Reglas de video de la API de publicación. Fuente [B] (confirmadas, leídas 2026-10):
 *  https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 *  - Reel: MP4/MOV sin edit lists y con el átomo moov al inicio; H.264 o HEVC, barrido progresivo,
 *    GOP cerrado, croma 4:2:0; audio AAC hasta 48 kHz, 1 o 2 canales; 23–60 fps; 3 s a 15 min;
 *    relación entre 0,01:1 y 10:1 (recomendado 9:16); ancho máx. 1920 px; video VBR hasta 25 Mbps;
 *    audio 128 kbps; hasta 300 MB. Portada: JPEG hasta 8 MB, 9:16 recomendado (`cover_url` o `thumb_offset`).
 *  - Story en video: mismas reglas de códec, 3 a 60 s, hasta 100 MB, relación 0,1:1 a 10:1 (9:16 recomendado).
 *
 * A VERIFICAR (no figura o no lo confirmamos en la doc):
 *  - Que desde la app móvil (publicación a mano) rijan los mismos topes: la app tiene sus propios límites y cambian.
 *  - Duración máxima de un Reel hecho desde la app (la doc de la API dice 15 min; la app ha variado).
 *  - Videos dentro de carruseles: la API los admite pero no verificamos sus topes acá.
 *  - Resolución mínima recomendada para video (usamos 720 px de ancho como aviso, criterio propio).
 */
export const VIDEO_SPECS = {
  reel: { minSec: 3, maxSec: 15 * 60, maxBytes: 300 * 1024 * 1024 },
  story: { minSec: 3, maxSec: 60, maxBytes: 100 * 1024 * 1024 },
  maxWidthPx: 1920,
  recommendedRatio: 9 / 16,
  ratioMin: 0.01,
  ratioMax: 10,
  storyRatioMin: 0.1,
  fps: { min: 23, max: 60 },
  coverMaxBytes: 8 * 1024 * 1024,
  /** Criterio propio (a verificar): por debajo se ve blando en pantalla completa. */
  softWidthPx: 720,
  /** Códec y contenedor: el navegador no los informa de forma fiable; se muestran como recordatorio. */
  acceptedMime: ["video/mp4", "video/quicktime"],
} as const;

export const IMAGE_UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/** Tope propio de lo que se guarda en el navegador por archivo (IndexedDB aguanta más, pero la cuota es chica). */
export const UPLOAD_MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export type PostKind = "carousel" | "photo" | "story" | "reel";

export interface PostKindInfo {
  id: PostKind;
  label: string;
  short: string;
  help: string;
  limits: string;
  /** Qué medios acepta. */
  accepts: ("image" | "video")[];
  min: number;
  max: number;
  /** Formato de exportación por defecto para imágenes. */
  formatId: IgFormatId;
  hasCaption: boolean;
}

export const POST_KINDS: PostKindInfo[] = [
  {
    id: "carousel", label: "Carrusel", short: "2 a 10 fotos",
    help: "Varias fotos que se deslizan en una sola publicación. Ideal para mostrar una propiedad ambiente por ambiente.",
    limits: "De 2 a 10 elementos. El recorte lo define la primera foto. Texto de hasta 2.200 caracteres.",
    accepts: ["image"], min: 2, max: IG_LIMITS.carouselMax, formatId: "feed45", hasCaption: true,
  },
  {
    id: "photo", label: "Foto única", short: "1 foto",
    help: "Una sola imagen en el feed, con texto debajo.",
    limits: "JPEG hasta 8 MB, relación de 4:5 a 1,91:1. Texto de hasta 2.200 caracteres.",
    accepts: ["image"], min: 1, max: 1, formatId: "feed45", hasCaption: true,
  },
  {
    id: "story", label: "Story", short: "Vertical 9:16",
    help: "Pantalla completa vertical que dura 24 horas. Admite fotos o un video corto. No lleva texto de publicación.",
    limits: "Imagen JPEG hasta 8 MB, 9:16. Video de 3 a 60 s, hasta 100 MB.",
    accepts: ["image", "video"], min: 1, max: 1, formatId: "story", hasCaption: false,
  },
  {
    id: "reel", label: "Reel", short: "Video 9:16",
    help: "Video vertical que aparece en la pestaña Reels y en tu perfil. Subí el video ya editado.",
    limits: "Video MP4/MOV (H.264 o HEVC, AAC), 3 s a 15 min, hasta 300 MB, 23–60 fps, 9:16 recomendado.",
    accepts: ["video"], min: 1, max: 1, formatId: "story", hasCaption: true,
  },
];

export const getPostKind = (id: PostKind): PostKindInfo => POST_KINDS.find((k) => k.id === id) ?? POST_KINDS[0];

export interface VideoFacts {
  width: number;
  height: number;
  durationSec: number;
  bytes: number;
}

export interface VideoCheck {
  id: "duration" | "size" | "ratio" | "resolution" | "format";
  level: CheckLevel;
  label: string;
  detail: string;
}

const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(1).replace(".", ",")} s`);
const mbs = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

export function checkVideo(v: VideoFacts, kind: "reel" | "story", mime: string | null): VideoCheck[] {
  const lim = VIDEO_SPECS[kind];
  const out: VideoCheck[] = [];
  if (v.durationSec < lim.minSec) out.push({ id: "duration", level: "error", label: "Duración", detail: `Dura ${secs(v.durationSec)}; el mínimo es ${lim.minSec} s.` });
  else if (v.durationSec > lim.maxSec) out.push({ id: "duration", level: "error", label: "Duración", detail: `Dura ${secs(v.durationSec)}; el máximo para ${kind === "reel" ? "un Reel" : "una Story"} es ${secs(lim.maxSec)}.` });
  else out.push({ id: "duration", level: "ok", label: "Duración", detail: `${secs(v.durationSec)} (de ${lim.minSec} s a ${secs(lim.maxSec)}).` });

  if (v.bytes > lim.maxBytes) out.push({ id: "size", level: "error", label: "Peso", detail: `Pesa ${mbs(v.bytes)}; el máximo es ${Math.round(lim.maxBytes / 1024 / 1024)} MB.` });
  else out.push({ id: "size", level: "ok", label: "Peso", detail: `${mbs(v.bytes)} (máximo ${Math.round(lim.maxBytes / 1024 / 1024)} MB).` });

  const ratio = v.width / v.height;
  const rMin = kind === "reel" ? VIDEO_SPECS.ratioMin : VIDEO_SPECS.storyRatioMin;
  if (ratio < rMin || ratio > VIDEO_SPECS.ratioMax) out.push({ id: "ratio", level: "error", label: "Relación de aspecto", detail: "Está fuera de lo que acepta la API." });
  else if (Math.abs(ratio - VIDEO_SPECS.recommendedRatio) > 0.02) out.push({ id: "ratio", level: "warn", label: "Relación de aspecto", detail: `Mide ${v.width}×${v.height}. Se acepta, pero con relación distinta de 9:16 Instagram recorta o deja bandas. Editalo en 9:16 antes de subirlo.` });
  else out.push({ id: "ratio", level: "ok", label: "Relación de aspecto", detail: "9:16, la recomendada." });

  if (v.width > VIDEO_SPECS.maxWidthPx) out.push({ id: "resolution", level: "warn", label: "Resolución", detail: `Ancho de ${v.width} px; la API toma hasta ${VIDEO_SPECS.maxWidthPx} px y puede reducirlo.` });
  else if (v.width < VIDEO_SPECS.softWidthPx) out.push({ id: "resolution", level: "warn", label: "Resolución", detail: `Ancho de ${v.width} px: se va a ver blando en pantalla completa (ideal 1080 px, criterio propio, a verificar).` });
  else out.push({ id: "resolution", level: "ok", label: "Resolución", detail: `${v.width}×${v.height} px.` });

  if (mime && !(VIDEO_SPECS.acceptedMime as readonly string[]).includes(mime)) out.push({ id: "format", level: "error", label: "Formato", detail: "Instagram acepta MP4 o MOV." });
  else out.push({ id: "format", level: "unknown", label: "Códec", detail: "El navegador no nos dice el códec: la API pide H.264 o HEVC con audio AAC, 23 a 60 fps (a verificar en tu archivo)." });
  return out;
}
