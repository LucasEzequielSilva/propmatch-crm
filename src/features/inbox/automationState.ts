import { useSyncExternalStore } from "react";
import { defaultConfig, FACTORY_SNIPPETS } from "./automationDefaults";
import { createLocalAutomationStore, createLocalSentLog } from "./automationStore";
import type { AutomationConfig, AutomationStore, SentEntry } from "./automationTypes";

/**
 * Estado compartido (config + registro de envíos) para el drawer, el chat y el
 * motor. Habla con `AutomationStore`; hoy es localStorage, mañana puede ser
 * una tabla sin tocar a los consumidores.
 */
interface State {
  agencyId: string | null;
  config: AutomationConfig;
  log: SentEntry[];
  /** false si el navegador no dejó guardar. */
  persisted: boolean;
}

let state: State = { agencyId: null, config: defaultConfig(), log: [], persisted: true };
let store: AutomationStore | null = null;
let logStore: ReturnType<typeof createLocalSentLog> | null = null;
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function ensure(agencyId: string): State {
  if (state.agencyId !== agencyId) {
    store = createLocalAutomationStore(agencyId);
    logStore = createLocalSentLog(agencyId);
    state = { agencyId, config: store.load() ?? defaultConfig(), log: logStore.load(), persisted: true };
    // Cambio de agencia: avisar a quien ya estaba suscripto (el render actual lee `state` directo).
    queueMicrotask(() => listeners.forEach((l) => l()));
  }
  return state;
}

export function updateConfig(agencyId: string, fn: (c: AutomationConfig) => AutomationConfig) {
  const cur = ensure(agencyId);
  const config = fn(cur.config);
  emit({ ...cur, config, persisted: store!.save(config) });
}

export function loadSentLog(agencyId: string): SentEntry[] {
  ensure(agencyId);
  // Se relee de storage: otra pestaña pudo haber reservado o enviado.
  const fresh = logStore!.load();
  state = { ...state, log: fresh };
  return fresh;
}

export function upsertSent(agencyId: string, entry: SentEntry) {
  ensure(agencyId);
  const rest = logStore!.load().filter((e) => e.key !== entry.key);
  const log = [entry, ...rest].sort((a, b) => b.at - a.at).slice(0, 200);
  logStore!.save(log);
  emit({ ...state, log });
}

export function clearSentLog(agencyId: string) {
  ensure(agencyId);
  logStore!.save([]);
  emit({ ...state, log: [] });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!state.agencyId || !e.key?.includes(state.agencyId)) return;
    emit({
      ...state,
      config: store?.load() ?? state.config,
      log: logStore?.load() ?? state.log,
    });
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAutomationState(agencyId: string): State {
  ensure(agencyId);
  return useSyncExternalStore(subscribe, () => state);
}

export function restoreFactorySnippets(c: AutomationConfig): AutomationConfig {
  const have = new Set(c.snippets.map((s) => s.factoryId).filter(Boolean));
  const missing = FACTORY_SNIPPETS.filter((s) => !have.has(s.factoryId)).map((s) => ({ ...s }));
  return { ...c, snippets: [...c.snippets, ...missing] };
}
