import { useCallback, useEffect, useRef } from "react";
import { isLinkedAgencyId, useStore } from "@/data/store";
import type { ToolData } from "@/lib/proppi/tools";

/**
 * Datos que leen las tools, siempre frescos (ref al último render del store):
 * el loop de tool use es asíncrono y puede durar varios segundos.
 */
export function useToolData(): () => ToolData {
  const s = useStore();
  const ref = useRef<ToolData | null>(null);
  ref.current = {
    agencyId: s.agency.id,
    linkedAgency: isLinkedAgencyId(s.agency.id),
    contacts: s.contacts,
    requirements: s.requirements,
    properties: s.properties,
    photos: s.photos,
    opportunities: s.opportunities,
    activities: s.activities,
    events: s.events,
    appOffers: s.appOffers,
    matches: s.matches,
    profiles: s.profiles,
    followUpSnoozes: s.followUpSnoozes,
  };
  return useCallback(() => ref.current!, []);
}

/**
 * Proppi necesita una cuenta de inmobiliaria real: el servidor exige el JWT de
 * Supabase y la membresía en `agency_members`. La demo y las cuentas locales
 * (sin inmobiliaria) ven "Disponible con tu cuenta".
 */
export function useProppiAvailable(): boolean {
  const { agency } = useStore();
  return isLinkedAgencyId(agency.id);
}

/** Cierra con Escape y mantiene el foco adentro del contenedor (Tab / Shift+Tab). */
export function useFocusTrap(open: boolean, container: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = container.current;
    const focusables = () =>
      el
        ? Array.from(
            el.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((n) => n.offsetParent !== null)
        : [];
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!el?.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, container]);
}
