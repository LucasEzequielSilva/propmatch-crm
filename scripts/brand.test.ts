/**
 * Marca de la inmobiliaria y plantillas de documentos (lógica pura).
 * Correr con: npm run test:brand   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import {
  brandLogoPrefix,
  checkContrast,
  contrastRatio,
  decodeBrandPng,
  encodeBrandPng,
  photoLogoCorner,
  readableOn,
  resolvePhotoLogo,
  resolveBrand,
  sanitizeBrand,
} from "../shared/brand.ts";

test("brand.png: ida y vuelta con acentos y emojis", () => {
  const json = JSON.stringify({ displayName: "López Propiedades ñ 🏠", primary: "#0F766E" });
  const png = encodeBrandPng(json);
  assert.equal(decodeBrandPng(png), json);
});

test("brand.png: es un PNG válido (IDAT se descomprime)", () => {
  const png = encodeBrandPng("{}");
  // Buscar el IDAT y descomprimirlo.
  let p = 8;
  let found = false;
  while (p < png.length) {
    const len = (png[p] << 24) | (png[p + 1] << 16) | (png[p + 2] << 8) | png[p + 3];
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (type === "IDAT") {
      const raw = inflateSync(png.subarray(p + 8, p + 8 + len));
      assert.deepEqual([...raw], [0, 0, 0, 0, 0]);
      found = true;
    }
    p += 12 + len;
  }
  assert.ok(found);
});

test("decodeBrandPng: basura o PNG sin chunk → null", () => {
  assert.equal(decodeBrandPng(new Uint8Array([1, 2, 3])), null);
  assert.equal(decodeBrandPng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), null);
});

test("sanitizeBrand: lista blanca, colores y URLs", () => {
  const b = sanitizeBrand({
    displayName: "  López  ",
    primary: "#0f766e",
    secondary: "rojo",
    email: "no-es-mail",
    website: "lopez.com.ar",
    instagram: "https://instagram.com/lopez.prop/",
    logoUrl: "javascript:alert(1)",
    extra: "<script>",
  })!;
  assert.equal(b.displayName, "López");
  assert.equal(b.primary, "#0F766E");
  assert.equal(b.secondary, "#EC4899");
  assert.equal(b.email, null);
  assert.equal(b.website, "https://lopez.com.ar/");
  assert.equal(b.instagram, "lopez.prop");
  assert.equal(b.logoUrl, null);
  assert.ok(!("extra" in b));
});

test("sanitizeBrand: el servidor solo acepta logos de la carpeta de la agencia", () => {
  const prefix = brandLogoPrefix("https://x.supabase.co", "agency-1");
  const ok = sanitizeBrand({ logoUrl: `${prefix}logo-1.png` }, { logoPrefix: prefix })!;
  assert.equal(ok.logoUrl, `${prefix}logo-1.png`);
  const bad = sanitizeBrand({ logoUrl: "https://evil.com/logo.png" }, { logoPrefix: prefix })!;
  assert.equal(bad.logoUrl, null);
  const data = sanitizeBrand({ logoUrl: "data:image/png;base64,AAAA" })!;
  assert.equal(data.logoUrl, null, "data URL solo con allowDataLogo");
});

test("contraste: readableOn llega a AA sobre blanco", () => {
  assert.ok(contrastRatio("#000000", "#FFFFFF") > 20);
  const yellow = "#FACC15";
  assert.ok(!checkContrast(yellow, "#FFFFFF").aa);
  assert.ok(checkContrast(readableOn(yellow), "#FFFFFF").aa);
  assert.equal(readableOn("#1F0A3C"), "#1F0A3C");
});

test("resolveBrand: usa los datos de la cuenta como respaldo", () => {
  const r = resolveBrand(null, { name: "Inmo", phone: "11 5555", email: "a@b.com" });
  assert.equal(r.name, "Inmo");
  assert.equal(r.whatsapp, "11 5555");
  assert.equal(r.custom, false);
  const r2 = resolveBrand(sanitizeBrand({ displayName: "López", primary: "#FACC15" }), { name: "Inmo" });
  assert.equal(r2.name, "López");
  assert.equal(r2.onPrimary, "#1F0A3C");
  assert.ok(r2.custom);
});

test("logo sobre fotos: apagado por defecto y tolera marcas viejas", () => {
  const vieja = sanitizeBrand({ displayName: "López", logoUrl: "https://x.supabase.co/l.png" })!;
  assert.deepEqual(vieja.photoLogo, { show: false, inApp: false, position: "bottom-right", size: "sm", backdrop: "shadow" });
  assert.equal(vieja.photoLogoUrl, null);
  assert.equal(resolvePhotoLogo(vieja), null);
  // Marca guardada antes de este cambio (sin los campos nuevos).
  assert.equal(resolvePhotoLogo({ logoUrl: "https://x.supabase.co/l.png" }), null);
  assert.equal(resolveBrand(vieja, { name: "Inmo" }).photoLogo, null);
});

test("logo sobre fotos: lista blanca de opciones y misma regla de URL que el logo", () => {
  const prefix = brandLogoPrefix("https://x.supabase.co", "agency-1");
  const b = sanitizeBrand(
    { photoLogoUrl: "https://evil.com/w.png", photoLogo: { show: true, position: "centro", size: "xl", backdrop: "neon", extra: 1 } },
    { logoPrefix: prefix },
  )!;
  assert.equal(b.photoLogoUrl, null);
  assert.deepEqual(b.photoLogo, { show: true, inApp: false, position: "bottom-right", size: "sm", backdrop: "shadow" });
  const ok = sanitizeBrand({ photoLogoUrl: `${prefix}logo-foto-1.png`, photoLogo: { show: true, position: "top-left", size: "md", backdrop: "dark" } }, { logoPrefix: prefix })!;
  assert.equal(ok.photoLogoUrl, `${prefix}logo-foto-1.png`);
  assert.deepEqual(ok.photoLogo, { show: true, inApp: false, position: "top-left", size: "md", backdrop: "dark" });
  assert.equal(sanitizeBrand({ photoLogoUrl: "data:image/png;base64,AAAA" })!.photoLogoUrl, null, "data URL solo con allowDataLogo");
});

test("logo sobre fotos: sin versión para fotos usa el principal con placa clara", () => {
  const on = { show: true, position: "bottom-right", size: "sm", backdrop: "shadow" } as const;
  assert.equal(resolvePhotoLogo({ photoLogo: on }), null, "sin ningún logo no hay nada que mostrar");
  const main = resolvePhotoLogo({ logoUrl: "https://x.supabase.co/l.png", photoLogo: on })!;
  assert.equal(main.src, "https://x.supabase.co/l.png");
  assert.equal(main.backdrop, "light");
  assert.ok(main.usesMainLogo);
  const own = resolvePhotoLogo({ logoUrl: "https://x.supabase.co/l.png", photoLogoUrl: "https://x.supabase.co/w.png", photoLogo: { ...on, backdrop: "dark" } })!;
  assert.equal(own.src, "https://x.supabase.co/w.png");
  assert.equal(own.backdrop, "dark");
  assert.ok(!own.usesMainLogo);
  assert.equal(resolvePhotoLogo({ photoLogoUrl: "javascript:alert(1)", photoLogo: on }), null);
});

test("logo sobre fotos: la esquina esquiva los badges", () => {
  assert.equal(photoLogoCorner("bottom-right"), "bottom-right");
  assert.equal(photoLogoCorner("bottom-right", ["bottom-right"]), "bottom-left");
  assert.equal(photoLogoCorner("top-left", ["top-left", "top-right"]), "bottom-left");
  assert.equal(photoLogoCorner("top-left", ["top-left", "top-right", "bottom-left"]), "bottom-right");
  assert.equal(photoLogoCorner("top-right", ["top-left", "top-right", "bottom-left", "bottom-right"]), "top-right");
});
