import { useMemo } from "react";
import { useStore } from "./store";
import { computeFollowUps } from "@/lib/followups";

/**
 * Seguimientos pendientes. Con `mineOnly`, los contactos a cargo del agente
 * con la sesión abierta (y los que no tienen a nadie asignado).
 */
export function useFollowUps(mineOnly = true) {
  const { contacts, activities, events, opportunities, matches, properties, followUpSnoozes, currentUserId } = useStore();
  return useMemo(() => {
    const scoped = mineOnly
      ? contacts.filter((c) => !c.owner_id || !currentUserId || c.owner_id === currentUserId)
      : contacts;
    return computeFollowUps({
      contacts: scoped,
      activities,
      events,
      opportunities,
      matches,
      properties,
      snoozes: followUpSnoozes,
    });
  }, [mineOnly, contacts, activities, events, opportunities, matches, properties, followUpSnoozes, currentUserId]);
}
