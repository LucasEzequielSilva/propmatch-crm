import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/**
 * Matches sin revisar de la agencia. Alimenta el badge del sidebar, que en el
 * prototipo era el número "3" escrito a mano.
 */
export function usePendingMatchCount(): number {
  const { profile } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!profile) return;
    let active = true;

    async function load() {
      const { count: n } = await supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("is_reviewed", false)
        .eq("is_dismissed", false);
      if (active) setCount(n ?? 0);
    }

    void load();

    // Se refresca solo cuando el motor de matching inserta o actualiza filas.
    const channel = supabase
      .channel("matches-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => void load())
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [profile]);

  return count;
}
