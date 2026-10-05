import { cropRect, IG_LIMITS, type Focal, type IgFormat } from "./imageSpecs";
import { drawEdited, type DrawOptions, type PhotoEdits } from "./photoEdits";

export class ExportError extends Error {
  constructor(public code: "cors" | "decode" | "encode", message: string) {
    super(message);
  }
}

function loadForCanvas(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Sin crossOrigin el canvas queda "contaminado" y toBlob falla; con él, el servidor debe mandar CORS.
    if (/^https?:/i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new ExportError(
          "cors",
          "No pudimos leer esta foto desde el navegador: el servidor de imágenes no habilita CORS. Descargá la original, subila con «Subir fotos» y exportá desde ahí, o pedí habilitar CORS en el almacenamiento de fotos.",
        ),
      );
    img.src = url;
  });
}

/** Recorta al formato (con el punto focal) y devuelve un JPEG del tamaño ideal. */
export async function exportPhotoJpeg(url: string, format: IgFormat, focal: Focal): Promise<Blob> {
  const img = await loadForCanvas(url);
  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportError("encode", "Tu navegador no pudo preparar el lienzo de exportación.");
  const { sx, sy, sw, sh } = cropRect(img.naturalWidth, img.naturalHeight, format.ratio, focal);
  // JPEG no tiene transparencia: fondo blanco para PNG/WebP con alfa.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, format.width, format.height);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ExportError("encode", "No se pudo generar el JPEG."))),
        "image/jpeg",
        IG_LIMITS.exportJpegQuality,
      );
    } catch {
      reject(new ExportError("cors", "El navegador bloqueó la lectura de la foto (CORS). Subila desde tu equipo con «Subir fotos»."));
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/**
 * Como `exportPhotoJpeg`, pero hornea todas las ediciones (recorte con zoom, giro, color,
 * filtro, viñeta, texto y sello). Es la misma función de dibujo que usa la vista previa.
 */
export async function exportEditedJpeg(
  url: string,
  format: IgFormat,
  edits: PhotoEdits,
  opts: DrawOptions = {},
  width: number = format.width,
): Promise<Blob> {
  const img = await loadForCanvas(url);
  const height = Math.round(width / format.ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ExportError("encode", "Tu navegador no pudo preparar el lienzo de exportación.");
  drawEdited(ctx, img, img.naturalWidth, img.naturalHeight, edits, width, height, opts);
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ExportError("encode", "No se pudo generar el JPEG."))),
        "image/jpeg",
        IG_LIMITS.exportJpegQuality,
      );
    } catch {
      reject(new ExportError("cors", "El navegador bloqueó la lectura de la foto (CORS). Subila desde tu equipo."));
    }
  });
}
