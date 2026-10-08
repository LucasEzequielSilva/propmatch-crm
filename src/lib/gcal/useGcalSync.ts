/**
 * Opción A: sincronización directa con el Google Calendar del agente.
 *
 * CRM → Google: en cada cambio (debounce) se compara lo que el CRM quiere en
 * Google con lo ya mandado (ledger en localStorage, por cuenta) y se manda la
 * diferencia a gcal-upsert / gcal-delete. Ids determinísticos en el servidor:
 * reintentar nunca duplica.
 *
 * Google → CRM: con la Agenda abierta, gcal-pull al abrir y cada 3 min con la
 * pestaña visible. Cambios de horario / borrados de eventos de PropMatch se
 * aplican al CRM (gana el último cambio); el resto llega como «Ocupado».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type GcalPatch } from "@/data/store";
import type { CalendarEvent, Task } from "@/types/db";
import {
  MAX_DELETE_ITEMS,
  MAX_UPSERT_ITEMS,
  crmPatchFromTimes,
  decidePullAction,
  itemHash,
  planReconcile,
  splitPropmatchId,
  type DesiredItem,
  type GcalBusy,
  type GcalItem,
  type GcalTimes,
  type LedgerEntry,
} from "../../../shared/gcal";
import { gcalApi, type GcalApiResult, type GcalStatus } from "./api";

const RECONCILE_DEBOUNCE_MS = 1_500;
const PULL_EVERY_MS = 3 * 60_000;
const DAY = 86_400_000;

/* ── Ledger ───────────────────────────────────────────────────────────────── */

interface Ledger {
  email: string | null;
  syncToken: string | null;
  entries: Record<string, LedgerEntry>;
}

const ledgerKey = (userId: string) => `propmatch.gcal.sync.v1:${userId}`;
const prefsKey = (userId: string) => `propmatch.gcal.prefs.v1:${userId}`;

function loadLedger(userId: string): Ledger {
  try {
    const raw = localStorage.getItem(ledgerKey(userId));
    if (raw) {
      const l = JSON.parse(raw) as Ledger;
      return { email: l.email ?? null, syncToken: l.syncToken ?? null, entries: l.entries ?? {} };
    }
  } catch {
    // Ilegible: se arranca de cero (los ids determinísticos evitan duplicados).
  }
  return { email: null, syncToken: null, entries: {} };
}

function saveLedger(userId: string, l: Ledger) {
  try {
    localStorage.setItem(ledgerKey(userId), JSON.stringify(l));
  } catch {
    // Sin espacio: en la próxima vuelta se vuelve a mandar (idempotente).
  }
}

export interface GcalPrefs {
  /** Mostrar los otros eventos de Google como «Ocupado». */
  showBusy: boolean;
  /** Mostrar sus títulos (si no, solo «Ocupado»). */
  showTitles: boolean;
}

const DEFAULT_PREFS: GcalPrefs = { showBusy: true, showTitles: false };

/* ── Estado expuesto ──────────────────────────────────────────────────────── */

export type SyncUiState = "loading" | "hidden" | "demo" | "no_db" | "not_configured" | "not_connected" | "connected" | "needs_reauth" | "error";

export interface SyncController {
  state: SyncUiState;
  email: string | null;
  lastSyncAt: string | null;
  /** Problema a mostrar, en castellano. */
  error: string | null;
  syncing: boolean;
  busyBlocks: GcalBusy[];
  prefs: GcalPrefs;
  setPrefs: (p: Partial<GcalPrefs>) => void;
  connect: (ret: "agenda" | "integraciones") => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => void;
  refreshStatus: () => void;
  /** La Agenda avisa qué rango muestra (null al cerrarse): activa el pull. */
  setAgendaRange: (r: { start: Date; end: Date } | null) => void;
}

function uiStateOf(s: GcalStatus): SyncUiState {
  if (!s.db) return "no_db";
  if (s.state === "connected") return "connected";
  if (s.state === "needs_reauth") return "needs_reauth";
  if (s.state === "error") return "error";
  return s.configured ? "not_connected" : "not_configured";
}

const updatedOf = (x: { updated_at?: string; created_at: string }) => x.updated_at ?? x.created_at;

const eventTimes = (e: CalendarEvent): GcalTimes => ({ allDay: false, start: new Date(e.starts_at).toISOString(), end: new Date(e.ends_at).toISOString() });

function taskTimes(t: Task): GcalTimes | null {
  if (!t.due_date) return null;
  const d = t.due_date.slice(0, 10);
  const next = new Date(`${d}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return { allDay: true, start: d, end: next.toISOString().slice(0, 10) };
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

export function useGcalSync(input: { userId: string | null; isDemo: boolean; items: GcalItem[]; visitsKnown: boolean }): SyncController {
  const { userId, isDemo, items, visitsKnown } = input;
  const { events, tasks, applyGcalPatches } = useStore();

  const [status, setStatus] = useState<{ state: SyncUiState; data: GcalStatus | null; error: string | null }>({ state: "loading", data: null, error: null });
  const [syncing, setSyncing] = useState(false);
  const [busyBlocks, setBusy] = useState<GcalBusy[]>([]);
  const [prefs, setPrefsState] = useState<GcalPrefs>(DEFAULT_PREFS);
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const ledger = useRef<Ledger>({ email: null, syncToken: null, entries: {} });
  useEffect(() => {
    if (!userId) return;
    ledger.current = loadLedger(userId);
    try {
      const raw = localStorage.getItem(prefsKey(userId));
      setPrefsState(raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as GcalPrefs) } : DEFAULT_PREFS);
    } catch {
      setPrefsState(DEFAULT_PREFS);
    }
  }, [userId]);

  const persist = useCallback(() => {
    if (userId) saveLedger(userId, ledger.current);
  }, [userId]);

  /* Estado de la conexión ──────────────────────────────────────────────── */
  const refreshStatus = useCallback(() => {
    if (isDemo) return setStatus({ state: "demo", data: null, error: null });
    if (!userId) return;
    void gcalApi.status().then((r) => {
      if (!r.ok) {
        if (r.error === "no_server" || r.error === "forbidden" || r.error === "not_configured") return setStatus({ state: "hidden", data: null, error: null });
        return setStatus((s) => ({ ...s, state: s.state === "loading" ? "error" : s.state, error: r.message }));
      }
      // Otra cuenta de Google que la del ledger: se arranca de cero.
      if (r.data.state === "connected" && r.data.email !== ledger.current.email) {
        ledger.current = { email: r.data.email, syncToken: null, entries: {} };
        persist();
      }
      setLastSyncAt(r.data.lastSyncAt);
      setStatus({ state: uiStateOf(r.data), data: r.data, error: r.data.state === "connected" ? null : r.data.lastError });
    });
  }, [isDemo, userId, persist]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const connected = status.state === "connected";

  /** Errores de cualquier llamada: reauth corta todo; el resto se muestra. */
  const onFail = useCallback((r: Extract<GcalApiResult<unknown>, { ok: false }>) => {
    if (r.error === "needs_reauth") setStatus((s) => ({ ...s, state: "needs_reauth", error: r.message }));
    else if (r.error === "not_connected") setStatus((s) => ({ ...s, state: "not_connected", error: null }));
    else if (r.error === "no_db") setStatus((s) => ({ ...s, state: "no_db", error: null }));
    else setStatus((s) => ({ ...s, error: r.message }));
  }, []);

  /* Lo que el CRM quiere tener en Google ───────────────────────────────── */
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const desired = useMemo(() => {
    const ev = new Map(events.map((e) => [e.id, e]));
    const tk = new Map(tasks.map((t) => [t.id, t]));
    const nowIso = new Date().toISOString();
    const m = new Map<string, DesiredItem>();
    for (const item of items) {
      const ref = splitPropmatchId(item.propmatchId);
      if (!ref) continue;
      // Las visitas de la app se gestionan en la app: para Google, siempre gana lo del CRM.
      const crmUpdatedAt =
        ref.kind === "event" ? updatedOf(ev.get(ref.id) ?? { created_at: nowIso }) : ref.kind === "task" ? updatedOf(tk.get(ref.id) ?? { created_at: nowIso }) : nowIso;
      m.set(item.propmatchId, { item, crmUpdatedAt });
    }
    return m;
  }, [items, events, tasks]);
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  const visitsKnownRef = useRef(visitsKnown);
  visitsKnownRef.current = visitsKnown;

  /** Aplica en el CRM lo que ganó Google. */
  const applyFromGoogle = useCallback(
    (pm: string, gid: string, what: { deleted: true } | { times: GcalTimes; updated: string | null }) => {
      const ref = splitPropmatchId(pm);
      if (!ref) return;
      const entries = ledger.current.entries;
      const patches: GcalPatch[] = [];
      if ("deleted" in what) {
        if (ref.kind === "event") {
          const e = eventsRef.current.find((x) => x.id === ref.id);
          // Una visita borrada en Google queda «cancelada» (no se pierde el feedback); el resto se borra.
          if (e?.type === "visita") patches.push({ kind: "event", id: ref.id, patch: { status: "cancelada", google_event_id: null, updated_at: new Date().toISOString() } });
          else if (e) patches.push({ kind: "event", id: ref.id, remove: true });
          delete entries[pm];
        } else {
          const cur = desiredRef.current.get(pm);
          const times = cur ? { allDay: cur.item.allDay, start: cur.item.start, end: cur.item.end } : entries[pm]?.times;
          if (times) entries[pm] = { gid: null, hash: cur ? itemHash(cur.item) : "", times };
          else delete entries[pm];
          if (ref.kind === "task") patches.push({ kind: "task", id: ref.id, patch: { google_event_id: null } });
        }
      } else {
        const p = crmPatchFromTimes(ref.kind, what.times);
        const updated_at = what.updated ?? new Date().toISOString();
        if (p && ref.kind === "event") patches.push({ kind: "event", id: ref.id, patch: { ...(p as { starts_at: string; ends_at: string }), updated_at } });
        if (p && ref.kind === "task") patches.push({ kind: "task", id: ref.id, patch: { ...(p as { due_date: string }), updated_at } });
        // "applied": en la próxima vuelta se reenvía (sin conflicto) el texto con el horario nuevo.
        entries[pm] = { gid, hash: "applied", times: what.times };
      }
      applyGcalPatches(patches);
    },
    [applyGcalPatches],
  );

  /* CRM → Google ───────────────────────────────────────────────────────── */
  const running = useRef(false);
  const again = useRef(false);
  const [kick, setKick] = useState(0);

  const reconcile = useCallback(async () => {
    if (!connected || !userId) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      for (let round = 0; round < 10; round++) {
        const plan = planReconcile(desiredRef.current, ledger.current.entries, new Date(), { visitsKnown: visitsKnownRef.current });
        for (const pm of plan.drop) delete ledger.current.entries[pm];
        if (plan.upserts.length === 0 && plan.deletes.length === 0) break;
        setSyncing(true);
        if (plan.upserts.length) {
          const batch = plan.upserts.slice(0, MAX_UPSERT_ITEMS);
          const r = await gcalApi.upsert(batch);
          if (!r.ok) {
            onFail(r);
            break;
          }
          const idPatches: GcalPatch[] = [];
          let failed = false;
          for (const res of r.data.results) {
            const sent = batch.find((b) => b.propmatchId === res.propmatchId);
            if (!sent) continue;
            const ref = splitPropmatchId(res.propmatchId);
            if (res.ok) {
              ledger.current.entries[res.propmatchId] = { gid: res.googleEventId, hash: itemHash(sent), times: { allDay: sent.allDay, start: sent.start, end: sent.end } };
              if (ref?.kind === "event" && eventsRef.current.find((e) => e.id === ref.id)?.google_event_id !== res.googleEventId)
                idPatches.push({ kind: "event", id: ref.id, patch: { google_event_id: res.googleEventId } });
              if (ref?.kind === "task" && tasksRef.current.find((t) => t.id === ref.id)?.google_event_id !== res.googleEventId)
                idPatches.push({ kind: "task", id: ref.id, patch: { google_event_id: res.googleEventId } });
            } else if (res.conflict === "google_deleted") {
              applyFromGoogle(res.propmatchId, res.googleEventId, { deleted: true });
            } else if (res.conflict === "google_changed" && res.google?.times) {
              applyFromGoogle(res.propmatchId, res.googleEventId, { times: res.google.times, updated: res.google.updated });
            } else {
              failed = true;
            }
          }
          applyGcalPatches(idPatches);
          persist();
          if (failed) {
            setStatus((s) => ({ ...s, error: "Algunos eventos no se pudieron mandar a Google. Reintentamos en un rato." }));
            break;
          }
        } else {
          const batch = plan.deletes.slice(0, MAX_DELETE_ITEMS);
          const r = await gcalApi.remove(batch);
          if (!r.ok) {
            onFail(r);
            break;
          }
          for (const res of r.data.results) if (res.ok) delete ledger.current.entries[res.propmatchId];
          persist();
          if (r.data.results.some((x) => !x.ok)) break;
        }
      }
    } finally {
      running.current = false;
      setSyncing(false);
      if (again.current) {
        again.current = false;
        setKick((k) => k + 1);
      }
    }
  }, [connected, userId, onFail, persist, applyFromGoogle, applyGcalPatches]);

  useEffect(() => {
    if (!connected) return;
    const t = setTimeout(() => void reconcile(), RECONCILE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [connected, desired, visitsKnown, kick, reconcile]);

  /* Google → CRM ───────────────────────────────────────────────────────── */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const pulling = useRef(false);
  const lastPull = useRef(0);

  const pull = useCallback(async () => {
    if (!connected || !userId || pulling.current) return;
    pulling.current = true;
    setSyncing(true);
    try {
      const r0 = rangeRef.current;
      let busy: { timeMin: string; timeMax: string } | null = null;
      if (r0 && prefsRef.current.showBusy) {
        const a = new Date(r0.start.getTime() - DAY);
        const z = new Date(Math.min(r0.end.getTime() + DAY, a.getTime() + 69 * DAY));
        busy = { timeMin: a.toISOString(), timeMax: z.toISOString() };
      }
      let pageToken: string | null = null;
      for (let i = 0; i < 5; i++) {
        const r = await gcalApi.pull({ syncToken: ledger.current.syncToken, pageToken, busy: i === 0 ? busy : null, titles: prefsRef.current.showTitles });
        if (!r.ok) {
          onFail(r);
          return;
        }
        if (i === 0) setBusy(r.data.busy ?? []);
        const byGid = new Map(Object.entries(ledger.current.entries).filter(([, e]) => e.gid).map(([pm, e]) => [e.gid!, pm]));
        for (const ch of r.data.changes) {
          const pm = ch.propmatchId ?? byGid.get(ch.googleEventId);
          if (!pm) continue;
          const ref = splitPropmatchId(pm);
          if (!ref) continue;
          const d = desiredRef.current.get(pm);
          const entry = ledger.current.entries[pm];
          const ev = ref.kind === "event" ? eventsRef.current.find((e) => e.id === ref.id) : undefined;
          const tk = ref.kind === "task" ? tasksRef.current.find((t) => t.id === ref.id) : undefined;
          const action = decidePullAction(ch, {
            exists: !!d,
            kind: ref.kind,
            times: ev ? eventTimes(ev) : tk ? taskTimes(tk) : d ? { allDay: d.item.allDay, start: d.item.start, end: d.item.end } : null,
            crmUpdatedAt: d?.crmUpdatedAt ?? null,
            pushed: entry?.gid ? { times: entry.times, hash: entry.hash } : null,
            currentHash: d ? itemHash(d.item) : null,
          });
          if (action === "apply_delete") applyFromGoogle(pm, ch.googleEventId, { deleted: true });
          else if (action === "unlink") applyFromGoogle(pm, ch.googleEventId, { deleted: true });
          else if (action === "apply_times" && ch.times) applyFromGoogle(pm, ch.googleEventId, { times: ch.times, updated: ch.updated });
          else if (action === "push" && entry) entry.hash = "stale";
        }
        if (r.data.nextSyncToken) ledger.current.syncToken = r.data.nextSyncToken;
        persist();
        setLastSyncAt(r.data.lastSyncAt);
        setStatus((s) => ({ ...s, error: null }));
        if (!r.data.nextPageToken) break;
        pageToken = r.data.nextPageToken;
      }
      lastPull.current = Date.now();
      setKick((k) => k + 1);
    } finally {
      pulling.current = false;
      setSyncing(false);
    }
  }, [connected, userId, onFail, persist, applyFromGoogle]);

  const agendaOpen = range !== null;
  const rangeKey = range ? `${range.start.toISOString()}|${range.end.toISOString()}` : "";
  useEffect(() => {
    if (!connected || !agendaOpen) return;
    void pull();
    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - lastPull.current >= PULL_EVERY_MS - 1000) void pull();
    };
    const t = setInterval(tick, PULL_EVERY_MS);
    const onVis = () => {
      if (document.visibilityState === "visible" && Date.now() - lastPull.current > 60_000) void pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // El rango y las preferencias cambian la ventana de «Ocupado»: se vuelve a pedir.
  }, [connected, agendaOpen, rangeKey, prefs.showBusy, prefs.showTitles, pull]);

  /* Acciones ───────────────────────────────────────────────────────────── */
  const setPrefs = useCallback(
    (p: Partial<GcalPrefs>) => {
      setPrefsState((cur) => {
        const next = { ...cur, ...p };
        try {
          if (userId) localStorage.setItem(prefsKey(userId), JSON.stringify(next));
        } catch {
          // Solo comodidad.
        }
        return next;
      });
    },
    [userId],
  );

  const connect = useCallback(
    async (ret: "agenda" | "integraciones") => {
      setSyncing(true);
      const r = await gcalApi.connect(ret);
      if (!r.ok) {
        setSyncing(false);
        return onFail(r);
      }
      window.location.href = r.data.url;
    },
    [onFail],
  );

  const disconnect = useCallback(async () => {
    setSyncing(true);
    const r = await gcalApi.disconnect();
    setSyncing(false);
    if (!r.ok) return onFail(r);
    ledger.current = { email: null, syncToken: null, entries: {} };
    persist();
    setBusy([]);
    refreshStatus();
  }, [onFail, persist, refreshStatus]);

  const setAgendaRange = useCallback((r: { start: Date; end: Date } | null) => setRange(r), []);
  const syncNow = useCallback(() => {
    void reconcile().then(() => pull());
  }, [reconcile, pull]);

  return {
    state: status.state,
    email: status.data?.email ?? null,
    lastSyncAt,
    error: status.error,
    syncing,
    busyBlocks: connected ? busyBlocks : [],
    prefs,
    setPrefs,
    connect,
    disconnect,
    syncNow,
    refreshStatus,
    setAgendaRange,
  };
}
