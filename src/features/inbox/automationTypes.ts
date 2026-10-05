export type TriggerType = "first_message" | "off_hours" | "new_match" | "no_reply";
export type OperationFilter = "venta" | "alquiler" | "alquiler_temporal";

export interface Snippet {
  id: string;
  title: string;
  text: string;
  /** Si viene de las de fábrica, para poder restaurarla. */
  factoryId?: string;
}

export interface DayHours {
  enabled: boolean;
  /** "HH:MM" en hora de Buenos Aires. */
  from: string;
  to: string;
}

/** Índice 0 = domingo (igual que `Date#getUTCDay`). */
export interface AgencyHours {
  days: DayHours[];
}

export interface AutomationRule {
  id: string;
  name: string;
  trigger: TriggerType;
  enabled: boolean;
  /** Se usa para no disparar sobre hechos anteriores a que la regla se prendiera. */
  enabledAt: number | null;
  /** Por ahora solo el chat de la app. */
  channel: "app";
  template: string;
  signature: { enabled: boolean; text: string };
  /** first_message: minutos de espera. */
  delayMin: number;
  /** no_reply: horas sin respuesta del cliente. */
  afterHours: number;
  filters: { operations: OperationFilter[]; propertyIds: string[] };
}

export interface AutomationConfig {
  v: 1;
  paused: boolean;
  hours: AgencyHours;
  /** Texto libre para {{horario}}; vacío = se arma solo desde `hours`. */
  hoursText: string;
  snippets: Snippet[];
  rules: AutomationRule[];
}

export interface SentEntry {
  /** `${ruleId}:${matchId}` */
  key: string;
  ruleId: string;
  ruleName: string;
  matchId: string;
  conversationName: string;
  at: number;
  status: "ok" | "error" | "pending";
  attempts: number;
  error?: string;
  nextRetryAt?: number;
  text: string;
}

export interface AutomationStore {
  load(): AutomationConfig | null;
  /** Devuelve false si no se pudo guardar (sin storage, cuota, etc.). */
  save(config: AutomationConfig): boolean;
}

export const TRIGGER_META: Record<TriggerType, { label: string; hint: string; proactive?: boolean }> = {
  first_message: {
    label: "Primer mensaje",
    hint: "Un contacto escribe y nadie del equipo respondió todavía en esa conversación.",
  },
  off_hours: {
    label: "Fuera de horario",
    hint: "Llega un mensaje del cliente fuera del horario de atención. Máximo 1 vez cada 12 h por conversación.",
  },
  new_match: {
    label: "Match nuevo sin mensajes",
    hint: "Hay un nuevo interesado y todavía nadie escribió.",
    proactive: true,
  },
  no_reply: {
    label: "Sin respuesta del cliente",
    hint: "El cliente no contestó nuestro último mensaje. Máximo 1 recordatorio por conversación.",
  },
};
