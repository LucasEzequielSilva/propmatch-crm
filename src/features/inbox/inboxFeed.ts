import { useEffect, useSyncExternalStore } from "react";
import { fetchAgencyMatches, fetchMessagesForMatches, type MatchRow, type MessageRow } from "@/lib/leadSync";

/**
 * Fuente única del Inbox: un fetch de matches + uno de mensajes, compartido
 * entre la pantalla y los contadores del menú. Cada consumidor monta el hook,
 * pero el polling es uno solo (se cuenta cuántos lo usan) y se pausa con la
 * pestaña oculta.
 */

export interface InboxFeed {
  agencyId: string | null;
  matches: MatchRow[];
  messagesByMatch: Record<string, MessageRow[]>;
  loading: boolean;
  error: string | null;
}

const POLL_MS = 10_000;

const EMPTY: InboxFeed = { agencyId: null, matches: [], messagesByMatch: {}, loading: true, error: null };

let state: InboxFeed = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let consumers = 0;
let activeAgency: string | null = null;
let requestSeq = 0;

function setState(next: InboxFeed) {
  state = next;
  listeners.forEach((l) => l());
}

export async function refreshInboxFeed(): Promise<void> {
  const agencyId = activeAgency;
  if (!agencyId) return;
  const seq = ++requestSeq;
  try {
    const matches = await fetchAgencyMatches(agencyId);
    const messagesByMatch = await fetchMessagesForMatches(matches.map((m) => m.id));
    // Una respuesta vieja no pisa a una más nueva ni a otra agencia.
    if (seq !== requestSeq || agencyId !== activeAgency) return;
    setState({ agencyId, matches, messagesByMatch, loading: false, error: null });
  } catch (err) {
    if (seq !== requestSeq || agencyId !== activeAgency) return;
    console.error("No se pudo cargar el inbox", err);
    setState({ ...state, agencyId, loading: false, error: "No pudimos traer las conversaciones." });
  }
}

function start(agencyId: string) {
  consumers++;
  if (activeAgency !== agencyId) {
    activeAgency = agencyId;
    setState({ ...EMPTY, agencyId });
  }
  if (consumers === 1) {
    refreshInboxFeed();
    timer = setInterval(() => {
      if (!document.hidden) refreshInboxFeed();
    }, POLL_MS);
  } else if (state.loading) {
    refreshInboxFeed();
  }
}

function stop() {
  consumers--;
  if (consumers <= 0) {
    consumers = 0;
    if (timer) clearInterval(timer);
    timer = null;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useInboxFeed(agencyId: string): InboxFeed {
  useEffect(() => {
    start(agencyId);
    return stop;
  }, [agencyId]);
  return useSyncExternalStore(subscribe, () => state);
}

/** Cuenta conversaciones cuyo último mensaje es del demandante (ver `Conversation.unanswered`). */
export function countUnanswered(feed: InboxFeed): number {
  let n = 0;
  for (const m of feed.matches) {
    const list = feed.messagesByMatch[m.id];
    const last = list?.[list.length - 1];
    if (last && last.sender_id === m.demandante_id) n++;
  }
  return n;
}
