/**
 * Copia de fotos externas al bucket `property-photos` («Publicar todas en la app»).
 *
 * Lógica pura + orquestador con dependencias inyectadas (la descarga real está
 * en download.ts y la subida en api/integrations.ts). Sin imports relativos en
 * tiempo de ejecución: lo corren los tests con `node --test`.
 *
 * Seguridad (anti-SSRF): solo http/https en puertos 80/443, sin usuario/clave
 * en la URL, sin hosts locales y sin IPs privadas/reservadas — ni escritas en
 * la URL ni resueltas por DNS (la validación de DNS se hace en el momento de
 * conectar, ver `guardedLookup`, así no hay rebinding entre validar y bajar).
 * Tamaño máximo por imagen, solo JPEG/PNG/WebP verificado por los bytes (no
 * por lo que diga el servidor remoto), timeout por foto y un plazo total por
 * pedido para no pasarse del límite de Vercel.
 */
import { BlockList, isIP } from "node:net";

export const MAX_URLS_PER_REQUEST = 40;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PHOTO_TIMEOUT_MS = 15_000;
/** Plazo para empezar fotos nuevas dentro de un pedido (maxDuration de la función = 60 s). */
export const REQUEST_BUDGET_MS = 40_000;
export const DOWNLOAD_CONCURRENCY = 4;
export const MAX_REDIRECTS = 3;
export const MAX_URL_LENGTH = 2048;

export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];
export const EXT_FOR: Record<AllowedType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/* ── IPs bloqueadas ───────────────────────────────────────────────────── */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "esta red"
  ["10.0.0.0", 8], // privada
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incluye metadata de nubes 169.254.169.254)
  ["172.16.0.0", 12], // privada
  ["192.0.0.0", 24], // IETF
  ["192.0.2.0", 24], // documentación
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // privada
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentación
  ["203.0.113.0", 24], // documentación
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reservada + broadcast
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128], // sin especificar
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64 (puede apuntar a IPv4 privadas)
  ["64:ff9b:1::", 48],
  ["100::", 64], // descarte
  ["2001:db8::", 32], // documentación
  ["2002::", 16], // 6to4 (embebe IPv4)
  ["fc00::", 7], // ULA privada
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (obsoleta)
  ["ff00::", 8], // multicast
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** IPv4 dentro de IPv6 (`::ffff:10.0.0.1`, `::10.0.0.1`) → la IPv4. */
function embeddedIpv4(ip: string): string | null {
  const m = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1];
  // ::ffff:a00:1 (forma hexadecimal)
  const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (h) {
    const a = parseInt(h[1], 16);
    const b = parseInt(h[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** `true` si la IP no es pública (o no es una IP válida: ante la duda, se bloquea). */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const fam = isIP(clean);
  if (fam === 4) return blocked.check(clean, "ipv4");
  if (fam === 6) {
    const v4 = embeddedIpv4(clean);
    if (v4) return isIP(v4) !== 4 || blocked.check(v4, "ipv4");
    return blocked.check(clean, "ipv6");
  }
  return true;
}

/* ── URLs ─────────────────────────────────────────────────────────────── */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".intranet", ".corp"];

/** Valida una URL de foto antes de bajarla (lo que se puede saber sin DNS). */
export function checkPhotoUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL_LENGTH) return { ok: false, reason: "URL inválida" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Solo se copian fotos http/https" };
  if (url.username || url.password) return { ok: false, reason: "La URL no puede llevar usuario ni clave" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, reason: "Puerto no permitido" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "URL inválida" };
  const literal = host.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (isBlockedIp(literal)) return { ok: false, reason: "Dirección no permitida (red privada o local)" };
    return { ok: true, url };
  }
  // Números sueltos que algunos resolvedores toman como IP (http://2130706433, http://0x7f.1).
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host) || /(^|\.)0x[0-9a-f]+/i.test(host)) {
    return { ok: false, reason: "Dirección no permitida" };
  }
  if (host === "localhost" || !host.includes(".") || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Dirección no permitida (red privada o local)" };
  }
  return { ok: true, url };
}

/* ── DNS al conectar ──────────────────────────────────────────────────── */

type LookupAddress = { address: string; family: number };
type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export type DnsLookup = (hostname: string, options: { all?: boolean; family?: number }, cb: LookupCallback) => void;

/**
 * `lookup` para http(s).request: resuelve con el DNS real y rechaza si
 * CUALQUIERA de las direcciones es privada/reservada. Como valida lo mismo que
 * se usa para conectar, un DNS que cambia de respuesta (rebinding) no sirve.
 */
export function guardedLookup(dnsLookup: DnsLookup) {
  return (hostname: string, options: unknown, cb?: unknown) => {
    const callback = (typeof options === "function" ? options : cb) as LookupCallback;
    const opts = (typeof options === "object" && options !== null ? options : {}) as { all?: boolean; family?: number };
    dnsLookup(hostname, { all: true, family: opts.family }, (err, addresses) => {
      if (err) return callback(err, opts.all ? [] : "", 4);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }]) as LookupAddress[];
      if (list.length === 0 || list.some((a) => isBlockedIp(a.address))) {
        const e = new Error("blocked_address") as NodeJS.ErrnoException;
        e.code = "EBLOCKED";
        return callback(e, opts.all ? [] : "", 4);
      }
      if (opts.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

/* ── Contenido ────────────────────────────────────────────────────────── */

/** Tipo real por los primeros bytes (no se confía en el Content-Type remoto). */
export function sniffImage(bytes: Uint8Array): AllowedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

/** Content-Type declarado aceptable (`image/jpg` y parámetros incluidos). Vacío = se decide por los bytes. */
export function declaredTypeOk(header: string | undefined | null): boolean {
  if (!header) return true;
  const t = header.split(";")[0].trim().toLowerCase();
  if (t === "image/jpg" || t === "image/pjpeg") return true;
  if (t === "application/octet-stream" || t === "binary/octet-stream") return true;
  return (ALLOWED_TYPES as readonly string[]).includes(t);
}

/* ── Pedido ───────────────────────────────────────────────────────────── */

export const CRM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type CopyRequest = { crmPropertyId: string; urls: string[] };

/** `{ crmPropertyId, urls }` → validado (o `null`). Saca duplicados. */
export function parseCopyRequest(body: unknown): CopyRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.crmPropertyId !== "string" || !CRM_ID_RE.test(b.crmPropertyId)) return null;
  if (!Array.isArray(b.urls) || b.urls.length === 0 || b.urls.length > MAX_URLS_PER_REQUEST) return null;
  if (!b.urls.every((u) => typeof u === "string" && u.length <= MAX_URL_LENGTH)) return null;
  return { crmPropertyId: b.crmPropertyId, urls: [...new Set(b.urls as string[])] };
}

/** Carpeta de destino: siempre la de la agencia del usuario (no la que diga el pedido). */
export function storagePath(agencyId: string, crmPropertyId: string, id: string, type: AllowedType): string {
  if (!CRM_ID_RE.test(crmPropertyId)) throw new Error("crm_id");
  if (!/^[0-9a-f-]{36}$/i.test(agencyId)) throw new Error("agency_id");
  return `${agencyId}/${crmPropertyId}/${id}.${EXT_FOR[type]}`;
}

/* ── Orquestador ──────────────────────────────────────────────────────── */

export type DownloadResult = { ok: true; bytes: Uint8Array; type: AllowedType } | { ok: false; reason: string };

export interface CopyDeps {
  download: (url: URL) => Promise<DownloadResult>;
  /** Sube y devuelve la URL pública. */
  upload: (path: string, bytes: Uint8Array, type: AllowedType) => Promise<string>;
  newId: () => string;
  now: () => number;
}

export interface CopyResultItem {
  url: string;
  ok: boolean;
  publicUrl?: string;
  reason?: string;
}

export interface CopyResponse {
  results: CopyResultItem[];
  /** No se empezaron por falta de tiempo: el cliente las vuelve a mandar. */
  skipped: string[];
}

/** Copia las fotos de UNA propiedad. Nunca tira: cada foto informa su resultado. */
export async function copyPhotos(
  agencyId: string,
  req: CopyRequest,
  deps: CopyDeps,
  opts: { budgetMs?: number; concurrency?: number } = {},
): Promise<CopyResponse> {
  const deadline = deps.now() + (opts.budgetMs ?? REQUEST_BUDGET_MS);
  const results: CopyResultItem[] = [];
  const skipped: string[] = [];
  let next = 0;

  const one = async (raw: string): Promise<CopyResultItem> => {
    const check = checkPhotoUrl(raw);
    if (!check.ok) return { url: raw, ok: false, reason: check.reason };
    let dl: DownloadResult;
    try {
      dl = await deps.download(check.url);
    } catch {
      dl = { ok: false, reason: "No se pudo descargar" };
    }
    if (!dl.ok) return { url: raw, ok: false, reason: dl.reason };
    try {
      const publicUrl = await deps.upload(storagePath(agencyId, req.crmPropertyId, deps.newId(), dl.type), dl.bytes, dl.type);
      return { url: raw, ok: true, publicUrl };
    } catch {
      return { url: raw, ok: false, reason: "No se pudo guardar la foto en PropMatch" };
    }
  };

  const lane = async () => {
    while (next < req.urls.length) {
      const url = req.urls[next++];
      if (deps.now() >= deadline) {
        skipped.push(url);
        continue;
      }
      results.push(await one(url));
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? DOWNLOAD_CONCURRENCY, req.urls.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  // Mismo orden que el pedido.
  const order = new Map(req.urls.map((u, i) => [u, i]));
  results.sort((a, b) => (order.get(a.url) ?? 0) - (order.get(b.url) ?? 0));
  return { results, skipped };
}
