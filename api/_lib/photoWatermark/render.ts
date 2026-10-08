/**
 * Dibuja el logo de la inmobiliaria SOBRE una foto (marca de agua real) con
 * sharp. Solo para las copias que van a la app PropMatch: ver
 * shared/appWatermark.ts y docs/marca-de-agua-app.md.
 *
 * Sin imports relativos en tiempo de ejecución (lo prueban los tests con
 * `node --test` e imágenes generadas en memoria). api/integrations.ts lo carga
 * con `import()` solo en la acción watermark-photos, así el resto de las
 * acciones no paga el arranque de sharp.
 */
import sharp from "sharp";

type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Size = "sm" | "md";
type Backdrop = "shadow" | "light" | "dark";

export interface RenderOptions {
  position: Position;
  size: Size;
  backdrop: Backdrop;
}

/** Ancho del logo relativo al ancho de la foto. */
export const SIZE_RATIO: Record<Size, number> = { sm: 0.14, md: 0.2 };
/** Alto máximo del logo relativo al alto de la foto (logos cuadrados o verticales). */
export const MAX_HEIGHT_RATIO: Record<Size, number> = { sm: 0.12, md: 0.17 };
/** Lado mayor de la copia (las fotos más grandes se achican; nunca se agrandan). */
export const MAX_SIDE = 2560;
export const JPEG_QUALITY = 85;
/** El bucket acepta hasta 5 MB por archivo. */
export const MAX_OUTPUT_BYTES = 4.8 * 1024 * 1024;
/** Fotos absurdas (o bombas de descompresión) no se procesan. */
export const MAX_INPUT_PIXELS = 60_000_000;

// Una función de Vercel atiende un pedido por vez: sin caché entre pedidos y
// con pocos hilos, para no pasarse de memoria.
sharp.cache(false);
sharp.concurrency(2);

export interface WatermarkLayout {
  /** Caja del logo (sin la placa). */
  logo: { left: number; top: number; width: number; height: number };
  /** Caja total (con la placa, si hay). */
  box: { left: number; top: number; width: number; height: number; radius: number };
  plate: boolean;
  margin: number;
  /** Sigma del desenfoque de la sombra suave. */
  shadowSigma: number;
}

/**
 * Dónde y de qué tamaño va el logo. Pura: misma entrada, misma salida.
 * Ancho ≈ 14 % (chico) o 20 % (mediano) del ancho de la foto, sin pasarse de
 * un alto razonable; margen ≈ 3 % del lado menor; la placa suma un relleno
 * proporcional al alto del logo (como la capa CSS de PhotoLogoOverlay).
 */
export function watermarkLayout(photoW: number, photoH: number, logoW: number, logoH: number, o: RenderOptions): WatermarkLayout {
  const aspect = logoW > 0 && logoH > 0 ? logoW / logoH : 1;
  let width = Math.max(1, Math.round(photoW * SIZE_RATIO[o.size]));
  let height = Math.max(1, Math.round(width / aspect));
  const maxH = Math.max(1, Math.round(photoH * MAX_HEIGHT_RATIO[o.size]));
  if (height > maxH) {
    height = maxH;
    width = Math.max(1, Math.round(height * aspect));
  }
  const margin = Math.max(4, Math.round(Math.min(photoW, photoH) * 0.03));
  const plate = o.backdrop !== "shadow";
  const pad = plate ? Math.max(3, Math.round(height * 0.22)) : 0;
  const boxW = Math.min(photoW, width + pad * 2);
  const boxH = Math.min(photoH, height + pad * 2);
  const [v, h] = o.position.split("-") as ["top" | "bottom", "left" | "right"];
  const left = Math.max(0, h === "left" ? margin : photoW - margin - boxW);
  const top = Math.max(0, v === "top" ? margin : photoH - margin - boxH);
  return {
    logo: { left: left + pad, top: top + pad, width, height },
    box: { left, top, width: boxW, height: boxH, radius: plate ? Math.max(2, Math.round(height * 0.3)) : 0 },
    plate,
    margin,
    shadowSigma: Math.max(1, Math.round(height * 0.06)),
  };
}

const plateSvg = (w: number, h: number, r: number, backdrop: Backdrop) => {
  const fill = backdrop === "light" ? "#FFFFFF" : "#110C1E";
  const opacity = backdrop === "light" ? 0.86 : 0.5;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}" fill-opacity="${opacity}"/></svg>`,
  );
};

/**
 * Foto + logo → JPEG (calidad 85) con el logo en la esquina elegida.
 * Respeta la orientación EXIF, achica a 2560 px de lado mayor y aplana la
 * transparencia sobre blanco. Tira si la foto o el logo no se pueden leer.
 */
export async function renderWatermark(photo: Uint8Array, logo: Uint8Array, o: RenderOptions): Promise<Uint8Array> {
  // 1) La foto, derecha y a tamaño final, en crudo (así sabemos su tamaño real).
  const base = await sharp(photo, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = base.info.width;
  const H = base.info.height;

  // 2) El logo a su tamaño.
  const meta = await sharp(logo, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  if (!meta.width || !meta.height) throw new Error("logo");
  const L = watermarkLayout(W, H, meta.width, meta.height, o);
  const logoPng = await sharp(logo).ensureAlpha().resize(L.logo.width, L.logo.height, { fit: "fill" }).png().toBuffer();

  const layers: sharp.OverlayOptions[] = [];
  if (L.plate) {
    layers.push({ input: plateSvg(L.box.width, L.box.height, L.box.radius, o.backdrop), left: L.box.left, top: L.box.top });
  } else {
    // Sombra suave: la silueta del logo en negro, desenfocada y un poco más abajo.
    const ext = Math.min(L.shadowSigma * 3, L.margin);
    const shadow = await sharp(logoPng)
      .extend({ top: ext, bottom: ext, left: ext, right: ext, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .linear([0, 0, 0, 0.6], [0, 0, 0, 0])
      .blur(L.shadowSigma)
      .png()
      .toBuffer();
    const sw = L.logo.width + ext * 2;
    const sh = L.logo.height + ext * 2;
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
    const sx = clamp(L.logo.left - ext, W - sw);
    const sy = clamp(L.logo.top - ext + Math.max(1, Math.round(L.shadowSigma / 2)), H - sh);
    if (sw <= W && sh <= H) layers.push({ input: shadow, left: sx, top: sy });
  }
  layers.push({ input: logoPng, left: L.logo.left, top: L.logo.top });

  const composed = sharp(base.data, { raw: { width: W, height: H, channels: base.info.channels } }).composite(layers);
  const raw = await composed.raw().toBuffer({ resolveWithObject: true });
  // 3) JPEG; si se pasa del tope del bucket, se baja la calidad.
  for (const quality of [JPEG_QUALITY, 75, 65]) {
    const out = await sharp(raw.data, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } })
      .jpeg({ quality, chromaSubsampling: "4:2:0" })
      .toBuffer();
    if (out.length <= MAX_OUTPUT_BYTES) return new Uint8Array(out.buffer, out.byteOffset, out.length);
  }
  throw new Error("too_big");
}
