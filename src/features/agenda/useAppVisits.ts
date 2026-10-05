import { useEffect, useState } from "react";
import { isLinkedAgencyId, useStore } from "@/data/store";
import { fetchAgendaVisits, type AppVisitRow } from "@/lib/agendaVisits";

const POLL_MS = 60_000;

export interface AppVisitsState {
  visits: AppVisitRow[];
  /** `false` en la demo o en una cuenta sin inmobiliaria: no hay visitas de la app que traer. */
  enabled: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Visitas reales de la app, en memoria. Se vuelven a pedir cada minuto para
 * que un cambio de horario o de estado hecho en la app se vea en la Agenda.
 */
export function useAppVisits(): AppVisitsState {
  const { agency, currentUserId } = useStore();
  const enabled = Boolean(currentUserId) && isLinkedAgencyId(agency.id);
  const [visits, setVisits] = useState<AppVisitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisits([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const rows = await fetchAgendaVisits(agency.id);
        if (cancelled) return;
        setVisits(rows);
        setError(null);
      } catch (err) {
        console.error("No se pudieron traer las visitas de la app", err);
        if (!cancelled) setError("No pudimos traer las visitas de la app. Reintentamos en un minuto.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    const t = setInterval(run, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled, agency.id]);

  return { visits, enabled, loading, error };
}
