/**
 * «Publicar todas en la app»: lógica pura (sin red, sin React, sin Supabase).
 *
 *  - Elegibilidad: qué propiedades del CRM pueden subir a la app PropMatch y,
 *    las que no, por qué (en criollo, para mostrarle a la inmobiliaria).
 *  - Fotos: qué fotos hay que copiar al bucket `property-photos` y cómo quedan
 *    las listas (CRM y app) después de copiarlas.
 *  - Tandas: cola con concurrencia, pausa y cancelación.
 *  - Estado del trabajo (se guarda en localStorage para poder retomarlo).
 *  - Sincronizar UNA propiedad con dependencias inyectadas (testeable).
 *
 * Sin imports en tiempo de ejecución: lo corren los tests con `node --test`.
 * Ver docs/publicar-todas-en-la-app.md.
 */

/* ── Elegibilidad ─────────────────────────────────────────────────────── */

/** Tipos y operaciones del CRM que la app sabe mostrar (ver TYPE_TO_APP/OPERATION_TO_APP en src/lib/propertySync.ts). */
export const APP_SUPPORTED_TYPES = ["casa", "departamento", "ph", "terreno", "local", "oficina"] as const;
export const APP_SUPPORTED_OPERATIONS = ["venta", "alquiler", "alquiler_temporal"] as const;

/** Tope de fotos que se copian y se mandan a la app por propiedad. */
export const MAX_PHOTOS_PER_PROPERTY = 40;

/**
 * Tipos donde los ambientes no aplican (terreno, local, oficina): si no hay
 * dato, van a la app con 0 en vez de quedar afuera (la columna es NOT NULL).
 */
export const ROOMLESS_TYPES = ["terreno", "local", "oficina"] as const;
export const isRoomlessType = (type: string | null | undefined): boolean =>
  (ROOMLESS_TYPES as readonly string[]).includes(type ?? "");

/** Lo mínimo de una propiedad del CRM que hace falta para decidir. */
export interface BulkProperty {
  id: string;
  title: string;
  type: string;
  operation: string;
  status: string;
  locality: string | null;
  price: number | null;
  currency: string;
  rooms?: number | null;
  bedrooms?: number | null;
  app_property_id?: string | null;
  sync_status?: string;
  is_sample?: boolean;
}

export type IneligibleReason =
  | "sample"
  | "currency"
  | "no_price"
  | "no_zone"
  | "no_photos"
  | "no_title"
  | "no_rooms"
  | "type"
  | "operation"
  | "closed";

export const INELIGIBLE_LABEL: Record<IneligibleReason, string> = {
  sample: "Es un dato de ejemplo (nunca sale del CRM)",
  currency: "Está en pesos: la app solo maneja USD",
  no_price: "No tiene precio",
  no_zone: "No tiene zona / barrio",
  no_photos: "No tiene fotos",
  no_title: "No tiene título",
  no_rooms: "No tiene cantidad de ambientes",
  type: "Tipo de propiedad que la app no admite",
  operation: "Operación que la app no admite",
  closed: "Está vendida o alquilada",
};

/** Fotos que todavía apuntan a algo (las `blob:` de versiones viejas ya no existen). */
export const usablePhotos = (photos: string[] | undefined): string[] =>
  (photos ?? []).filter((u) => typeof u === "string" && u.length > 0 && !u.startsWith("blob:"));

/** Misma regla que `roomsOf` en propertySync: si no hay ambientes, dormitorios + 1. */
export function bulkRoomsOf(p: Pick<BulkProperty, "rooms" | "bedrooms"> & { type?: string }): number | null {
  if (p.rooms !== undefined && p.rooms !== null) return p.rooms;
  const fallback = isRoomlessType(p.type) ? 0 : null;
  if (p.rooms === null) return fallback;
  return typeof p.bedrooms === "number" ? p.bedrooms + 1 : fallback;
}

/** Todos los motivos por los que una propiedad NO puede subir (vacío = puede). */
export function ineligibleReasons(p: BulkProperty, photos: string[] | undefined): IneligibleReason[] {
  if (p.is_sample) return ["sample"];
  const out: IneligibleReason[] = [];
  if (p.currency !== "USD") out.push("currency");
  if (p.price === null || p.price === undefined || !Number.isFinite(p.price) || p.price <= 0) out.push("no_price");
  if (!p.locality || !p.locality.trim()) out.push("no_zone");
  if (usablePhotos(photos).length === 0) out.push("no_photos");
  if (!p.title || !p.title.trim()) out.push("no_title");
  if (!(APP_SUPPORTED_TYPES as readonly string[]).includes(p.type)) out.push("type");
  if (!(APP_SUPPORTED_OPERATIONS as readonly string[]).includes(p.operation)) out.push("operation");
  // La columna `rooms` de la app es NOT NULL: mandar null rompe el insert.
  if (bulkRoomsOf(p) === null) out.push("no_rooms");
  // Se insertaría como `deleted`: no tiene sentido subirla.
  if (p.status === "vendida" || p.status === "alquilada") out.push("closed");
  return out;
}

export interface BulkItem {
  id: string;
  title: string;
}

export interface BulkSummary {
  /** Listas para subir. */
  ready: BulkItem[];
  /** Ya tienen fila en la app (`app_property_id`). */
  synced: BulkItem[];
  /** No van, con todos sus motivos. */
  ineligible: (BulkItem & { reasons: IneligibleReason[] })[];
  /** Cuántas propiedades tienen cada motivo (una puede sumar en varios). */
  reasonCounts: Partial<Record<IneligibleReason, number>>;
}

/** Clasifica las propiedades de la agencia para el diálogo «Publicar todas en la app». */
export function classifyForApp(properties: BulkProperty[], photos: Record<string, string[] | undefined>): BulkSummary {
  const summary: BulkSummary = { ready: [], synced: [], ineligible: [], reasonCounts: {} };
  for (const p of properties) {
    const item = { id: p.id, title: p.title || "(sin título)" };
    if (p.app_property_id && !p.is_sample) {
      summary.synced.push(item);
      continue;
    }
    const reasons = ineligibleReasons(p, photos[p.id]);
    if (reasons.length === 0) {
      summary.ready.push(item);
      continue;
    }
    summary.ineligible.push({ ...item, reasons });
    for (const r of reasons) summary.reasonCounts[r] = (summary.reasonCounts[r] ?? 0) + 1;
  }
  return summary;
}

/* ── Fotos ────────────────────────────────────────────────────────────── */

export type PhotoKind = "own" | "data" | "external" | "invalid";

export interface PhotoPlanEntry {
  url: string;
  kind: PhotoKind;
}

/**
 * Clasifica las fotos de una propiedad:
 *  - `own`: ya están en `property-photos/<agency_id>/` (no se tocan).
 *  - `data`: cargadas en el navegador; las sube `uploadPropertyPhotos` como siempre.
 *  - `external`: http(s) de otro sitio → hay que copiarlas (lado servidor).
 *  - `invalid`: `blob:`, vacías u otro esquema → no se mandan.
 * `ownPrefix` = URL pública de `property-photos/<agency_id>/`. Respeta el tope por propiedad.
 */
export function planPhotos(photos: string[] | undefined, ownPrefix: string): PhotoPlanEntry[] {
  const out: PhotoPlanEntry[] = [];
  let usable = 0;
  for (const url of photos ?? []) {
    let kind: PhotoKind;
    if (typeof url !== "string" || !url) kind = "invalid";
    else if (url.startsWith("data:image/")) kind = "data";
    else if (ownPrefix && url.startsWith(ownPrefix)) kind = "own";
    else if (/^https?:\/\//i.test(url)) kind = "external";
    else kind = "invalid";
    if (kind !== "invalid") {
      if (usable >= MAX_PHOTOS_PER_PROPERTY) continue;
      usable++;
    }
    out.push({ url, kind });
  }
  return out;
}

export const externalPhotos = (plan: PhotoPlanEntry[]): string[] => [
  ...new Set(plan.filter((e) => e.kind === "external").map((e) => e.url)),
];

/**
 * Cómo quedan las fotos después de copiar.
 *  - `crmPhotos`: las copiadas reemplazan a la original EN SU LUGAR; las que
 *    fallaron se conservan como estaban (para reintentar); las inválidas se quitan.
 *  - `appPhotos`: solo lo que la app puede mostrar desde nuestro bucket (más
 *    las `data:`, que sube uploadPropertyPhotos). Las externas que fallaron NO van.
 */
export function applyCopiedPhotos(
  plan: PhotoPlanEntry[],
  copied: Record<string, string>,
): { crmPhotos: string[]; appPhotos: string[]; changed: boolean } {
  const crmPhotos: string[] = [];
  const appPhotos: string[] = [];
  let changed = false;
  for (const e of plan) {
    if (e.kind === "invalid") {
      changed = true;
      continue;
    }
    if (e.kind === "external") {
      const next = copied[e.url];
      if (next) {
        crmPhotos.push(next);
        appPhotos.push(next);
        changed = true;
      } else {
        crmPhotos.push(e.url);
      }
      continue;
    }
    crmPhotos.push(e.url);
    appPhotos.push(e.url);
  }
  return { crmPhotos, appPhotos, changed };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}

/* ── Cola en tandas ───────────────────────────────────────────────────── */

/** Pausa / reanuda / cancela una cola en curso. Pausar no corta lo que ya arrancó: frena antes de tomar la siguiente. */
export class BatchController {
  paused = false;
  cancelled = false;
  private waiters: (() => void)[] = [];

  pause(): void {
    if (!this.cancelled) this.paused = true;
  }
  resume(): void {
    this.paused = false;
    this.flush();
  }
  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.flush();
  }
  /** Resuelve cuando no está en pausa (o se canceló). */
  waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  private flush() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }
}

/**
 * Procesa `items` con `concurrency` trabajadores. `worker` no debería tirar
 * (si tira, se informa como error con el mensaje). Devuelve cuántos se
 * procesaron y si se canceló.
 */
export async function runQueue<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  opts: {
    concurrency: number;
    control?: BatchController;
    onSettled?: (item: T, result: { ok: true; value: R } | { ok: false; error: string }) => void;
  },
): Promise<{ processed: number; cancelled: boolean }> {
  const control = opts.control ?? new BatchController();
  let next = 0;
  let processed = 0;
  const lane = async () => {
    for (;;) {
      await control.waitIfPaused();
      if (control.cancelled || next >= items.length) return;
      const item = items[next++];
      let result: { ok: true; value: R } | { ok: false; error: string };
      try {
        result = { ok: true, value: await worker(item) };
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
      processed++;
      opts.onSettled?.(item, result);
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency, items.length || 1));
  await Promise.all(Array.from({ length: lanes }, lane));
  return { processed, cancelled: control.cancelled };
}

/* ── Estado del trabajo (persistido) ──────────────────────────────────── */

export type JobStatus = "running" | "paused" | "interrupted" | "cancelled" | "done";

export interface JobItemResult {
  ok: boolean;
  /** Motivo del error (si falló). */
  reason?: string;
  /** Fotos que no se pudieron copiar (la propiedad subió con el resto). */
  photoFailures?: number;
  /** Fotos que fueron a la app SIN el logo (no se pudo generar la copia con logo). */
  watermarkFailures?: number;
}

/**
 * `publish`: «Publicar todas en la app» (las que todavía no están).
 * `refresh`: «Actualizar las fotos en la app» (las que ya están: se vuelven a
 * mandar sus fotos, con o sin logo según la marca actual).
 */
export type JobKind = "publish" | "refresh";

export interface BulkJobState {
  version: 1;
  agencyId: string;
  /** Sin definir = `publish` (trabajos guardados antes de «Actualizar las fotos»). */
  kind?: JobKind;
  /**
   * Solo `refresh`: huella del logo con el que se actualizaron las fotos
   * (`appWatermarkFingerprint`). Al terminar queda como «aplicada».
   */
  fingerprint?: string | null;
  status: JobStatus;
  /** Propiedades a procesar, en orden. */
  ids: string[];
  titles: Record<string, string>;
  results: Record<string, JobItemResult>;
  /** Último error que frenó todo (sesión vencida, sin servidor…). */
  lastError: string | null;
  startedAt: string;
  updatedAt: string;
}

export function newJob(
  agencyId: string,
  items: BulkItem[],
  now = new Date(),
  opts: { kind?: JobKind; fingerprint?: string | null } = {},
): BulkJobState {
  const iso = now.toISOString();
  return {
    version: 1,
    agencyId,
    kind: opts.kind ?? "publish",
    fingerprint: opts.fingerprint ?? null,
    status: "running",
    ids: items.map((i) => i.id),
    titles: Object.fromEntries(items.map((i) => [i.id, i.title])),
    results: {},
    lastError: null,
    startedAt: iso,
    updatedAt: iso,
  };
}

export const pendingIds = (s: BulkJobState): string[] => s.ids.filter((id) => !s.results[id]);
export const failedIds = (s: BulkJobState): string[] => s.ids.filter((id) => s.results[id] && !s.results[id].ok);

export function jobProgress(s: BulkJobState) {
  let ok = 0;
  let failed = 0;
  let photoFailures = 0;
  let watermarkFailures = 0;
  for (const id of s.ids) {
    const r = s.results[id];
    if (!r) continue;
    if (r.ok) ok++;
    else failed++;
    photoFailures += r.photoFailures ?? 0;
    watermarkFailures += r.watermarkFailures ?? 0;
  }
  const done = ok + failed;
  const total = s.ids.length;
  return { done, total, ok, failed, photoFailures, watermarkFailures, pct: total ? Math.round((done / total) * 100) : 100 };
}

/** «Reintentar las fallidas»: vuelven a pendientes, el resto queda como estaba. */
export function retryFailed(s: BulkJobState, now = new Date()): BulkJobState {
  const results: Record<string, JobItemResult> = {};
  for (const [id, r] of Object.entries(s.results)) if (r.ok) results[id] = r;
  return { ...s, results, status: "running", lastError: null, updatedAt: now.toISOString() };
}

/** Lee el estado guardado; descarta cualquier cosa rara. Un trabajo que estaba "running" al recargar queda "interrupted". */
export function parseJob(raw: string | null): BulkJobState | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<BulkJobState>;
    if (j.version !== 1 || typeof j.agencyId !== "string" || !Array.isArray(j.ids)) return null;
    if (!j.ids.every((id) => typeof id === "string")) return null;
    const results = j.results && typeof j.results === "object" ? j.results : {};
    const status: JobStatus = j.status === "running" ? "interrupted" : (j.status as JobStatus) ?? "interrupted";
    return {
      version: 1,
      agencyId: j.agencyId,
      kind: j.kind === "refresh" ? "refresh" : "publish",
      fingerprint: typeof j.fingerprint === "string" ? j.fingerprint : null,
      status: ["paused", "interrupted", "cancelled", "done"].includes(status) ? status : "interrupted",
      ids: j.ids,
      titles: j.titles && typeof j.titles === "object" ? j.titles : {},
      results,
      lastError: typeof j.lastError === "string" ? j.lastError : null,
      startedAt: typeof j.startedAt === "string" ? j.startedAt : new Date(0).toISOString(),
      updatedAt: typeof j.updatedAt === "string" ? j.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/* ── Una propiedad ────────────────────────────────────────────────────── */

/** Tope de URLs por pedido a /api/integrations/copy-photos (sub-tandas: entra holgado en 60 s). */
export const COPY_CHUNK = 8;

export type CopyPhotosResponse =
  | {
      ok: true;
      results: { url: string; ok: boolean; publicUrl?: string; reason?: string }[];
      /** No llegó a procesarlas por tiempo: hay que volver a mandarlas. */
      skipped: string[];
    }
  | { ok: false; status: number; message: string };

export interface SyncOneDeps {
  ownPrefix: string;
  photosOf: (id: string) => string[] | undefined;
  copyPhotos: (crmPropertyId: string, urls: string[]) => Promise<CopyPhotosResponse>;
  /** Guarda en el CRM las URLs nuevas (en el mismo orden), sin re-sincronizar. */
  replacePhotos: (id: string, photos: string[]) => void;
  /**
   * Crea (o actualiza, si ya tiene `app_property_id`) la fila en la app con
   * estas fotos (si la marca lo pide, la app recibe copias con logo).
   */
  publish: (id: string, appPhotos: string[]) => Promise<{ ok: true; watermarkFailures?: number } | { ok: false; error: string }>;
}

export type SyncOneResult =
  | { ok: true; photoFailures: { url: string; reason: string }[]; watermarkFailures: number }
  | { ok: false; reason: string; photoFailures: { url: string; reason: string }[]; fatal?: boolean };

/** Errores que frenan TODO el trabajo (no tiene sentido seguir con las demás). */
const isFatalStatus = (status: number) => status === 0 || status === 401 || status === 403 || status === 404;

/** Copia las fotos externas de una propiedad y la publica en la app. Nunca tira. */
export async function syncOneProperty(id: string, deps: SyncOneDeps): Promise<SyncOneResult> {
  const plan = planPhotos(deps.photosOf(id), deps.ownPrefix);
  const copied: Record<string, string> = {};
  const photoFailures: { url: string; reason: string }[] = [];

  try {
    for (const part of chunk(externalPhotos(plan), COPY_CHUNK)) {
      let todo = part;
      // Lo que el servidor no llegó a procesar por tiempo se vuelve a mandar (hasta 3 veces).
      for (let attempt = 0; todo.length > 0 && attempt < 3; attempt++) {
        const r = await deps.copyPhotos(id, todo);
        if (!r.ok) {
          if (isFatalStatus(r.status)) return { ok: false, reason: r.message, photoFailures, fatal: true };
          for (const url of todo) photoFailures.push({ url, reason: r.message });
          todo = [];
          break;
        }
        for (const x of r.results) {
          if (x.ok && x.publicUrl) copied[x.url] = x.publicUrl;
          else photoFailures.push({ url: x.url, reason: x.reason ?? "No se pudo copiar" });
        }
        todo = r.skipped.filter((u) => todo.includes(u));
      }
      for (const url of todo) photoFailures.push({ url, reason: "Se acabó el tiempo para copiarla" });
    }

    const { crmPhotos, appPhotos, changed } = applyCopiedPhotos(plan, copied);
    if (changed) deps.replacePhotos(id, crmPhotos);
    if (appPhotos.length === 0) {
      const why = photoFailures[0]?.reason;
      return { ok: false, reason: `No se pudo copiar ninguna foto${why ? ` (${why})` : ""}`, photoFailures };
    }
    const pub = await deps.publish(id, appPhotos);
    if (!pub.ok) return { ok: false, reason: pub.error, photoFailures };
    return { ok: true, photoFailures, watermarkFailures: pub.watermarkFailures ?? 0 };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Error inesperado", photoFailures };
  }
}
