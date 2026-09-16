/**
 * Fotos sin backend.
 *
 * `URL.createObjectURL` da un `blob:` que muere con la pestaña: guardado en
 * localStorage, al recargar la foto queda rota. Mientras no haya Storage, la
 * foto se achica y se guarda como data URL. Se reduce bastante porque
 * localStorage tiene ~5 MB para toda la app.
 */

const MAX_SIDE = 1280;
const QUALITY = 0.72;

/** Achica la imagen a `MAX_SIDE` px de lado mayor y la devuelve como data URL WebP (o JPEG). */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const webp = canvas.toDataURL("image/webp", QUALITY);
  // Safari viejo no codifica WebP y devuelve PNG: ahí conviene JPEG.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", QUALITY);
}

/** Las URLs `blob:` guardadas antes de este arreglo ya no apuntan a nada. */
export const isDeadPhotoUrl = (url: string) => url.startsWith("blob:");
