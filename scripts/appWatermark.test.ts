/**
 * Logo quemado en las fotos de la app PropMatch: opción de la marca, rutas,
 * validación del pedido, orquestador (idempotencia, plazos, errores), qué
 * URLs van a la app, que Mercado Libre siga con las originales y el dibujo con
 * sharp (imágenes generadas en memoria). Sin red.
 * Correr con: npm run test:marca-agua   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  WATERMARK_CHUNK,
  appPhotosWithLogo,
  b64urlDecode,
  b64urlEncode,
  looksLikeWatermarkCopy,
  originalPhotos,
  ownPhotoRel,
  parseWatermarkRequest,
  parseWatermarkUrl,
  photosPublicBase,
  portalPhotosFromAppRow,
  watermarkHashInput,
  watermarkObjectPath,
  watermarkPhotos,
  type WatermarkCall,
  type WatermarkDeps,
  type WatermarkRequest,
} from "../shared/appWatermark.ts";
import { appWatermarkFingerprint, brandLogoPrefix, resolveAppWatermark, sanitizeBrand } from "../shared/brand.ts";
import { buildMeliItem, buildMeliUpdate, type MeliListingInput } from "../shared/meliListing.ts";
import { renderWatermark, watermarkLayout } from "../api/_lib/photoWatermark/render.ts";

const SUPA = "https://x.supabase.co";
const BASE = photosPublicBase(SUPA);
const AG = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const LOGO = `${BASE}${AG}/branding/logo-fotos-1700000000000.png`;
const own = (rel: string, agency = AG) => `${BASE}${agency}/${rel}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/* ── Opción en la marca ───────────────────────────────────────────────── */

test("marca: «logo en las fotos de la app» apagado por defecto e independiente de lo visual", () => {
  const vieja = sanitizeBrand({ logoUrl: LOGO })!;
  assert.equal(vieja.photoLogo.inApp, false);
  assert.equal(resolveAppWatermark(vieja), null);
  const on = sanitizeBrand({ photoLogoUrl: LOGO, photoLogo: { show: false, inApp: true, position: "top-left", size: "md", backdrop: "dark" } })!;
  assert.deepEqual(resolveAppWatermark(on), { logoUrl: LOGO, position: "top-left", size: "md", backdrop: "dark" });
  assert.equal(sanitizeBrand({ photoLogo: { inApp: "sí" } })!.photoLogo.inApp, false, "solo true literal");
});

test("marca: sin versión para fotos usa el principal con placa clara; data URL o logo ajeno no van", () => {
  const prefix = brandLogoPrefix(SUPA, AG);
  const main = resolveAppWatermark({ logoUrl: LOGO, photoLogo: { show: false, inApp: true, position: "bottom-right", size: "sm", backdrop: "shadow" } }, prefix)!;
  assert.equal(main.backdrop, "light");
  const opts = { show: false, inApp: true, position: "bottom-right", size: "sm", backdrop: "shadow" } as const;
  assert.equal(resolveAppWatermark({ photoLogoUrl: "data:image/png;base64,AAAA", photoLogo: opts }, prefix), null, "sin publicar no hay URL");
  assert.equal(resolveAppWatermark({ photoLogoUrl: `${BASE}${OTHER}/branding/l.png`, photoLogo: opts }, prefix), null, "logo de otra agencia");
  assert.equal(appWatermarkFingerprint(null), "off");
  assert.notEqual(appWatermarkFingerprint(main), appWatermarkFingerprint({ ...main, size: "md" }));
});

/* ── Rutas ────────────────────────────────────────────────────────────── */

test("rutas: base64url ida y vuelta", () => {
  for (const s of ["", "a", "ab", "abc", "p_1/3f2a.jpg", "crm/p_k3x9-Z/0b1c2d3e-aaaa-bbbb-cccc-123456789abc.webp"]) {
    assert.equal(b64urlDecode(b64urlEncode(s)), s);
  }
  assert.equal(b64urlDecode("a"), null);
  assert.equal(b64urlDecode("ab+/"), null);
});

test("rutas: solo fotos originales de la carpeta de la agencia", () => {
  assert.equal(ownPhotoRel(own("p_1/a.jpg"), BASE, AG), "p_1/a.jpg");
  assert.equal(ownPhotoRel(own("crm/p_1/a.webp"), BASE, AG), "crm/p_1/a.webp");
  assert.equal(ownPhotoRel(own("p_1/a.jpg", OTHER), BASE, AG), null, "otra agencia");
  assert.equal(ownPhotoRel(own("branding/logo-1.png"), BASE, AG), null, "el logo no es una foto");
  assert.equal(ownPhotoRel(own("p_1/app/abc.jpg"), BASE, AG), null, "una copia no se vuelve a marcar");
  assert.equal(ownPhotoRel(own("p_1/../x/a.jpg"), BASE, AG), null);
  assert.equal(ownPhotoRel(own("p_1/a.jpg?x=1"), BASE, AG), null);
  assert.equal(ownPhotoRel(own("p_1/a.gif"), BASE, AG), null);
  assert.equal(ownPhotoRel(own("x/p_1/a.jpg"), BASE, AG), null, "tres niveles solo bajo crm/");
  assert.equal(ownPhotoRel("https://evil.com/p_1/a.jpg", BASE, AG), null);
});

test("rutas: la copia lleva la original adentro y se puede volver a ella", () => {
  const hash = sha("x").slice(0, 24);
  const path = watermarkObjectPath(AG, "p_1", hash, "crm/p_1/a.webp");
  assert.match(path, new RegExp(`^${AG}/p_1/app/${hash}_[A-Za-z0-9_-]+\\.jpg$`));
  const info = parseWatermarkUrl(`${BASE}${path}`, BASE)!;
  assert.equal(info.originalUrl, own("crm/p_1/a.webp"));
  assert.equal(info.agencyId, AG);
  assert.ok(looksLikeWatermarkCopy(`${BASE}${path}`));
  assert.ok(!looksLikeWatermarkCopy(own("p_1/a.jpg")));
  assert.throws(() => watermarkObjectPath(AG, "../p", hash, "p_1/a.jpg"));
  assert.throws(() => watermarkObjectPath(AG, "p_1", hash, "branding/l.png"));
  // Una "copia" que dice venir de algo que no es una foto válida no se acepta.
  assert.equal(parseWatermarkUrl(`${BASE}${AG}/p_1/app/${hash}_${b64urlEncode("../../secreto.jpg")}.jpg`, BASE), null);
});

test("originalPhotos: cambia copias por originales, mantiene orden y saca repetidas", () => {
  const h = sha("y").slice(0, 24);
  const copy = `${BASE}${watermarkObjectPath(AG, "p_1", h, "p_1/a.jpg")}`;
  assert.deepEqual(originalPhotos([copy, own("p_1/b.jpg"), own("p_1/a.jpg"), 3, "https://otra.com/c.jpg"], BASE), [
    own("p_1/a.jpg"),
    own("p_1/b.jpg"),
    "https://otra.com/c.jpg",
  ]);
});

/* ── Pedido ───────────────────────────────────────────────────────────── */

const reqBody = (over: Record<string, unknown> = {}) => ({
  crmPropertyId: "p_1",
  urls: [own("p_1/a.jpg")],
  logoUrl: LOGO,
  position: "bottom-right",
  size: "sm",
  backdrop: "shadow",
  ...over,
});

test("pedido: valida opciones, logo de la agencia y separa fotos ajenas", () => {
  const ctx = { publicBase: BASE, agencyId: AG };
  const ok = parseWatermarkRequest(reqBody({ urls: [own("p_1/a.jpg"), own("p_1/a.jpg"), "http://169.254.169.254/x.jpg", own("p_1/b.jpg", OTHER)] }), ctx)!;
  assert.deepEqual(ok.photos, [{ url: own("p_1/a.jpg"), rel: "p_1/a.jpg" }]);
  assert.equal(ok.rejected.length, 2, "metadata de la nube y otra agencia no se tocan");
  assert.equal(ok.logo.rel, "branding/logo-fotos-1700000000000.png");
  assert.equal(parseWatermarkRequest(reqBody({ logoUrl: `${BASE}${OTHER}/branding/l.png` }), ctx), null, "logo de otra agencia");
  assert.equal(parseWatermarkRequest(reqBody({ logoUrl: `${BASE}${AG}/branding/brand.png` }), ctx), null, "brand.png no es un logo");
  assert.equal(parseWatermarkRequest(reqBody({ logoUrl: "https://evil.com/l.png" }), ctx), null);
  assert.equal(parseWatermarkRequest(reqBody({ position: "center" }), ctx), null);
  assert.equal(parseWatermarkRequest(reqBody({ size: "xl" }), ctx), null);
  assert.equal(parseWatermarkRequest(reqBody({ crmPropertyId: "../x" }), ctx), null);
  assert.equal(parseWatermarkRequest(reqBody({ urls: [] }), ctx), null);
  assert.equal(parseWatermarkRequest(reqBody({ urls: Array.from({ length: 13 }, (_, i) => own(`p_1/${i}.jpg`)) }), ctx), null);
});

/* ── Orquestador ──────────────────────────────────────────────────────── */

function fakeDeps(over: Partial<WatermarkDeps> = {}) {
  const stored = new Map<string, Uint8Array>();
  const calls = { render: 0, download: [] as string[], list: 0 };
  let clock = 0;
  const deps: WatermarkDeps = {
    hash: sha,
    listNames: async (folder) => {
      calls.list++;
      return new Set([...stored.keys()].filter((k) => k.startsWith(`${folder}/`)).map((k) => k.slice(folder.length + 1)));
    },
    download: async (path) => {
      calls.download.push(path);
      return new Uint8Array([1, 2, 3]);
    },
    render: async () => {
      calls.render++;
      return new Uint8Array([0xff, 0xd8, 0xff]);
    },
    upload: async (path, bytes) => {
      stored.set(path, bytes);
    },
    publicUrl: (path) => `${BASE}${path}`,
    now: () => clock,
    ...over,
  };
  return { deps, stored, calls, tick: (ms: number) => (clock += ms) };
}

const parsed = (urls: string[], over: Record<string, unknown> = {}) =>
  parseWatermarkRequest(reqBody({ urls, ...over }), { publicBase: BASE, agencyId: AG }) as WatermarkRequest;

test("orquestador: marca, sube en <agencia>/<crm>/app/ e informa la URL", async () => {
  const f = fakeDeps();
  const r = await watermarkPhotos(AG, parsed([own("p_1/a.jpg"), own("crm/p_1/b.png")]), f.deps);
  assert.equal(r.skipped.length, 0);
  assert.equal(r.results.length, 2);
  for (const x of r.results) {
    assert.ok(x.ok && x.publicUrl);
    assert.equal(parseWatermarkUrl(x.publicUrl, BASE)!.originalUrl, x.url);
    assert.ok(x.publicUrl.startsWith(`${BASE}${AG}/p_1/app/`));
  }
  assert.equal(f.calls.render, 2);
  assert.equal(f.calls.download.filter((p) => p.endsWith("/branding/logo-fotos-1700000000000.png")).length, 1, "el logo se baja una sola vez");
  assert.ok(f.calls.download.every((p) => p.startsWith(`${AG}/`)), "solo lee de la carpeta de la agencia");
});

test("orquestador: idempotente por hash (foto + logo + opciones)", async () => {
  const f = fakeDeps();
  const first = await watermarkPhotos(AG, parsed([own("p_1/a.jpg")]), f.deps);
  const again = await watermarkPhotos(AG, parsed([own("p_1/a.jpg")]), f.deps);
  assert.equal(f.calls.render, 1, "la segunda vez no se re-procesa");
  assert.equal(again.results[0].cached, true);
  assert.equal(again.results[0].publicUrl, first.results[0].publicUrl);
  // Otras opciones u otro logo → otra copia.
  const md = await watermarkPhotos(AG, parsed([own("p_1/a.jpg")], { size: "md" }), f.deps);
  assert.notEqual(md.results[0].publicUrl, first.results[0].publicUrl);
  const otherLogo = await watermarkPhotos(AG, parsed([own("p_1/a.jpg")], { logoUrl: `${BASE}${AG}/branding/logo-2.png` }), f.deps);
  assert.notEqual(otherLogo.results[0].publicUrl, first.results[0].publicUrl);
  assert.equal(f.calls.render, 3);
  assert.notEqual(
    watermarkHashInput("p_1/a.jpg", "branding/l.png", { position: "top-left", size: "sm", backdrop: "dark" }),
    watermarkHashInput("p_1/a.jpg", "branding/l.png", { position: "top-left", size: "sm", backdrop: "light" }),
  );
});

test("orquestador: errores por foto, logo ilegible y plazo agotado", async () => {
  const bad = fakeDeps({
    render: async () => {
      throw new Error("vips");
    },
  });
  const r1 = await watermarkPhotos(AG, parsed([own("p_1/a.jpg")]), bad.deps);
  assert.equal(r1.results[0].ok, false);
  assert.match(r1.results[0].reason!, /logo en la foto/);

  const noLogo = fakeDeps({
    download: async (path) => {
      if (path.includes("/branding/")) throw new Error("404");
      return new Uint8Array([1]);
    },
  });
  const r2 = await watermarkPhotos(AG, parsed([own("p_1/a.jpg"), own("p_1/b.jpg")]), noLogo.deps);
  assert.ok(r2.results.every((x) => !x.ok && /logo de la inmobiliaria/.test(x.reason!)));

  const slow = fakeDeps();
  slow.deps.render = async () => {
    slow.tick(30_000);
    return new Uint8Array([0xff, 0xd8, 0xff]);
  };
  const r3 = await watermarkPhotos(AG, parsed([own("p_1/a.jpg"), own("p_1/b.jpg"), own("p_1/c.jpg")]), slow.deps, { concurrency: 1 });
  assert.equal(r3.results.length, 2);
  assert.deepEqual(r3.skipped, [own("p_1/c.jpg")], "lo que no entra en el plazo vuelve para reintentar");
});

/* ── Cliente: qué va a la app ─────────────────────────────────────────── */

const TARGET = { logoUrl: LOGO, position: "bottom-right", size: "sm", backdrop: "shadow" } as const;

/** Servidor falso: usa el orquestador real con dependencias en memoria. */
function serverCall(f = fakeDeps(), sent: string[][] = []): WatermarkCall {
  return async (crm, urls, t) => {
    sent.push(urls);
    const p = parseWatermarkRequest({ crmPropertyId: crm, urls, ...t }, { publicBase: BASE, agencyId: AG });
    if (!p) return { ok: false, message: "bad_request" };
    return { ok: true, data: await watermarkPhotos(AG, p, f.deps) };
  };
}

test("app: las fotos de la agencia van con logo, el resto queda igual, en sub-tandas", async () => {
  const sent: string[][] = [];
  const photos = [...Array.from({ length: WATERMARK_CHUNK + 2 }, (_, i) => own(`p_1/${i}.jpg`)), "https://otra.com/x.jpg"];
  const r = await appPhotosWithLogo("p_1", photos, TARGET, { publicBase: BASE, agencyId: AG, call: serverCall(fakeDeps(), sent) });
  assert.equal(r.failures.length, 0);
  assert.deepEqual(sent.map((s) => s.length), [WATERMARK_CHUNK, 2]);
  assert.equal(r.photos.length, photos.length);
  r.photos.slice(0, -1).forEach((u, i) => assert.equal(parseWatermarkUrl(u, BASE)!.originalUrl, photos[i]));
  assert.equal(r.photos.at(-1), "https://otra.com/x.jpg");
});

test("app: si falla una foto va la original y se informa; si falla el servidor, van todas las originales", async () => {
  const f = fakeDeps({
    render: async (photo) => {
      if (photo.length === 9) throw new Error("x");
      return new Uint8Array([0xff, 0xd8, 0xff]);
    },
    download: async (path) => (path.endsWith("/b.jpg") ? new Uint8Array(9) : new Uint8Array(3)),
  });
  const photos = [own("p_1/a.jpg"), own("p_1/b.jpg")];
  const r = await appPhotosWithLogo("p_1", photos, TARGET, { publicBase: BASE, agencyId: AG, call: serverCall(f) });
  assert.ok(looksLikeWatermarkCopy(r.photos[0]));
  assert.equal(r.photos[1], own("p_1/b.jpg"));
  assert.deepEqual(r.failures.map((x) => x.url), [own("p_1/b.jpg")]);

  const down = await appPhotosWithLogo("p_1", photos, TARGET, {
    publicBase: BASE,
    agencyId: AG,
    call: async () => ({ ok: false, message: "Sin servidor" }),
  });
  assert.deepEqual(down.photos, photos);
  assert.equal(down.failures.length, 2);
  const thrown = await appPhotosWithLogo("p_1", photos, TARGET, {
    publicBase: BASE,
    agencyId: AG,
    call: async () => {
      throw new Error("red");
    },
  });
  assert.deepEqual(thrown.photos, photos, "nunca tira");
});

test("app: lo que el servidor deja para después se vuelve a pedir", async () => {
  let n = 0;
  const call: WatermarkCall = async (_crm, urls) => {
    n++;
    const [first, ...rest] = urls;
    return { ok: true, data: { results: [{ url: first, ok: true, publicUrl: `${first}#wm` }], skipped: rest } };
  };
  const photos = [own("p_1/a.jpg"), own("p_1/b.jpg"), own("p_1/c.jpg"), own("p_1/d.jpg")];
  const r = await appPhotosWithLogo("p_1", photos, TARGET, { publicBase: BASE, agencyId: AG, call });
  assert.equal(n, 3, "hasta 3 intentos por sub-tanda");
  assert.deepEqual(r.photos.slice(0, 3), photos.slice(0, 3).map((u) => `${u}#wm`));
  assert.equal(r.photos[3], photos[3]);
  assert.deepEqual(r.failures.map((x) => x.url), [photos[3]]);
});

/* ── Mercado Libre: siempre las originales ────────────────────────────── */

const LISTING: MeliListingInput = {
  type: "departamento",
  operation: "venta",
  title: "Departamento Venta 3 ambientes Tolosa",
  description: "Luminoso.",
  price: 95000,
  currency: "USD",
  expenses: null,
  surfaceTotal: 70,
  surfaceCovered: 64,
  rooms: 3,
  bedrooms: 2,
  bathrooms: 1,
  garages: 0,
  ageYears: 10,
  features: [],
  street: "Calle 7",
  streetNumber: "1234",
  lat: null,
  lng: null,
  propertyCode: null,
  location: null,
  guests: null,
  landAccess: null,
};

test("Mercado Libre: con copias con logo en la app, el aviso se arma con las originales", async () => {
  // Lo que queda en `properties.photos` después de publicar con la opción prendida.
  const originals = [own("p_1/a.jpg"), own("crm/p_1/b.png"), own("p_1/c.webp")];
  const app = await appPhotosWithLogo("p_1", originals, TARGET, { publicBase: BASE, agencyId: AG, call: serverCall() });
  assert.ok(app.photos.every(looksLikeWatermarkCopy), "la app tiene las copias");

  const forMeli = portalPhotosFromAppRow(app.photos, { supabaseUrl: SUPA });
  assert.deepEqual(forMeli, originals);
  const item = buildMeliItem(LISTING, forMeli, "silver");
  assert.deepEqual(item.pictures.map((p) => p.source), originals);
  assert.ok(item.pictures.every((p) => !looksLikeWatermarkCopy(p.source) && !p.source.includes("/app/")));
  const update = buildMeliUpdate(LISTING, forMeli, undefined, []) as { pictures?: { source?: string }[] };
  assert.ok((update.pictures ?? []).every((p) => !p.source || !looksLikeWatermarkCopy(p.source)));
});

test("Mercado Libre: sin opción prendida no cambia nada y nunca deja pasar una copia rota", () => {
  const plain = [own("p_1/a.jpg"), "https://http2.mlstatic.com/D_123.jpg", "https://evil.com/x.jpg"];
  assert.deepEqual(portalPhotosFromAppRow(plain, { supabaseUrl: SUPA, existing: ["https://http2.mlstatic.com/D_123.jpg"] }), plain.slice(0, 2));
  const broken = `${BASE}${AG}/p_1/app/${"a".repeat(24)}_${b64urlEncode("branding/l.png")}.jpg`;
  assert.deepEqual(portalPhotosFromAppRow([broken], { supabaseUrl: SUPA }), []);
  assert.deepEqual(portalPhotosFromAppRow(null, { supabaseUrl: SUPA }), []);
});

/* ── Dibujo (sharp, imágenes en memoria) ──────────────────────────────── */

test("layout: chico ~14 % y mediano ~20 % del ancho, en la esquina con margen", () => {
  const sm = watermarkLayout(2000, 1500, 400, 100, { position: "bottom-right", size: "sm", backdrop: "shadow" });
  assert.equal(sm.logo.width, 280);
  assert.equal(sm.logo.height, 70);
  assert.equal(sm.logo.left + sm.logo.width + sm.margin, 2000);
  assert.equal(sm.logo.top + sm.logo.height + sm.margin, 1500);
  const md = watermarkLayout(2000, 1500, 400, 100, { position: "top-left", size: "md", backdrop: "light" });
  assert.equal(md.logo.width, 400);
  assert.equal(md.box.left, md.margin);
  assert.equal(md.box.top, md.margin);
  assert.ok(md.plate && md.logo.left > md.box.left, "la placa tiene relleno");
  // Logo cuadrado: no se pasa de un alto razonable.
  const sq = watermarkLayout(1600, 900, 500, 500, { position: "top-right", size: "md", backdrop: "dark" });
  assert.ok(sq.logo.height <= Math.round(900 * 0.17));
});

async function solid(w: number, h: number, color: string) {
  return new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer());
}
async function pixel(img: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

test("render: JPEG del mismo tamaño con el logo en la esquina elegida", async () => {
  const photo = await solid(800, 600, "#204060");
  const logo = new Uint8Array(await sharp({ create: { width: 200, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer());
  for (const backdrop of ["shadow", "light", "dark"] as const) {
    const out = await renderWatermark(photo, logo, { position: "bottom-right", size: "sm", backdrop });
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 800);
    assert.equal(meta.height, 600);
    const L = watermarkLayout(800, 600, 200, 50, { position: "bottom-right", size: "sm", backdrop });
    const [r, g, b] = await pixel(out, L.logo.left + Math.round(L.logo.width / 2), L.logo.top + Math.round(L.logo.height / 2));
    assert.ok(r > 200 && g < 60 && b < 60, `centro del logo rojo (${backdrop}): ${r},${g},${b}`);
    const [r2, g2, b2] = await pixel(out, 20, 20);
    assert.ok(Math.abs(r2 - 0x20) < 12 && Math.abs(g2 - 0x40) < 12 && Math.abs(b2 - 0x60) < 12, "la esquina opuesta no cambia");
  }
});

test("render: achica fotos enormes, respeta la orientación EXIF y aplana transparencia", async () => {
  const big = new Uint8Array(await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#808080" } }).jpeg({ quality: 50 }).toBuffer());
  const logo = new Uint8Array(await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.5 } } }).png().toBuffer());
  const out = await renderWatermark(big, logo, { position: "top-left", size: "md", backdrop: "shadow" });
  const m = await sharp(out).metadata();
  assert.equal(Math.max(m.width!, m.height!), 2560);

  // Foto "acostada" con orientación 6 (girar 90°): la copia sale parada.
  const rotated = new Uint8Array(await sharp({ create: { width: 300, height: 200, channels: 3, background: "#336699" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer());
  const r = await sharp(await renderWatermark(rotated, logo, { position: "bottom-left", size: "sm", backdrop: "light" })).metadata();
  assert.deepEqual([r.width, r.height], [200, 300]);

  const png = new Uint8Array(await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
  const flat = await renderWatermark(png, logo, { position: "bottom-left", size: "sm", backdrop: "dark" });
  assert.deepEqual(await pixel(flat, 290, 10), [255, 255, 255]);
  await assert.rejects(renderWatermark(new Uint8Array([1, 2, 3]), logo, { position: "bottom-left", size: "sm", backdrop: "dark" }));
});
