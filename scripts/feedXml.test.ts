/**
 * Feed XML: parser y plan de sincronización, sin red.
 * Correr con: npm run test:feed
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedPlan, checkFeedUrl, feedPropertyId, parseFeedXml } from "../shared/feedXml.ts";

const NAVENT = `<?xml version="1.0"?>
<OpenNavent>
  <Avisos>
    <Aviso>
      <codigoAviso>NAV-1</codigoAviso>
      <titulo>Casa en Nordelta</titulo>
      <descripcion>Con jardín</descripcion>
      <tipoDePropiedad>Casa</tipoDePropiedad>
      <tipoDeOperacion>Alquiler</tipoDeOperacion>
      <precio>850.000</precio>
      <moneda>ARS</moneda>
      <direccion>Los Sauces 100</direccion>
      <localidad>Nordelta</localidad>
      <provincia>Buenos Aires</provincia>
      <superficieTotal>200</superficieTotal>
      <superficieCubierta>150</superficieCubierta>
      <dormitorios>3</dormitorios>
      <banos>2</banos>
      <fotos>
        <foto>https://cdn.example.com/b.jpg</foto>
        <foto>http://insecure.example.com/no.jpg</foto>
      </fotos>
      <url>https://www.zonaprop.com.ar/aviso-1</url>
    </Aviso>
    <Aviso>
      <codigoAviso>NAV-1</codigoAviso>
      <titulo>Casa en Nordelta actualizada</titulo>
      <tipoDePropiedad>Casa</tipoDePropiedad>
      <tipoDeOperacion>Alquiler</tipoDeOperacion>
    </Aviso>
  </Avisos>
</OpenNavent>`;

const TOKKO = `<?xml version="1.0"?>
<ads>
  <ad>
    <id>99</id>
    <title>Departamento en Palermo</title>
    <description>Luminoso &amp; amplio</description>
    <operation_type>Venta</operation_type>
    <property_type>Departamento</property_type>
    <address>Guatemala 5000</address>
    <neighborhood>Palermo</neighborhood>
    <price><price>180000</price><currency>USD</currency></price>
    <total_surface>70</total_surface>
    <roofed_surface>60</roofed_surface>
    <room_amount>3</room_amount>
    <suite_amount>2</suite_amount>
    <bathroom_amount>1</bathroom_amount>
    <parking_lot_amount>1</parking_lot_amount>
    <photos><photo><url>https://cdn.example.com/a.jpg</url></photo></photos>
  </ad>
</ads>`;

test("rechaza URL que no sea https público", () => {
  assert.equal(checkFeedUrl("http://ejemplo.com/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://user:pass@ejemplo.com/a").ok, false);
  assert.equal(checkFeedUrl("https://127.0.0.1/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://10.0.0.8/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://localhost/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://[::1]/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://[::ffff:127.0.0.1]/feed.xml").ok, false);
  assert.equal(checkFeedUrl("https://[::ffff:8.8.8.8]/feed.xml").ok, true);
  const ok = checkFeedUrl("https://feeds.ejemplo.com/inmob/avisos.xml?token=abc");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.url.hostname, "feeds.ejemplo.com");
});

test("lee un aviso Navent y se queda con la última copia del mismo código", () => {
  const r = parseFeedXml(NAVENT);
  assert.equal(r.error, null);
  assert.equal(r.listings.length, 1);
  const a = r.listings[0];
  assert.equal(a.externalId, "NAV-1");
  assert.equal(a.title, "Casa en Nordelta actualizada");
  assert.equal(a.operation, "alquiler");
  // La copia que gana no trae moneda ni precio: alquiler asume ARS y no hereda la anterior.
  assert.equal(a.currency, "ARS");
  assert.equal(a.currencyAssumed, true);
  assert.equal(a.price, null);
  assert.deepEqual(a.photos, []);
});

test("lee un anuncio tipo Tokko: precio anidado, dirección, fotos https y texto escapado", () => {
  const r = parseFeedXml(TOKKO);
  assert.equal(r.error, null);
  assert.equal(r.listings.length, 1);
  const a = r.listings[0];
  assert.equal(a.externalId, "99");
  assert.equal(a.type, "departamento");
  assert.equal(a.operation, "venta");
  assert.equal(a.price, 180000);
  assert.equal(a.currency, "USD");
  assert.equal(a.street, "Guatemala");
  assert.equal(a.street_number, "5000");
  assert.equal(a.locality, "Palermo");
  assert.equal(a.rooms, 3);
  assert.equal(a.bedrooms, 2);
  assert.equal(a.bathrooms, 1);
  assert.equal(a.garages, 1);
  assert.equal(a.surface_total, 70);
  assert.equal(a.surface_covered, 60);
  assert.equal(a.description, "Luminoso & amplio");
  assert.deepEqual(a.photos, ["https://cdn.example.com/a.jpg"]);
});

test("no abre un DOCTYPE y no inventa avisos vacíos", () => {
  const bad = parseFeedXml(`<!DOCTYPE foo [<!ENTITY x "y">]><ads><ad><id>&x;</id></ad></ads>`);
  assert.ok(bad.error);
  assert.equal(bad.listings.length, 0);
  const empty = parseFeedXml("<ads></ads>");
  assert.ok(empty.error);
  assert.equal(empty.listings.length, 0);
});

test("plan: crea, no reescribe si no cambió, pausa lo que falta y no pisa una reserva", () => {
  const parsed = parseFeedXml(TOKKO);
  const now = "2026-11-25T12:00:00.000Z";
  const first = buildFeedPlan(parsed.listings, [], {}, now, "agency-1", true);
  assert.equal(first.created, 1);
  assert.equal(first.items[0].kind, "property");
  assert.equal(first.items[0].id, feedPropertyId("99"));
  assert.equal(first.items[1].kind, "photos");
  const created = first.items[0].data;
  assert.equal(created.owner_contact_id, null);
  assert.equal(created.feed_managed, true);

  const owned = [{
    id: first.items[0].id,
    externalId: "99",
    hash: parsed.listings[0].hash,
    locked: false,
    data: { ...created, status: "reservada", owner_contact_id: "c1" },
  }];
  const same = buildFeedPlan(parsed.listings, owned, { [owned[0].id]: ["https://cdn.example.com/a.jpg"] }, now, "agency-1", true);
  assert.equal(same.unchanged, 1);
  assert.equal(same.items.length, 0);

  const changedListing = { ...parsed.listings[0], price: 190000, hash: "otro" };
  const updated = buildFeedPlan([changedListing], owned, { [owned[0].id]: ["https://cdn.example.com/a.jpg"] }, now, "agency-1", true);
  assert.equal(updated.updated, 1);
  assert.equal(updated.items[0].data.status, "reservada");
  assert.equal(updated.items[0].data.owner_contact_id, "c1");
  assert.equal(updated.items[0].data.price, 190000);

  const gone = buildFeedPlan([], owned, {}, now, "agency-1", true);
  assert.equal(gone.paused, 0, "un feed vacío no se aplica: el parser no llama al plan");

  const other = parseFeedXml(NAVENT).listings;
  const paused = buildFeedPlan(other, owned, {}, now, "agency-1", true);
  assert.equal(paused.paused, 1);
  assert.equal(paused.items.find((i) => i.id === owned[0].id)?.data.status, "pausada");
  assert.equal(paused.items.find((i) => i.id === owned[0].id)?.data.owner_contact_id, "c1");

  const locked = buildFeedPlan(other, [{ ...owned[0], locked: true }], {}, now, "agency-1", true);
  assert.equal(locked.locked, 1);
  assert.equal(locked.paused, 0);

  const truncated = buildFeedPlan(other, owned, {}, now, "agency-1", false);
  assert.equal(truncated.paused, 0);
});
