/**
 * Logo de la inmobiliaria QUEMADO en las fotos que van a la app PropMatch.
 *
 * Lógica pura (sin red, sin sharp, sin imports en tiempo de ejecución: la
 * usan el navegador, api/integrations.ts y los tests con `node --test`). El
 * dibujo con sharp está en api/_lib/photoWatermark/render.ts.
 *
 * Cómo funciona (ver docs/marca-de-agua-app.md):
 *  - El CRM guarda y muestra SIEMPRE las fotos originales.
 *  - Con la opción «Poner el logo en las fotos de la app PropMatch» prendida,
 *    antes de escribir `properties.photos` el navegador le pide al servidor
 *    (POST /api/integrations/watermark-photos) una copia con logo de cada
 *    foto. La app recibe las copias.
 *  - Las copias van a `property-photos/<agency_id>/<crmPropertyId>/app/`. El
 *    nombre es `<hash>_<original>.jpg`:
 *      · `<hash>`: sha256 de (foto + logo + opciones + versión). Si el archivo
 *        ya existe no se vuelve a procesar (idempotente).
 *      · `<original>`: la ruta de la foto original dentro de la carpeta de la
 *        agencia, en base64url. Así cualquiera que lea `properties.photos`
 *        (Mercado Libre, la web pública) puede volver a la original SIN una
 *        tabla nueva y sin confiar en el navegador: `originalPhotos()`.
 *  - Mercado Libre y el resto de los portales usan siempre las originales.
 */

export const WATERMARK_VERSION = 1;
export const PHOTO_BUCKET = "property-photos";
/** Fotos por pedido al servidor (cada una se baja, se dibuja y se sube: entra holgado en 60 s). */
export const WATERMARK_CHUNK = 6;
/** Tope que acepta el servidor por pedido. */
export const WATERMARK_MAX_URLS = 12;
/** Plazo para EMPEZAR fotos nuevas dentro de un pedido (maxDuration de la función = 60 s). */
export const WATERMARK_BUDGET_MS = 40_000;
/** Fotos en paralelo dentro de un pedido (sharp usa varios núcleos por foto). */
export const WATERMARK_CONCURRENCY = 2;
/** Carpeta de las copias con logo dentro de la carpeta de la propiedad. */
export const WATERMARK_FOLDER = "app";

export const WATERMARK_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export const WATERMARK_SIZES = ["sm", "md"] as const;
export const WATERMARK_BACKDROPS = ["shadow", "light", "dark"] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];
export type WatermarkSize = (typeof WATERMARK_SIZES)[number];
export type WatermarkBackdrop = (typeof WATERMARK_BACKDROPS)[number];

/** Cómo se dibuja el logo (lo mismo que `AppWatermarkConfig` de shared/brand.ts, sin la URL). */
export interface WatermarkOptions {
  position: WatermarkPosition;
  size: WatermarkSize;
  backdrop: WatermarkBackdrop;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CRM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^[A-Za-z0-9_-]{1,120}\.(jpe?g|png|webp)$/i;
const BRAND_FILE_RE = /^[A-Za-z0-9_-]{1,120}\.(jpe?g|png|webp)$/i;
const HASH_RE = /^[0-9a-f]{24}$/;

/** `https://<proyecto>.supabase.co/storage/v1/object/public/property-photos/` */
export function photosPublicBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/`;
}

/* ── base64url (solo ASCII: las rutas que se codifican ya pasaron la lista blanca) ── */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function b64urlEncode(ascii: string): string {
  let out = "";
  for (let i = 0; i < ascii.length; i += 3) {
    const a = ascii.charCodeAt(i);
    const b = i + 1 < ascii.length ? ascii.charCodeAt(i + 1) : NaN;
    const c = i + 2 < ascii.length ? ascii.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (!Number.isNaN(b)) out += B64[(n >> 6) & 63];
    if (!Number.isNaN(c)) out += B64[n & 63];
  }
  return out;
}

export function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  let out = "";
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : -1));
    const n = (v[0] << 18) | (v[1] << 12) | (Math.max(v[2], 0) << 6) | Math.max(v[3], 0);
    out += String.fromCharCode((n >> 16) & 255);
    if (v[2] >= 0) out += String.fromCharCode((n >> 8) & 255);
    if (v[3] >= 0) out += String.fromCharCode(n & 255);
  }
  return out;
}

/* ── Rutas ────────────────────────────────────────────────────────────── */

/**
 * Ruta (relativa a la carpeta de la agencia) de una foto ORIGINAL que se puede
 * marcar: `<crmId>/<archivo>` (subida al sincronizar o copiada por «Publicar
 * todas») o `crm/<crmId>/<archivo>` (subida para Mercado Libre). Nunca el logo
 * (`branding/`) ni una copia con logo (`…/app/…`). `null` si no.
 */
export function validOriginalRel(rel: string): boolean {
  const parts = rel.split("/");
  if (parts.length < 2 || parts.length > 3) return false;
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (!FILE_RE.test(file) || !dirs.every((d) => SEGMENT_RE.test(d))) return false;
  if (dirs[0] === "branding" || dirs.includes(WATERMARK_FOLDER)) return false;
  if (parts.length === 3 && dirs[0] !== "crm") return false;
  return true;
}

/** Ruta de una foto original de la agencia a partir de su URL pública (o `null`). */
export function ownPhotoRel(url: unknown, publicBase: string, agencyId: string): string | null {
  if (typeof url !== "string" || !publicBase || !UUID_RE.test(agencyId)) return null;
  const prefix = `${publicBase}${agencyId}/`;
  if (!url.startsWith(prefix)) return null;
  const rel = url.slice(prefix.length);
  return validOriginalRel(rel) ? rel : null;
}

/** Logo de la agencia: un archivo directo de `<agency_id>/branding/`. */
export function brandingLogoRel(url: unknown, publicBase: string, agencyId: string): string | null {
  if (typeof url !== "string" || !publicBase || !UUID_RE.test(agencyId)) return null;
  const prefix = `${publicBase}${agencyId}/branding/`;
  if (!url.startsWith(prefix)) return null;
  const file = url.slice(prefix.length);
  return BRAND_FILE_RE.test(file) && file !== "brand.png" ? `branding/${file}` : null;
}

/** Ruta completa en el bucket de la copia con logo. */
export function watermarkObjectPath(agencyId: string, crmPropertyId: string, hash: string, originalRel: string): string {
  if (!UUID_RE.test(agencyId)) throw new Error("agency_id");
  if (!CRM_ID_RE.test(crmPropertyId)) throw new Error("crm_id");
  if (!HASH_RE.test(hash)) throw new Error("hash");
  if (!validOriginalRel(originalRel)) throw new Error("original");
  return `${agencyId}/${crmPropertyId}/${WATERMARK_FOLDER}/${hash}_${b64urlEncode(originalRel)}.jpg`;
}

export interface WatermarkCopyInfo {
  agencyId: string;
  crmPropertyId: string;
  hash: string;
  originalRel: string;
  /** URL pública de la foto original (misma agencia). */
  originalUrl: string;
}

/** Si `url` es una copia con logo de este bucket, de dónde salió. Si no, `null`. */
export function parseWatermarkUrl(url: unknown, publicBase: string): WatermarkCopyInfo | null {
  if (typeof url !== "string" || !publicBase || !url.startsWith(publicBase)) return null;
  const m = /^([0-9a-f-]{36})\/([A-Za-z0-9_-]{1,64})\/app\/([0-9a-f]{24})_([A-Za-z0-9_-]{4,400})\.jpg$/.exec(url.slice(publicBase.length));
  if (!m || !UUID_RE.test(m[1])) return null;
  const rel = b64urlDecode(m[4]);
  if (!rel || !validOriginalRel(rel)) return null;
  return { agencyId: m[1], crmPropertyId: m[2], hash: m[3], originalRel: rel, originalUrl: `${publicBase}${m[1]}/${rel}` };
}

/** Sin la base: ¿parece una copia con logo? (para la web, que no siempre la tiene a mano). */
export const looksLikeWatermarkCopy = (url: unknown): boolean =>
  typeof url === "string" && /\/property-photos\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\/app\/[0-9a-f]{24}_[A-Za-z0-9_-]+\.jpg$/.test(url);

/**
 * Las fotos ORIGINALES de una lista que puede traer copias con logo (p. ej.
 * `properties.photos` de la app). Mantiene el orden y saca repetidas. Es lo
 * que tienen que usar Mercado Libre, la web pública y cualquier otro portal.
 */
export function originalPhotos(photos: readonly unknown[] | null | undefined, publicBase: string): string[] {
  const out: string[] = [];
  for (const u of photos ?? []) {
    if (typeof u !== "string") continue;
    const original = parseWatermarkUrl(u, publicBase)?.originalUrl ?? u;
    if (!out.includes(original)) out.push(original);
  }
  return out;
}

/** Texto que se hashea: misma foto + mismo logo + mismas opciones = mismo archivo. */
export function watermarkHashInput(originalRel: string, logoRel: string, o: WatermarkOptions): string {
  return `pm-wm|v${WATERMARK_VERSION}|${originalRel}|${logoRel}|${o.position}|${o.size}|${o.backdrop}`;
}

/* ── Pedido (servidor) ────────────────────────────────────────────────── */

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list.includes(v as T) ? (v as T) : null);

export interface WatermarkRequest {
  crmPropertyId: string;
  /** Fotos a marcar, en el orden pedido (sin repetidas). */
  photos: { url: string; rel: string }[];
  /** Las que no son fotos de la agencia: no se tocan. */
  rejected: { url: string; reason: string }[];
  logo: { url: string; rel: string };
  options: WatermarkOptions;
}

/**
 * `{ crmPropertyId, urls, logoUrl, position, size, backdrop }` → validado, o
 * `null` si el pedido está mal armado. Solo acepta fotos y logo de la carpeta
 * de ESTA agencia en el bucket (la agencia sale de la sesión, nunca del
 * pedido): el servidor las lee del Storage, no de internet.
 */
export function parseWatermarkRequest(body: unknown, ctx: { publicBase: string; agencyId: string }): WatermarkRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.crmPropertyId !== "string" || !CRM_ID_RE.test(b.crmPropertyId)) return null;
  if (!Array.isArray(b.urls) || b.urls.length === 0 || b.urls.length > WATERMARK_MAX_URLS) return null;
  const position = oneOf(WATERMARK_POSITIONS, b.position);
  const size = oneOf(WATERMARK_SIZES, b.size);
  const backdrop = oneOf(WATERMARK_BACKDROPS, b.backdrop);
  if (!position || !size || !backdrop) return null;
  const logoRel = brandingLogoRel(b.logoUrl, ctx.publicBase, ctx.agencyId);
  if (!logoRel) return null;
  const photos: { url: string; rel: string }[] = [];
  const rejected: { url: string; reason: string }[] = [];
  for (const u of b.urls) {
    if (typeof u !== "string" || u.length > 2048) return null;
    if (photos.some((p) => p.url === u) || rejected.some((r) => r.url === u)) continue;
    const rel = ownPhotoRel(u, ctx.publicBase, ctx.agencyId);
    if (rel) photos.push({ url: u, rel });
    else rejected.push({ url: u, reason: "Solo se marcan fotos guardadas en la carpeta de tu inmobiliaria" });
  }
  return { crmPropertyId: b.crmPropertyId, photos, rejected, logo: { url: b.logoUrl as string, rel: logoRel }, options: { position, size, backdrop } };
}

/* ── Orquestador (servidor) ───────────────────────────────────────────── */

export interface WatermarkDeps {
  /** sha256 en hex. */
  hash: (s: string) => string;
  /** Nombres de archivo que ya hay en una carpeta del bucket. */
  listNames: (folder: string) => Promise<Set<string>>;
  /** Baja un objeto del bucket por su ruta (no por URL: nunca sale a internet). */
  download: (path: string) => Promise<Uint8Array>;
  /** Dibuja el logo sobre la foto y devuelve un JPEG. */
  render: (photo: Uint8Array, logo: Uint8Array, o: WatermarkOptions) => Promise<Uint8Array>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  publicUrl: (path: string) => string;
  now: () => number;
}

export interface WatermarkResultItem {
  url: string;
  ok: boolean;
  /** URL pública de la copia con logo. */
  publicUrl?: string;
  /** Ya existía: no se volvió a procesar. */
  cached?: boolean;
  reason?: string;
}

export interface WatermarkResponse {
  results: WatermarkResultItem[];
  /** No se empezaron por falta de tiempo: el cliente las vuelve a mandar. */
  skipped: string[];
}

/** Marca las fotos de UNA propiedad. Nunca tira: cada foto informa su resultado. */
export async function watermarkPhotos(
  agencyId: string,
  req: WatermarkRequest,
  deps: WatermarkDeps,
  opts: { budgetMs?: number; concurrency?: number } = {},
): Promise<WatermarkResponse> {
  const deadline = deps.now() + (opts.budgetMs ?? WATERMARK_BUDGET_MS);
  const results: WatermarkResultItem[] = req.rejected.map((r) => ({ url: r.url, ok: false, reason: r.reason }));
  const skipped: string[] = [];
  const folder = `${agencyId}/${req.crmPropertyId}/${WATERMARK_FOLDER}`;

  let existing: Promise<Set<string>> | null = null;
  const existingNames = () =>
    (existing ??= deps.listNames(folder).catch(() => new Set<string>()));
  let logo: Promise<Uint8Array> | null = null;
  const logoBytes = () => (logo ??= deps.download(`${agencyId}/${req.logo.rel}`));

  const one = async (p: { url: string; rel: string }): Promise<WatermarkResultItem> => {
    let path: string;
    try {
      path = watermarkObjectPath(agencyId, req.crmPropertyId, deps.hash(watermarkHashInput(p.rel, req.logo.rel, req.options)).slice(0, 24), p.rel);
    } catch {
      return { url: p.url, ok: false, reason: "Foto inválida" };
    }
    const name = path.slice(folder.length + 1);
    if ((await existingNames()).has(name)) return { url: p.url, ok: true, publicUrl: deps.publicUrl(path), cached: true };
    let logoData: Uint8Array;
    try {
      logoData = await logoBytes();
    } catch {
      return { url: p.url, ok: false, reason: "No se pudo leer el logo de la inmobiliaria" };
    }
    let photo: Uint8Array;
    try {
      photo = await deps.download(`${agencyId}/${p.rel}`);
    } catch {
      return { url: p.url, ok: false, reason: "No se pudo leer la foto original" };
    }
    let out: Uint8Array;
    try {
      out = await deps.render(photo, logoData, req.options);
    } catch {
      return { url: p.url, ok: false, reason: "No se pudo poner el logo en la foto" };
    }
    try {
      await deps.upload(path, out);
    } catch {
      return { url: p.url, ok: false, reason: "No se pudo guardar la foto con logo" };
    }
    return { url: p.url, ok: true, publicUrl: deps.publicUrl(path) };
  };

  let next = 0;
  const lane = async () => {
    while (next < req.photos.length) {
      const p = req.photos[next++];
      if (deps.now() >= deadline) {
        skipped.push(p.url);
        continue;
      }
      results.push(await one(p));
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? WATERMARK_CONCURRENCY, req.photos.length || 1));
  await Promise.all(Array.from({ length: lanes }, lane));
  return { results, skipped };
}

/* ── Cliente: qué URLs van a la app ───────────────────────────────────── */

export interface AppWatermarkTarget {
  logoUrl: string;
  position: WatermarkPosition;
  size: WatermarkSize;
  backdrop: WatermarkBackdrop;
}

export type WatermarkCall = (
  crmPropertyId: string,
  urls: string[],
  target: AppWatermarkTarget,
) => Promise<{ ok: true; data: WatermarkResponse } | { ok: false; message: string }>;

export interface AppPhotosOutcome {
  /** Lo que se manda a `properties.photos` (copias con logo; la original si falló). */
  photos: string[];
  /** Fotos que van SIN logo porque no se pudo generar la copia. */
  failures: { url: string; reason: string }[];
}

/**
 * Las fotos que van a la app: cada foto de la agencia se reemplaza por su
 * copia con logo; si una falla, va la original y se informa (no frena la
 * publicación). Lo que no es una foto de la agencia (o ya es una copia) queda
 * igual. Pide en sub-tandas y reintenta lo que el servidor no llegó a hacer.
 * Nunca tira.
 */
export async function appPhotosWithLogo(
  crmPropertyId: string,
  photos: readonly string[],
  target: AppWatermarkTarget,
  ctx: { publicBase: string; agencyId: string; call: WatermarkCall },
): Promise<AppPhotosOutcome> {
  const todoAll = [...new Set(photos.filter((u) => ownPhotoRel(u, ctx.publicBase, ctx.agencyId)))];
  const done = new Map<string, string>();
  const failures: { url: string; reason: string }[] = [];
  for (let i = 0; i < todoAll.length; i += WATERMARK_CHUNK) {
    let todo = todoAll.slice(i, i + WATERMARK_CHUNK);
    for (let attempt = 0; todo.length > 0 && attempt < 3; attempt++) {
      let r: Awaited<ReturnType<WatermarkCall>>;
      try {
        r = await ctx.call(crmPropertyId, todo, target);
      } catch (err) {
        r = { ok: false, message: err instanceof Error ? err.message : "Error inesperado" };
      }
      if (!r.ok) {
        for (const url of todo) failures.push({ url, reason: r.message });
        todo = [];
        break;
      }
      for (const x of r.data.results) {
        if (!todo.includes(x.url)) continue;
        if (x.ok && x.publicUrl) done.set(x.url, x.publicUrl);
        else failures.push({ url: x.url, reason: x.reason ?? "No se pudo poner el logo" });
      }
      const skipped = r.data.skipped.filter((u) => todo.includes(u));
      // Lo que no volvió ni como resultado ni como pendiente se da por fallado.
      for (const url of todo) {
        if (!done.has(url) && !skipped.includes(url) && !failures.some((f) => f.url === url)) {
          failures.push({ url, reason: "El servidor no devolvió la foto" });
        }
      }
      todo = skipped;
    }
    for (const url of todo) failures.push({ url, reason: "Se acabó el tiempo para poner el logo" });
  }
  return { photos: photos.map((u) => done.get(u) ?? u), failures };
}

/* ── Portales: siempre las originales ─────────────────────────────────── */

/**
 * Fotos para Mercado Libre (u otro portal) a partir de `properties.photos` de
 * la app: las copias con logo se cambian por su original, y solo quedan las
 * del Storage público del proyecto o las que el aviso ya tiene en el portal
 * (`existing`). Nunca devuelve una copia con logo.
 */
export function portalPhotosFromAppRow(photos: unknown, opts: { supabaseUrl: string; existing?: readonly string[] }): string[] {
  if (!Array.isArray(photos)) return [];
  const storagePrefix = `${opts.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/`;
  const known = new Set(opts.existing ?? []);
  return originalPhotos(photos, photosPublicBase(opts.supabaseUrl)).filter(
    (u) => !looksLikeWatermarkCopy(u) && (u.startsWith(storagePrefix) || known.has(u)),
  );
}
