/**
 * Trabajo en curso de «Publicar todas en la app».
 *
 * Vive fuera de React (un singleton del módulo) para que siga corriendo si se
 * cierra el diálogo o se cambia de pantalla. El estado se guarda en
 * localStorage: si se recarga la página, queda "interrumpido" y se puede
 * retomar desde donde quedó (las ya subidas tienen `app_property_id`, así que
 * no se duplican). Lógica pura en shared/appBulkSync.ts.
 */
import { useSyncExternalStore } from "react";
import {
  BatchController,
  newJob,
  parseJob,
  pendingIds,
  retryFailed,
  runQueue,
  syncOneProperty,
  type BulkItem,
  type BulkJobState,
  type SyncOneDeps,
} from "../../../shared/appBulkSync";

const KEY = "propmatch.appBulkSync.v1";
/** Propiedades en paralelo (cada una ya copia sus fotos de a varias del lado servidor). */
export const CONCURRENCY = 2;

let state: BulkJobState | null = load();
let controller: BatchController | null = null;
let running = false;
const listeners = new Set<() => void>();

function load(): BulkJobState | null {
  try {
    return parseJob(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function save() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    // Sin storage el trabajo sigue igual; solo no se puede retomar tras recargar.
  }
}

function set(next: BulkJobState | null) {
  state = next ? { ...next, updatedAt: new Date().toISOString() } : null;
  save();
  for (const l of listeners) l();
}

export function getJob(): BulkJobState | null {
  return state;
}

export function isRunning(): boolean {
  return running;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Estado del trabajo para la UI (se re-renderiza en cada avance). */
export function useBulkJob(agencyId: string | null): BulkJobState | null {
  const s = useSyncExternalStore(subscribe, getJob, getJob);
  return s && agencyId && s.agencyId === agencyId ? s : null;
}

/**
 * Dependencias vivas (store + API). Las registra el host montado en el layout,
 * así el trabajo siempre lee las propiedades y fotos actuales.
 */
let depsRef: SyncOneDeps | null = null;
export function setBulkDeps(deps: SyncOneDeps | null) {
  depsRef = deps;
}

async function run() {
  if (running || !state) return;
  if (!depsRef) {
    set({ ...state, status: "paused", lastError: "Se cerró la sesión o la cuenta ya no está vinculada" });
    return;
  }
  running = true;
  controller = new BatchController();
  const ctrl = controller;
  set({ ...state, status: "running", lastError: null });
  const ids = pendingIds(state);
  let fatal: string | null = null;
  await runQueue(
    ids,
    async (id) => {
      const deps = depsRef;
      if (!deps) return { ok: false as const, fatal: true, reason: "Se cerró la sesión o la cuenta ya no está vinculada", photoFailures: [] };
      return syncOneProperty(id, deps);
    },
    {
      concurrency: CONCURRENCY,
      control: ctrl,
      onSettled: (id, r) => {
        if (!state) return;
        if (r.ok && !r.value.ok && r.value.fatal) {
          // Sesión vencida / sin servidor: no se marca la propiedad (queda
          // pendiente) y se corta la cola; «Retomar» vuelve a empezar por ella.
          fatal = r.value.reason;
          ctrl.cancel();
          return;
        }
        const result = r.ok
          ? r.value.ok
            ? { ok: true, photoFailures: r.value.photoFailures.length }
            : { ok: false, reason: r.value.reason, photoFailures: r.value.photoFailures.length }
          : { ok: false, reason: r.error };
        set({ ...state, results: { ...state.results, [id]: result } });
      },
    },
  );
  running = false;
  controller = null;
  if (!state) return;
  if (fatal) set({ ...state, status: "paused", lastError: fatal });
  else if (ctrl.cancelled) set({ ...state, status: "cancelled" });
  else if (state.status !== "paused") set({ ...state, status: pendingIds(state).length ? "paused" : "done" });
}

/** Arranca un trabajo nuevo con estas propiedades. */
export function startJob(agencyId: string, items: BulkItem[]) {
  if (running) return;
  set(newJob(agencyId, items));
  void run();
}

export function pauseJob() {
  if (!state) return;
  if (controller) controller.pause();
  set({ ...state, status: "paused" });
}

/** Reanuda (pausado en curso) o retoma (interrumpido por recarga / frenado por un error). */
export function resumeJob() {
  if (!state) return;
  if (running && controller) {
    controller.resume();
    set({ ...state, status: "running", lastError: null });
    return;
  }
  void run();
}

export function cancelJob() {
  if (!state) return;
  if (controller) controller.cancel();
  else set({ ...state, status: "cancelled" });
}

export function retryFailedJob() {
  if (!state || running) return;
  set(retryFailed(state));
  void run();
}

/** Olvida el trabajo terminado/cancelado (no toca nada de lo ya subido). */
export function clearJob() {
  if (running) return;
  set(null);
}
