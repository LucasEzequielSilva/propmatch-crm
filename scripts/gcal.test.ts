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
  GCAL_SCOPES,
  buildGcalReturnUrl,
  buildGoogleEvent,
  busyFromItems,
  changesFromItems,
  crmPatchFromTimes,
  decidePullAction,
  detectConflict,
  emailFromIdToken,
  googleEventIdFromDigest,
  googleWins,
  grantedCalendarScope,
  isGoogleEventId,
  itemHash,
  parseDeleteBody,
  parseGoogleEvent,
  parsePullBody,
  parseUpsertBody,
  planReconcile,
  timesOf,
  type DesiredItem,
  type GcalChange,
  type LedgerEntry,
  type LocalForPull,
} from "../shared/gcal.ts";
import { hashFeedToken, newFeedToken } from "../api/_lib/gcal/feedToken.ts";
import { buildAuthUrl, checkCallback, parseOauthCookie } from "../api/_lib/gcal/oauth.ts";
import { challengeS256, newVerifier } from "../api/_lib/pkce.ts";

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

/* ══ Opción A: conexión directa ══════════════════════════════════════════ */

const digest = (s: string) => createHash("sha256").update(s).digest();

test("idempotencia: id de Google determinístico y válido (a–v, 0–9)", () => {
  const a = googleEventIdFromDigest(digest(`${USER}:event:e-1`));
  const b = googleEventIdFromDigest(digest(`${USER}:event:e-1`));
  const c = googleEventIdFromDigest(digest(`${USER}:event:e-2`));
  const d = googleEventIdFromDigest(digest(`otro:event:e-1`));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d, "otro agente → otro id");
  assert.ok(isGoogleEventId(a));
  assert.match(a, /^pm[a-v0-9]{32}$/);
});

test("idempotencia: con el ledger al día el plan sale vacío; un cambio manda solo ese", () => {
  const item = eventToItem(ev(), ctx);
  const tItem = taskToItem(task(), { contactName: null, propertyTitle: null, address: null });
  const desired = new Map<string, DesiredItem>([
    [item.propmatchId, { item, crmUpdatedAt: "2026-10-01T10:00:00.000Z" }],
    [tItem.propmatchId, { item: tItem, crmUpdatedAt: "2026-10-01T10:00:00.000Z" }],
  ]);
  const first = planReconcile(desired, {}, NOW, { visitsKnown: true });
  assert.equal(first.upserts.length, 2);
  assert.equal(first.upserts[0].known, null, "nunca mandado → sin horario conocido");
  const ledger: Record<string, LedgerEntry> = {};
  for (const u of first.upserts) ledger[u.propmatchId] = { gid: "pmabc", hash: itemHash(u), times: { allDay: u.allDay, start: u.start, end: u.end } };
  const again = planReconcile(desired, ledger, NOW, { visitsKnown: true });
  assert.deepEqual(again, { upserts: [], deletes: [], drop: [] });

  const moved = eventToItem(ev({ starts_at: "2026-10-10T15:00:00.000Z", ends_at: "2026-10-10T16:00:00.000Z" }), ctx);
  desired.set(moved.propmatchId, { item: moved, crmUpdatedAt: "2026-10-08T11:00:00.000Z" });
  const p = planReconcile(desired, ledger, NOW, { visitsKnown: true });
  assert.equal(p.upserts.length, 1);
  assert.deepEqual(p.upserts[0].known, ledger[moved.propmatchId].times, "manda lo último que conoce Google");
});

test("idempotencia: borrados, visitas sin cargar y ventana de lo nuevo", () => {
  const ledger: Record<string, LedgerEntry> = {
    "event:gone": { gid: "pm1", hash: "x", times: { allDay: false, start: NOW.toISOString(), end: NOW.toISOString() } },
    "visit:v1": { gid: "pm2", hash: "x", times: { allDay: false, start: NOW.toISOString(), end: NOW.toISOString() } },
    "task:dismissed": { gid: null, hash: "x", times: { allDay: true, start: "2026-10-09", end: "2026-10-10" } },
  };
  const p = planReconcile(new Map(), ledger, NOW, { visitsKnown: false });
  assert.deepEqual(p.deletes, ["event:gone"], "las visitas no se borran si esta pestaña no las cargó");
  assert.deepEqual(p.drop, ["task:dismissed"]);
  assert.deepEqual(planReconcile(new Map(), ledger, NOW, { visitsKnown: true }).deletes.sort(), ["event:gone", "visit:v1"]);
  const old = eventToItem(ev({ id: "viejo", starts_at: "2026-08-01T13:00:00.000Z", ends_at: "2026-08-01T14:00:00.000Z" }), ctx);
  const plan = planReconcile(new Map([[old.propmatchId, { item: old, crmUpdatedAt: NOW.toISOString() }]]), {}, NOW, { visitsKnown: true });
  assert.equal(plan.upserts.length, 0, "al conectar no se sube todo el historial");
});

test("mapeo CRM → Google: título, horario, dirección, cliente, link y propmatchId", () => {
  const item = eventToItem(ev(), ctx);
  const g = buildGoogleEvent(item, { googleEventId: "pmabc12", appUrl: "https://propmatch-crm-taupe.vercel.app/" });
  assert.equal(g.id, "pmabc12");
  assert.equal(g.summary, "Visita — Martín");
  assert.deepEqual(g.start, { dateTime: "2026-10-10T13:00:00.000Z" });
  assert.deepEqual(g.end, { dateTime: "2026-10-10T14:00:00.000Z" });
  assert.equal(g.location, "Calle 13 450, City Bell");
  assert.deepEqual(g.extendedProperties.private, { propmatchId: "event:e-1", propmatchKind: "event" });
  assert.equal(g.source.url, "https://propmatch-crm-taupe.vercel.app/agenda");
  assert.ok(g.description.includes("Cliente: Martín Rodríguez"));
  assert.ok(g.description.includes("Visita · Confirmada"));
  assert.equal(g.transparency, "opaque");
  const t = buildGoogleEvent(taskToItem(task(), { contactName: null, propertyTitle: null, address: null }), { googleEventId: "pmt0001", appUrl: "https://x" });
  assert.deepEqual(t.start, { date: "2026-10-12" });
  assert.deepEqual(t.end, { date: "2026-10-13" });
  assert.equal(t.transparency, "transparent");
  assert.ok(!("location" in t));
});

test("mapeo Google → CRM: horario, día completo y vuelta a campos del CRM", () => {
  const g = parseGoogleEvent({
    id: "pmabc",
    status: "confirmed",
    updated: "2026-10-08T10:00:00.000Z",
    summary: "Visita",
    start: { dateTime: "2026-10-10T12:00:00-03:00" },
    end: { dateTime: "2026-10-10T13:30:00-03:00" },
    extendedProperties: { private: { propmatchId: "event:e-1" } },
  })!;
  assert.equal(g.propmatchId, "event:e-1");
  assert.deepEqual(timesOf(g), { allDay: false, start: "2026-10-10T15:00:00.000Z", end: "2026-10-10T16:30:00.000Z" });
  assert.deepEqual(crmPatchFromTimes("event", timesOf(g)!), { starts_at: "2026-10-10T15:00:00.000Z", ends_at: "2026-10-10T16:30:00.000Z" });
  assert.deepEqual(crmPatchFromTimes("task", { allDay: true, start: "2026-10-14", end: "2026-10-15" }), { due_date: "2026-10-14" });
  assert.equal(crmPatchFromTimes("event", { allDay: true, start: "2026-10-14", end: "2026-10-15" }), null, "un evento pasado a «todo el día» no pierde su horario");
  assert.equal(parseGoogleEvent({ id: "x", extendedProperties: { private: { propmatchId: "hack:1" } } })!.propmatchId, null);
});

test("parse del pull incremental: cambios de PropMatch, borrados y «Ocupado»", () => {
  const items = [
    { id: "pm1", status: "confirmed", updated: "2026-10-08T10:00:00Z", start: { dateTime: "2026-10-10T13:00:00Z" }, end: { dateTime: "2026-10-10T14:00:00Z" }, extendedProperties: { private: { propmatchId: "event:e-1" } } },
    { id: "pm2", status: "cancelled" },
    { id: "ajeno", status: "confirmed", summary: "Dentista", start: { dateTime: "2026-10-10T16:00:00Z" }, end: { dateTime: "2026-10-10T17:00:00Z" } },
    { id: "libre", status: "confirmed", summary: "Recordatorio", transparency: "transparent", start: { dateTime: "2026-10-10T16:00:00Z" }, end: { dateTime: "2026-10-10T17:00:00Z" } },
    { id: "rechazado", status: "confirmed", summary: "Reunión", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2026-10-10T18:00:00Z" }, end: { dateTime: "2026-10-10T19:00:00Z" } },
    { id: "feriado", status: "confirmed", summary: "Feriado", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
    { nada: true },
  ];
  const changes = changesFromItems(items);
  assert.deepEqual(changes.map((c) => [c.googleEventId, c.propmatchId, c.cancelled]), [
    ["pm1", "event:e-1", false],
    ["pm2", null, true],
  ]);
  const busy = busyFromItems(items, { titles: false });
  assert.deepEqual(busy.map((b) => [b.id, b.title, b.allDay]), [
    ["ajeno", null, false],
    ["feriado", null, true],
  ]);
  assert.equal(busyFromItems(items, { titles: true })[0].title, "Dentista");
});

test("parse del pedido de pull: tokens y ventana acotada", () => {
  assert.deepEqual(parsePullBody({}), { syncToken: null, pageToken: null, busy: null, titles: false });
  assert.equal(parsePullBody({ syncToken: "abc def" }), null);
  assert.equal(parsePullBody({ busy: { timeMin: "2026-10-01T00:00:00Z", timeMax: "2027-10-01T00:00:00Z" } }), null, "más de 70 días");
  const ok = parsePullBody({ syncToken: "CPDAlvWDx70CEPDAlvWDx70CGAU=", busy: { timeMin: "2026-10-01T00:00:00Z", timeMax: "2026-10-31T00:00:00Z" }, titles: true })!;
  assert.equal(ok.titles, true);
  assert.equal(ok.busy!.timeMin, "2026-10-01T00:00:00.000Z");
  assert.equal(parseUpsertBody({ items: [] }), null);
  const item = { ...eventToItem(ev(), ctx), crmUpdatedAt: NOW.toISOString(), known: null };
  assert.equal(parseUpsertBody({ items: [item, item] }), null, "ids repetidos");
  assert.equal(parseUpsertBody({ items: [item] })!.length, 1);
  assert.deepEqual(parseDeleteBody({ items: [{ propmatchId: "task:t-1" }, "event:e-1"] }), ["task:t-1", "event:e-1"]);
  assert.equal(parseDeleteBody({ items: ["../etc"] }), null);
});

test("conflicto: gana el último cambio", () => {
  assert.ok(googleWins("2026-10-08T10:00:01Z", "2026-10-08T10:00:00Z"));
  assert.ok(!googleWins("2026-10-08T10:00:00Z", "2026-10-08T10:00:00Z"), "empate → CRM");
  assert.ok(!googleWins(null, "2026-10-08T10:00:00Z"));
  const known = { allDay: false, start: "2026-10-10T13:00:00.000Z", end: "2026-10-10T14:00:00.000Z" };
  const google = (o: Record<string, unknown>) => parseGoogleEvent({ id: "pm1", status: "confirmed", start: { dateTime: known.start }, end: { dateTime: known.end }, ...o })!;
  // Google sin cambios: se pisa.
  assert.equal(detectConflict({ google: google({ updated: "2026-10-09T00:00:00Z" }), known, crmUpdatedAt: "2026-10-08T00:00:00Z" }), "none");
  // Lo movieron en Google DESPUÉS del cambio en el CRM: gana Google.
  const moved = google({ updated: "2026-10-09T00:00:00Z", start: { dateTime: "2026-10-10T15:00:00Z" }, end: { dateTime: "2026-10-10T16:00:00Z" } });
  assert.equal(detectConflict({ google: moved, known, crmUpdatedAt: "2026-10-08T00:00:00Z" }), "google_changed");
  // …y si el CRM cambió después, gana el CRM.
  assert.equal(detectConflict({ google: moved, known, crmUpdatedAt: "2026-10-09T00:00:01Z" }), "none");
  assert.equal(detectConflict({ google: google({ status: "cancelled", updated: "2026-10-09T00:00:00Z" }), known, crmUpdatedAt: "2026-10-08T00:00:00Z" }), "google_deleted");
  assert.equal(detectConflict({ google: null, known, crmUpdatedAt: NOW.toISOString() }), "none", "no existe → se crea");
  assert.equal(detectConflict({ google: moved, known: null, crmUpdatedAt: "2026-10-01T00:00:00Z" }), "none", "nunca lo mandamos → se pisa");
});

test("conflicto en el pull: eco propio, Google gana, CRM gana, visitas de la app y borrados", () => {
  const pushed = { allDay: false, start: "2026-10-10T13:00:00.000Z", end: "2026-10-10T14:00:00.000Z" };
  const later = { allDay: false, start: "2026-10-10T15:00:00.000Z", end: "2026-10-10T16:00:00.000Z" };
  const base: LocalForPull = { exists: true, kind: "event", times: pushed, crmUpdatedAt: "2026-10-08T09:00:00Z", pushed: { times: pushed, hash: "h1" }, currentHash: "h1" };
  const ch = (o: Partial<GcalChange>): GcalChange => ({ googleEventId: "pm1", propmatchId: "event:e-1", cancelled: false, times: pushed, updated: "2026-10-08T10:00:00Z", ...o });
  assert.equal(decidePullAction(ch({}), base), "ignore", "eco de nuestro propio push");
  assert.equal(decidePullAction(ch({ times: later }), base), "apply_times");
  assert.equal(decidePullAction(ch({ times: later }), { ...base, currentHash: "h2", crmUpdatedAt: "2026-10-08T11:00:00Z" }), "push", "el CRM cambió después");
  assert.equal(decidePullAction(ch({ times: later }), { ...base, currentHash: "h2", crmUpdatedAt: "2026-10-08T09:30:00Z" }), "apply_times", "Google cambió después");
  assert.equal(decidePullAction(ch({ times: later }), { ...base, kind: "visit" }), "push", "las visitas de la app no se mueven desde Google");
  assert.equal(decidePullAction(ch({ cancelled: true, times: null }), base), "apply_delete");
  assert.equal(decidePullAction(ch({ cancelled: true, times: null }), { ...base, kind: "task" }), "unlink");
  assert.equal(decidePullAction(ch({ times: later }), { ...base, pushed: null }), "ignore", "no lo mandó este navegador");
  assert.equal(decidePullAction(ch({ times: later }), { ...base, exists: false }), "ignore");
});

/* ── state / PKCE ─────────────────────────────────────────────────────── */

test("PKCE: verifier de 86 caracteres y challenge S256 = base64url(sha256(verifier)) sin relleno", () => {
  const v = newVerifier();
  assert.match(v, /^[A-Za-z0-9_-]{86}$/);
  const ch = challengeS256(v);
  assert.equal(ch, createHash("sha256").update(v).digest("base64url"));
  assert.match(ch, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(v.length, 86);
  assert.notEqual(newVerifier(), v);
});

test("OAuth: URL de consentimiento con scope mínimo, offline + consent y PKCE", () => {
  const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://crm.example/api/integrations/gcal-callback", state: "st", challenge: "ch", scopes: GCAL_SCOPES }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/calendar.events");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "st");
  assert.equal(u.searchParams.get("redirect_uri"), "https://crm.example/api/integrations/gcal-callback");
});

test("OAuth: el callback valida state (anti-CSRF), vencimiento y errores", () => {
  const cookie = parseOauthCookie(JSON.stringify({ state: "s".repeat(43), verifier: "v", userId: "u", agencyId: "a", exp: 1000, ret: "integraciones" }))!;
  assert.equal(cookie.ret, "integraciones");
  assert.deepEqual(checkCallback({ code: "c", state: "s".repeat(43) }, cookie, 999), { ok: true, code: "c", cookie });
  assert.deepEqual(checkCallback({ code: "c", state: "x".repeat(43) }, cookie, 999), { ok: false, reason: "state" });
  assert.deepEqual(checkCallback({ code: "c", state: "s".repeat(43) }, cookie, 1001), { ok: false, reason: "expired" });
  assert.deepEqual(checkCallback({ code: "c", state: "s".repeat(43) }, null, 999), { ok: false, reason: "invalid" });
  assert.deepEqual(checkCallback({ error: "access_denied" }, cookie, 999), { ok: false, reason: "denied" });
  assert.deepEqual(checkCallback({ state: "s" }, cookie, 999), { ok: false, reason: "invalid" });
  assert.equal(parseOauthCookie("{nope"), null);
  assert.equal(parseOauthCookie(JSON.stringify({ state: 1 })), null);
});

test("OAuth: la vuelta va solo a rutas propias (sin redirección abierta)", () => {
  assert.equal(buildGcalReturnUrl("https://crm.example/", "agenda"), "https://crm.example/agenda?gcal=ok");
  assert.equal(buildGcalReturnUrl("https://crm.example", "integraciones", "scope"), "https://crm.example/configuracion/integraciones?gcal=error&reason=scope");
  assert.equal(buildGcalReturnUrl("https://crm.example", "https://evil.example"), "https://crm.example/agenda?gcal=ok");
  assert.equal(buildGcalReturnUrl("https://crm.example", "agenda", "<script>"), "https://crm.example/agenda?gcal=error&reason=server");
});

test("OAuth: email del id_token y permiso del calendario", () => {
  const payload = Buffer.from(JSON.stringify({ email: "agente@gmail.com", sub: "123" })).toString("base64url");
  assert.deepEqual(emailFromIdToken(`h.${payload}.s`), { email: "agente@gmail.com", sub: "123" });
  assert.deepEqual(emailFromIdToken("roto"), { email: null, sub: null });
  assert.ok(grantedCalendarScope("openid https://www.googleapis.com/auth/calendar.events email"));
  assert.ok(!grantedCalendarScope("openid email"), "el agente destildó el calendario");
});
