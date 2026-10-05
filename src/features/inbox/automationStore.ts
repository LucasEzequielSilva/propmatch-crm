import { defaultConfig, DEFAULT_HOURS, DEFAULT_SIGNATURE } from "./automationDefaults";
import type {
  AgencyHours,
  AutomationConfig,
  AutomationRule,
  AutomationStore,
  SentEntry,
  Snippet,
  TriggerType,
} from "./automationTypes";

const TRIGGERS: TriggerType[] = ["first_message", "off_hours", "new_match", "no_reply"];
const OPS = ["venta", "alquiler", "alquiler_temporal"] as const;

const str = (v: unknown, max: number, fallback = ""): string => (typeof v === "string" ? v.slice(0, max) : fallback);
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function sanitizeHours(raw: unknown): AgencyHours {
  const days = isObj(raw) && Array.isArray(raw.days) ? raw.days : [];
  return {
    days: DEFAULT_HOURS.days.map((d, i) => {
      const r = days[i];
      if (!isObj(r)) return { ...d };
      return {
        enabled: r.enabled === true,
        from: typeof r.from === "string" && HHMM.test(r.from) ? r.from : d.from,
        to: typeof r.to === "string" && HHMM.test(r.to) ? r.to : d.to,
      };
    }),
  };
}

function sanitizeRule(raw: unknown): AutomationRule | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !TRIGGERS.includes(raw.trigger as TriggerType)) return null;
  const sig = isObj(raw.signature) ? raw.signature : {};
  const filters = isObj(raw.filters) ? raw.filters : {};
  return {
    id: raw.id.slice(0, 80),
    name: str(raw.name, 80),
    trigger: raw.trigger as TriggerType,
    enabled: raw.enabled === true,
    enabledAt: typeof raw.enabledAt === "number" && Number.isFinite(raw.enabledAt) ? raw.enabledAt : null,
    channel: "app",
    template: str(raw.template, 1000),
    signature: {
      enabled: sig.enabled !== false,
      text: typeof sig.text === "string" ? sig.text.slice(0, 200) : DEFAULT_SIGNATURE,
    },
    delayMin: num(raw.delayMin, 0, 60, 1),
    afterHours: num(raw.afterHours, 1, 168, 24),
    filters: {
      operations: Array.isArray(filters.operations)
        ? OPS.filter((o) => (filters.operations as unknown[]).includes(o))
        : [],
      propertyIds: Array.isArray(filters.propertyIds)
        ? (filters.propertyIds as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200)
        : [],
    },
  };
}

/** Lo que hay en storage no es de fiar: se valida campo por campo y lo roto se descarta. */
export function sanitizeConfig(raw: unknown): AutomationConfig | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const base = defaultConfig();
  const snippets: Snippet[] = Array.isArray(raw.snippets)
    ? raw.snippets.flatMap((s): Snippet[] =>
        isObj(s) && typeof s.id === "string" && typeof s.text === "string"
          ? [
              {
                id: s.id.slice(0, 80),
                title: str(s.title, 60, "Sin título"),
                text: s.text.slice(0, 1000),
                ...(typeof s.factoryId === "string" ? { factoryId: s.factoryId } : {}),
              },
            ]
          : [],
      )
    : base.snippets;
  const rules = Array.isArray(raw.rules)
    ? raw.rules.map(sanitizeRule).filter((r): r is AutomationRule => r !== null)
    : [];
  return {
    v: 1,
    paused: raw.paused === true,
    hours: sanitizeHours(raw.hours),
    hoursText: str(raw.hoursText, 200),
    snippets,
    rules,
  };
}

export function createLocalAutomationStore(agencyId: string): AutomationStore {
  const key = `pm_inbox_automations_${agencyId}`;
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? sanitizeConfig(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    save(config) {
      try {
        localStorage.setItem(key, JSON.stringify(config));
        return true;
      } catch {
        return false;
      }
    },
  };
}

const LOG_MAX = 200;

export function createLocalSentLog(agencyId: string) {
  const key = `pm_inbox_automation_log_${agencyId}`;
  return {
    key,
    load(): SentEntry[] {
      try {
        const raw = JSON.parse(localStorage.getItem(key) ?? "[]");
        if (!Array.isArray(raw)) return [];
        return raw.flatMap((e): SentEntry[] =>
          isObj(e) &&
          typeof e.key === "string" &&
          typeof e.ruleId === "string" &&
          typeof e.matchId === "string" &&
          typeof e.at === "number" &&
          (e.status === "ok" || e.status === "error" || e.status === "pending")
            ? [
                {
                  key: e.key,
                  ruleId: e.ruleId,
                  matchId: e.matchId,
                  ruleName: str(e.ruleName, 80),
                  conversationName: str(e.conversationName, 120),
                  at: e.at,
                  status: e.status,
                  attempts: num(e.attempts, 0, 99, 0),
                  error: typeof e.error === "string" ? e.error.slice(0, 300) : undefined,
                  nextRetryAt: typeof e.nextRetryAt === "number" ? e.nextRetryAt : undefined,
                  text: str(e.text, 2200),
                },
              ]
            : [],
        );
      } catch {
        return [];
      }
    },
    save(entries: SentEntry[]) {
      try {
        const trimmed = [...entries].sort((a, b) => b.at - a.at).slice(0, LOG_MAX);
        localStorage.setItem(key, JSON.stringify(trimmed));
      } catch {
        /* sin storage: el registro queda solo en memoria */
      }
    },
  };
}
