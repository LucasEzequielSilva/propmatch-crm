/**
 * Google Calendar (link .ics y sincronización directa): piezas puras, sin red.
 * Correr con: npm run test:gcal   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildIcsCalendar, icsText } from "../shared/ics.ts";
import {
  FEED_MAX_ITEMS,
  eventIsSyncable,
  eventToItem,
  feedIcsEvents,
  feedTokenFromFile,
  feedUid,
  inFeedWindow,
  isFeedToken,
  parseFeedBody,
  taskIsSyncable,
  taskToItem,
  visitIsSyncable,
  type CrmEventLike,
  type CrmTaskLike,
  type GcalItem,
} from "../shared/gcal.ts";
import { hashFeedToken, newFeedToken } from "../api/_lib/gcal/feedToken.ts";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const USER = "user-1";

const ev = (o: Partial<CrmEventLike> = {}): CrmEventLike => ({
  id: "e-1",
  type: "visita",
  title: "Visita — Martín",
  owner_id: USER,
  starts_at: "2026-10-10T13:00:00.000Z",
  ends_at: "2026-10-10T14:00:00.000Z",
  status: "confirmada",
  created_at: "2026-10-01T10:00:00.000Z",
  ...o,
});

const task = (o: Partial<CrmTaskLike> = {}): CrmTaskLike => ({
  id: "t-1",
  text: "Llamar a Mirta",
  owner_id: USER,
  due_date: "2026-10-12",
  is_done: false,
  created_at: "2026-10-01T10:00:00.000Z",
  ...o,
});

const unfold = (s: string) => s.split("\r\n ").join("");

const ctx = { contactName: "Martín Rodríguez", propertyTitle: "Casa en City Bell", address: "Calle 13 450, City Bell" };

/* ── Token del link ───────────────────────────────────────────────────── */

test("token: 32 bytes en base64url (43 caracteres), distinto cada vez", () => {
  const a = newFeedToken();
  const b = newFeedToken();
  assert.equal(a.length, 43);
  assert.ok(isFeedToken(a));
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32);
});

test("token: en la base solo va el sha256 (hex) y es determinístico", () => {
  const t = newFeedToken();
  const h = hashFeedToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, createHash("sha256").update(t).digest("hex"));
  assert.equal(hashFeedToken(t), h);
  assert.notEqual(hashFeedToken(newFeedToken()), h);
});

test("token: el path público solo acepta <token>.ics", () => {
  const t = newFeedToken();
  assert.equal(feedTokenFromFile(`${t}.ics`), t);
  assert.equal(feedTokenFromFile([`${t}.ics`]), t);
  assert.equal(feedTokenFromFile(t), null);
  assert.equal(feedTokenFromFile(`${t}.ics.php`), null);
  assert.equal(feedTokenFromFile(`../${t}.ics`), null);
  assert.equal(feedTokenFromFile("corto.ics"), null);
  assert.equal(feedTokenFromFile(undefined), null);
});

/* ── Qué va al calendario ─────────────────────────────────────────────── */

test("filtrado: solo lo del agente (o sin asignar), sin ejemplos ni cancelados", () => {
  assert.ok(eventIsSyncable(ev(), USER));
  assert.ok(eventIsSyncable(ev({ owner_id: null }), USER));
  assert.ok(!eventIsSyncable(ev({ owner_id: "otro" }), USER));
  assert.ok(!eventIsSyncable(ev({ is_sample: true }), USER));
  assert.ok(!eventIsSyncable(ev({ status: "cancelada" }), USER));
  assert.ok(!eventIsSyncable(ev({ ends_at: "2026-10-10T12:00:00.000Z" }), USER), "fin antes del inicio");
  assert.ok(taskIsSyncable(task(), USER));
  assert.ok(!taskIsSyncable(task({ due_date: null }), USER));
  assert.ok(!taskIsSyncable(task({ is_done: true }), USER));
  assert.ok(!taskIsSyncable(task({ is_sample: true }), USER));
  assert.ok(!taskIsSyncable(task({ owner_id: "otro" }), USER));
  const v = { id: "v1", title: "Visita", start: new Date(NOW), end: new Date(NOW.getTime() + 1800_000), ownerId: USER, statusLabel: null, cancelled: false };
  assert.ok(visitIsSyncable(v, USER));
  assert.ok(!visitIsSyncable({ ...v, ownerId: null }, USER), "visitas de la app sin asesor: no van al Google de todos");
  assert.ok(!visitIsSyncable({ ...v, cancelled: true }, USER));
});

test("filtrado: el ítem lleva lo mínimo (nada de notas, precios ni ids de la base)", () => {
  const withSecrets = { ...ev(), notes: "Precio mínimo 150.000 USD", price: 185000, contact_id: "c-1", property_id: "p-1" } as CrmEventLike;
  const item = eventToItem(withSecrets, ctx);
  assert.deepEqual(Object.keys(item).sort(), ["allDay", "contactName", "end", "location", "propertyTitle", "propmatchId", "start", "title", "typeLabel"]);
  assert.equal(item.typeLabel, "Visita · Confirmada");
  assert.ok(!JSON.stringify(item).includes("150.000"));
  // Y el servidor descarta campos de más aunque el navegador los mande.
  const parsed = parseFeedBody({ items: [{ ...item, notes: "secreto", price: 1 }] }, NOW)!;
  assert.equal(parsed.length, 1);
  assert.ok(!("notes" in parsed[0]) && !("price" in parsed[0]));
});

test("filtrado: tarea con fecha → evento de día completo", () => {
  const item = taskToItem(task(), { contactName: null, propertyTitle: null, address: null });
  assert.equal(item.allDay, true);
  assert.equal(item.start, "2026-10-12");
  assert.equal(item.end, "2026-10-13");
  assert.equal(item.title, "Tarea: Llamar a Mirta");
});

test("ventana: 30 días atrás a 6 meses adelante", () => {
  const at = (days: number): GcalItem => {
    const s = new Date(NOW.getTime() + days * 86_400_000);
    return { propmatchId: `event:d${days < 0 ? "m" : ""}${Math.abs(days)}`, title: "x", allDay: false, start: s.toISOString(), end: new Date(s.getTime() + 3600_000).toISOString(), typeLabel: null, contactName: null, propertyTitle: null, location: null };
  };
  assert.ok(inFeedWindow(at(-29), NOW));
  assert.ok(!inFeedWindow(at(-31), NOW));
  assert.ok(inFeedWindow(at(180), NOW));
  assert.ok(!inFeedWindow(at(190), NOW));
  const parsed = parseFeedBody({ items: [at(-60), at(1), at(400)] }, NOW)!;
  assert.deepEqual(parsed.map((i) => i.propmatchId), ["event:d1"]);
});

test("push: valida, deduplica y corta lo roto; más del tope → null", () => {
  const ok = eventToItem(ev(), ctx);
  const parsed = parseFeedBody({ items: [ok, ok, { ...ok, propmatchId: "event:x", start: "no-es-fecha" }, { ...ok, propmatchId: "otro:1" }, null] }, NOW)!;
  assert.equal(parsed.length, 1);
  assert.equal(parseFeedBody({ items: "x" }, NOW), null);
  assert.equal(parseFeedBody({ items: Array.from({ length: FEED_MAX_ITEMS + 1 }, () => ok) }, NOW), null);
  const long = parseFeedBody({ items: [{ ...ok, title: "a".repeat(500), location: "b\r\nc" }] }, NOW)!;
  assert.equal(long[0].title.length, 200);
  assert.equal(long[0].location, "b c", "sin saltos de línea ni caracteres de control");
});

/* ── Armado del .ics ──────────────────────────────────────────────────── */

test("ics: UID estable por ítem (mismo evento → mismo UID)", () => {
  const a = feedIcsEvents([eventToItem(ev(), ctx)], "https://crm.example/");
  const b = feedIcsEvents([eventToItem(ev({ title: "Otro título", starts_at: "2026-10-11T13:00:00.000Z", ends_at: "2026-10-11T14:00:00.000Z" }), ctx)], "https://crm.example");
  assert.equal(a[0].uid, "pm-event-e-1");
  assert.equal(a[0].uid, b[0].uid);
  assert.equal(feedUid("task:t-9"), "pm-task-t-9");
  const ics = buildIcsCalendar(a, { stampIso: NOW.toISOString(), name: "PropMatch — Mi agenda", refreshMinutes: 60 });
  assert.match(ics, /UID:pm-event-e-1@propmatch\r\n/);
  assert.match(ics, /X-WR-CALNAME:PropMatch — Mi agenda\r\n/);
  assert.match(ics, /REFRESH-INTERVAL;VALUE=DURATION:PT60M\r\n/);
  assert.match(ics, /DTSTART:20261010T130000Z\r\n/);
  assert.match(ics, /DTEND:20261010T140000Z\r\n/);
  assert.ok(unfold(ics).includes("Ver en PropMatch: https://crm.example/agenda"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
});

test("ics: escapes RFC 5545 y líneas plegadas", () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const item = eventToItem(ev({ title: "Visita, depto; 3° \\ amb" }), { ...ctx, address: "Calle 7, 1220; La Plata" });
  const ics = buildIcsCalendar(feedIcsEvents([item], "https://crm.example"), { stampIso: NOW.toISOString() });
  assert.ok(unfold(ics).includes("SUMMARY:Visita\\, depto\\; 3° \\\\ amb"));
  assert.ok(unfold(ics).includes("LOCATION:Calle 7\\, 1220\\; La Plata"));
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `línea larga: ${line}`);
});

test("ics: tareas de día completo con VALUE=DATE y fin exclusivo", () => {
  const ics = buildIcsCalendar(feedIcsEvents([taskToItem(task(), { contactName: null, propertyTitle: null, address: null })], "https://x"), {
    stampIso: NOW.toISOString(),
  });
  assert.match(ics, /DTSTART;VALUE=DATE:20261012\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261013\r\n/);
  assert.match(ics, /TRANSP:TRANSPARENT\r\n/);
});
