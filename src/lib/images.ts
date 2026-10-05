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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Las fotos ya sincronizadas vienen del Storage público (con CORS): sin
    // esto el canvas queda "contaminado" y no se puede exportar.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = src;
  });
}

/**
 * Gira la foto 90° a la derecha y la devuelve como data URL, con el mismo
 * tope de tamaño y calidad que `compressImage`. Si era una URL del Storage,
 * pasa a ser una foto nueva: se vuelve a subir en la próxima sincronización.
 */
export async function rotateImage(src: string): Promise<string> {
  const img = await loadImage(src);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = h;
  canvas.height = w;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.translate(h, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0, w, h);

  const webp = canvas.toDataURL("image/webp", QUALITY);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", QUALITY);
}

/** Las URLs `blob:` guardadas antes de este arreglo ya no apuntan a nada. */
export const isDeadPhotoUrl = (url: string) => url.startsWith("blob:");
