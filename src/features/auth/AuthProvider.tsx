import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Agency, Profile } from "@/types/db";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  agency: Agency | null;
  loading: boolean;
  /** Hay sesión pero el usuario todavía no pertenece a ninguna agencia. */
  needsOnboarding: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setProfile(null);
      setAgency(null);
      return;
    }
    // `maybeSingle` porque justo después del registro el perfil todavía no existe.
    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle<Profile>();

    setProfile(prof ?? null);

    if (prof) {
      const { data: ag } = await supabase
        .from("agencies")
        .select("*")
        .eq("id", prof.agency_id)
        .maybeSingle<Agency>();
      setAgency(ag ?? null);
    } else {
      setAgency(null);
    }
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!active) return;
      setSession(next);
      await loadProfile(next?.user.id);
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refresh = useCallback(async () => {
    await loadProfile(session?.user.id);
  }, [loadProfile, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setAgency(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      agency,
      loading,
      needsOnboarding: !!session && !profile,
      refresh,
      signOut,
    }),
    [session, profile, agency, loading, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

/** El perfil y la agencia dentro del área autenticada, ya sin nulls. */
export function useSessionProfile(): { profile: Profile; agency: Agency } {
  const { profile, agency } = useAuth();
  if (!profile || !agency) {
    throw new Error("useSessionProfile solo puede usarse dentro de una ruta protegida");
  }
  return { profile, agency };
}
