/**
 * Visitas reales de la app para la Agenda. SOLO LECTURA.
 *
 * Es un fetch aparte del de `leadSync.fetchAgencyVisits` (que solo trae lo
 * necesario para convertir una visita nueva en actividad, una sola vez): acá
 * se necesitan fecha, duración y estado actuales, y se vuelven a pedir en
 * cada poll. Nada de esto se copia al localStorage: la Agenda las mezcla en
 * memoria con los eventos locales. El estado lo gestionan las partes desde la
 * app; el CRM no lo cambia.
 */

import { supabase } from "./supabase";

export type AppVisitStatus = "proposed" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface AppVisitRow {
  id: string;
  match_id: string;
  demandante_id: string;
  property_id: string;
  scheduled_at: string;
  duration_min: number;
  status: AppVisitStatus;
  note: string | null;
  created_at: string;
}

export async function fetchAgendaVisits(agencyId: string): Promise<AppVisitRow[]> {
  const { data, error } = await supabase
    .from("visits")
    .select(
      "id, match_id, demandante_id, property_id, scheduled_at, duration_min, status, note, created_at, properties!inner(agency_id)",
    )
    .eq("properties.agency_id", agencyId)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as AppVisitRow[]).map((r) => ({
    id: r.id,
    match_id: r.match_id,
    demandante_id: r.demandante_id,
    property_id: r.property_id,
    scheduled_at: r.scheduled_at,
    duration_min: r.duration_min ?? 30,
    status: r.status,
    note: r.note,
    created_at: r.created_at,
  }));
}
