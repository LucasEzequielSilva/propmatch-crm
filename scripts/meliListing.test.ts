/**
 * Verificación del mapeo y la validación de Mercado Libre.
 * Correr con: npm run test:meli   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressLine,
  buildMeliAttributes,
  buildMeliItem,
  buildMeliUpdate,
  categoryFor,
  isPublishable,
  mapMeliItemStatus,
  pickListingType,
  plainDescription,
  readableMeliError,
  validateMeliListing,
  type MeliListingInput,
} from "../shared/meliListing.ts";

const PHOTOS = Array.from({ length: 12 }, (_, i) => `https://x.supabase.co/storage/v1/object/public/property-photos/a/p/${i}.jpg`);

const base: MeliListingInput = {
  type: "departamento",
  operation: "venta",
  title: "Departamento Venta 3 ambientes Tolosa",
  description: "Luminoso, <b>al frente</b>. 😀\r\nCon balcón.",
  price: 95000,
  currency: "USD",
  expenses: 45000,
  surfaceTotal: 70,
  surfaceCovered: 64,
  rooms: 3,
  bedrooms: 2,
  bathrooms: 1,
  garages: 0,
  ageYears: 10,
  features: ["Balcón", "Mascotas", "Luminoso"],
  street: "Calle 7",
  streetNumber: "1234",
  lat: -34.9,
  lng: -57.95,
  propertyCode: "p_abc123",
  location: { neighborhoodId: "TUxBQlRPTDEyMzQ" },
};

test("categorías hoja por tipo y operación", () => {
  assert.equal(categoryFor("departamento", "venta"), "MLA401686");
  assert.equal(categoryFor("casa", "alquiler"), "MLA1467");
  assert.equal(categoryFor("ph", "alquiler_temporal"), "MLA105180");
  assert.equal(categoryFor("terreno", "alquiler_temporal"), null);
});

test("una propiedad completa es publicable", () => {
  const issues = validateMeliListing(base, PHOTOS);
  assert.ok(isPublishable(issues), JSON.stringify(issues));
});

test("faltantes bloquean con mensajes legibles", () => {
  const issues = validateMeliListing(
    { ...base, surfaceCovered: null, garages: null, price: null, location: null },
    PHOTOS,
  );
  const fields = issues.filter((i) => i.blocking).map((i) => i.field).sort();
  assert.deepEqual(fields, ["COVERED_AREA", "PARKING_LOTS", "location", "price"]);
  assert.match(issues.find((i) => i.field === "PARKING_LOTS")!.message, /Cocheras/);
});

test("sin fotos públicas no se puede publicar", () => {
  assert.ok(!isPublishable(validateMeliListing(base, [])));
});

test("alquiler temporario pide huéspedes; terreno pide acceso", () => {
  const temp = validateMeliListing({ ...base, operation: "alquiler_temporal" }, PHOTOS);
  assert.ok(temp.some((i) => i.field === "GUESTS" && i.blocking));
  assert.ok(isPublishable(validateMeliListing({ ...base, operation: "alquiler_temporal", guests: 4 }, PHOTOS)));
  const land = validateMeliListing({ ...base, type: "terreno", rooms: null, bedrooms: null, bathrooms: null }, PHOTOS);
  assert.ok(land.some((i) => i.field === "LAND_ACCESS" && i.blocking));
});

test("WebP genera advertencia, no bloqueo", () => {
  const issues = validateMeliListing(base, PHOTOS.map((u) => u.replace(".jpg", ".webp")));
  assert.ok(isPublishable(issues));
  assert.ok(issues.some((i) => i.field === "pictures" && !i.blocking && /WebP/.test(i.message)));
});

test("atributos: unidades, booleanos y filtro por categoría", () => {
  const attrs = buildMeliAttributes(base);
  const byId = Object.fromEntries(attrs.map((a) => [a.id, a]));
  assert.equal(byId.TOTAL_AREA.value_name, "70 m²");
  assert.equal(byId.PARKING_LOTS.value_name, "0");
  assert.equal(byId.PROPERTY_AGE.value_name, "10 años");
  assert.equal(byId.MAINTENANCE_FEE.value_name, "45000 ARS");
  assert.equal(byId.HAS_BALCONY.value_id, "242085");
  assert.equal(byId.IS_SUITABLE_FOR_PETS.value_id, "242085");
  assert.ok(!("Luminoso" in byId));
  const filtered = buildMeliAttributes(base, new Set(["TOTAL_AREA"]));
  assert.deepEqual(filtered.map((a) => a.id), ["TOTAL_AREA"]);
});

test("item: campos fijos de clasificados y ubicación", () => {
  const item = buildMeliItem(base, PHOTOS, "silver");
  assert.equal(item.category_id, "MLA401686");
  assert.equal(item.buying_mode, "classified");
  assert.equal(item.available_quantity, 1);
  assert.deepEqual(item.channels, ["marketplace"]);
  assert.equal(item.currency_id, "USD");
  assert.equal(item.pictures.length, 12);
  assert.deepEqual(item.location, {
    address_line: "Calle 7 1234",
    neighborhood: { id: "TUxBQlRPTDEyMzQ" },
    latitude: -34.9,
    longitude: -57.95,
  });
});

test("update no manda categoría ni listing type", () => {
  const body = buildMeliUpdate({ ...base, location: null }, PHOTOS);
  assert.ok(!("category_id" in body));
  assert.ok(!("listing_type_id" in body));
  assert.ok(!("location" in body));
});

test("dirección con la altura al final", () => {
  assert.equal(addressLine({ ...base, streetNumber: null }), "Calle 7");
  assert.equal(addressLine({ ...base, street: "" }), undefined);
});

test("descripción en texto plano", () => {
  assert.equal(plainDescription(base.description), "Luminoso, al frente . \nCon balcón.");
});

test("estados de Mercado Libre", () => {
  assert.equal(mapMeliItemStatus({ status: "active" }).status, "published");
  assert.equal(mapMeliItemStatus({ status: "paused" }).status, "paused");
  assert.equal(mapMeliItemStatus({ status: "closed" }).status, "removed");
  assert.equal(mapMeliItemStatus({ status: "closed", sub_status: ["pack_quota_exceeded"] }).status, "error");
});

test("errores legibles", () => {
  const msg = readableMeliError(400, {
    message: "Validation error",
    error: "validation_error",
    status: 400,
    cause: [{ code: "item.pictures.invalid", message: "Picture could not be downloaded", type: "error" }],
  });
  assert.match(msg, /foto/);
  assert.match(readableMeliError(401, null), /Volvé a conectar/);
});

test("elección de listing type según cupo", () => {
  const packs = [{ status: "active", listing_details: [{ listing_type_id: "silver", remaining_listings: 3 }] }];
  assert.deepEqual(pickListingType(packs, "silver"), { ok: true, listingType: "silver" });
  assert.equal(pickListingType(packs, "gold").ok, false);
  assert.equal(pickListingType([], "silver").ok, false);
});
