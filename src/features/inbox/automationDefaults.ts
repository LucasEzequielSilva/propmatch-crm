import type { AgencyHours, AutomationConfig, AutomationRule, Snippet, TriggerType } from "./automationTypes";

export const DEFAULT_SIGNATURE = "Mensaje automático de {{inmobiliaria}}";

export const FACTORY_SNIPPETS: Snippet[] = [
  {
    id: "f-visita",
    factoryId: "visita",
    title: "Confirmar visita",
    text: "Hola {{nombre}}, ¿te queda bien coordinar una visita a {{propiedad}}? Decime qué día y horario te viene mejor y lo confirmo.",
  },
  {
    id: "f-requisitos",
    factoryId: "requisitos",
    title: "Pedir requisitos",
    text: "Hola {{nombre}}, para avanzar con {{propiedad}} necesito saber: presupuesto aproximado, fecha en la que querés mudarte y si la operación sería con crédito o contado.",
  },
  {
    id: "f-ubicacion",
    factoryId: "ubicacion",
    title: "Compartir ubicación",
    text: "Hola {{nombre}}, te paso la ubicación: {{direccion}}.",
  },
];

export const DEFAULT_HOURS: AgencyHours = {
  days: [
    { enabled: false, from: "09:00", to: "13:00" },
    ...Array.from({ length: 5 }, () => ({ enabled: true, from: "09:00", to: "18:00" })),
    { enabled: false, from: "09:00", to: "13:00" },
  ],
};

export interface RuleTemplate {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  rule: Pick<AutomationRule, "name" | "trigger" | "template" | "delayMin" | "afterHours">;
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: "bienvenida",
    title: "Bienvenida",
    description: "Confirma que recibiste la consulta cuando alguien escribe por primera vez.",
    defaultEnabled: true,
    rule: {
      name: "Bienvenida",
      trigger: "first_message",
      delayMin: 1,
      afterHours: 24,
      template:
        "¡Hola {{nombre}}! Gracias por escribirnos por {{propiedad}}. Recibimos tu consulta y alguien del equipo de {{inmobiliaria}} te va a responder por acá.",
    },
  },
  {
    id: "fuera-de-horario",
    title: "Fuera de horario",
    description: "Avisa cuándo atendés si te escriben cuando no hay nadie.",
    defaultEnabled: true,
    rule: {
      name: "Fuera de horario",
      trigger: "off_hours",
      delayMin: 0,
      afterHours: 24,
      template:
        "Hola {{nombre}}, gracias por tu mensaje. En este momento estamos fuera de horario; atendemos {{horario}}. Cuando retomemos te respondemos por acá.",
    },
  },
  {
    id: "seguimiento",
    title: "Seguimiento",
    description: "Un único recordatorio si el cliente no contestó. Viene pausada.",
    defaultEnabled: false,
    rule: {
      name: "Seguimiento",
      trigger: "no_reply",
      delayMin: 0,
      afterHours: 24,
      template:
        "Hola {{nombre}}, ¿pudiste ver mi mensaje sobre {{propiedad}}? Si querés más información o coordinar una visita, escribime por acá.\n{{agente}}",
    },
  },
];

let seq = 0;
export function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
  }
}

export function newRule(trigger: TriggerType = "first_message", partial: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: newId("r"),
    name: "",
    trigger,
    enabled: false,
    enabledAt: null,
    channel: "app",
    template: "",
    signature: { enabled: true, text: DEFAULT_SIGNATURE },
    delayMin: 1,
    afterHours: 24,
    filters: { operations: [], propertyIds: [] },
    ...partial,
  };
}

export function defaultConfig(): AutomationConfig {
  return {
    v: 1,
    paused: false,
    hours: DEFAULT_HOURS,
    hoursText: "",
    snippets: FACTORY_SNIPPETS.map((s) => ({ ...s })),
    rules: [],
  };
}
