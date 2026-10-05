import { useCallback, useEffect, useState } from "react";
import type { ProppiSettingsPayload } from "@/lib/proppi/client";

/**
 * Configuración de Proppi, por inmobiliaria y en este navegador (como las
 * automatizaciones del Inbox). Vive aparte de `store.tsx` a propósito: no toca
 * el modelo de datos compartido y se migra sola cuando haya backend.
 */

export interface ProppiSettings {
  enabled: boolean;
  panelEnabled: boolean;
  inboxEnabled: boolean;
  tone: "cercano" | "formal";
  signature: string;
  knowledge: string;
  /** Consultas por mes en este navegador. 0 = sin tope. */
  monthlyLimit: number;
}

export const DEFAULT_SETTINGS: ProppiSettings = {
  enabled: true,
  panelEnabled: true,
  inboxEnabled: true,
  tone: "cercano",
  signature: "",
  knowledge: "",
  monthlyLimit: 300,
};

const EVT = "pm:proppi-settings";
const settingsKey = (agencyId: string) => `pm.proppi.settings.${agencyId}`;
const usageKey = (agencyId: string) => `pm.proppi.usage.${agencyId}`;
const monthId = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function readJson<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin storage: queda en memoria hasta recargar */
  }
  window.dispatchEvent(new Event(EVT));
}

export function readSettings(agencyId: string): ProppiSettings {
  return { ...DEFAULT_SETTINGS, ...(readJson<ProppiSettings>(settingsKey(agencyId)) ?? {}) };
}

function readUsage(agencyId: string): number {
  const u = readJson<{ month: string; count: number }>(usageKey(agencyId));
  return u && u.month === monthId() && typeof u.count === "number" ? u.count : 0;
}

export function payloadOf(s: ProppiSettings): ProppiSettingsPayload {
  return { tone: s.tone, signature: s.signature, knowledge: s.knowledge };
}

export function useProppiSettings(agencyId: string) {
  const [settings, setSettings] = useState(() => readSettings(agencyId));
  const [used, setUsed] = useState(() => readUsage(agencyId));

  useEffect(() => {
    const sync = () => {
      setSettings(readSettings(agencyId));
      setUsed(readUsage(agencyId));
    };
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [agencyId]);

  const save = useCallback(
    (patch: Partial<ProppiSettings>) => writeJson(settingsKey(agencyId), { ...readSettings(agencyId), ...patch }),
    [agencyId],
  );

  /** Suma una consulta. Devuelve false si ya se llegó al tope del mes. */
  const consume = useCallback((): boolean => {
    const s = readSettings(agencyId);
    const n = readUsage(agencyId);
    if (s.monthlyLimit > 0 && n >= s.monthlyLimit) return false;
    writeJson(usageKey(agencyId), { month: monthId(), count: n + 1 });
    return true;
  }, [agencyId]);

  const limitReached = settings.monthlyLimit > 0 && used >= settings.monthlyLimit;
  return { settings, save, used, consume, limitReached };
}
