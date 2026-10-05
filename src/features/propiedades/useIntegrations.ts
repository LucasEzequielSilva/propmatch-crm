import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

interface StatusResponse {
  configured?: boolean;
  connected?: boolean;
  needsReauth?: boolean;
  nickname?: string;
  isAdmin?: boolean;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : null;
}

/**
 * Estado de la conexión con Mercado Libre. Si `/api/*` no existe (vite dev no
 * ejecuta funciones) o falla, degrada a `configured: false` sin ruido.
 */
export function useMeliConnection() {
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [nickname, setNickname] = useState<string | undefined>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("sin sesión");
      const r = await fetch("/api/meli/status", { headers, cache: "no-store" });
      const isJson = r.headers.get("content-type")?.includes("application/json");
      if (!r.ok || !isJson) throw new Error("no disponible");
      const j = (await r.json()) as StatusResponse;
      setConfigured(!!j.configured);
      setConnected(!!j.connected);
      setNeedsReauth(!!j.needsReauth);
      setNickname(j.nickname);
      setIsAdmin(!!j.isAdmin);
    } catch {
      setConfigured(false);
      setConnected(false);
      setNeedsReauth(false);
      setNickname(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error();
      const r = await fetch("/api/meli/connect", { method: "POST", headers });
      if (r.status === 403) {
        setError("Solo los administradores de la inmobiliaria pueden conectar cuentas.");
        return;
      }
      if (!r.ok) throw new Error();
      const { url } = (await r.json()) as { url?: string };
      if (!url) throw new Error();
      window.location.href = url;
    } catch {
      setError("No pudimos iniciar la conexión con Mercado Libre. Probá de nuevo en un rato.");
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error();
      const r = await fetch("/api/meli/disconnect", { method: "POST", headers });
      if (r.status === 403) {
        setError("Solo los administradores de la inmobiliaria pueden desconectar cuentas.");
        return;
      }
      if (!r.ok) throw new Error();
      setConnected(false);
      setNeedsReauth(false);
      setNickname(undefined);
    } catch {
      setError("No pudimos desconectar la cuenta. Probá de nuevo en un rato.");
    }
  }, []);

  return { loading, configured, connected, needsReauth, nickname, isAdmin, connect, disconnect, error };
}
