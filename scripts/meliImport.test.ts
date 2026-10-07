/**
 * Importar avisos de Mercado Libre y publicar propiedades solo-CRM (pesos o
 * sin sincronizar): mapeo ML → ficha, dedupe, validación del lado servidor,
 * moneda y piezas del importador. Sin red.
 * Correr con: npm run test:meli-import   (Node >= 22.18 ejecuta TypeScript sin flags)
 *
 * Fixture principal: respuesta de ejemplo de "List properties"
 * (https://developers.mercadolibre.com.ar/en_us/list-properties), copiada tal
 * cual en scripts/fixtures/meli-item-list-properties.json.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BOOLEAN_TO_FEATURE,
  findImportDuplicate,
  isRealEstatePath,
  mapMeliItemToProperty,
  splitAddress,
  typeAndOperation,
  type CategoryPath,
  type MeliImportItem,
} from "../shared/meliImport.ts";
import {
  FEATURE_TO_BOOLEAN,
  buildMeliAttributes,
  buildMeliItem,
  buildMeliUpdate,
  meliCurrency,
  picturePayload,
  validateMeliListing,
  isPublishable,
  type MeliListingInput,
} from "../shared/meliListing.ts";
import {
  chunk,
  crmPhotoFolder,
  filterCrmPhotos,
  nextImportCursor,
  parseCrmPropertyId,
  parseImportCursor,
  parseImportLinks,
  parseItemIds,
  parseListing,
  parseMultiget,
  parsePrevious,
  parseTarget,
} from "../api/_lib/integrations/meliRequest.ts";

const DOC_ITEM = JSON.parse(readFileSync(new URL("./fixtures/meli-item-list-properties.json", import.meta.url), "utf8")) as MeliImportItem;
const DEPTO_VENTA: CategoryPath = [
  { id: "MLA1459", name: "Inmuebles" },
  { id: "MLA1472", name: "Departamentos" },
  { id: "MLA1474", name: "Venta" },
  { id: "MLA401686", name: "Propiedades Individuales" },
];
const CASA_ALQUILER: CategoryPath = [
  { id: "MLA1459", name: "Inmuebles" },
  { id: "MLA1466", name: "Casas" },
  { id: "MLA1467", name: "Alquiler" },
];

/* ───────────────────────── mapeo ML → ficha ─────────────────────────── */

test("aviso de la doc (departamento en venta, ARS) → ficha del CRM", () => {
  const r = mapMeliItemToProperty(DOC_ITEM, DEPTO_VENTA, "Descripción de la doc.");
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  const d = r.draft;
  assert.equal(d.type, "departamento");
  assert.equal(d.operation, "venta");
  assert.equal(d.title, "Property Title");
  assert.equal(d.description, "Descripción de la doc.");
  assert.equal(d.price, 100000);
  assert.equal(d.currency, "ARS");
  assert.equal(d.status, "disponible");
  assert.equal(d.surface_total, 40);
  assert.equal(d.surface_covered, 30);
  assert.equal(d.rooms, 2);
  assert.equal(d.bedrooms, 4);
  assert.equal(d.bathrooms, 1);
  assert.equal(d.garages, 1);
  assert.ok(d.features.includes("Cochera"));
  // Dirección: la altura va al final del address_line.
  assert.equal(d.street, "My property address NEW");
  assert.equal(d.street_number, "111");
  assert.equal(d.locality, "Palermo");
  assert.equal(d.province, "Capital Federal");
  assert.equal(d.lat, -34.5780655);
  assert.equal(d.lng, -58.4265317);
  assert.deepEqual(d.photos, ["https://mla-s2-p.mlstatic.com/910707-MLA40763776324_022020-O.jpg"]);
  // Lo que no tiene lugar en la ficha va a notas, sin inventar.
  assert.ok(r.unmapped.includes("Código postal: 5000"));
  assert.equal(d.age_years, null);
  assert.equal(d.expenses, null);
  // Datos para vincular la publicación.
  assert.equal(r.listing.externalId, "MLA839018613");
  assert.match(r.listing.permalink ?? "", /^https:\/\/departamento\.mercadolibre\.com\.ar\//);
  assert.deepEqual(r.listing.meliLocation, { stateId: "TUxBUENBUGw3M2E1", cityId: "TUxBQ0NBUGZlZG1sYQ", neighborhoodId: "TUxBQlBBTDI1MTVa" });
});

test("sin el árbol de categorías, el tipo y la operación salen de PROPERTY_TYPE / OPERATION", () => {
  const to = typeAndOperation(DOC_ITEM, null);
  assert.deepEqual(to, { type: "departamento", operation: "venta" });
});

const CASA: MeliImportItem = {
  id: "MLA1234567890",
  title: "Casa en alquiler 4 ambientes con pileta",
  category_id: "MLA1467",
  price: 850000,
  currency_id: "ARS",
  status: "paused",
  seller_id: 99,
  pictures: [{ id: "1-MLA", url: "http://http2.mlstatic.com/D_1-O.jpg" }],
  location: {
    street_name: "Calle 7",
    street_number: "1234",
    neighborhood: { id: "N1", name: "Tolosa" },
    city: { id: "C1", name: "La Plata" },
    state: { id: "S1", name: "Bs.As. G.B.A. Sur" },
    latitude: 0,
    longitude: 0,
  },
  attributes: [
    { id: "TOTAL_AREA", name: "Superficie total", value_name: "300 m²", value_struct: { number: 300, unit: "m²" } },
    { id: "COVERED_AREA", name: "Superficie cubierta", value_name: "160 m²", value_struct: { number: 160, unit: "m²" } },
    { id: "ROOMS", name: "Ambientes", value_name: "4" },
    { id: "BEDROOMS", name: "Dormitorios", value_name: "3" },
    { id: "FULL_BATHROOMS", name: "Baños", value_name: "2" },
    { id: "PARKING_LOTS", name: "Cocheras", value_name: "0" },
    { id: "PROPERTY_AGE", name: "Antigüedad", value_name: "15 años", value_struct: { number: 15, unit: "años" } },
    { id: "MAINTENANCE_FEE", name: "Expensas", value_name: "120 USD", value_struct: { number: 120, unit: "USD" } },
    { id: "HAS_SWIMMING_POOL", name: "Pileta", value_id: "242085", value_name: "Sí" },
    { id: "HAS_GRILL", name: "Parrilla", value_id: "242085", value_name: "Sí" },
    { id: "HAS_GYM", name: "Gimnasio", value_id: "242084", value_name: "No" },
    { id: "HAS_HEATING", name: "Calefacción", value_id: "242085", value_name: "Sí" },
    { id: "DISPOSITION", name: "Disposición", value_name: "Frente" },
    { id: "FACING", name: "Orientación", value_name: "Norte" },
    { id: "WAREHOUSES", name: "Bauleras", value_name: "1" },
    { id: "HAS_LEADS_PENALIZATION", name: "Tiene penalización por Leads", value_name: "Sí" },
  ],
};

test("casa en alquiler, pausada, con expensas en USD, booleanos y notas", () => {
  const r = mapMeliItemToProperty(CASA, CASA_ALQUILER, null);
  assert.ok(r.ok);
  if (!r.ok) return;
  const d = r.draft;
  assert.equal(d.type, "casa");
  assert.equal(d.operation, "alquiler");
  assert.equal(d.status, "pausada");
  assert.equal(d.currency, "ARS");
  assert.equal(d.expenses, 120);
  assert.equal(d.expenses_currency, "USD");
  assert.equal(d.age_years, 15);
  assert.equal(d.garages, 0);
  assert.ok(!d.features.includes("Cochera"));
  assert.deepEqual(d.features.sort(), ["Parrilla", "Piscina"]);
  assert.equal(d.layout, "frente");
  assert.equal(d.orientation, "N");
  assert.equal(d.street, "Calle 7");
  assert.equal(d.street_number, "1234");
  assert.equal(d.locality, "Tolosa");
  // 0,0 no es una ubicación real.
  assert.equal(d.lat, null);
  // Foto http → https.
  assert.deepEqual(d.photos, ["https://http2.mlstatic.com/D_1-O.jpg"]);
  assert.equal(d.description, null);
  // Notas: lo que el CRM no modela (Calefacción, Bauleras, ciudad); nunca flags internos de ML.
  assert.ok(r.unmapped.includes("Calefacción: Sí"));
  assert.ok(r.unmapped.includes("Bauleras: 1"));
  assert.ok(r.unmapped.includes("Ciudad (Mercado Libre): La Plata"));
  assert.ok(!r.unmapped.some((u) => /penalizaci/i.test(u)));
});

test("terreno en hectáreas y expensas en UVA (no se convierten: van a notas)", () => {
  const item: MeliImportItem = {
    ...CASA,
    attributes: [
      { id: "TOTAL_AREA", name: "Superficie total", value_name: "1.5 ha", value_struct: { number: 1.5, unit: "ha" } },
      { id: "MAINTENANCE_FEE", name: "Expensas", value_name: "3 UVA", value_struct: { number: 3, unit: "UVA" } },
    ],
  };
  const r = mapMeliItemToProperty(item, [{ id: "MLA1459" }, { id: "MLA1493", name: "Terrenos y Lotes" }, { id: "MLA1495", name: "Venta" }], null);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.draft.type, "terreno");
  assert.equal(r.draft.surface_total, 15000);
  assert.equal(r.draft.expenses, null);
  assert.ok(r.unmapped.includes("Expensas: 3 UVA"));
});

test("tipos que el CRM no maneja, otras monedas y categorías fuera de Inmuebles no se importan", () => {
  const cochera = mapMeliItemToProperty(CASA, [{ id: "MLA1459" }, { id: "MLA50541", name: "Cocheras" }, { id: "X", name: "Venta" }], null);
  assert.equal(cochera.ok, false);
  assert.match(!cochera.ok ? cochera.reason : "", /Cocheras/);
  const uf = mapMeliItemToProperty({ ...CASA, currency_id: "CLF" }, CASA_ALQUILER, null);
  assert.equal(uf.ok, false);
  const auto = mapMeliItemToProperty(CASA, [{ id: "MLA1743", name: "Autos" }], null);
  assert.equal(auto.ok, false);
  assert.equal(isRealEstatePath([{ id: "MLA1743" }]), false);
  assert.equal(isRealEstatePath(CASA_ALQUILER), true);
});

test("alquiler temporario sale del nombre de la categoría", () => {
  const to = typeAndOperation(CASA, [{ id: "MLA1459" }, { id: "MLA1466", name: "Casas" }, { id: "MLA50278", name: "Alquiler Temporario" }]);
  assert.deepEqual(to, { type: "casa", operation: "alquiler_temporal" });
});

test("splitAddress separa la altura del final", () => {
  assert.deepEqual(splitAddress("Av. 7 N 1234"), { street: "Av. 7 N", number: "1234" });
  assert.deepEqual(splitAddress("Diagonal 74"), { street: "Diagonal", number: "74" });
  assert.deepEqual(splitAddress("Calle sin número"), { street: "Calle sin número", number: null });
  assert.deepEqual(splitAddress(""), { street: null, number: null });
});

test("catálogo de características: importar y publicar usan los mismos atributos", () => {
  for (const [attr, chip] of Object.entries(BOOLEAN_TO_FEATURE)) assert.equal(FEATURE_TO_BOOLEAN[chip], attr, chip);
  for (const [chip, attr] of Object.entries(FEATURE_TO_BOOLEAN)) assert.equal(BOOLEAN_TO_FEATURE[attr], chip, attr);
});

/* ───────────────────────── dedupe ───────────────────────────────────── */

const props = [
  { id: "p_1", title: "Casa en alquiler 4 ambientes con pileta", price: 850000, currency: "ARS", street: "Calle 7", street_number: "1234" },
  { id: "p_2", title: "Otra", price: 1, currency: "USD", street: null, street_number: null },
  { id: "p_s", title: "Casa en alquiler 4 ambientes con pileta", price: 850000, currency: "ARS", street: "Calle 7", street_number: "1234", is_sample: true },
];
const cand = { externalId: "MLA1234567890", title: "  casa en ALQUILER 4 ambientes con pileta ", price: 850000, currency: "ARS", street: "calle 7", street_number: "1234" };

test("dedupe por external_id: ya vinculado → no se vuelve a importar", () => {
  assert.deepEqual(findImportDuplicate(cand, props, [{ crmPropertyId: "p_2", externalId: "MLA1234567890" }]), { kind: "linked", propertyId: "p_2" });
});

test("dedupe por título + precio + dirección (normalizados)", () => {
  assert.deepEqual(findImportDuplicate(cand, props, []), { kind: "similar", propertyId: "p_1" });
  assert.equal(findImportDuplicate({ ...cand, price: 900000 }, props, []), null);
  assert.equal(findImportDuplicate({ ...cand, street_number: "99" }, props, []), null);
});

test("dedupe ignora datos de ejemplo (nunca se importa ni vincula sobre ellos)", () => {
  const onlySample = props.filter((p) => p.is_sample);
  assert.equal(findImportDuplicate(cand, onlySample, []), null);
  assert.equal(findImportDuplicate(cand, onlySample, [{ crmPropertyId: "p_s", externalId: cand.externalId }]), null);
});

/* ───────────────── validación de la ficha del lado servidor ─────────── */

const SUPA = "https://abc.supabase.co";
const AG = "11111111-2222-4333-8444-555555555555";

test("parseListing: lista blanca de campos (nada confidencial entra)", () => {
  const l = parseListing({
    type: "departamento",
    operation: "venta",
    title: "x".repeat(400),
    price: 1e20,
    currency: "ARS",
    expenses: 50000,
    expensesCurrency: "EUR",
    reserve_min_price: 80000,
    commission_pct: 3,
    owner_contact_id: "c_1",
    features: ["Balcón", 3, "y".repeat(100)],
  });
  assert.ok(l);
  const keys = Object.keys(l!);
  for (const k of ["reserve_min_price", "commission_pct", "owner_contact_id"]) assert.ok(!keys.includes(k), k);
  assert.ok(!JSON.stringify(l).includes("80000"));
  assert.equal(l!.title.length, 300);
  assert.equal(l!.price, null);
  assert.equal(l!.expensesCurrency, null);
  assert.deepEqual(l!.features, ["Balcón", "y".repeat(60)]);
  assert.equal(parseListing({ type: "castillo", operation: "venta" }), null);
});

test("fotos solo-CRM: solo el bucket y la carpeta de la agencia (o fotos del propio aviso)", () => {
  const folder = `${SUPA}/storage/v1/object/public/property-photos/${crmPhotoFolder(AG, "p_abc")}`;
  const r = filterCrmPhotos(
    [
      `${folder}a1.jpg`,
      `${folder}a1.jpg`, // repetida
      `${folder}../otra/x.jpg`,
      `${folder}sub/x.jpg`,
      `${folder}x.jpg?token=1`,
      `${SUPA}/storage/v1/object/public/property-photos/99999999-2222-4333-8444-555555555555/crm/p_abc/x.jpg`,
      `${SUPA}/storage/v1/object/public/property-photos/${AG}/crm/p_otra/x.jpg`,
      `${SUPA}/storage/v1/object/public/avatars/${AG}/crm/p_abc/x.jpg`,
      "https://evil.example.com/x.jpg",
      "data:image/jpeg;base64,AAAA",
      "https://http2.mlstatic.com/D_1-O.jpg",
      42,
    ],
    { supabaseUrl: `${SUPA}/`, agencyId: AG, crmPropertyId: "p_abc", existing: ["https://http2.mlstatic.com/D_1-O.jpg"] },
  );
  assert.deepEqual(r.photos, [`${folder}a1.jpg`, "https://http2.mlstatic.com/D_1-O.jpg"]);
  assert.equal(r.rejected, 9);
});

test("ids y destino del pedido", () => {
  assert.equal(parseCrmPropertyId("p_k3x9-1"), "p_k3x9-1");
  assert.equal(parseCrmPropertyId("../x"), null);
  assert.equal(parseCrmPropertyId("a/b"), null);
  assert.deepEqual(parseTarget({ crmPropertyId: "p_1" }), { kind: "crm", crmPropertyId: "p_1" });
  assert.deepEqual(parseTarget({ propertyId: AG, crmPropertyId: "p_1" }), { kind: "app", propertyId: AG, crmPropertyId: "p_1" });
  assert.equal(parseTarget({ propertyId: "no-uuid", crmPropertyId: "p_1" }), null);
  assert.equal(parseTarget({}), null);
  assert.deepEqual(parsePrevious({ externalId: "MLA123456789" }), { externalId: "MLA123456789" });
  assert.equal(parsePrevious({ externalId: "MLB123456789" }), null);
});

/* ───────────────────────── moneda ───────────────────────────────────── */

const pesos: MeliListingInput = {
  type: "departamento",
  operation: "alquiler",
  title: "Departamento Alquiler 2 ambientes Centro",
  description: "Lindo.",
  price: 650000,
  currency: "ARS",
  expenses: 80,
  expensesCurrency: "USD",
  surfaceTotal: 50,
  surfaceCovered: 45,
  rooms: 2,
  bedrooms: 1,
  bathrooms: 1,
  garages: 0,
  ageYears: 5,
  features: ["Ascensor", "Gimnasio"],
  street: "Calle 50",
  streetNumber: "800",
  lat: null,
  lng: null,
  location: { neighborhoodId: "TUxBQlRPTDEyMzQ" },
};

test("moneda: pesos y dólares se publican; el resto se bloquea", () => {
  assert.equal(meliCurrency("ARS"), "ARS");
  assert.equal(meliCurrency(" usd "), "USD");
  assert.equal(meliCurrency("U$S"), null);
  assert.equal(meliCurrency("UVA"), null);
  assert.equal(meliCurrency(null), null);
  const photos = Array.from({ length: 12 }, (_, i) => `https://x.supabase.co/storage/v1/object/public/property-photos/a/crm/p/${i}.jpg`);
  assert.ok(isPublishable(validateMeliListing(pesos, photos)));
  assert.equal(buildMeliItem(pesos, photos, "silver").currency_id, "ARS");
  assert.equal(buildMeliItem({ ...pesos, currency: "USD" }, photos, "silver").currency_id, "USD");
  assert.ok(validateMeliListing({ ...pesos, currency: "EUR" }, photos).some((i) => i.field === "currency" && i.blocking));
});

test("expensas con su moneda (ARS por defecto) y características nuevas", () => {
  const attrs = buildMeliAttributes(pesos);
  assert.deepEqual(attrs.find((a) => a.id === "MAINTENANCE_FEE"), { id: "MAINTENANCE_FEE", value_name: "80 USD" });
  assert.deepEqual(buildMeliAttributes({ ...pesos, expensesCurrency: null }).find((a) => a.id === "MAINTENANCE_FEE"), { id: "MAINTENANCE_FEE", value_name: "80 ARS" });
  assert.ok(attrs.some((a) => a.id === "HAS_LIFT" && a.value_id === "242085"));
  assert.ok(attrs.some((a) => a.id === "HAS_GYM"));
});

test("al actualizar, las fotos que ya están en el aviso van por id", () => {
  const existing = [{ id: "910707-MLA40763776324_022020", url: "http://a/1.jpg", secure_url: "https://a/1.jpg" }];
  assert.deepEqual(picturePayload(["https://a/1.jpg", "https://b/2.jpg"], existing), [{ id: "910707-MLA40763776324_022020" }, { source: "https://b/2.jpg" }]);
  const body = buildMeliUpdate(pesos, ["https://a/1.jpg"], undefined, existing);
  assert.deepEqual(body.pictures, [{ id: "910707-MLA40763776324_022020" }]);
});

/* ───────────────────────── importador: piezas ───────────────────────── */

test("cursor del importador: activos → pausados → fin", () => {
  assert.deepEqual(parseImportCursor(undefined), { status: "active", scrollId: null });
  assert.equal(parseImportCursor({ status: "closed" }), null);
  assert.equal(parseImportCursor({ status: "active", scrollId: "a b" }), null);
  const c = parseImportCursor({ status: "active", scrollId: null })!;
  assert.deepEqual(nextImportCursor(c, { scrollId: "YXBp==:ZHM=", count: 100 }), { status: "active", scrollId: "YXBp==:ZHM=" });
  assert.deepEqual(nextImportCursor(c, { scrollId: null, count: 0 }), { status: "paused", scrollId: null });
  assert.equal(nextImportCursor({ status: "paused", scrollId: "x" }, { scrollId: "x", count: 0 }), null);
});

test("multiget: formato nuevo (/items/bulk) y viejo (/items?ids=)", () => {
  const nuevo = [{ id: "MLA1", status_code: 200, body: { id: "MLA1" } }, { id: "MLA2", status_code: 404, body: { message: "not found" } }];
  const viejo = [{ code: 200, body: { id: "MLA3" } }];
  assert.deepEqual(parseMultiget(nuevo), [{ id: "MLA1" }]);
  assert.deepEqual(parseMultiget(viejo), [{ id: "MLA3" }]);
  assert.deepEqual(parseMultiget({ error: "x" }), []);
});

test("lotes de 20 y validación de ids y vínculos", () => {
  const ids = Array.from({ length: 45 }, (_, i) => `MLA${1000000 + i}`);
  assert.deepEqual(chunk(ids, 20).map((g) => g.length), [20, 20, 5]);
  assert.deepEqual(parseItemIds(["MLA1234567", "MLA1234567"]), ["MLA1234567"]);
  assert.equal(parseItemIds(ids), null);
  assert.equal(parseItemIds(["MLA1234567", "x"]), null);
  assert.deepEqual(parseImportLinks([{ crmPropertyId: "p_1", externalId: "MLA1234567" }]), [{ crmPropertyId: "p_1", externalId: "MLA1234567", propertyId: null }]);
  assert.equal(parseImportLinks([{ crmPropertyId: "p_1", externalId: "MLA1234567", propertyId: "x" }]), null);
});
