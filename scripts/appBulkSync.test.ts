/**
 * «Publicar todas en la app»: elegibilidad, tandas, estado del trabajo, copia
 * de fotos (cliente y servidor) y guardas anti-SSRF. Sin red.
 * Correr con: npm run test:app-sync   (Node >= 22.18 ejecuta TypeScript sin flags)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BatchController,
  COPY_CHUNK,
  MAX_PHOTOS_PER_PROPERTY,
  applyCopiedPhotos,
  chunk,
  classifyForApp,
  externalPhotos,
  failedIds,
  ineligibleReasons,
  bulkRoomsOf,
  jobProgress,
  newJob,
  parseJob,
  pendingIds,
  planPhotos,
  retryFailed,
  runQueue,
  syncOneProperty,
  type BulkProperty,
  type CopyPhotosResponse,
  type SyncOneDeps,
} from "../shared/appBulkSync.ts";
import {
  MAX_IMAGE_BYTES,
  MAX_URLS_PER_REQUEST,
  checkPhotoUrl,
  copyPhotos,
  declaredTypeOk,
  guardedLookup,
  isBlockedIp,
  parseCopyRequest,
  sniffImage,
  storagePath,
  type CopyDeps,
  type DnsLookup,
} from "../api/_lib/photoCopy/core.ts";

const AG = "0a1b2c3d-1111-4222-8333-444455556666";
const OWN = `https://x.supabase.co/storage/v1/object/public/property-photos/${AG}/`;
const EXT = (n: number) => `https://backoffice.ricardodouer.com/storage/p/${n}.jpg`;

const base = (over: Partial<BulkProperty> = {}): BulkProperty => ({
  id: "p-1",
  title: "Depto 2 amb",
  type: "departamento",
  operation: "venta",
  status: "disponible",
  locality: "Palermo",
  price: 120000,
  currency: "USD",
  rooms: 2,
  bedrooms: 1,
  ...over,
});

/* ── Elegibilidad ─────────────────────────────────────────────────────── */

test("elegibilidad: una propiedad completa en USD está lista", () => {
  assert.deepEqual(ineligibleReasons(base(), [EXT(1)]), []);
});

test("elegibilidad: pesos, ejemplo, sin precio, sin zona, sin fotos, tipo y cerrada", () => {
  assert.deepEqual(ineligibleReasons(base({ currency: "ARS" }), [EXT(1)]), ["currency"]);
  assert.deepEqual(ineligibleReasons(base({ is_sample: true, currency: "ARS" }), []), ["sample"]);
  assert.deepEqual(ineligibleReasons(base({ price: null }), [EXT(1)]), ["no_price"]);
  assert.deepEqual(ineligibleReasons(base({ price: 0 }), [EXT(1)]), ["no_price"]);
  assert.deepEqual(ineligibleReasons(base({ locality: "  " }), [EXT(1)]), ["no_zone"]);
  assert.deepEqual(ineligibleReasons(base(), []), ["no_photos"]);
  assert.deepEqual(ineligibleReasons(base(), ["blob:http://x/1"]), ["no_photos"]);
  assert.deepEqual(ineligibleReasons(base({ type: "cochera" }), [EXT(1)]), ["type"]);
  assert.deepEqual(ineligibleReasons(base({ status: "vendida" }), [EXT(1)]), ["closed"]);
  assert.deepEqual(ineligibleReasons(base({ rooms: null }), [EXT(1)]), ["no_rooms"]);
  // Sin `rooms` (dato viejo): dormitorios + 1.
  assert.deepEqual(ineligibleReasons(base({ rooms: undefined, bedrooms: 2 }), [EXT(1)]), []);
  assert.deepEqual(ineligibleReasons(base({ currency: "ARS", locality: null }), []), ["currency", "no_zone", "no_photos"]);
});

test("classifyForApp separa listas, ya sincronizadas y no elegibles con conteo de motivos", () => {
  const props = [
    base({ id: "a" }),
    base({ id: "b", app_property_id: "uuid-b" }),
    base({ id: "c", currency: "ARS" }),
    base({ id: "d", currency: "ARS", locality: null }),
    base({ id: "e", is_sample: true, app_property_id: "nunca" }),
  ];
  const photos = { a: [EXT(1)], b: [OWN + "x.jpg"], c: [EXT(2)], d: [EXT(3)], e: [EXT(4)] };
  const s = classifyForApp(props, photos);
  assert.deepEqual(s.ready.map((x) => x.id), ["a"]);
  assert.deepEqual(s.synced.map((x) => x.id), ["b"]);
  assert.deepEqual(s.ineligible.map((x) => x.id), ["c", "d", "e"]);
  assert.equal(s.reasonCounts.currency, 2);
  assert.equal(s.reasonCounts.no_zone, 1);
  assert.equal(s.reasonCounts.sample, 1);
});

/* ── Plan de fotos ────────────────────────────────────────────────────── */

test("planPhotos clasifica propias, data:, externas e inválidas y respeta el tope", () => {
  const plan = planPhotos([OWN + "a.jpg", "data:image/webp;base64,AAA", EXT(1), "blob:x", "ftp://x/y.jpg", EXT(1)], OWN);
  assert.deepEqual(plan.map((e) => e.kind), ["own", "data", "external", "invalid", "invalid", "external"]);
  assert.deepEqual(externalPhotos(plan), [EXT(1)]); // sin duplicados
  const many = planPhotos(Array.from({ length: 50 }, (_, i) => EXT(i)), OWN);
  assert.equal(many.length, MAX_PHOTOS_PER_PROPERTY);
});

test("applyCopiedPhotos reemplaza en su lugar, conserva las fallidas en el CRM y no las manda a la app", () => {
  const plan = planPhotos([EXT(1), OWN + "a.jpg", EXT(2), "blob:x"], OWN);
  const r = applyCopiedPhotos(plan, { [EXT(1)]: OWN + "new1.jpg" });
  assert.deepEqual(r.crmPhotos, [OWN + "new1.jpg", OWN + "a.jpg", EXT(2)]);
  assert.deepEqual(r.appPhotos, [OWN + "new1.jpg", OWN + "a.jpg"]);
  assert.equal(r.changed, true);
  const same = applyCopiedPhotos(planPhotos([OWN + "a.jpg"], OWN), {});
  assert.equal(same.changed, false);
});

test("chunk parte en tandas", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

/* ── Cola en tandas ───────────────────────────────────────────────────── */

const tick = () => new Promise((r) => setImmediate(r));

test("runQueue respeta la concurrencia y procesa todo", async () => {
  let active = 0;
  let max = 0;
  const seen: number[] = [];
  const r = await runQueue(
    [1, 2, 3, 4, 5, 6, 7],
    async (n) => {
      active++;
      max = Math.max(max, active);
      await tick();
      active--;
      if (n === 4) throw new Error("falló 4");
      return n * 2;
    },
    { concurrency: 3, onSettled: (n, res) => seen.push(res.ok ? n : -n) },
  );
  assert.equal(r.processed, 7);
  assert.equal(max, 3);
  assert.equal(seen.length, 7);
  assert.ok(seen.includes(-4));
});

test("runQueue: pausa frena antes de tomar la siguiente y cancelar corta", async () => {
  const control = new BatchController();
  const started: number[] = [];
  const p = runQueue(
    [1, 2, 3, 4, 5],
    async (n) => {
      started.push(n);
      if (n === 2) control.pause();
      await tick();
      return n;
    },
    { concurrency: 1, control },
  );
  await tick();
  await tick();
  await tick();
  assert.deepEqual(started, [1, 2]);
  assert.equal(control.paused, true);
  control.resume();
  await tick();
  await tick();
  control.cancel();
  const r = await p;
  assert.equal(r.cancelled, true);
  assert.ok(started.length < 5);
});

/* ── Estado del trabajo ───────────────────────────────────────────────── */

test("estado del trabajo: progreso, pendientes, reintento y lectura defensiva", () => {
  let s = newJob(AG, [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
  ]);
  s.results.a = { ok: true, photoFailures: 1 };
  s.results.b = { ok: false, reason: "falló" };
  assert.deepEqual(pendingIds(s), ["c"]);
  assert.deepEqual(failedIds(s), ["b"]);
  assert.deepEqual(jobProgress(s), { done: 2, total: 3, ok: 1, failed: 1, photoFailures: 1, watermarkFailures: 0, pct: 67 });
  s = retryFailed(s);
  assert.deepEqual(pendingIds(s), ["b", "c"]);
  assert.equal(s.status, "running");

  // Al recargar, un trabajo "running" queda "interrupted" para retomarlo.
  const back = parseJob(JSON.stringify(s));
  assert.equal(back?.status, "interrupted");
  assert.deepEqual(back?.ids, ["a", "b", "c"]);
  assert.equal(parseJob("no es json"), null);
  assert.equal(parseJob(JSON.stringify({ version: 2 })), null);
  assert.equal(parseJob(JSON.stringify({ version: 1, agencyId: AG, ids: [1] })), null);
});

/* ── Una propiedad (cliente) ──────────────────────────────────────────── */

function fakeDeps(photos: string[], copy: (urls: string[]) => CopyPhotosResponse, publishOk = true) {
  const calls = { copy: [] as string[][], replaced: [] as string[][], published: [] as string[][] };
  const deps: SyncOneDeps = {
    ownPrefix: OWN,
    photosOf: () => photos,
    copyPhotos: async (_id, urls) => {
      calls.copy.push(urls);
      return copy(urls);
    },
    replacePhotos: (_id, p) => calls.replaced.push(p),
    publish: async (_id, p) => {
      calls.published.push(p);
      return publishOk ? { ok: true } : { ok: false, error: "La app rechazó la propiedad" };
    },
  };
  return { deps, calls };
}

const copyAll = (urls: string[]): CopyPhotosResponse => ({
  ok: true,
  results: urls.map((u) => ({ url: u, ok: true, publicUrl: OWN + "c-" + u.split("/").pop() })),
  skipped: [],
});

test("syncOneProperty copia en sub-tandas, reemplaza en el CRM y publica con las nuevas", async () => {
  const photos = Array.from({ length: COPY_CHUNK + 3 }, (_, i) => EXT(i));
  const { deps, calls } = fakeDeps(photos, copyAll);
  const r = await syncOneProperty("p-1", deps);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.copy.map((c) => c.length), [COPY_CHUNK, 3]);
  assert.equal(calls.replaced.length, 1);
  assert.ok(calls.published[0].every((u) => u.startsWith(OWN)));
  assert.equal(calls.published[0].length, photos.length);
});

test("syncOneProperty: fotos que fallan se informan y sube con las demás; reenvía las salteadas por tiempo", async () => {
  let round = 0;
  const { deps, calls } = fakeDeps([EXT(1), EXT(2), EXT(3)], (urls) => {
    round++;
    if (round === 1)
      return {
        ok: true,
        results: [
          { url: EXT(1), ok: true, publicUrl: OWN + "1.jpg" },
          { url: EXT(2), ok: false, reason: "La foto ya no existe en el sitio de origen (404)" },
        ],
        skipped: [EXT(3)],
      };
    return copyAll(urls);
  });
  const r = await syncOneProperty("p-1", deps);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.copy, [[EXT(1), EXT(2), EXT(3)], [EXT(3)]]);
  assert.deepEqual(r.photoFailures.map((f) => f.url), [EXT(2)]);
  assert.deepEqual(calls.published[0], [OWN + "1.jpg", OWN + "c-3.jpg"]);
  // En el CRM la fallida queda como estaba (para reintentar).
  assert.deepEqual(calls.replaced[0], [OWN + "1.jpg", EXT(2), OWN + "c-3.jpg"]);
});

test("syncOneProperty: si no se copia ninguna foto, no publica", async () => {
  const { deps, calls } = fakeDeps([EXT(1)], (urls) => ({ ok: true, results: urls.map((u) => ({ url: u, ok: false, reason: "Tardó demasiado" })), skipped: [] }));
  const r = await syncOneProperty("p-1", deps);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : "", /ninguna foto/);
  assert.equal(calls.published.length, 0);
});

test("syncOneProperty: sesión vencida o sin servidor es fatal (frena todo el trabajo)", async () => {
  const { deps, calls } = fakeDeps([EXT(1)], () => ({ ok: false, status: 401, message: "Tu sesión venció" }));
  const r = await syncOneProperty("p-1", deps);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.fatal, true);
  assert.equal(calls.published.length, 0);
});

test("syncOneProperty: sin fotos externas no llama al servidor; error de la app se informa", async () => {
  const { deps, calls } = fakeDeps([OWN + "a.jpg", "data:image/webp;base64,AA"], copyAll, false);
  const r = await syncOneProperty("p-1", deps);
  assert.equal(calls.copy.length, 0);
  assert.equal(calls.replaced.length, 0);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "La app rechazó la propiedad");
});

/* ── Servidor: anti-SSRF ──────────────────────────────────────────────── */

test("isBlockedIp: privadas, loopback, link-local, metadata, CGNAT, IPv6 y mapeadas", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fd00::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "no-es-ip",
  ]) assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "200.45.1.1", "172.32.0.1", "2800:3f0:4002:80b::2004"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("checkPhotoUrl: solo http/https públicas, sin credenciales ni puertos raros", () => {
  assert.equal(checkPhotoUrl(EXT(1)).ok, true);
  assert.equal(checkPhotoUrl("http://fotos.ejemplo.com.ar/a.png").ok, true);
  for (const bad of [
    "ftp://ejemplo.com/a.jpg",
    "file:///etc/passwd",
    "data:image/png;base64,AA",
    "javascript:alert(1)",
    "http://localhost/a.jpg",
    "http://foo.localhost/a.jpg",
    "http://127.0.0.1/a.jpg",
    "http://2130706433/a.jpg",
    "http://0x7f.1/a.jpg",
    "http://[::1]/a.jpg",
    "http://[::ffff:169.254.169.254]/latest",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/a.jpg",
    "http://intranet/a.jpg",
    "http://nas.local/a.jpg",
    "http://user:pass@ejemplo.com/a.jpg",
    "https://ejemplo.com:8443/a.jpg",
    "https://ejemplo.com/" + "a".repeat(3000),
    42,
  ]) assert.equal(checkPhotoUrl(bad).ok, false, String(bad).slice(0, 60));
});

test("guardedLookup rechaza si el DNS devuelve alguna IP privada (anti rebinding) y deja pasar públicas", async () => {
  const fakeDns = (answers: string[]): DnsLookup => (_h, _o, cb) =>
    cb(null, answers.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 })));
  const run = (answers: string[], all: boolean) =>
    new Promise<{ err: NodeJS.ErrnoException | null; addr: unknown }>((resolve) =>
      guardedLookup(fakeDns(answers))("fotos.ejemplo.com", { all }, (err: NodeJS.ErrnoException | null, addr: unknown) => resolve({ err, addr })),
    );
  const bad = await run(["93.184.216.34", "10.0.0.1"], false);
  assert.equal(bad.err?.code, "EBLOCKED");
  const ok = await run(["93.184.216.34"], false);
  assert.equal(ok.err, null);
  assert.equal(ok.addr, "93.184.216.34");
  const okAll = await run(["93.184.216.34"], true);
  assert.deepEqual(okAll.addr, [{ address: "93.184.216.34", family: 4 }]);
});

test("sniffImage y declaredTypeOk: solo JPEG/PNG/WebP por los bytes", () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("GIF89a....")), null);
  assert.equal(declaredTypeOk("image/jpeg; charset=binary"), true);
  assert.equal(declaredTypeOk("image/jpg"), true);
  assert.equal(declaredTypeOk(undefined), true);
  assert.equal(declaredTypeOk("text/html"), false);
  assert.equal(declaredTypeOk("image/svg+xml"), false);
});

test("parseCopyRequest y storagePath", () => {
  assert.deepEqual(parseCopyRequest({ crmPropertyId: "p-abc123", urls: [EXT(1), EXT(1), EXT(2)] }), {
    crmPropertyId: "p-abc123",
    urls: [EXT(1), EXT(2)],
  });
  assert.equal(parseCopyRequest({ crmPropertyId: "../otra", urls: [EXT(1)] }), null);
  assert.equal(parseCopyRequest({ crmPropertyId: "p-1", urls: [] }), null);
  assert.equal(parseCopyRequest({ crmPropertyId: "p-1", urls: Array.from({ length: MAX_URLS_PER_REQUEST + 1 }, (_, i) => EXT(i)) }), null);
  assert.equal(parseCopyRequest({ crmPropertyId: "p-1", urls: [1] }), null);
  assert.equal(parseCopyRequest(null), null);
  assert.equal(storagePath(AG, "p-1", "u-u-i-d", "image/png"), `${AG}/p-1/u-u-i-d.png`);
  assert.throws(() => storagePath("local-123", "p-1", "x", "image/png"));
  assert.throws(() => storagePath(AG, "a/b", "x", "image/png"));
});

/* ── Servidor: orquestador ────────────────────────────────────────────── */

function serverDeps(over: Partial<CopyDeps> = {}) {
  const uploads: string[] = [];
  let n = 0;
  let clock = 0;
  const deps: CopyDeps = {
    download: async (url) =>
      url.pathname.includes("404")
        ? { ok: false, reason: "404" }
        : { ok: true, bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: "image/jpeg" },
    upload: async (path) => {
      uploads.push(path);
      return "https://pub/" + path;
    },
    newId: () => `id${++n}`,
    now: () => clock,
    ...over,
  };
  return { deps, uploads, advance: (ms: number) => (clock += ms) };
}

test("copyPhotos sube bajo <agencia>/<propiedad>/, informa las que fallan y conserva el orden", async () => {
  const { deps, uploads } = serverDeps();
  const r = await copyPhotos(AG, { crmPropertyId: "p-1", urls: [EXT(1), "https://x.com/404.jpg", "http://127.0.0.1/a.jpg", EXT(2)] }, deps);
  assert.deepEqual(r.results.map((x) => x.ok), [true, false, false, true]);
  assert.equal(r.results[2].reason, "Dirección no permitida (red privada o local)");
  assert.equal(r.skipped.length, 0);
  assert.ok(uploads.every((p) => p.startsWith(`${AG}/p-1/`) && p.endsWith(".jpg")));
  assert.equal(uploads.length, 2);
});

test("copyPhotos: lo que no entra en el plazo vuelve como `skipped`; una subida que falla no corta las demás", async () => {
  const s = serverDeps();
  s.deps.download = async () => {
    s.advance(20_000);
    return { ok: true, bytes: new Uint8Array([0xff, 0xd8, 0xff]), type: "image/jpeg" };
  };
  const urls = [EXT(1), EXT(2), EXT(3), EXT(4)];
  const r = await copyPhotos(AG, { crmPropertyId: "p-1", urls }, s.deps, { budgetMs: 30_000, concurrency: 1 });
  assert.equal(r.results.length, 2);
  assert.deepEqual(r.skipped, [EXT(3), EXT(4)]);

  const f = serverDeps({ upload: async (p) => { if (p.includes("id1")) throw new Error("x"); return "ok"; } });
  const r2 = await copyPhotos(AG, { crmPropertyId: "p-1", urls: [EXT(1), EXT(2)] }, f.deps, { concurrency: 1 });
  assert.deepEqual(r2.results.map((x) => x.ok), [false, true]);
  assert.equal(r2.results[0].reason, "No se pudo guardar la foto en PropMatch");
});

test("tope de tamaño por imagen: 10 MB", () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});

test("«Actualizar las fotos en la app»: el trabajo recuerda su tipo y el logo, y cuenta las fotos sin logo", async () => {
  const job = newJob("ag", [{ id: "p1", title: "Casa" }], new Date("2026-10-08T00:00:00Z"), { kind: "refresh", fingerprint: "v1|logo" });
  const back = parseJob(JSON.stringify(job))!;
  assert.equal(back.kind, "refresh");
  assert.equal(back.fingerprint, "v1|logo");
  // Trabajos guardados antes de esta opción: son de «Publicar todas».
  const old = parseJob(JSON.stringify({ ...job, kind: undefined, fingerprint: undefined }))!;
  assert.equal(old.kind, "publish");
  assert.equal(old.fingerprint, null);

  const own = "https://x.supabase.co/storage/v1/object/public/property-photos/ag/";
  const r = await syncOneProperty("p1", {
    ownPrefix: own,
    photosOf: () => [`${own}p1/a.jpg`, `${own}p1/b.jpg`],
    copyPhotos: async () => ({ ok: true, results: [], skipped: [] }),
    replacePhotos: () => {},
    publish: async (_id, photos) => {
      assert.deepEqual(photos, [`${own}p1/a.jpg`, `${own}p1/b.jpg`], "a publish le llegan las originales");
      return { ok: true, watermarkFailures: 1 };
    },
  });
  assert.ok(r.ok);
  assert.equal(r.ok && r.watermarkFailures, 1);
  const done = { ...job, results: { p1: { ok: true, watermarkFailures: 1 } } };
  assert.equal(jobProgress(done).watermarkFailures, 1);
});

test("elegibilidad: terreno, local u oficina sin ambientes van con 0", () => {
  for (const type of ["terreno", "local", "oficina"]) {
    assert.deepEqual(ineligibleReasons(base({ type, rooms: null, bedrooms: null }), [EXT(1)]), []);
    assert.equal(bulkRoomsOf({ type, rooms: null, bedrooms: null }), 0);
  }
  // Una casa o un departamento sin ambientes siguen sin poder subir.
  assert.deepEqual(ineligibleReasons(base({ type: "casa", rooms: null, bedrooms: null }), [EXT(1)]), ["no_rooms"]);
  // Con dato, se respeta.
  assert.equal(bulkRoomsOf({ type: "oficina", rooms: 3, bedrooms: null }), 3);
});
