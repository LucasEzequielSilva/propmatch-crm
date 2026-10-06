/**
 * Estado de Marketing en el navegador (localStorage por agencia, aparte del
 * store principal para no tocarlo): segmentos, plantillas, campañas,
 * etiquetas, y la copia local de bajas y consentimientos.
 *
 * La fuente de verdad de bajas y consentimientos es el SERVIDOR (Supabase del
 * CRM): la baja llega desde un link público o desde WhatsApp. Acá se guarda:
 *  - lo cargado en este navegador que todavía no se subió (`synced: false`), y
 *  - la última copia bajada del servidor (`server`).
 * Mientras el servidor no esté configurado, todo vive acá y la UI lo avisa.
 */
import { useSyncExternalStore } from "react";
import { isDemoActive } from "@/lib/demo";
import type {
  Campaign,
  Consent,
  MarketingTemplate,
  Segment,
  ServerStatus,
  Unsubscribe,
} from "./types";

export interface MarketingData {
  version: 1;
  segments: Segment[];
  templates: MarketingTemplate[];
  campaigns: Campaign[];
  /** Etiquetas de marketing por contacto (el contacto no tiene etiquetas propias). */
  tags: Record<string, string[]>;
  /** Cargadas acá: pendientes de subir, o todo si no hay servidor. */
  consents: (Consent & { email?: string | null; phone?: string | null })[];
  unsubs: Unsubscribe[];
  /** Copia del servidor. */
  server: {
    consents: (Consent & { email: string | null; phone: string | null })[];
    unsubs: Unsubscribe[];
    fetchedAt: string | null;
  };
  status: ServerStatus;
}

export const EMPTY_STATUS: ServerStatus = {
  checkedAt: null,
  configured: { db: false, email: false, whatsapp: false, sendEnabled: false },
  whatsapp: null,
  isAdmin: false,
  reachable: false,
};

function empty(): MarketingData {
  return {
    version: 1,
    segments: [],
    templates: [],
    campaigns: [],
    tags: {},
    consents: [],
    unsubs: [],
    server: { consents: [], unsubs: [], fetchedAt: null },
    status: EMPTY_STATUS,
  };
}

const keyFor = (agencyId: string) => `propmatch.marketing.v1.${isDemoActive() ? "demo" : agencyId}`;

let current: { key: string; data: MarketingData; persisted: boolean } | null = null;
const listeners = new Set<() => void>();

function load(key: string): MarketingData {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<MarketingData>;
    const base = empty();
    return {
      ...base,
      ...parsed,
      server: { ...base.server, ...(parsed.server ?? {}) },
      status: { ...base.status, ...(parsed.status ?? {}) },
      version: 1,
    };
  } catch {
    return empty();
  }
}

function ensure(agencyId: string) {
  const key = keyFor(agencyId);
  if (!current || current.key !== key) {
    current = { key, data: load(key), persisted: true };
    queueMicrotask(() => listeners.forEach((l) => l()));
  }
  return current;
}

/** Lectura sincrónica (para código que no es React: Proppi, bloqueos). */
export function readMarketing(agencyId: string): MarketingData {
  return ensure(agencyId).data;
}

export function updateMarketing(agencyId: string, fn: (d: MarketingData) => MarketingData): MarketingData {
  const cur = ensure(agencyId);
  const data = fn(cur.data);
  let persisted = true;
  try {
    localStorage.setItem(cur.key, JSON.stringify(data));
  } catch {
    persisted = false;
  }
  current = { key: cur.key, data, persisted };
  listeners.forEach((l) => l());
  return data;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!current || e.key !== current.key) return;
    current = { ...current, data: load(current.key) };
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useMarketing(agencyId: string): MarketingData {
  ensure(agencyId);
  return useSyncExternalStore(subscribe, () => ensure(agencyId).data);
}

export function marketingPersisted(): boolean {
  return current?.persisted ?? true;
}

export function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rnd}`;
}
