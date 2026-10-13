/**
 * Sincronización del store con la base propia del CRM (api/crm.ts).
 * Ver docs/datos-en-la-base.md.
 *
 * Cómo funciona:
 * - Al abrir sesión se bajan TODOS los registros de la inmobiliaria y se
 *   reconcilian con lo que había en este navegador (la base manda; lo de
 *   ejemplo y lo pendiente de subir se conservan).
 * - Cada cambio del store se compara con lo último que se sabe que tiene la
 *   base (`known`): lo que difiere va a la cola (`outbox`) y se sube en tandas
 *   con un pequeño retraso. Las bajas suben como tumbas.
 * - Cada 20 s (y al volver la conexión o la pestaña) se piden los cambios
 *   desde la última versión vista y se aplican. Por registro, gana el último
 *   cambio; un registro con cambios locales sin subir no se pisa.
 * - Las fotos cargadas acá (data URL) se suben al bucket antes: el registro
 *   `photos` viaja solo con URLs.
 * - La cola se guarda en localStorage: lo cargado sin conexión se sube al
 *   volver, aunque se haya recargado la página.
 *
 * El navegador nunca habla con la base directo: siempre por /api/crm/* con
 * el JWT de la app. La demo no sincroniza.
 */
import { supabase } from "@/lib/supabase";
import type { Property, VisitChecklist, VisitFeedback } from "@/types/db";
import type { StoreData } from "./store";
import {
  applyRecordsToRows,
  chunkForPush,
  dedupeByAppId,
  isSampleRow,
  knownValue,
  pendingChanges,
  recordKey,
  rowData,
  type CrmKind,
  type CrmRecord,
  type CrmStoredRecord,
} from "../../shared/crmSync";

export type RemoteStatus =
  /** Sin sesión real (login o demo): nada que sincronizar. */
  | "off"
  /** Bajando los datos de la inmobiliaria por primera vez en esta sesión. */
  | "loading"
  | "synced"
  /** Hay cambios locales esperando subir. */
  | "pending"
  /** El servidor no responde: se sigue trabajando acá y se sube al volver. */
  | "offline"
  /** La base del CRM no está configurada en el servidor: los datos quedan solo en este navegador. */
  | "no_db"
  /** La sesión venció: hay que volver a entrar. */
  | "unauthorized";

export interface RemoteHandlers {
  /** Primera bajada completa (cuando `start` no pudo y entró más tarde): reconciliar. */
  onInitial: (records: CrmRecord[], pending: Set<string>) => void;
  /** Cambios que llegaron de la base (ya filtrados: sin lo pendiente local). */
  onRecords: (records: CrmRecord[], skip: Set<string>) => void;
  /** Fotos recién subidas: data URL → URL pública, para reemplazar en el store. */
  onPhotosUploaded: (propertyId: string, swap: Map<string, string>) => void;
  onStatus: (status: RemoteStatus) => void;
}

const POLL_MS = 20_000;
const FLUSH_DELAY_MS = 800;
const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
const OUTBOX_KEY = (userId: string) => `propmatch.outbox.v1:${userId}`;

type Fail = { ok: false; status: number; error: string };
type Ok<T> = { ok: true; data: T };

async function call<T>(action: string, method: "GET" | "POST", body?: unknown): Promise<Ok<T> | Fail> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, status: 401, error: "unauthorized" };
    const r = await fetch(`/api/crm/${action}`, {
      method,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.headers.get("content-type")?.includes("application/json")) return { ok: false, status: r.status, error: "no_server" };
    const j = (await r.json()) as T & { error?: string };
    if (!r.ok) return { ok: false, status: r.status, error: j.error ?? "server_error" };
    return { ok: true, data: j };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

/* ── Store → registros ───────────────────────────────────────────────────── */

const ROW_KINDS: { kind: CrmKind; key: keyof StoreData }[] = [
  { kind: "profile", key: "profiles" },
  { kind: "contact", key: "contacts" },
  { kind: "requirement", key: "requirements" },
  { kind: "property", key: "properties" },
  { kind: "opportunity", key: "opportunities" },
  { kind: "activity", key: "activities" },
  { kind: "event", key: "events" },
  { kind: "task", key: "tasks" },
  { kind: "deal", key: "deals" },
  { kind: "app_offer", key: "appOffers" },
];

/**
 * El JSON de cada registro se calcula una vez por objeto fuente: el store
 * actualiza de forma inmutable, así que lo que no cambió conserva la
 * referencia y no se vuelve a serializar.
 */
const jsonCache = new WeakMap<object, { data: Record<string, unknown>; json: string }>();

function cached(source: object, build: () => Record<string, unknown>) {
  let hit = jsonCache.get(source);
  if (!hit) {
    const data = build();
    hit = { data, json: JSON.stringify(data) };
    jsonCache.set(source, hit);
  }
  return hit;
}

const jsonByData = new WeakMap<object, string>();
const stringify = (data: Record<string, unknown>) => jsonByData.get(data) ?? JSON.stringify(data);

function record(kind: CrmKind, id: string, source: object, build: () => Record<string, unknown>): CrmRecord {
  const { data, json } = cached(source, build);
  jsonByData.set(data, json);
  return { kind, id, data };
}

const isPhotoDataUrl = (u: string) => u.startsWith("data:");

/** Los registros reales del store (sin ejemplos). Es lo que la base debería tener. */
export function storeToRecords(d: StoreData): CrmRecord[] {
  const out: CrmRecord[] = [];
  const { id: _id, ...agencyData } = d.agency;
  void _id;
  out.push(record("agency", "main", d.agency, () => agencyData as Record<string, unknown>));

  for (const { kind, key } of ROW_KINDS) {
    const rows = d[key] as { id: string; is_sample?: boolean }[];
    for (const row of rows) {
      if (isSampleRow(row)) continue;
      out.push(record(kind, row.id, row, () => rowData(row)));
    }
  }

  const sampleProps = new Set<string>();
  const realProps = new Set<string>();
  for (const p of d.properties) (isSampleRow(p) ? sampleProps : realProps).add(p.id);
  for (const [propertyId, urls] of Object.entries(d.photos)) {
    // Fotos de propiedades que no existen (restos) o de ejemplo: no viajan.
    if (!realProps.has(propertyId)) continue;
    out.push(record("photos", propertyId, urls, () => ({ urls })));
  }

  for (const id of d.reviewedMatches) out.push({ kind: "reviewed_match", id, data: EMPTY });
  for (const [id, until] of Object.entries(d.followUpSnoozes)) out.push(record("snooze", id, snoozeSource(id, until), () => ({ until })));
  for (const id of d.syncedAppEventIds) out.push({ kind: "synced_app_event", id, data: EMPTY });
  for (const [id, feedback] of Object.entries(d.appVisitFeedback)) out.push(record("app_visit_feedback", id, feedback, () => ({ ...feedback })));
  for (const [id, checklist] of Object.entries(d.appVisitChecklist)) out.push(record("app_visit_checklist", id, checklist, () => ({ ...checklist })));
  return out;
}

const EMPTY: Record<string, unknown> = Object.freeze({});
jsonByData.set(EMPTY, "{}");

/** `followUpSnoozes` guarda strings: se les da un objeto estable para la caché. */
const snoozeSources = new Map<string, object>();
function snoozeSource(id: string, until: string): object {
  const k = `${id}|${until}`;
  let o = snoozeSources.get(k);
  if (!o) {
    o = {};
    snoozeSources.set(k, o);
  }
  return o;
}

/* ── Registros → store ───────────────────────────────────────────────────── */

type Rows = { id: string; is_sample?: boolean }[];

function byKind(records: CrmRecord[]): Map<CrmKind, CrmRecord[]> {
  const m = new Map<CrmKind, CrmRecord[]>();
  for (const r of records) {
    const list = m.get(r.kind);
    if (list) list.push(r);
    else m.set(r.kind, [r]);
  }
  return m;
}

function applySet(list: string[], recs: CrmRecord[] | undefined, skip: Set<string>): string[] {
  if (!recs) return list;
  const set = new Set(list);
  let changed = false;
  for (const r of recs) {
    if (skip.has(recordKey(r))) continue;
    if (r.deleted) {
      if (set.delete(r.id)) changed = true;
    } else if (!set.has(r.id)) {
      set.add(r.id);
      changed = true;
    }
  }
  return changed ? [...set] : list;
}

function applyMap<V>(map: Record<string, V>, recs: CrmRecord[] | undefined, skip: Set<string>, value: (data: Record<string, unknown>) => V): Record<string, V> {
  if (!recs) return map;
  const next = { ...map };
  let changed = false;
  for (const r of recs) {
    if (skip.has(recordKey(r))) continue;
    changed = true;
    if (r.deleted) delete next[r.id];
    else next[r.id] = value(r.data);
  }
  return changed ? next : map;
}

/** Aplica cambios llegados de la base sobre el store. Lo de ejemplo y lo pendiente (`skip`) no se tocan. */
export function applyRemote(d: StoreData, records: CrmRecord[], skip: Set<string>): StoreData {
  if (records.length === 0) return d;
  const groups = byKind(records);
  let next: StoreData = d;
  const set = <K extends keyof StoreData>(key: K, value: StoreData[K]) => {
    if (value !== next[key]) next = { ...next, [key]: value };
  };

  const agency = groups.get("agency")?.find((r) => r.id === "main" && !r.deleted && !skip.has("agency:main"));
  if (agency) set("agency", { ...d.agency, ...(agency.data as Partial<StoreData["agency"]>), id: d.agency.id });

  for (const { kind, key } of ROW_KINDS) {
    const recs = groups.get(kind);
    if (!recs) continue;
    set(key, applyRecordsToRows(d[key] as Rows, recs, skip) as StoreData[typeof key]);
  }
  if (groups.has("property")) set("properties", dedupeByAppId(next.properties));

  set("photos", applyMap(d.photos, groups.get("photos"), skip, (data) => (Array.isArray(data.urls) ? (data.urls as string[]) : [])));
  set("reviewedMatches", applySet(d.reviewedMatches, groups.get("reviewed_match"), skip));
  set("followUpSnoozes", applyMap(d.followUpSnoozes, groups.get("snooze"), skip, (data) => String(data.until ?? "")));
  set("syncedAppEventIds", applySet(d.syncedAppEventIds, groups.get("synced_app_event"), skip));
  set("appVisitFeedback", applyMap(d.appVisitFeedback, groups.get("app_visit_feedback"), skip, (data) => data as unknown as VisitFeedback));
  set("appVisitChecklist", applyMap(d.appVisitChecklist, groups.get("app_visit_checklist"), skip, (data) => data as unknown as VisitChecklist));
  return next;
}

/**
 * Primera bajada de la sesión: la base manda sobre lo que conoce. De lo local
 * quedan los ejemplos, lo que está en la cola sin subir (`pending`) y lo que la
 * base no conoce en absoluto (ni como tumba): eso es nuevo de este navegador
 * (datos de antes de que existiera la base, o cargados sin conexión) y el
 * primer `track` lo sube. Lo que la base tiene borrado, se va.
 */
export function reconcileInitial(d: StoreData, remote: CrmRecord[], pending: Set<string>): StoreData {
  if (remote.length === 0) return d;
  const remoteKeys = new Set(remote.map(recordKey));
  const keep = (kind: CrmKind, id: string) => {
    const key = `${kind}:${id}`;
    return pending.has(key) || !remoteKeys.has(key);
  };
  let base: StoreData = { ...d };
  for (const { kind, key } of ROW_KINDS) {
    const rows = d[key] as Rows;
    const kept = rows.filter((r) => isSampleRow(r) || keep(kind, r.id));
    (base as unknown as Record<string, unknown>)[key] = kept.length === rows.length ? rows : kept;
  }
  const sampleProps = new Set(d.properties.filter(isSampleRow).map((p) => p.id));
  base.photos = Object.fromEntries(Object.entries(d.photos).filter(([id]) => sampleProps.has(id) || keep("photos", id)));
  base.reviewedMatches = d.reviewedMatches.filter((id) => keep("reviewed_match", id));
  base.followUpSnoozes = Object.fromEntries(Object.entries(d.followUpSnoozes).filter(([id]) => keep("snooze", id)));
  base.syncedAppEventIds = d.syncedAppEventIds.filter((id) => keep("synced_app_event", id));
  base.appVisitFeedback = Object.fromEntries(Object.entries(d.appVisitFeedback).filter(([id]) => keep("app_visit_feedback", id)));
  base.appVisitChecklist = Object.fromEntries(Object.entries(d.appVisitChecklist).filter(([id]) => keep("app_visit_checklist", id)));
  return applyRemote(base, remote, pending);
}

/** Reemplaza en el store las data URL ya subidas por su URL pública. */
export function swapPhotoUrls(d: StoreData, propertyId: string, swap: Map<string, string>): StoreData {
  const urls = d.photos[propertyId];
  if (!urls || !urls.some((u) => swap.has(u))) return d;
  return { ...d, photos: { ...d.photos, [propertyId]: urls.map((u) => swap.get(u) ?? u) } };
}

/* ── Motor ───────────────────────────────────────────────────────────────── */

export class RemoteSync {
  /** Clave → JSON de `data` (o TOMBSTONE) tal como lo tiene la base, hasta donde sabemos. */
  private known = new Map<string, string>();
  private outbox = new Map<string, CrmRecord>();
  private since = 0;
  private tracking = false;
  private stopped = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private pulling = false;
  private failures = 0;
  private uploading = new Set<string>();
  private status: RemoteStatus = "off";

  constructor(
    private readonly userId: string,
    private readonly handlers: RemoteHandlers,
  ) {
    this.loadOutbox();
  }

  /** Claves con cambios locales sin subir: lo remoto no las pisa. */
  pendingKeys(): Set<string> {
    return new Set(this.outbox.keys());
  }

  /**
   * Baja todo lo de la inmobiliaria. Devuelve los registros, o `null` si no
   * se pudo (sin red, base sin configurar, sesión vencida): en ese caso se
   * sigue intentando cada tanto y, cuando entra, `onRecords` trae todo.
   */
  async start(): Promise<CrmRecord[] | null> {
    this.setStatus("loading");
    const all = await this.pullAll(0);
    if (!all) {
      this.schedulePoll(RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)]);
      return null;
    }
    this.attachListeners();
    return all.records;
  }

  /** A partir de acá, cada `track` compara el store con la base y encola diferencias. */
  enableTracking(): void {
    this.tracking = true;
    this.schedulePoll(POLL_MS);
  }

  /** Llamar con cada versión nueva del store. Barato si nada cambió. */
  track(d: StoreData): void {
    if (!this.tracking || this.stopped) return;
    const pending = pendingChanges(storeToRecords(d), this.known, stringify);
    const next = new Map<string, CrmRecord>();
    for (const r of pending) next.set(recordKey(r), r);
    this.outbox = next;
    this.saveOutbox();
    if (next.size === 0) {
      if (this.status === "pending") this.setStatus("synced");
      return;
    }
    this.setStatus(this.status === "offline" || this.status === "no_db" || this.status === "unauthorized" ? this.status : "pending");
    this.scheduleFlush(FLUSH_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    this.tracking = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.detachListeners();
    this.setStatus("off");
  }

  /* ── Bajada ─────────────────────────────────────────────────────────────── */

  private async pullAll(since: number): Promise<{ records: CrmRecord[]; version: number } | null> {
    const records: CrmRecord[] = [];
    let cursor = since;
    for (let page = 0; page < 200; page++) {
      const r = await call<{ records: CrmStoredRecord[]; version: number; more: boolean }>(`pull?since=${cursor}`, "GET");
      if (!r.ok) {
        this.failures++;
        this.setStatus(r.error === "no_db" ? "no_db" : r.status === 401 ? "unauthorized" : "offline");
        return null;
      }
      for (const rec of r.data.records) {
        records.push({ kind: rec.kind, id: rec.id, data: rec.data ?? {}, deleted: rec.deleted });
        this.known.set(recordKey(rec), knownValue(rec));
      }
      cursor = r.data.version;
      if (!r.data.more) break;
    }
    this.failures = 0;
    this.since = Math.max(this.since, cursor);
    this.setStatus(this.outbox.size ? "pending" : "synced");
    return { records, version: cursor };
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.pulling) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      this.schedulePoll(POLL_MS);
      return;
    }
    this.pulling = true;
    try {
      if (!this.tracking) {
        // La primera bajada falló: se reintenta entera.
        const all = await this.pullAll(0);
        if (all) {
          this.attachListeners();
          this.handlers.onInitial(all.records, this.pendingKeys());
          this.tracking = true;
          this.scheduleFlush(0);
        }
      } else {
        const before = new Map(this.known);
        const res = await this.pullAll(this.since);
        if (res && res.records.length) {
          // Lo que ya teníamos igual (nuestro propio eco) no se vuelve a aplicar.
          const fresh = res.records.filter((r) => before.get(recordKey(r)) !== knownValue(r));
          if (fresh.length) this.handlers.onRecords(fresh, this.pendingKeys());
        }
      }
    } finally {
      this.pulling = false;
      this.schedulePoll(this.failures ? RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)] : POLL_MS);
    }
  }

  private schedulePoll(ms: number) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  /* ── Subida ─────────────────────────────────────────────────────────────── */

  private scheduleFlush(ms: number) {
    if (this.stopped) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), ms);
  }

  private async flush(): Promise<void> {
    if (this.stopped || this.flushing || this.outbox.size === 0) return;
    this.flushing = true;
    try {
      const ready: CrmRecord[] = [];
      for (const rec of this.outbox.values()) {
        if (rec.kind === "photos" && !rec.deleted) {
          const urls = (rec.data.urls as string[] | undefined) ?? [];
          if (urls.some(isPhotoDataUrl)) {
            void this.uploadPhotos(rec.id, urls);
            continue;
          }
        }
        ready.push(rec);
      }
      for (const chunk of chunkForPush(ready, stringify)) {
        const r = await call<{ version: number }>("push", "POST", { items: chunk });
        if (!r.ok) {
          this.failures++;
          this.setStatus(r.error === "no_db" ? "no_db" : r.status === 401 ? "unauthorized" : r.status === 400 ? "pending" : "offline");
          if (r.status !== 401 && r.error !== "no_db") this.scheduleFlush(RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)]);
          return;
        }
        for (const rec of chunk) {
          const key = recordKey(rec);
          this.known.set(key, knownValue(rec, stringify));
          // Si volvió a cambiar mientras subía, queda en la cola con su versión nueva.
          if (this.outbox.get(key) === rec) this.outbox.delete(key);
        }
        this.saveOutbox();
      }
      this.failures = 0;
      this.setStatus(this.outbox.size ? "pending" : "synced");
    } finally {
      this.flushing = false;
      if (this.outbox.size && this.failures === 0 && !this.uploading.size) this.scheduleFlush(FLUSH_DELAY_MS);
    }
  }

  private async uploadPhotos(propertyId: string, urls: string[]): Promise<void> {
    if (this.uploading.has(propertyId)) return;
    this.uploading.add(propertyId);
    try {
      const swap = new Map<string, string>();
      for (const u of urls) {
        if (!isPhotoDataUrl(u) || swap.has(u)) continue;
        const r = await call<{ url: string }>("upload", "POST", { propertyId, dataUrl: u });
        if (!r.ok) {
          // Una foto inválida (400) se descarta: no vale la pena reintentarla.
          if (r.status === 400) swap.set(u, "");
          else break;
        } else swap.set(u, r.data.url);
      }
      if (swap.size) this.handlers.onPhotosUploaded(propertyId, swap);
    } finally {
      this.uploading.delete(propertyId);
      this.scheduleFlush(FLUSH_DELAY_MS);
    }
  }

  /* ── Persistencia de la cola ─────────────────────────────────────────────── */

  private loadOutbox() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY(this.userId));
      if (!raw) return;
      const items = JSON.parse(raw) as CrmRecord[];
      for (const r of items) this.outbox.set(recordKey(r), r);
    } catch {
      // Cola ilegible: se parte de cero (lo local sigue en el store).
    }
  }

  private saveOutbox() {
    try {
      const key = OUTBOX_KEY(this.userId);
      if (this.outbox.size === 0) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify([...this.outbox.values()].filter((r) => r.kind !== "photos" || !((r.data.urls as string[] | undefined) ?? []).some(isPhotoDataUrl))));
    } catch {
      // Sin espacio: la cola vive en memoria hasta subir.
    }
  }

  /* ── Varios ─────────────────────────────────────────────────────────────── */

  private setStatus(s: RemoteStatus) {
    if (this.status === s) return;
    this.status = s;
    this.handlers.onStatus(s);
  }

  private readonly onWake = () => {
    if (this.stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    this.failures = 0;
    this.schedulePoll(0);
    if (this.outbox.size) this.scheduleFlush(0);
  };

  private attachListeners() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
  }

  private detachListeners() {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.onWake);
    document.removeEventListener("visibilitychange", this.onWake);
  }
}

/** Para la UI: `true` si la propiedad tiene fotos todavía sin subir a la base. */
export const hasLocalPhotos = (d: Pick<StoreData, "photos">, p: Pick<Property, "id">) =>
  (d.photos[p.id] ?? []).some(isPhotoDataUrl);
