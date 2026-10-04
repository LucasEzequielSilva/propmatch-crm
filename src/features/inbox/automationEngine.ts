import { useEffect, useRef } from "react";
import { fetchMatchMessages, sendMatchMessage, type MessageRow } from "@/lib/leadSync";
import type { Conversation } from "./conversations";
import type { AgencyHours, AutomationRule, SentEntry, TriggerType } from "./automationTypes";
import { refreshInboxFeed } from "./inboxFeed";
import { loadSentLog, upsertSent } from "./automationState";
import { renderTemplate, type TemplateContext } from "./templates";

export const MAX_SENDS_PER_CYCLE = 3;
export const MAX_ATTEMPTS = 3;
const OFF_HOURS_COOLDOWN_MS = 12 * 3600_000;
const PENDING_TTL_MS = 2 * 60_000;
const MIN = 60_000;
const HOUR = 3600_000;
// Un hecho viejo no dispara una respuesta: llegaría desfasada y confundiría.
const MAX_AGE: Record<TriggerType, number> = {
  first_message: 24 * HOUR,
  off_hours: 24 * HOUR,
  new_match: 24 * HOUR,
  no_reply: 7 * 24 * HOUR,
};
// Si dos reglas aplican a la misma conversación, gana la más específica.
const PRIORITY: TriggerType[] = ["off_hours", "first_message", "new_match", "no_reply"];

export interface PlannedSend {
  ruleId: string;
  matchId: string;
  text: string;
}

export interface PlanInput {
  conversations: Conversation[];
  messagesByMatch: Record<string, MessageRow[]>;
  rules: AutomationRule[];
  sentLog: SentEntry[];
  now: number;
  agencyHours: AgencyHours;
  renderContext: (c: Conversation) => TemplateContext;
}

// Argentina no tiene horario de verano: UTC-3 todo el año, así que alcanza con
// correr el reloj 3 h y evitar depender de Intl en una función pura.
const AR_OFFSET_MS = -3 * HOUR;

export function isWithinHours(ms: number, hours: AgencyHours): boolean {
  const d = new Date(ms + AR_OFFSET_MS);
  const day = hours.days[d.getUTCDay()];
  if (!day?.enabled) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  const [fh, fm] = day.from.split(":").map(Number);
  const [th, tm] = day.to.split(":").map(Number);
  return mins >= fh * 60 + fm && mins < th * 60 + tm;
}

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const hourLabel = (hhmm: string) => {
  const [h, m] = hhmm.split(":");
  return m === "00" ? `${Number(h)}` : `${Number(h)}:${m}`;
};

/** "de lunes a viernes de 9 a 18 h" — agrupa días contiguos con la misma franja. */
export function summarizeHours(hours: AgencyHours): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { days: number[]; from: string; to: string }[] = [];
  for (const i of order) {
    const d = hours.days[i];
    if (!d.enabled) continue;
    const last = groups[groups.length - 1];
    const prev = last?.days[last.days.length - 1];
    if (last && last.from === d.from && last.to === d.to && prev !== undefined && order.indexOf(prev) === order.indexOf(i) - 1)
      last.days.push(i);
    else groups.push({ days: [i], from: d.from, to: d.to });
  }
  if (!groups.length) return "en horarios a coordinar";
  return groups
    .map((g) => {
      const days =
        g.days.length === 1
          ? `los ${DAY_NAMES[g.days[0]]}`
          : g.days.length === 2
            ? `${DAY_NAMES[g.days[0]]} y ${DAY_NAMES[g.days[1]]}`
            : `de ${DAY_NAMES[g.days[0]]} a ${DAY_NAMES[g.days[g.days.length - 1]]}`;
      return `${days} de ${hourLabel(g.from)} a ${hourLabel(g.to)} h`;
    })
    .join(" y ");
}

export function composeText(rule: Pick<AutomationRule, "template" | "signature">, ctx: TemplateContext): string {
  const body = renderTemplate(rule.template, ctx);
  if (!body) return "";
  const sig = rule.signature.enabled ? renderTemplate(rule.signature.text, ctx) : "";
  return sig ? `${body}\n\n${sig}` : body;
}

const ts = (m: MessageRow | undefined) => (m ? Date.parse(m.created_at) : NaN);

function passesFilters(rule: AutomationRule, c: Conversation): boolean {
  const { operations, propertyIds } = rule.filters;
  if (!operations.length && !propertyIds.length) return true;
  if (!c.property) return false;
  if (operations.length && !operations.includes(c.property.operation)) return false;
  if (propertyIds.length && !propertyIds.includes(c.property.id)) return false;
  return true;
}

/** Cuándo ocurrió el hecho y desde cuándo corresponde responder; null si la regla no aplica. */
function trigger(
  rule: AutomationRule,
  c: Conversation,
  msgs: MessageRow[],
  hours: AgencyHours,
): { at: number; due: number } | null {
  const isClient = (m: MessageRow) => m.sender_id === c.demandanteId;
  const last = msgs[msgs.length - 1];
  switch (rule.trigger) {
    case "first_message": {
      if (!msgs.length || msgs.some((m) => !isClient(m))) return null;
      const at = ts(msgs[0]);
      return { at, due: at + rule.delayMin * MIN };
    }
    case "off_hours": {
      if (!last || !isClient(last)) return null;
      const at = ts(last);
      return isWithinHours(at, hours) ? null : { at, due: at };
    }
    case "new_match": {
      if (msgs.length) return null;
      const at = Date.parse(c.lastAt);
      return { at, due: at };
    }
    case "no_reply": {
      if (!last || isClient(last)) return null;
      const at = ts(last);
      return { at, due: at + rule.afterHours * HOUR };
    }
  }
}

function blockedByLog(rule: AutomationRule, entry: SentEntry | undefined, now: number): boolean {
  if (!entry) return false;
  if (entry.status === "pending") return now - entry.at < PENDING_TTL_MS;
  if (entry.status === "error") return entry.attempts >= MAX_ATTEMPTS || now < (entry.nextRetryAt ?? Infinity);
  return rule.trigger === "off_hours" ? now - entry.at < OFF_HOURS_COOLDOWN_MS : true;
}

/**
 * Decide qué mensajes automáticos corresponde mandar ahora. Pura: no lee
 * storage ni red, así se puede probar y, más adelante, correr igual en un
 * servidor. A lo sumo un envío por conversación y ciclo.
 */
export function planAutomations(input: PlanInput): PlannedSend[] {
  const { conversations, messagesByMatch, sentLog, now, agencyHours } = input;
  const rules = input.rules
    .filter((r) => r.enabled && r.channel === "app")
    .sort((a, b) => PRIORITY.indexOf(a.trigger) - PRIORITY.indexOf(b.trigger));
  if (!rules.length) return [];
  const logByKey = new Map(sentLog.map((e) => [e.key, e]));
  const out: PlannedSend[] = [];

  for (const c of conversations) {
    if (!c.demandanteId) continue;
    const msgs = messagesByMatch[c.matchId] ?? [];
    for (const rule of rules) {
      if (!passesFilters(rule, c)) continue;
      const t = trigger(rule, c, msgs, agencyHours);
      if (!t || !Number.isFinite(t.at)) continue;
      if (rule.enabledAt === null || t.at < rule.enabledAt) continue;
      if (now - t.at > MAX_AGE[rule.trigger] || now < t.due) continue;
      if (blockedByLog(rule, logByKey.get(`${rule.id}:${c.matchId}`), now)) continue;
      const text = composeText(rule, input.renderContext(c));
      if (!text) continue;
      // Otro navegador (o una persona) ya mandó lo mismo.
      if (msgs.some((m) => m.sender_id !== c.demandanteId && m.content?.trim() === text)) continue;
      out.push({ ruleId: rule.id, matchId: c.matchId, text });
      break;
    }
  }
  return out;
}

/** Mensaje enviado por una regla desde este navegador (el servidor no lo distingue de uno humano). */
export function isAutomaticMessage(m: MessageRow, demandanteId: string, log: SentEntry[]): boolean {
  if (m.sender_id === demandanteId) return false;
  return log.some((e) => e.status === "ok" && e.matchId === m.match_id && e.text === m.content?.trim());
}

export interface RunnerInput {
  agencyId: string;
  userId: string | null;
  /** El feed ya cargó sin error para esta agencia. */
  ready: boolean;
  paused: boolean;
  rules: AutomationRule[];
  hours: AgencyHours;
  conversations: Conversation[];
  messagesByMatch: Record<string, MessageRow[]>;
  renderContext: (c: Conversation) => TemplateContext;
}

/**
 * Evalúa en cada ciclo del feed (cambia `messagesByMatch`); no hace su propio
 * polling. Antes de enviar vuelve a pedir los mensajes al servidor y recalcula,
 * para no duplicar si otro navegador o una persona ya respondió.
 */
export function useAutomationRunner(input: RunnerInput) {
  const latest = useRef(input);
  latest.current = input;
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const cur = latest.current;
    if (!cur.ready || !cur.userId || cur.paused || running.current) return;
    if (!cur.rules.some((r) => r.enabled)) return;
    const userId = cur.userId;

    const planWith = (convs: Conversation[], msgs: Record<string, MessageRow[]>) =>
      planAutomations({
        conversations: convs,
        messagesByMatch: msgs,
        rules: latest.current.rules,
        sentLog: loadSentLog(cur.agencyId),
        now: Date.now(),
        agencyHours: latest.current.hours,
        renderContext: latest.current.renderContext,
      });

    const run = async () => {
      running.current = true;
      try {
        const plan = planWith(cur.conversations, cur.messagesByMatch).slice(0, MAX_SENDS_PER_CYCLE);
        for (const p of plan) {
          if (!alive.current || latest.current.paused) break;
          const conv = cur.conversations.find((c) => c.matchId === p.matchId);
          const rule = latest.current.rules.find((r) => r.id === p.ruleId);
          if (!conv || !rule) continue;
          let fresh: MessageRow[];
          try {
            fresh = await fetchMatchMessages(p.matchId);
          } catch {
            continue;
          }
          const again = planWith([conv], { [p.matchId]: fresh }).find((x) => x.ruleId === p.ruleId);
          if (!again || !alive.current) continue;

          const key = `${rule.id}:${p.matchId}`;
          const prev = loadSentLog(cur.agencyId).find((e) => e.key === key);
          const attempts = (prev?.status === "error" ? prev.attempts : 0) + 1;
          const base: SentEntry = {
            key,
            ruleId: rule.id,
            ruleName: rule.name || "Sin nombre",
            matchId: p.matchId,
            conversationName: conv.name,
            at: Date.now(),
            status: "pending",
            attempts,
            text: again.text,
          };
          // Se reserva antes de enviar para que otra pestaña no mande lo mismo.
          upsertSent(cur.agencyId, base);
          const { error } = await sendMatchMessage(p.matchId, userId, again.text);
          if (error) {
            upsertSent(cur.agencyId, {
              ...base,
              at: Date.now(),
              status: "error",
              error,
              nextRetryAt: Date.now() + Math.min(60, 2 ** attempts * 2) * MIN,
            });
            break;
          }
          upsertSent(cur.agencyId, { ...base, at: Date.now(), status: "ok" });
          refreshInboxFeed();
        }
      } finally {
        running.current = false;
      }
    };
    void run();
  }, [input.messagesByMatch, input.ready, input.paused, input.rules]);
}
