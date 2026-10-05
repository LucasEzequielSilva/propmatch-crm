/**
 * Reglas puras de Meta (Instagram/Facebook) y de la web pública.
 * Correr con: npm run test:meta   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFbImage, checkIgCaption, checkIgCount, checkIgImage, igKindFor, jpegSize } from "../shared/metaPublish.ts";
import {
  decodeExactGeo,
  deriveAgencySlug,
  encodeExactGeo,
  filterProperties,
  formatUsd,
  idPrefixFromSlug,
  isValidSlug,
  whatsappDigits,
  type PublicProperty,
} from "../shared/publicSite.ts";

/** JPEG mínimo: SOI + APP0 + SOF0 con el tamaño pedido. */
function fakeJpeg(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

test("jpegSize lee el SOF", () => {
  assert.deepEqual(jpegSize(fakeJpeg(1080, 1350)), { width: 1080, height: 1350 });
  assert.equal(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

test("Instagram: JPEG y relación de aspecto 4:5 a 1,91:1", () => {
  const base = { url: "u", bytes: 500_000 };
  assert.equal(checkIgImage({ ...base, contentType: "image/jpeg", width: 1080, height: 1350 }, "image"), null);
  assert.equal(checkIgImage({ ...base, contentType: "image/jpeg", width: 1080, height: 566 }, "carousel"), null);
  assert.equal(checkIgImage({ ...base, contentType: "image/jpeg", width: 1080, height: 1920 }, "image")?.code, "ratio");
  assert.equal(checkIgImage({ ...base, contentType: "image/jpeg", width: 1080, height: 1920 }, "story"), null);
  assert.equal(checkIgImage({ ...base, contentType: "image/webp", width: 1080, height: 1080 }, "image")?.code, "not_jpeg");
  assert.equal(checkIgImage({ url: "u", bytes: 9 * 1024 * 1024, contentType: "image/jpeg", width: 1080, height: 1080 }, "image")?.code, "too_big");
});

test("Instagram: cantidad y texto", () => {
  assert.equal(igKindFor(1), "image");
  assert.equal(igKindFor(3), "carousel");
  assert.equal(checkIgCount("carousel", 1) !== null, true);
  assert.equal(checkIgCount("carousel", 10), null);
  assert.equal(checkIgCount("carousel", 11) !== null, true);
  assert.equal(checkIgCount("story", 1), null);
  assert.equal(checkIgCaption("Hola #a #b"), null);
  assert.notEqual(checkIgCaption("x".repeat(2201)), null);
  assert.notEqual(checkIgCaption(Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ")), null);
});

test("Facebook: formatos y 4 MB", () => {
  assert.equal(checkFbImage({ url: "u", contentType: "image/png", bytes: 1000, width: null, height: null }), null);
  assert.equal(checkFbImage({ url: "u", contentType: "image/webp", bytes: 1000, width: null, height: null })?.code, "not_jpeg");
  assert.equal(checkFbImage({ url: "u", contentType: "image/jpeg", bytes: 5 * 1024 * 1024, width: null, height: null })?.code, "too_big");
});

test("slug derivado de la agencia", () => {
  const a = { id: "1ffdbb92-7cb2-4508-9b0c-20b66e298b32", name: "Inmobiliaria López & Asoc." };
  const s = deriveAgencySlug(a);
  assert.equal(s, "inmobiliaria-lopez-asoc-1ffdbb92");
  assert.equal(isValidSlug(s), true);
  assert.equal(idPrefixFromSlug(s), "1ffdbb92");
  assert.equal(idPrefixFromSlug("lopez-propiedades"), null);
  assert.equal(isValidSlug("../etc"), false);
});

test("ubicación exacta solo con formato válido", () => {
  assert.deepEqual(decodeExactGeo(encodeExactGeo(-34.603722, -58.381592)), { lat: -34.603722, lng: -58.381592 });
  assert.equal(decodeExactGeo(null), null);
  assert.equal(decodeExactGeo("geo:999,1"), null);
  assert.equal(decodeExactGeo("MLA123"), null);
});

test("WhatsApp y precio", () => {
  assert.equal(whatsappDigits("011 5555-1234"), "541155551234");
  assert.equal(whatsappDigits("+54 9 221 555-0101"), "5492215550101");
  assert.equal(whatsappDigits("123"), null);
  assert.equal(formatUsd(null, null), "Consultar precio");
  assert.equal(formatUsd(850, "mes"), "USD 850 / mes");
});

test("filtros de la web", () => {
  const p = (o: Partial<PublicProperty>): PublicProperty => ({
    id: "x",
    title: "Depto",
    description: "",
    type: "depto",
    operation: "venta",
    price: 100_000,
    pricePeriod: null,
    rooms: 2,
    amenities: [],
    area: "Palermo",
    photos: [],
    exact: null,
    updatedAt: "",
    ...o,
  });
  const list = [p({ id: "a" }), p({ id: "b", operation: "alquiler", price: 700, area: "Belgrano", rooms: 3 }), p({ id: "c", type: "casa", price: null })];
  const ids = (f: Parameters<typeof filterProperties>[1]) => filterProperties(list, f).map((x) => x.id);
  const none = { operation: "", type: "", area: "", priceMin: null, priceMax: null, rooms: null } as const;
  assert.deepEqual(ids({ ...none, operation: "alquiler" }), ["b"]);
  assert.deepEqual(ids({ ...none, area: "palérmo" }), ["a", "c"]);
  assert.deepEqual(ids({ ...none, priceMin: 50_000 }), ["a"]);
  assert.deepEqual(ids({ ...none, rooms: 3 }), ["b"]);
  assert.deepEqual(ids({ ...none, type: "casa" }), ["c"]);
});
