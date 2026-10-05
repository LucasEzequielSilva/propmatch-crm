import { useEffect, useSyncExternalStore } from "react";
import { inboxApi, type ChannelConversation } from "@/lib/inbox/api";

/**
 * Conversaciones de WhatsApp / Instagram / Messenger vía /api/inbox.
 * Polling único cada 10 s (sin realtime por ahora), pausado con la pestaña
 * oculta. Si el servidor dice "no configurado" deja de pedir hasta que se
 * vuelva a montar.
 */

export interface ChannelInboxState {
  configured: boolean;
  loading: boolean;
  error: string | null;
  conversations: ChannelConversation[];
}

const POLL_MS = 10_000;
const INITIAL: ChannelInboxState = { configured: false, loading: true, error: null, conversations: [] };

let state = INITIAL;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let consumers = 0;
let seq = 0;

function set(next: ChannelInboxState) {
  state = next;
  listeners.forEach((l) => l());
}

export async function refreshChannelInbox(): Promise<void> {
  const my = ++seq;
  const r = await inboxApi<{ configured: boolean; conversations: ChannelConversation[] }>("/api/inbox/conversations");
  if (my !== seq) return;
  if (!r.ok || !r.data) {
    // 503 / sin /api / sin tablas: canales no disponibles, sin error visible.
    const unavailable = r.status === 503 || r.status === 404 || r.error === "unavailable";
    set({ ...state, loading: false, configured: unavailable ? false : state.configured, error: unavailable ? null : "No pudimos traer WhatsApp/Instagram/Messenger." });
    if (unavailable) stopTimer();
    return;
  }
  if (!r.data.configured) {
    set({ configured: false, loading: false, error: null, conversations: [] });
    stopTimer();
    return;
  }
  set({ configured: true, loading: false, error: null, conversations: r.data.conversations });
}

/** Actualiza una conversación en memoria (p. ej. al marcarla leída) sin esperar al próximo poll. */
export function patchChannelConversation(id: string, patch: Partial<ChannelConversation>) {
  set({ ...state, conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function start() {
  consumers++;
  if (!timer) {
    void refreshChannelInbox();
    timer = setInterval(() => {
      if (!document.hidden) void refreshChannelInbox();
    }, POLL_MS);
  }
}

function stop() {
  consumers = Math.max(0, consumers - 1);
  if (consumers === 0) stopTimer();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useChannelInbox(): ChannelInboxState {
  useEffect(() => {
    start();
    return stop;
  }, []);
  return useSyncExternalStore(subscribe, () => state);
}
