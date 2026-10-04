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

export const worstLevel = (checks: PhotoCheck[]): CheckLevel =>
  checks.some((c) => c.level === "error") ? "error" : checks.some((c) => c.level === "warn") ? "warn" : checks.some((c) => c.level === "unknown") ? "unknown" : "ok";

export const LEVEL_STYLE: Record<CheckLevel, { dot: string; text: string; bg: string; word: string }> = {
  ok: { dot: "#16A34A", text: "#15803D", bg: "#DCFCE7", word: "Bien" },
  warn: { dot: "#D97706", text: "#B45309", bg: "#FEF3C7", word: "Atención" },
  error: { dot: "#E11D48", text: "#BE123C", bg: "#FFE4E6", word: "Problema" },
  unknown: { dot: "#9CA3AF", text: "#4B5563", bg: "#F3F4F6", word: "Sin datos" },
};
