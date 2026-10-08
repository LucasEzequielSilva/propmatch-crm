/**
 * De los datos del CRM a los ítems que van a Google (link .ics y conexión
 * directa). Solo lo del agente (dueño = él, o sin asignar), sin datos de
 * ejemplo, sin cancelados y con lo mínimo: título, horario, tipo, cliente,
 * propiedad y dirección. Nunca precios, notas ni teléfonos.
 */
import type { CalendarEvent, Contact, Property, Task } from "@/types/db";
import { STATUS_META, propertyAddress, type AgendaItem } from "@/features/agenda/agendaModel";
import {
  eventIsSyncable,
  eventToItem,
  inFeedWindow,
  taskIsSyncable,
  taskToItem,
  visitIsSyncable,
  visitToItem,
  type GcalItem,
} from "../../../shared/gcal";

export interface CrmSources {
  events: CalendarEvent[];
  tasks: Task[];
  contacts: Contact[];
  properties: Property[];
  userId: string;
}

function lookups(contacts: Contact[], properties: Property[]) {
  const c = new Map(contacts.map((x) => [x.id, x]));
  const p = new Map(properties.map((x) => [x.id, x]));
  return {
    contactName: (id: string | null) => (id ? c.get(id)?.full_name ?? null : null),
    property: (id: string | null) => (id ? p.get(id) : undefined),
  };
}

/** Eventos y tareas del CRM que van al calendario del agente (sin ventana de fechas). */
export function crmItems(s: CrmSources): GcalItem[] {
  const l = lookups(s.contacts, s.properties);
  const out: GcalItem[] = [];
  for (const e of s.events) {
    if (!eventIsSyncable(e, s.userId)) continue;
    const prop = l.property(e.property_id);
    out.push(eventToItem(e, { contactName: l.contactName(e.contact_id), propertyTitle: prop?.title ?? null, address: propertyAddress(prop) }));
  }
  for (const t of s.tasks) {
    if (!taskIsSyncable(t, s.userId)) continue;
    out.push(taskToItem(t, { contactName: l.contactName(t.contact_id), propertyTitle: null, address: null }));
  }
  return out;
}

/** Visitas pedidas desde la app (las que la Agenda ya resolvió como AgendaItem) asignadas al agente. */
export function appVisitItems(items: AgendaItem[], s: Pick<CrmSources, "contacts" | "properties" | "userId">): GcalItem[] {
  const l = lookups(s.contacts, s.properties);
  const out: GcalItem[] = [];
  for (const i of items) {
    if (i.source !== "app") continue;
    const v = {
      id: i.id,
      title: i.title,
      start: i.start,
      end: i.end,
      ownerId: i.ownerId,
      statusLabel: i.status ? STATUS_META[i.status].label : null,
      cancelled: i.status === "cancelada",
    };
    if (!visitIsSyncable(v, s.userId)) continue;
    const prop = l.property(i.propertyId);
    out.push(
      visitToItem(v, {
        contactName: l.contactName(i.contactId) ?? i.contactFallback,
        propertyTitle: prop?.title ?? null,
        address: propertyAddress(prop),
      }),
    );
  }
  return out;
}

/** Lo que entra en el link de suscripción (30 días atrás a 6 meses adelante). */
export function feedItems(items: GcalItem[], now = new Date()): GcalItem[] {
  return items.filter((i) => inFeedWindow(i, now));
}
