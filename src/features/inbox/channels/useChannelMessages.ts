import { useCallback, useEffect, useRef, useState } from "react";
import { inboxApi, sendErrorText, type ChannelMessage } from "@/lib/inbox/api";
import { patchChannelConversation, refreshChannelInbox } from "./useChannelInbox";

const POLL_MS = 10_000;

/** Mensajes de una conversación externa con polling de 10 s y envío. */
export function useChannelMessages(conversationId: string) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(conversationId);

  const load = useCallback(async () => {
    const id = conversationId;
    const r = await inboxApi<{ messages: ChannelMessage[] }>(`/api/inbox/messages?conversationId=${encodeURIComponent(id)}&limit=100`);
    if (current.current !== id) return;
    setLoading(false);
    if (r.ok && r.data) setMessages(r.data.messages);
  }, [conversationId]);

  useEffect(() => {
    current.current = conversationId;
    setMessages([]);
    setLoading(true);
    setError(null);
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [conversationId, load]);

  const markRead = useCallback(async () => {
    patchChannelConversation(conversationId, { unread_count: 0 });
    await inboxApi("/api/inbox/messages", { method: "POST", body: { action: "read", conversationId } });
  }, [conversationId]);

  const send = useCallback(
    async (payload: { text: string } | { template: { name: string; language: string; params: string[] } }): Promise<boolean> => {
      setSending(true);
      setError(null);
      const r = await inboxApi<{ ok: boolean }>("/api/inbox/send", { method: "POST", body: { conversationId, ...payload } });
      setSending(false);
      if (!r.ok) {
        setError(sendErrorText(r.error));
        void load(); // el intento fallido queda guardado con su error
        return false;
      }
      await load();
      void refreshChannelInbox();
      return true;
    },
    [conversationId, load],
  );

  return { messages, loading, sending, error, send, markRead, reload: load };
}
