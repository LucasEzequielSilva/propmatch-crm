/**
 * Marca de la inmobiliaria (logo, colores y datos de contacto) para la ficha
 * que se manda a clientes, el PDF y la web pública. Lógica pura: la usan el
 * navegador y api/web.ts.
 *
 * DÓNDE SE PUBLICA (para que la vean la web y la ficha sin login).
 * La tabla `agencies` de la app no tiene columnas de marca (verificado
 * 2026-10-06: id, name, owner_user_id, created_at) y el bucket público
 * `property-photos` solo acepta imágenes (jpeg/png/webp/avif, 5 MB). Así que,
 * sin aplicar SQL, la marca se publica como imágenes en la carpeta de la
 * agencia, que la policy de Storage ya habilita para sus miembros
 * (`is_agency_member(foldername[1])`, insert + update) y que es de lectura
 * pública:
 *   - `<agency_id>/branding/logo-<timestamp>.png|jpg`: el logo (nombre nuevo
 *     en cada cambio, así el CDN nunca sirve uno viejo);
 *   - `<agency_id>/branding/brand.png`: un PNG de 1×1 transparente que lleva
 *     el JSON de la marca en un chunk de texto `iTXt` (keyword
 *     `propmatch-brand`). Es un PNG válido (pasa el filtro de mime del
 *     bucket) y cualquiera lo puede leer con un fetch.
 * La alternativa prolija es una columna `agencies.branding jsonb`: ver
 * supabase/drafts/agencies_branding.sql (SIN aplicar). api/_lib/web/data.ts
 * ya la lee primero si existe.
 *
 * Todo lo que entra (del navegador o del PNG) pasa por `sanitizeBrand`: es una
 * lista blanca de campos con largos máximos, colores #RRGGBB y URLs https.
 */

export interface AgencyBrand {
  v: 1;
  /** Nombre comercial (si es distinto del nombre de la cuenta). */
  displayName: string | null;
  /** URL https del logo (o data URL mientras no se publicó, solo local). */
  logoUrl: string | null;
  /** #RRGGBB */
  primary: string;
  /** #RRGGBB */
  secondary: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  /** Matrícula del corredor (opcional). */
  license: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  /** Texto al pie de la ficha, el PDF y la web. */
  footer: string | null;
  /** «Hecho con PropMatch» chiquito al pie. */
  showPoweredBy: boolean;
  updatedAt: string | null;
}

/** Colores de PropMatch: lo que se ve si la inmobiliaria no eligió los suyos. */
export const PROPMATCH_PRIMARY = "#7C3AED";
export const PROPMATCH_SECONDARY = "#EC4899";

export const EMPTY_BRAND: AgencyBrand = {
  v: 1,
  displayName: null,
  logoUrl: null,
  primary: PROPMATCH_PRIMARY,
  secondary: PROPMATCH_SECONDARY,
  phone: null,
  whatsapp: null,
  email: null,
  address: null,
  license: null,
  website: null,
  instagram: null,
  facebook: null,
  footer: null,
  showPoweredBy: true,
  updatedAt: null,
};

/* ── Lista blanca ────────────────────────────────────────────────────────── */

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Sin caracteres de control (salvo saltos de línea en el pie).
  const t = v.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").trim();
  return t ? t.slice(0, max) : null;
};

export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

const httpsUrl = (v: unknown, max = 300): string | null => {
  const s = str(v, max);
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s) ? `https://${s}` : null;
  if (!withProto) return null;
  try {
    const u = new URL(withProto);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

/** "@lopezprop", "lopezprop" o el link entero → handle sin @. */
const handle = (v: unknown): string | null => {
  const s = str(v, 120);
  if (!s) return null;
  const m = /(?:instagram\.com|facebook\.com|fb\.com)\/([\w.\-]+)/i.exec(s);
  const h = (m ? m[1] : s).replace(/^@/, "");
  return /^[\w.\-]{1,60}$/.test(h) ? h : null;
};

export interface SanitizeOptions {
  /**
   * Prefijo obligatorio para el logo (la carpeta pública de la agencia en el
   * Storage). Del lado servidor siempre se pasa: así la web nunca muestra una
   * imagen de otro lado.
   */
  logoPrefix?: string;
  /** Acepta `data:image/...` como logo (solo en el navegador, antes de publicar). */
  allowDataLogo?: boolean;
}

export function sanitizeBrand(input: unknown, opts: SanitizeOptions = {}): AgencyBrand | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  let logo: string | null = null;
  if (typeof o.logoUrl === "string") {
    if (opts.allowDataLogo && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(o.logoUrl) && o.logoUrl.length < 700_000) {
      logo = o.logoUrl;
    } else if (/^https:\/\/[^\s"'<>]+$/i.test(o.logoUrl) && o.logoUrl.length <= 500) {
      logo = !opts.logoPrefix || o.logoUrl.startsWith(opts.logoPrefix) ? o.logoUrl : null;
    }
  }
  const email = str(o.email, 120);
  return {
    v: 1,
    displayName: str(o.displayName, 80),
    logoUrl: logo,
    primary: isHexColor(o.primary) ? o.primary.toUpperCase() : PROPMATCH_PRIMARY,
    secondary: isHexColor(o.secondary) ? o.secondary.toUpperCase() : PROPMATCH_SECONDARY,
    phone: str(o.phone, 40),
    whatsapp: str(o.whatsapp, 40),
    email: email && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : null,
    address: str(o.address, 160),
    license: str(o.license, 80),
    website: httpsUrl(o.website),
    instagram: handle(o.instagram),
    facebook: handle(o.facebook),
    footer: str(o.footer, 400),
    showPoweredBy: o.showPoweredBy !== false,
    updatedAt: typeof o.updatedAt === "string" && !Number.isNaN(Date.parse(o.updatedAt)) ? o.updatedAt : null,
  };
}

/* ── Contraste (WCAG 2.x) ────────────────────────────────────────────────── */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (c: [number, number, number]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mezcla `hex` con `with` (0 = hex, 1 = with). */
export function mix(hex: string, withHex: string, amount: number): string {
  const a = rgb(hex);
  const b = rgb(withHex);
  return toHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
}

export const WHITE = "#FFFFFF";
export const INK = "#1F0A3C";

/** Texto blanco o tinta sobre `bg`, el que más contraste dé. */
export function textOn(bg: string): string {
  return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
}

/**
 * El mismo color, oscurecido lo justo para llegar a `min` de contraste contra
 * `bg` (AA para texto normal = 4.5). Sirve para usar el color de la marca en
 * títulos y links sobre blanco aunque la marca sea un amarillo clarito.
 */
export function readableOn(color: string, bg = WHITE, min = 4.5): string {
  if (contrastRatio(color, bg) >= min) return color.toUpperCase();
  const towards = luminance(bg) > 0.5 ? "#000000" : WHITE;
  for (let i = 1; i <= 20; i++) {
    const c = mix(color, towards, i * 0.05);
    if (contrastRatio(c, bg) >= min) return c;
  }
  return towards === WHITE ? WHITE : INK;
}

export interface ContrastCheck {
  ratio: number;
  /** AA texto normal (4.5:1). */
  aa: boolean;
  /** AA texto grande / componentes (3:1). */
  aaLarge: boolean;
}

export function checkContrast(fg: string, bg: string): ContrastCheck {
  const ratio = contrastRatio(fg, bg);
  return { ratio: Math.round(ratio * 100) / 100, aa: ratio >= 4.5, aaLarge: ratio >= 3 };
}

/* ── Marca resuelta (con los datos de la cuenta como respaldo) ───────────── */

export interface ResolvedBrand {
  name: string;
  logoUrl: string | null;
  primary: string;
  secondary: string;
  /** Color de texto sobre `primary` (botones). */
  onPrimary: string;
  /** `primary` legible sobre blanco (títulos, links): siempre AA. */
  accent: string;
  /** `secondary` legible sobre blanco. */
  accent2: string;
  /** Fondo suave (primary muy aclarado). */
  soft: string;
  /** Borde suave. */
  border: string;
  gradient: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  license: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  footer: string | null;
  showPoweredBy: boolean;
  /** `true` si la inmobiliaria cargó algo de su marca. */
  custom: boolean;
}

export function resolveBrand(
  brand: AgencyBrand | null | undefined,
  fallback: { name: string; phone?: string | null; email?: string | null },
): ResolvedBrand {
  const b = brand ?? EMPTY_BRAND;
  const primary = isHexColor(b.primary) ? b.primary : PROPMATCH_PRIMARY;
  const secondary = isHexColor(b.secondary) ? b.secondary : PROPMATCH_SECONDARY;
  const custom = !!brand && (primary !== PROPMATCH_PRIMARY || secondary !== PROPMATCH_SECONDARY || !!b.logoUrl || !!b.displayName);
  return {
    name: b.displayName || fallback.name,
    logoUrl: b.logoUrl,
    primary,
    secondary,
    onPrimary: textOn(primary),
    accent: readableOn(primary),
    accent2: readableOn(secondary),
    soft: mix(primary, WHITE, 0.92),
    border: mix(primary, WHITE, 0.8),
    gradient: `linear-gradient(135deg, ${primary} 0%, ${secondary} 100%)`,
    phone: b.phone ?? fallback.phone ?? null,
    whatsapp: b.whatsapp ?? b.phone ?? fallback.phone ?? null,
    email: b.email ?? fallback.email ?? null,
    address: b.address,
    license: b.license,
    website: b.website,
    instagram: b.instagram,
    facebook: b.facebook,
    footer: b.footer,
    showPoweredBy: b.showPoweredBy !== false,
    custom,
  };
}

/** Variables CSS para pintar una página con la marca (ficha, web, PDF). */
export function brandCssVars(r: ResolvedBrand): Record<string, string> {
  return {
    "--brand-primary": r.primary,
    "--brand-secondary": r.secondary,
    "--brand-on-primary": r.onPrimary,
    "--brand-accent": r.accent,
    "--brand-accent-2": r.accent2,
    "--brand-soft": r.soft,
    "--brand-border": r.border,
    "--brand-gradient": r.gradient,
  };
}

/** Lo justo para la ficha que viaja en el link (sin `updatedAt` ni logos en data URL). */
export function compactBrand(b: AgencyBrand | null | undefined): AgencyBrand | null {
  if (!b) return null;
  const clean = sanitizeBrand(b);
  if (!clean) return null;
  return { ...clean, updatedAt: null };
}

/* ── Rutas en el Storage ─────────────────────────────────────────────────── */

export const BRAND_BUCKET = "property-photos";
export const brandFolder = (agencyId: string) => `${agencyId}/branding`;
export const brandObjectPath = (agencyId: string) => `${brandFolder(agencyId)}/brand.png`;

export function storagePublicBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BRAND_BUCKET}/`;
}

/** Prefijo que tiene que tener el logo publicado de esta agencia. */
export function brandLogoPrefix(supabaseUrl: string, agencyId: string): string {
  return `${storagePublicBase(supabaseUrl)}${brandFolder(agencyId)}/`;
}

/* ── PNG con texto (el "brand.json" que el bucket acepta) ────────────────── */

export const BRAND_PNG_KEYWORD = "propmatch-brand";
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function chunk(type: string, data: Uint8Array): number[] {
  const typeBytes = Array.from(type, (c) => c.charCodeAt(0));
  const body = new Uint8Array([...typeBytes, ...data]);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}

/** PNG 1×1 transparente con `json` en un chunk iTXt (UTF-8, sin comprimir). */
export function encodeBrandPng(json: string): Uint8Array {
  const ihdr = new Uint8Array([...u32(1), ...u32(1), 8, 6, 0, 0, 0]);
  // Una fila: byte de filtro 0 + RGBA(0,0,0,0), en un bloque zlib "stored".
  const raw = new Uint8Array([0, 0, 0, 0, 0]);
  const idat = new Uint8Array([0x78, 0x01, 0x01, raw.length, 0, ~raw.length & 255, 0xff, ...raw, ...u32(adler32(raw))]);
  const text = new TextEncoder().encode(json);
  const kw = Array.from(BRAND_PNG_KEYWORD, (c) => c.charCodeAt(0));
  // keyword \0 compression-flag(0) method(0) language \0 translated \0 text
  const itxt = new Uint8Array([...kw, 0, 0, 0, 0, 0, ...text]);
  return new Uint8Array([...PNG_SIG, ...chunk("IHDR", ihdr), ...chunk("iTXt", itxt), ...chunk("IDAT", idat), ...chunk("IEND", new Uint8Array())]);
}

/** Saca el texto del chunk `propmatch-brand`. `null` si no es un PNG o no lo tiene. */
export function decodeBrandPng(bytes: Uint8Array): string | null {
  if (bytes.length < 8 || PNG_SIG.some((b, i) => bytes[i] !== b)) return null;
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const start = p + 8;
    const end = start + len;
    if (end + 4 > bytes.length) return null;
    if (type === "iTXt" || type === "tEXt") {
      const data = bytes.subarray(start, end);
      const nul = data.indexOf(0);
      const kw = String.fromCharCode(...data.subarray(0, Math.max(nul, 0)));
      if (kw === BRAND_PNG_KEYWORD) {
        if (type === "tEXt") return new TextDecoder().decode(data.subarray(nul + 1));
        if (data[nul + 1] !== 0) return null; // comprimido: no lo generamos nosotros
        let q = nul + 3;
        q = data.indexOf(0, q) + 1; // idioma
        q = data.indexOf(0, q) + 1; // keyword traducida
        if (q <= 0) return null;
        return new TextDecoder().decode(data.subarray(q));
      }
    }
    if (type === "IEND") break;
    p = end + 4;
  }
  return null;
}
