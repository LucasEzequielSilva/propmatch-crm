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
  readableOn,
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
