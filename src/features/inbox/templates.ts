import { money } from "@/lib/format";
import type { Conversation } from "./conversations";
import { addressOf } from "./snippets";

export const VARIABLES = [
  { name: "nombre", label: "Nombre", help: "Primer nombre del contacto" },
  { name: "propiedad", label: "Propiedad", help: "Título de la propiedad" },
  { name: "direccion", label: "Dirección", help: "Dirección de la propiedad" },
  { name: "precio", label: "Precio", help: "Precio con moneda" },
  { name: "agente", label: "Agente", help: "Quien atiende la conversación" },
  { name: "inmobiliaria", label: "Inmobiliaria", help: "Nombre de tu inmobiliaria" },
  { name: "horario", label: "Horario", help: "Horario de atención" },
] as const;

export type VariableName = (typeof VARIABLES)[number]["name"];
export type TemplateContext = Partial<Record<VariableName, string | null | undefined>>;

const TOKEN = /\{\{([^{}]*)\}\}/g;
const KNOWN = new Set<string>(VARIABLES.map((v) => v.name));

// Saludo sin nombre: "Hola {{nombre}}," pasa a "Hola," en vez de dejar un hueco.
const GREETING_NAME = /\b(hola|buenas(?: tardes| noches)?|buen d[ií]a|buenos d[ií]as)(,?)\s*\{\{\s*nombre\s*\}\}/gi;
const DANGLING_PREP = /\s+(?:por|sobre|en|de|con|para)(?=\s*(?:[.,;:!?)]|$))/gim;

function clean(s: string, hadEmpty: boolean): string {
  let out = s;
  if (hadEmpty) out = out.replace(DANGLING_PREP, "");
  return out
    .split("\n")
    .map((l) =>
      l
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
        .replace(/\(\s*\)/g, "")
        .trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reemplaza `{{variable}}` sin evaluar nada. Una variable desconocida o sin
 * dato queda vacía (nunca se deja el `{{x}}` literal en un mensaje que sale).
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  let hadEmpty = false;
  let src = template;
  if (!ctx.nombre?.trim()) src = src.replace(GREETING_NAME, (_m, hi: string, comma: string) => `${hi}${comma}`);
  const replaced = src.replace(TOKEN, (_m, raw: string) => {
    const name = raw.trim();
    const value = KNOWN.has(name) ? ctx[name as VariableName]?.toString().trim() : "";
    if (!value) {
      hadEmpty = true;
      return name === "nombre" && KNOWN.has(name) ? "¡Hola!" : "";
    }
    return value;
  });
  // Llaves sueltas que quedaron mal escritas tampoco deben salir.
  return clean(replaced.replace(/\{\{|\}\}/g, ""), hadEmpty);
}

export interface TemplateIssue {
  level: "error" | "warning";
  message: string;
}

export function validateTemplate(template: string): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (!template.trim()) issues.push({ level: "error", message: "El mensaje está vacío." });
  const unknown = new Set<string>();
  for (const m of template.matchAll(TOKEN)) {
    const name = m[1].trim();
    if (!KNOWN.has(name)) unknown.add(name || "(vacía)");
  }
  if (unknown.size)
    issues.push({
      level: "error",
      message: `Variable desconocida: ${[...unknown].map((n) => `{{${n}}}`).join(", ")}. Se enviaría vacía.`,
    });
  const opens = (template.match(/\{\{/g) ?? []).length;
  const closes = (template.match(/\}\}/g) ?? []).length;
  if (opens !== closes) issues.push({ level: "error", message: "Hay llaves sin cerrar: cada {{ necesita su }}." });
  else if (/(?<!\{)\{[a-záéíóúñ_]+\}(?!\})/i.test(template))
    issues.push({ level: "warning", message: "Usá doble llave, por ejemplo {{nombre}}, no {nombre}." });
  if (template.length > 1000) issues.push({ level: "error", message: "Máximo 1000 caracteres." });
  return issues;
}

export function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

export interface TemplateEnv {
  agencyName: string;
  agentName: string;
  horario: string;
}

export function buildTemplateContext(conv: Conversation, env: TemplateEnv): TemplateContext {
  const p = conv.property;
  return {
    nombre: firstName(conv.contact?.full_name),
    propiedad: p?.title ?? "",
    direccion: addressOf(p) ?? "",
    precio: p?.price != null ? money(p.price, p.currency) : "",
    agente: env.agentName,
    inmobiliaria: env.agencyName,
    horario: env.horario,
  };
}

export function sampleContext(env: TemplateEnv): TemplateContext {
  return {
    nombre: "Camila",
    propiedad: "Departamento 3 ambientes en Palermo",
    direccion: "Gorriti 4800, Palermo",
    precio: money(185000, "USD"),
    agente: env.agentName || "Martín",
    inmobiliaria: env.agencyName,
    horario: env.horario,
  };
}

/** Variables de propiedad que usa la plantilla y la conversación no tiene (para deshabilitar la respuesta rápida). */
export function missingPropertyVars(template: string, ctx: TemplateContext): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN)) {
    const n = m[1].trim() as VariableName;
    if ((n === "propiedad" || n === "direccion" || n === "precio") && !ctx[n]?.trim() && !out.includes(n)) out.push(n);
  }
  return out;
}
