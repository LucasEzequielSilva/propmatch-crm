/**
 * Lo que se le cuenta al propietario sobre su propiedad.
 *
 * Es la pregunta que más hacen ("¿y, se movió algo?") y la que más cuesta
 * contestar sin CRM. Todo sale de datos que ya existen: matches, pipeline,
 * agenda y los WhatsApp enviados.
 */

import type { Activity, CalendarEvent, Match, Opportunity } from "@/types/db";

export interface OwnerReport {
  /** Contactos de la cartera cuya búsqueda coincide. */
  interested: number;
  /** Clientes a los que ya se les mandó la propiedad. */
  sentTo: number;
  /** Oportunidades abiertas sobre la propiedad. */
  inProgress: number;
  visitsDone: number;
  visitsUpcoming: number;
}

export function ownerReport(
  propertyId: string,
  data: { matches: Match[]; opportunities: Opportunity[]; events: CalendarEvent[]; activities: Activity[] },
  now = Date.now(),
): OwnerReport {
  const visits = data.events.filter((e) => e.property_id === propertyId && e.type === "visita");
  return {
    interested: data.matches.filter((m) => m.property_id === propertyId).length,
    sentTo: new Set(
      data.activities
        .filter((a) => a.type === "mensaje" && a.property_id === propertyId && a.contact_id)
        .map((a) => a.contact_id),
    ).size,
    inProgress: data.opportunities.filter(
      (o) => o.property_id === propertyId && o.stage !== "perdida" && o.stage !== "cierre",
    ).length,
    visitsDone: visits.filter((e) => new Date(e.starts_at).getTime() <= now).length,
    visitsUpcoming: visits.filter((e) => new Date(e.starts_at).getTime() > now).length,
  };
}

/** Último WhatsApp mandado a un contacto sobre una propiedad, si hubo. */
export function lastSentAbout(activities: Activity[], contactId: string, propertyId: string): Activity | undefined {
  return activities.find((a) => a.type === "mensaje" && a.contact_id === contactId && a.property_id === propertyId);
}
