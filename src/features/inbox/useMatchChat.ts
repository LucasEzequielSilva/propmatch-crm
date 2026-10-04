import { useCallback, useEffect, useState } from "react";
import { fetchMatchMessages, sendMatchMessage, type MessageRow } from "@/lib/leadSync";
import { refreshInboxFeed } from "./inboxFeed";

/**
 * Historial completo de un match con polling cada 8 s (igual que `ChatPanel`).
 * Hasta que llega la primera respuesta se muestran los mensajes que ya trajo
 * la bandeja, para que abrir una conversación no arranque en blanco.
 */
export function useMatchChat(matchId: string | null, currentUserId: string | null, preview: MessageRow[]) {
  const [loaded, setLoaded] = useState<{ matchId: string; rows: MessageRow[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!matchId) return;
    try {
      const rows = await fetchMatchMessages(matchId);
      setLoaded({ matchId, rows });
    } catch (err) {
      console.error("No se pudo cargar el chat", err);
    }
  }, [matchId]);

  useEffect(() => {
    setError(null);
    if (!matchId) return;
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 8000);
    return () => clearInterval(id);
  }, [matchId, load]);

  const ready = loaded?.matchId === matchId;
  const messages = ready ? loaded!.rows : preview;

  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const text = content.trim();
      if (!matchId || !currentUserId || !text || sending) return false;
      setSending(true);
      setError(null);
      const { error: sendError } = await sendMatchMessage(matchId, currentUserId, text);
      if (sendError) {
        setError(`No se pudo enviar: ${sendError}`);
        setSending(false);
        return false;
      }
      await Promise.all([load(), refreshInboxFeed()]);
      setSending(false);
      return true;
    },
    [matchId, currentUserId, sending, load],
  );

  return { messages, loading: !ready && preview.length === 0, sending, error, send };
}
