import { isLinkedAgencyId, useStore } from "@/data/store";
import { useProppiSettings } from "@/features/proppi/settings";

/**
 * ¿La extracción va por Proppi? Solo con cuenta de inmobiliaria real, Proppi
 * activado en Configuración y sin tope mensual alcanzado. Si no, se usa el
 * parser local y el texto no sale del navegador.
 */
export function useVozProppi(): { active: boolean; reason: string | null; consume: () => boolean } {
  const { agency } = useStore();
  const { settings, consume, limitReached } = useProppiSettings(agency.id);
  if (!isLinkedAgencyId(agency.id)) return { active: false, reason: "En la demo se usa el armado básico, sin IA.", consume };
  if (!settings.enabled) return { active: false, reason: "Proppi está desactivado: se usa el armado básico, sin IA.", consume };
  if (limitReached) return { active: false, reason: "Llegaste al tope de consultas de Proppi del mes: se usa el armado básico.", consume };
  return { active: true, reason: null, consume };
}
