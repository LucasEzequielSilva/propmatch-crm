import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { VozData, VozKind } from "../../../shared/voz";

/**
 * Precarga por estado de navegación: el panel de Proppi navega a
 * /propiedades/nueva o /contactos con `{ state: vozNavState(resultado) }` y la
 * página lo aplica a su formulario UNA vez (después se limpia el estado para
 * que volver atrás o recargar no lo repita). No guarda nada.
 */

const KEY = "pmVoz";

export const vozNavState = (r: VozData) => ({ [KEY]: r });

function read(state: unknown, kind: VozKind): VozData | null {
  const v = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : null;
  return v && typeof v === "object" && (v as VozData).kind === kind && (v as VozData).data ? (v as VozData) : null;
}

export function useVozPrefill(kind: VozKind, apply: (r: VozData) => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const applyRef = useRef(apply);
  applyRef.current = apply;
  /** StrictMode corre el efecto dos veces: se aplica una sola por navegación. */
  const doneRef = useRef<string | null>(null);

  useEffect(() => {
    const r = read(location.state, kind);
    if (!r || doneRef.current === location.key) return;
    doneRef.current = location.key;
    const rest = { ...(location.state as Record<string, unknown>) };
    delete rest[KEY];
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: Object.keys(rest).length ? rest : null });
    applyRef.current(r);
    // Solo cuando llega una navegación nueva.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
}
