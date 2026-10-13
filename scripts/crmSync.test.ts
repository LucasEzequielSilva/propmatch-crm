/**
 * Datos del CRM en la base propia: piezas puras, sin red.
 * Correr con: npm run test:crm-sync   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PUSH_MAX_ITEMS,
  TOMBSTONE,
  applyRecordsToRows,
  chunkForPush,
  dedupeByAppId,
  knownValue,
  parsePushBody,
  parseSince,
  parseUploadBody,
  pendingChanges,
  recordKey,
  rowsToRecords,
  type CrmRecord,
} from "../shared/crmSync.ts";

/* ── Validación del servidor ─────────────────────────────────────────────── */

test("parsePushBody acepta registros y tumbas, y rechaza lo raro", () => {
  const ok = parsePushBody({ items: [{ kind: "contact", id: "c-1", data: { full_name: "Ana" } }, { kind: "task", id: "t-1", deleted: true }] });
  assert.deepEqual(ok, [
    { kind: "contact", id: "c-1", data: { full_name: "Ana" } },
    { kind: "task", id: "t-1", data: {}, deleted: true },
  ]);
  assert.equal(parsePushBody({ items: [] }), null);
  assert.equal(parsePushBody({ items: [{ kind: "users", id: "x", data: {} }] }), null, "kind desconocido");
  assert.equal(parsePushBody({ items: [{ kind: "contact", id: "con espacios", data: {} }] }), null, "id inválido");
  assert.equal(parsePushBody({ items: [{ kind: "contact", id: "c-1", data: [1] }] }), null, "data no es objeto");
  assert.equal(parsePushBody({ items: [{ kind: "contact", id: "c-1", data: null }] }), null);
  assert.equal(parsePushBody({ items: Array.from({ length: PUSH_MAX_ITEMS + 1 }, (_, i) => ({ kind: "task", id: `t-${i}`, data: {} })) }), null);
  assert.equal(parsePushBody(null), null);
});

test("parseSince: entero o 0", () => {
  assert.equal(parseSince("42"), 42);
  assert.equal(parseSince(["7", "8"]), 7);
  assert.equal(parseSince(undefined), 0);
  assert.equal(parseSince("-1"), 0);
  assert.equal(parseSince("abc"), 0);
});

test("parseUploadBody: solo data URL de imagen, con tope", () => {
  const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const ok = parseUploadBody({ propertyId: "p-1", dataUrl: `data:image/png;base64,${png1x1}` });
  assert.ok(ok);
  assert.equal(ok.ext, "png");
  assert.equal(ok.mime, "image/png");
  assert.ok(ok.bytes.length > 0);
  assert.equal(parseUploadBody({ propertyId: "p-1", dataUrl: "data:text/html;base64,PGI+" }), null);
  assert.equal(parseUploadBody({ propertyId: "p/1", dataUrl: `data:image/png;base64,${png1x1}` }), null);
  assert.equal(parseUploadBody({ propertyId: "p-1", dataUrl: "https://x/y.jpg" }), null);
});

/* ── Diff: qué subir ─────────────────────────────────────────────────────── */

test("rowsToRecords deja afuera los ejemplos y la marca", () => {
  const recs = rowsToRecords("contact", [
    { id: "c-1", full_name: "Ana" },
    { id: "c-2", full_name: "Ejemplo", is_sample: true },
  ]);
  assert.deepEqual(recs, [{ kind: "contact", id: "c-1", data: { id: "c-1", full_name: "Ana" } }]);
});

test("pendingChanges: nuevos, editados y tumbas de lo que desapareció", () => {
  const known = new Map<string, string>([
    ["contact:c-1", JSON.stringify({ id: "c-1", full_name: "Ana" })],
    ["contact:c-2", JSON.stringify({ id: "c-2", full_name: "Bruno" })],
    ["task:t-0", TOMBSTONE],
  ]);
  const current: CrmRecord[] = [
    { kind: "contact", id: "c-1", data: { id: "c-1", full_name: "Ana" } }, // igual: no sube
    { kind: "contact", id: "c-3", data: { id: "c-3", full_name: "Carla" } }, // nuevo
  ];
  const pending = pendingChanges(current, known);
  assert.deepEqual(
    pending.map((r) => [recordKey(r), r.deleted ?? false]),
    [
      ["contact:c-3", false],
      ["contact:c-2", true], // desapareció del store → tumba
    ],
    "la tumba vieja (t-0) no se vuelve a mandar",
  );
});

test("knownValue: JSON de data, o TOMBSTONE si está borrado", () => {
  assert.equal(knownValue({ kind: "task", id: "t", data: { a: 1 } }), '{"a":1}');
  assert.equal(knownValue({ kind: "task", id: "t", data: {}, deleted: true }), TOMBSTONE);
});

test("chunkForPush respeta el tope de ítems y de bytes", () => {
  const many: CrmRecord[] = Array.from({ length: PUSH_MAX_ITEMS * 2 + 5 }, (_, i) => ({ kind: "task", id: `t-${i}`, data: { i } }));
  const chunks = chunkForPush(many);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, PUSH_MAX_ITEMS);
  assert.equal(chunks[2].length, 5);

  const big: CrmRecord[] = [
    { kind: "deal", id: "d-1", data: { notes: "x".repeat(2_000_000) } },
    { kind: "deal", id: "d-2", data: { notes: "y".repeat(2_000_000) } },
  ];
  assert.equal(chunkForPush(big).length, 2, "dos registros grandes no van juntos");
});

/* ── Aplicar lo que llega ────────────────────────────────────────────────── */

test("applyRecordsToRows: reemplaza, agrega adelante, saca tumbas y respeta ejemplos y pendientes", () => {
  const rows = [
    { id: "c-1", full_name: "Ana" },
    { id: "c-2", full_name: "Bruno" },
    { id: "c-s", full_name: "Ejemplo", is_sample: true },
    { id: "c-4", full_name: "Local sin subir" },
  ];
  const next = applyRecordsToRows(
    rows,
    [
      { kind: "contact", id: "c-1", data: { id: "c-1", full_name: "Ana María" } },
      { kind: "contact", id: "c-2", data: {}, deleted: true },
      { kind: "contact", id: "c-9", data: { id: "c-9", full_name: "Nueva" } },
      { kind: "contact", id: "c-s", data: { id: "c-s", full_name: "no debería pisar un ejemplo" } },
      { kind: "contact", id: "c-4", data: { id: "c-4", full_name: "versión vieja de la base" } },
    ],
    new Set(["contact:c-4"]),
  );
  assert.deepEqual(next, [
    { id: "c-9", full_name: "Nueva" },
    { id: "c-1", full_name: "Ana María" },
    { id: "c-s", full_name: "Ejemplo", is_sample: true },
    { id: "c-4", full_name: "Local sin subir" },
  ]);
});

test("applyRecordsToRows: sin cambios devuelve la misma referencia", () => {
  const rows = [{ id: "c-1" }];
  assert.equal(applyRecordsToRows(rows, []), rows);
  assert.equal(applyRecordsToRows(rows, [{ kind: "contact", id: "c-2", data: {} }], new Set(["contact:c-2"])), rows);
});

test("dedupeByAppId: gana la más vieja, a igual fecha el id menor; los ejemplos no cuentan", () => {
  const rows = [
    { id: "p-b", app_property_id: "app-1", created_at: "2026-10-09T10:00:00Z" },
    { id: "p-a", app_property_id: "app-1", created_at: "2026-10-09T10:00:00Z" },
    { id: "p-c", app_property_id: "app-1", created_at: "2026-10-08T10:00:00Z" },
    { id: "p-d", app_property_id: null },
    { id: "p-s", app_property_id: "app-1", is_sample: true },
  ];
  assert.deepEqual(dedupeByAppId(rows).map((r) => r.id), ["p-c", "p-d", "p-s"]);
  const clean = [{ id: "p-1", app_property_id: "app-1" }];
  assert.equal(dedupeByAppId(clean), clean);
});
