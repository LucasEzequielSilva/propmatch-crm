/**
 * Motor de publicación multi-portal y piezas puras de los adapters (sin red).
 * Correr con: npm run test:integraciones   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PORTALS, SAMPLE_MESSAGE, runEngine, type EngineDeps } from "../api/_lib/integrations/engine.ts";
import { meliOutcome } from "../api/_lib/integrations/meliOutcome.ts";
import { buildReturnUrl, parseReturnTarget } from "../api/_lib/integrations/returnTo.ts";
import { isMissingColumn, resetSchemaFlags, schemaFlags, withOptionalColumns } from "../api/_lib/integrations/dbCompat.ts";
import { maskApiUser, parseArgenpropCredentials } from "../api/_lib/integrations/argenpropCredentials.ts";
import type { AgencyScope, ConnectionStatus, PortalAdapter, PortalId, PublishRequest, PublishResult } from "../api/_lib/integrations/types.ts";
import { PORTALS, portalMeta } from "../src/lib/integrations/registry.ts";

const PROP = "11111111-2222-4333-8444-555555555555";
const OTHER_PROP = "99999999-2222-4333-8444-555555555555";
const scope: AgencyScope = { agencyId: "agency-A", userId: "user-1", role: "agente" };

/* ── adapter falso ─────────────────────────────────────────────────────── */

interface FakeOpts {
  id: PortalId;
  state?: ConnectionStatus["state"];
  available?: boolean;
  /** Avisos ya publicados por propiedad (para probar idempotencia). */
  existing?: Set<string>;
  throws?: boolean;
}

function fakeAdapter(o: FakeOpts) {
  const calls: { kind: string; agencyId: string; propertyId?: string }[] = [];
  const existing = o.existing ?? new Set<string>();
  const res = (outcome: PublishResult["outcome"], ok: boolean): PublishResult => ({
    portal: o.id,
    outcome,
    ok,
    message: null,
    issues: [],
    warnings: [],
    row: { channel: o.id, connection_id: `conn-${o.id}` },
  });
  const adapter: PortalAdapter = {
    id: o.id,
    name: o.id,
    authMethod: "oauth",
    channels: [o.id],
    availability: () => (o.available === false ? { state: "coming_soon", reason: "no hay conector" } : { state: "available" }),
    async status(s) {
      calls.push({ kind: "status", agencyId: s.agencyId });
      return {
        portal: o.id,
        state: o.state ?? "connected",
        accountLabel: null,
        connectedAt: null,
        lastError: null,
        lastCheckedAt: null,
        authMethod: "oauth",
        availability: { state: "available" },
      };
    },
    async connect() {
      return {};
    },
    async disconnect() {},
    async refresh() {},
    async validate(r: PublishRequest) {
      calls.push({ kind: "validate", agencyId: r.scope.agencyId, propertyId: r.propertyId });
      return res("ready", true);
    },
    async publish(r: PublishRequest) {
      calls.push({ kind: "publish", agencyId: r.scope.agencyId, propertyId: r.propertyId });
      if (o.throws) throw new Error("boom");
      if (existing.has(r.propertyId)) return res("updated", true);
      existing.add(r.propertyId);
      return res("published", true);
    },
    async update() {
      return res("updated", true);
    },
    async lifecycle() {
      return res("updated", true);
    },
    mapStatus: () => ({ status: "published", message: null }),
  };
  return { adapter, calls };
}

function deps(adapters: PortalAdapter[], owned: Record<string, string> = { [PROP]: "agency-A", [OTHER_PROP]: "agency-B" }): EngineDeps {
  return {
    adapterFor: (id) => adapters.find((a) => a.id === id) ?? null,
    loadProperty: async (agencyId, propertyId) => (owned[propertyId] === agencyId ? { id: propertyId } : null),
  };
}

/* ── motor ─────────────────────────────────────────────────────────────── */

test("publica en varios portales y devuelve un resultado por portal", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const ap = fakeAdapter({ id: "argenprop", available: false });
  const zp = fakeAdapter({ id: "zonaprop", state: "not_connected" });
  const r = await runEngine(
    { scope, mode: "publish", body: { propertyId: PROP, portals: ["mercadolibre", "argenprop", "zonaprop"] } },
    deps([ml.adapter, ap.adapter, zp.adapter]),
  );
  assert.equal(r.http, 200);
  const by = Object.fromEntries(r.body.results!.map((x) => [x.portal, x]));
  assert.equal(by.mercadolibre.outcome, "published");
  assert.equal(by.mercadolibre.row?.connection_id, "conn-mercadolibre");
  assert.equal(by.argenprop.outcome, "unavailable");
  assert.equal(by.argenprop.message, "no hay conector");
  assert.equal(by.zonaprop.outcome, "not_connected");
  assert.match(by.zonaprop.message!, /Integraciones/);
  // Un portal no disponible ni consulta la conexión; uno sin conectar no publica.
  assert.equal(ap.calls.length, 0);
  assert.deepEqual(zp.calls.map((c) => c.kind), ["status"]);
});

test("idempotente: publicar dos veces actualiza el aviso existente", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const d = deps([ml.adapter]);
  const body = { propertyId: PROP, portals: ["mercadolibre", "mercadolibre"] };
  const first = await runEngine({ scope, mode: "publish", body }, d);
  const second = await runEngine({ scope, mode: "publish", body }, d);
  assert.equal(first.body.results!.length, 1, "portales repetidos se publican una sola vez");
  assert.equal(first.body.results![0].outcome, "published");
  assert.equal(second.body.results![0].outcome, "updated");
});

test("aislamiento: una propiedad de otra agencia no llega a ningún adapter", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const r = await runEngine({ scope, mode: "publish", body: { propertyId: OTHER_PROP, portals: ["mercadolibre"] } }, deps([ml.adapter]));
  assert.equal(r.http, 404);
  assert.equal(r.body.error, "property_not_found");
  assert.equal(ml.calls.length, 0);
});

test("la conexión se resuelve SIEMPRE con la agencia del usuario (el body no la puede cambiar)", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  await runEngine(
    { scope, mode: "publish", body: { propertyId: PROP, portals: ["mercadolibre"], agencyId: "agency-B", scope: { agencyId: "agency-B" } } },
    deps([ml.adapter]),
  );
  assert.ok(ml.calls.length > 0);
  assert.ok(ml.calls.every((c) => c.agencyId === "agency-A"));
});

test("propiedades de ejemplo: nunca se publican", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const r = await runEngine({ scope, mode: "publish", body: { propertyId: PROP, portals: ["mercadolibre"], isSample: true } }, deps([ml.adapter]));
  assert.equal(r.http, 422);
  assert.equal(r.body.message, SAMPLE_MESSAGE);
  assert.equal(ml.calls.length, 0);
});

test("pedidos inválidos: sin uuid, sin portales, demasiados o desconocidos", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const d = deps([ml.adapter]);
  const run = (body: Record<string, unknown>) => runEngine({ scope, mode: "publish", body }, d);
  assert.equal((await run({ propertyId: "x", portals: ["mercadolibre"] })).http, 400);
  assert.equal((await run({ propertyId: PROP, portals: [] })).http, 400);
  assert.equal((await run({ propertyId: PROP, portals: Array(MAX_PORTALS + 1).fill("mercadolibre") })).http, 400);
  assert.equal((await run({ propertyId: PROP, portals: ["myspace"] })).body.error, "unknown_portal");
  assert.equal(ml.calls.length, 0);
});

test("check valida sin publicar; needs_reauth no publica; un error no frena a los demás", async () => {
  const ml = fakeAdapter({ id: "mercadolibre" });
  const check = await runEngine({ scope, mode: "check", body: { propertyId: PROP, portals: ["mercadolibre"] } }, deps([ml.adapter]));
  assert.equal(check.body.results![0].outcome, "ready");
  assert.ok(!ml.calls.some((c) => c.kind === "publish"));

  const stale = fakeAdapter({ id: "mercadolibre", state: "needs_reauth" });
  const broken = fakeAdapter({ id: "meta", throws: true });
  const r = await runEngine({ scope, mode: "publish", body: { propertyId: PROP, portals: ["mercadolibre", "meta"] } }, deps([stale.adapter, broken.adapter]));
  const by = Object.fromEntries(r.body.results!.map((x) => [x.portal, x]));
  assert.equal(by.mercadolibre.outcome, "needs_reauth");
  assert.equal(by.meta.outcome, "error");
  assert.ok(!stale.calls.some((c) => c.kind === "publish"));
});

/* ── Mercado Libre: respuesta de /api/meli/publish → resultado del motor ── */

test("meliOutcome: publicado, actualizado, 402 pendiente de pago, faltantes y sin conexión", () => {
  const row = { id: "r", status: "published" };
  assert.equal(meliOutcome({ http: 200, body: { row } }, "publish").outcome, "published");
  assert.equal(meliOutcome({ http: 200, body: { row, updatedExisting: true } }, "publish").outcome, "updated");
  const pay = meliOutcome({ http: 422, body: { error: "meli_payment_required", message: "pendiente de pago", row } }, "publish");
  assert.equal(pay.outcome, "pending_payment");
  assert.equal(pay.ok, false);
  assert.equal(pay.row, row);
  const inv = meliOutcome({ http: 422, body: { error: "invalid", issues: [{ field: "pictures", blocking: true, message: "faltan fotos" }] } }, "publish");
  assert.equal(inv.outcome, "invalid");
  assert.equal(inv.issues.length, 1);
  assert.equal(meliOutcome({ http: 409, body: { error: "meli_needs_reauth", message: "x" } }, "publish").outcome, "needs_reauth");
  assert.equal(meliOutcome({ http: 409, body: { error: "meli_not_connected", message: "x" } }, "publish").outcome, "not_connected");
  assert.equal(meliOutcome({ http: 409, body: { error: "in_progress", message: "x" } }, "publish").outcome, "in_progress");
  const ready = meliOutcome({ http: 200, body: { issues: [{ field: "x", blocking: false, message: "sugerencia" }], packNote: "sin cupo" } }, "check");
  assert.equal(ready.outcome, "ready");
  assert.deepEqual(ready.warnings, ["sin cupo"]);
  assert.equal(meliOutcome({ http: 200, body: { issues: [{ field: "x", blocking: true, message: "falta" }] } }, "check").outcome, "invalid");
});

/* ── vuelta del OAuth sin redirección abierta ─────────────────────────── */

test("returnTo: solo destinos conocidos; todo lo demás vuelve al publicador", () => {
  assert.equal(parseReturnTarget("integraciones"), "integraciones");
  assert.equal(parseReturnTarget("https://evil.example"), "publicador");
  assert.equal(parseReturnTarget("//evil.example"), "publicador");
  assert.equal(parseReturnTarget("__proto__"), "publicador");
  assert.equal(parseReturnTarget(undefined), "publicador");
  assert.equal(buildReturnUrl("https://app.x/", "integraciones", "meli"), "https://app.x/configuracion/integraciones?meli=connected");
  assert.equal(buildReturnUrl("https://app.x", undefined, "meli", "denied"), "https://app.x/publicador?meli=error&reason=denied");
  // Un motivo raro no se refleja en la URL.
  assert.equal(buildReturnUrl("https://app.x", "publicador", "meli", "<script>"), "https://app.x/publicador?meli=error&reason=server");
});

/* ── compatibilidad con la base sin la migración ──────────────────────── */

test("dbCompat: detecta la columna faltante, reintenta sin ella y lo recuerda", async () => {
  resetSchemaFlags();
  assert.ok(isMissingColumn({ code: "PGRST204", message: "Could not find the 'connection_id' column" }));
  assert.ok(isMissingColumn({ code: "42703", message: "column agency_integrations.last_error does not exist" }));
  assert.ok(!isMissingColumn({ code: "23505", message: "duplicate key" }));
  assert.ok(!isMissingColumn(null));

  const seen: Record<string, unknown>[] = [];
  const run = async (row: Record<string, unknown>) => {
    seen.push(row);
    return { error: "connection_id" in row ? { code: "PGRST204", message: "schema cache" } : null };
  };
  const r = await withOptionalColumns("publication", { status: "published", connection_id: "c1" }, run);
  assert.equal(r.error, null);
  assert.equal(seen.length, 2);
  assert.ok(!("connection_id" in seen[1]));
  assert.equal(schemaFlags().publication, true);
  // La próxima ya va sin la columna, en un solo intento.
  await withOptionalColumns("publication", { status: "x", connection_id: "c2" }, run);
  assert.equal(seen.length, 3);
  assert.ok(!("connection_id" in seen[2]));

  // Otros errores no se tapan.
  resetSchemaFlags();
  const dup = await withOptionalColumns("connection", { last_error: null }, async () => ({ error: { code: "23505", message: "dup" } }));
  assert.equal(dup.error?.code, "23505");
  assert.equal(schemaFlags().connection, false);
});

/* ── Argenprop: credenciales emitidas por el portal ───────────────────── */

test("Argenprop: valida el usuario @api.com y los ids; enmascara la cuenta", () => {
  const ok = parseArgenpropCredentials({ user: " Inmo@API.com ", password: "s3creta", sellerId: "12345", originId: "" });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { user: "inmo@api.com", password: "s3creta", sellerId: "12345", originId: null });
  const bad = parseArgenpropCredentials({ user: "inmo@gmail.com", password: "x", sellerId: "1" });
  assert.ok(!bad.ok && bad.field === "user");
  assert.ok(!parseArgenpropCredentials({ user: "a@api.com", password: "", sellerId: "1" }).ok);
  assert.ok(!parseArgenpropCredentials({ user: "a@api.com", password: "x", sellerId: "12a" }).ok);
  assert.ok(!parseArgenpropCredentials({ user: "a@api.com", password: "x", sellerId: "1", originId: "zz" }).ok);
  assert.ok(!parseArgenpropCredentials(null).ok);
  assert.equal(maskApiUser("inmobiliaria@api.com"), "inm***@api.com");
});

/* ── registro del cliente ─────────────────────────────────────────────── */

test("registro del cliente: un portal por adapter del servidor, sin claves técnicas a la vista", () => {
  const ids = PORTALS.map((p) => p.id).sort();
  assert.deepEqual(ids, ["argenprop", "mercadolibre", "meta", "zonaprop"]);
  for (const p of PORTALS) {
    assert.ok(p.description.length > 20, `${p.id} sin descripción`);
    assert.doesNotMatch(`${p.description} ${p.help.join(" ")}`, /\b(token|client_id|secret|api key)\b/i, `${p.id}: lenguaje técnico`);
  }
  assert.equal(portalMeta("mercadolibre")?.authMethod, "oauth");
  assert.equal(portalMeta("argenprop")?.authMethod, "credentials");
  assert.equal(portalMeta("nada"), null);
});
