/**
 * Carga por voz: parser local (sin IA) y saneamiento compartido.
 * Correr con: npm run test:voz   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBusqueda, parsePropiedad } from "../src/lib/voz/parse.ts";
import { busquedaSchema, propiedadSchema, sanitizeBusqueda, sanitizeCatalog, sanitizePropiedad } from "../shared/voz.ts";

// Mismo catálogo que src/data/seed.ts (FEATURE_CHIPS y ZONES).
const catalog = {
  zones: ["City Bell", "Gonnet", "La Plata Centro", "La Plata Norte", "Tolosa", "Los Hornos", "Ringuelet", "Berisso", "Ensenada"],
  amenities: [
    "Jardín", "Balcón", "Cochera", "Piscina", "Terraza", "Seguridad", "Mascotas", "Parrilla", "Luminoso",
    "Gimnasio", "Solarium", "SUM", "Lavadero", "Aire acondicionado", "Seguridad 24 hs", "Ascensor", "Placards", "Apto profesional",
  ],
};

test("propiedad: departamento en venta, dólares con 'mil'", () => {
  const p = parsePropiedad(
    "Departamento en venta en City Bell, 2 ambientes, 1 dormitorio, 1 baño, 85 mil dólares, 50 metros cubiertos, con balcón",
    catalog,
  );
  assert.equal(p.operation, "venta");
  assert.equal(p.type, "departamento");
  assert.equal(p.zone, "City Bell");
  assert.equal(p.rooms, 2);
  assert.equal(p.bedrooms, 1);
  assert.equal(p.bathrooms, 1);
  assert.equal(p.price, 85000);
  assert.equal(p.currency, "USD");
  assert.equal(p.surface_covered, 50);
  assert.deepEqual(p.features, ["Balcón"]);
  assert.equal(p.title, "Departamento 2 ambientes en City Bell con balcón");
  assert.ok(p.description?.includes("City Bell"));
});

test("propiedad: USD 85.000 y palabras como números", () => {
  const p = parsePropiedad("Vendo casa de tres dormitorios y dos baños en Gonnet, USD 85.000, con pileta y parrilla", catalog);
  assert.equal(p.type, "casa");
  assert.equal(p.bedrooms, 3);
  assert.equal(p.bathrooms, 2);
  assert.equal(p.zone, "Gonnet");
  assert.equal(p.price, 85000);
  assert.equal(p.currency, "USD");
  assert.deepEqual(p.features, ["Piscina", "Parrilla"]);
});

test("propiedad: alquiler en pesos, expensas aparte", () => {
  const p = parsePropiedad("PH en alquiler en Tolosa, 120 mil pesos por mes, expensas 30 mil, 80 metros, 2 ambientes", catalog);
  assert.equal(p.operation, "alquiler");
  assert.equal(p.type, "ph");
  assert.equal(p.price, 120000);
  assert.equal(p.currency, "ARS");
  assert.equal(p.expenses, 30000);
  assert.equal(p.expenses_currency, "ARS");
  assert.equal(p.surface_covered, 80);
  assert.equal(p.surface_total, null);
  assert.equal(p.rooms, 2);
});

test("propiedad: expensas antes del precio", () => {
  const p = parsePropiedad("Depto en La Plata Centro, expensas 45.000 pesos, precio 110 mil dólares", catalog);
  assert.equal(p.zone, "La Plata Centro");
  assert.equal(p.expenses, 45000);
  assert.equal(p.price, 110000);
  assert.equal(p.currency, "USD");
});

test("propiedad: superficies, cochera, antigüedad, crédito, permuta y negaciones", () => {
  const p = parsePropiedad(
    "Casa en venta en Los Hornos, 300 metros de terreno y 140 metros cubiertos, 2 cocheras, sin pileta, a estrenar, apta crédito, acepta permuta",
    catalog,
  );
  assert.equal(p.surface_total, 300);
  assert.equal(p.surface_covered, 140);
  assert.equal(p.garages, 2);
  assert.equal(p.age_years, 0);
  assert.equal(p.credit_eligible, true);
  assert.equal(p.accepts_swap, true);
  assert.ok(!p.features.includes("Piscina"));
  assert.ok(p.features.includes("Cochera"));
});

test("propiedad: 'con cochera' sin número cuenta 1; antigüedad en años", () => {
  const p = parsePropiedad("Departamento con cochera, 15 años de antigüedad, no apto crédito", catalog);
  assert.equal(p.garages, 1);
  assert.equal(p.age_years, 15);
  assert.equal(p.credit_eligible, false);
});

test("propiedad: monoambiente, piso y dirección", () => {
  const p = parsePropiedad("Monoambiente en alquiler, calle 7 número 1234, piso 3, 30 m2", catalog);
  assert.equal(p.type, "departamento");
  assert.equal(p.subtype, "Monoambiente");
  assert.equal(p.rooms, 1);
  assert.equal(p.street, "Calle 7");
  assert.equal(p.street_number, "1234");
  assert.equal(p.floor, "3");
  assert.equal(p.surface_covered, 30);
});

test("propiedad: zona fuera de catálogo va a notas, no al campo", () => {
  const p = parsePropiedad("Casa en venta en Palermo, 200 mil dólares", catalog);
  assert.equal(p.zone, null);
  assert.ok(p.notes.some((n) => n.includes("Palermo")));
});

test("propiedad: alquiler temporario y millones de pesos", () => {
  const p = parsePropiedad("Casa en alquiler temporario en Berisso, 1,5 millones de pesos", catalog);
  assert.equal(p.operation, "alquiler_temporal");
  assert.equal(p.price, 1500000);
  assert.equal(p.currency, "ARS");
});

test("propiedad: números sueltos que no son plata no se toman como precio", () => {
  const p = parsePropiedad("Departamento de 3 ambientes, 2 baños, 70 metros, teléfono 221 555 1234", catalog);
  assert.equal(p.price, null);
});

test("búsqueda: rango 'entre 80 y 100 mil dólares'", () => {
  const b = parseBusqueda("Busca comprar un departamento o PH en Gonnet o City Bell, entre 80 y 100 mil dólares, mínimo 2 dormitorios", catalog);
  assert.equal(b.operation, "venta");
  assert.deepEqual(b.property_types, ["departamento", "ph"]);
  assert.deepEqual(b.zones, ["Gonnet", "City Bell"]);
  assert.equal(b.budget_min, 80000);
  assert.equal(b.budget_max, 100000);
  assert.equal(b.currency, "USD");
  assert.equal(b.bedrooms_min, 2);
});

test("búsqueda: 'hasta', plazo, amenities, nombre y teléfono", () => {
  const b = parseBusqueda(
    "Cliente Martín Rodríguez, teléfono 221 444 5566, quiere alquilar una casa con jardín y cochera en Tolosa, hasta 600 mil pesos, para marzo",
    catalog,
  );
  assert.equal(b.contact_name, "Martín Rodríguez");
  assert.equal(b.contact_phone, "221 444 5566");
  assert.equal(b.operation, "alquiler");
  assert.deepEqual(b.property_types, ["casa"]);
  assert.deepEqual(b.zones, ["Tolosa"]);
  assert.equal(b.budget_max, 600000);
  assert.equal(b.budget_min, null);
  assert.equal(b.currency, "ARS");
  assert.deepEqual(b.features, ["Jardín", "Cochera"]);
  assert.equal(b.timeframe, "para marzo");
});

test("búsqueda: 'desde', ambientes y metros mínimos, urgente", () => {
  const b = parseBusqueda("Busca depto de 3 ambientes, 60 metros, desde 90 mil dólares, es urgente", catalog);
  assert.equal(b.rooms_min, 3);
  assert.equal(b.surface_min, 60);
  assert.equal(b.budget_min, 90000);
  assert.equal(b.budget_max, null);
  assert.equal(b.timeframe, "urgente");
});

test("búsqueda: La Plata Norte no se confunde con otra zona", () => {
  const b = parseBusqueda("Busca casa en La Plata Norte", catalog);
  assert.deepEqual(b.zones, ["La Plata Norte"]);
});

test("saneamiento: nada fuera de catálogo, enums válidos, rango ordenado", () => {
  const p = sanitizePropiedad(
    { operation: "permuta", type: "casa", zone: "palermo", features: ["Pileta climatizada", "balcón"], price: "85000", rooms: -1, notes: ["x"] },
    catalog,
  );
  assert.equal(p.operation, null);
  assert.equal(p.type, "casa");
  assert.equal(p.zone, null);
  assert.deepEqual(p.features, ["Balcón"]);
  assert.equal(p.price, 85000);
  assert.equal(p.rooms, null);
  assert.ok(p.notes.includes("Amenity: Pileta climatizada"));
  assert.ok(p.notes.some((n) => n.includes("palermo")));

  const b = sanitizeBusqueda({ zones: ["gonnet", "Palermo"], budget_min: 100, budget_max: 50, property_types: ["casa", "castillo"] }, catalog);
  assert.deepEqual(b.zones, ["Gonnet"]);
  assert.deepEqual(b.property_types, ["casa"]);
  assert.equal(b.budget_min, 50);
  assert.equal(b.budget_max, 100);
});

test("esquemas: todos los objetos cerrados y con todo requerido (structured outputs)", () => {
  for (const s of [propiedadSchema(catalog), busquedaSchema(catalog)] as Record<string, unknown>[]) {
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(s.required, Object.keys(s.properties as object));
    assert.ok(!JSON.stringify(s).includes("minimum"));
  }
  const c = sanitizeCatalog({ zones: ["A", "A", 3, ""], amenities: "x" });
  assert.deepEqual(c, { zones: ["A"], amenities: [] });
});

test("amenities: 'seguridad 24 horas' no suma también 'Seguridad'; orden de mención", () => {
  const p = parsePropiedad("Departamento con ascensor, seguridad 24 horas, sum y gimnasio", catalog);
  assert.deepEqual(p.features, ["Ascensor", "Seguridad 24 hs", "SUM", "Gimnasio"]);
});

test("búsqueda: zona fuera de catálogo en una lista ('Gonnet o Palermo') va a notas", () => {
  const b = parseBusqueda("Busca casa en Gonnet o Palermo, hasta 150 mil dólares", catalog);
  assert.deepEqual(b.zones, ["Gonnet"]);
  assert.ok(b.notes.some((n) => n.includes("Palermo")));
});
