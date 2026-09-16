/**
 * Seguimiento automático: a quién escribirle hoy y por qué.
 *
 * Los leads se pierden por olvido, no por falta de propiedades. Este módulo
 * mira la última vez que alguien del equipo habló con cada contacto (WhatsApp,
 * llamada, visita, cambio de etapa) y aplica las reglas de un agente ordenado:
 *
 *   Lead nuevo sin respuesta        24 h       (urgente: el que contesta primero gana)
 *   Visita ya hecha                 al día siguiente, "¿qué te pareció?"
 *   Oportunidad en negociación      cada 3 días
 *   Cliente con propiedades nuevas  apenas aparecen
 *   Cliente activo                  cada 7 días
 *   Propietario con propiedades     cada 30 días (informe)
 *
 * Si ya hay algo agendado a futuro con el contacto, no se lo marca: el
 * seguimiento ya existe. Nada de esto se guarda; se recalcula con los datos.
 */

import type { Activity, CalendarEvent, Contact, Match, Opportunity, Property } from "@/types/db";

export type FollowUpTemplate = "saludo" | "postvisita" | "propiedad" | "seguimiento" | "informe";

export interface FollowUp {
  contact: Contact;
  /** "Lead nuevo sin respuesta" */
  reason: string;
  /** Días desde el último contacto (o desde el alta si nunca hubo). */
  daysSince: number;
  priority: 1 | 2 | 3; // 1 = urgente
  template: FollowUpTemplate;
  /** Propiedad para el mensaje (la visitada, la nueva que matchea o la del propietario). */
  propertyId: string | null;
}

const DAY = 86_400_000;

/** Actividades que cuentan como "hablamos". Las automáticas (un match nuevo, un alta) no. */
const TOUCH_TYPES = new Set<Activity["type"]>(["mensaje", "llamada", "visita_programada", "etapa_avanzada", "nota"]);

const RULE = {
  newLeadDays: 1,
  /** Hasta cuántos días desde el alta un contacto sin historial cuenta como lead nuevo. */
  freshLeadDays: 14,
  negotiationDays: 3,
  activeDays: 7,
  ownerDays: 30,
  /** Una visita hecha hace más de esto ya no dispara el "¿qué te pareció?". */
  postVisitWindowDays: 3,
  /** Solo matches buenos justifican escribir por una propiedad nueva. */
  newMatchScore: 70,
};

export interface FollowUpData {
  contacts: Contact[];
  activities: Activity[];
  events: CalendarEvent[];
  opportunities: Opportunity[];
  matches: Match[];
  properties: Property[];
  snoozes: Record<string, string>;
}

export function lastTouch(contactId: string, data: Pick<FollowUpData, "activities" | "events">, now: number): number | null {
  let last: number | null = null;
  for (const a of data.activities) {
    if (a.contact_id !== contactId || !TOUCH_TYPES.has(a.type)) continue;
    const t = new Date(a.created_at).getTime();
    if (t <= now && (last === null || t > last)) last = t;
  }
  for (const e of data.events) {
    if (e.contact_id !== contactId) continue;
    const t = new Date(e.starts_at).getTime();
    if (t <= now && (last === null || t > last)) last = t;
  }
  return last;
}

export function computeFollowUps(data: FollowUpData, now = Date.now()): FollowUp[] {
  const out: FollowUp[] = [];

  for (const contact of data.contacts) {
    if (contact.status === "cerrado" || contact.status === "perdido") continue;

    const snoozedUntil = data.snoozes[contact.id];
    if (snoozedUntil && new Date(snoozedUntil).getTime() > now) continue;

    // Algo agendado a futuro: el seguimiento ya está en la agenda.
    if (data.events.some((e) => e.contact_id === contact.id && new Date(e.starts_at).getTime() > now)) continue;

    const touch = lastTouch(contact.id, data, now);
    const since = touch ?? new Date(contact.created_at).getTime();
    const daysSince = Math.floor((now - since) / DAY);

    // Propietario: informe periódico, solo si tiene algo en venta.
    if (contact.kind === "propietario") {
      const owned = data.properties.filter(
        (p) => p.owner_contact_id === contact.id && (p.status === "disponible" || p.status === "reservada"),
      );
      if (owned.length && daysSince >= RULE.ownerDays) {
        out.push({
          contact,
          reason: `Informe al propietario: hace ${daysSince} días sin novedades`,
          daysSince,
          priority: 3,
          template: "informe",
          propertyId: owned[0].id,
        });
      }
      continue;
    }

    // Lead nuevo al que nadie le escribió. Un contacto viejo sin historial
    // cargado no es un "lead nuevo": sigue por las reglas de abajo.
    const isFreshLead = contact.status === "nuevo" || daysSince <= RULE.freshLeadDays;
    if (touch === null && isFreshLead && daysSince >= RULE.newLeadDays) {
      out.push({
        contact,
        reason: daysSince === 1 ? "Lead nuevo sin respuesta desde ayer" : `Lead nuevo sin respuesta hace ${daysSince} días`,
        daysSince,
        priority: 1,
        template: "saludo",
        propertyId: null,
      });
      continue;
    }

    // Visita reciente sin contacto posterior.
    const lastVisit = data.events
      .filter((e) => e.contact_id === contact.id && e.type === "visita" && new Date(e.ends_at).getTime() <= now)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at))[0];
    if (lastVisit) {
      const visitEnd = new Date(lastVisit.ends_at).getTime();
      const touchedAfter = data.activities.some(
        (a) => a.contact_id === contact.id && TOUCH_TYPES.has(a.type) && new Date(a.created_at).getTime() > visitEnd,
      );
      const daysFromVisit = (now - visitEnd) / DAY;
      if (!touchedAfter && daysFromVisit >= 0.5 && daysFromVisit <= RULE.postVisitWindowDays) {
        out.push({
          contact,
          reason: "Tuvo una visita: preguntale qué le pareció",
          daysSince,
          priority: 1,
          template: "postvisita",
          propertyId: lastVisit.property_id,
        });
        continue;
      }
    }

    // Negociación: no dejarla enfriar.
    const negotiating = data.opportunities.find((o) => o.contact_id === contact.id && o.stage === "negociacion");
    if (negotiating && daysSince >= RULE.negotiationDays) {
      out.push({
        contact,
        reason: `En negociación y hace ${daysSince} días sin hablar`,
        daysSince,
        priority: 1,
        template: "seguimiento",
        propertyId: negotiating.property_id,
      });
      continue;
    }

    // Propiedades nuevas para mostrarle desde la última charla.
    const fresh = data.matches
      .filter(
        (m) =>
          m.contact_id === contact.id &&
          m.score >= RULE.newMatchScore &&
          new Date(m.created_at).getTime() > since &&
          !data.activities.some((a) => a.type === "mensaje" && a.contact_id === contact.id && a.property_id === m.property_id),
      )
      .sort((a, b) => b.score - a.score);
    if (fresh.length) {
      out.push({
        contact,
        reason:
          fresh.length === 1
            ? "Entró una propiedad que le sirve"
            : `Entraron ${fresh.length} propiedades que le sirven`,
        daysSince,
        priority: 2,
        template: "propiedad",
        propertyId: fresh[0].property_id,
      });
      continue;
    }

    if (daysSince >= RULE.activeDays) {
      out.push({
        contact,
        reason: `Hace ${daysSince} días sin contacto`,
        daysSince,
        priority: daysSince >= RULE.activeDays * 3 ? 2 : 3,
        template: "seguimiento",
        propertyId: null,
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority || b.daysSince - a.daysSince);
}

/** "hoy", "ayer", "hace 9 días", "nunca" */
export function touchLabel(touch: number | null, now = Date.now()): string {
  if (touch === null) return "nunca";
  const days = Math.floor((now - touch) / DAY);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}
