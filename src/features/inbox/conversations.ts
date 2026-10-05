import { useCallback, useEffect, useState } from "react";
import type { Contact, Property } from "@/types/db";
import type { MatchRow, MessageRow } from "@/lib/leadSync";

/**
 * Modelo normalizado del Inbox. Hoy solo existe el canal "app" (chat real de
 * PropMatch); el resto está listo para cuando haya integración, y la UI los
 * muestra deshabilitados mientras `connected` sea false.
 */
export type Channel = "app" | "whatsapp" | "instagram" | "mercadolibre" | "zonaprop" | "web";

export const CHANNEL_META: Record<Channel, { label: string; connected: boolean }> = {
  app: { label: "App PropMatch", connected: true },
  whatsapp: { label: "WhatsApp", connected: false },
  instagram: { label: "Instagram", connected: false },
  mercadolibre: { label: "Mercado Libre", connected: false },
  zonaprop: { label: "Zonaprop", connected: false },
  web: { label: "Formulario web", connected: false },
};

export const SOON_CHANNELS: Channel[] = ["whatsapp", "instagram", "mercadolibre", "zonaprop"];

export interface Conversation {
  id: string;
  channel: Channel;
  /** id del match real en la app: es también la clave del chat. */
  matchId: string;
  demandanteId: string;
  contact: Contact | undefined;
  name: string;
  property: Property | undefined;
  last: MessageRow | undefined;
  /** Último mensaje, o alta del match si todavía no hay mensajes. */
  lastAt: string;
  /** Último mensaje del demandante: espera respuesta. */
  unanswered: boolean;
  unread: boolean;
  /** Quién respondió último (o dueño del contacto), si se sabe. */
  agentId: string | null;
}

export function buildConversations(input: {
  matches: MatchRow[];
  messagesByMatch: Record<string, MessageRow[]>;
  contacts: Contact[];
  properties: Property[];
  seen: Record<string, string>;
}): Conversation[] {
  const contactByUser = new Map<string, Contact>();
  for (const c of input.contacts) if (c.app_user_id) contactByUser.set(c.app_user_id, c);
  const propByApp = new Map<string, Property>();
  for (const p of input.properties) if (p.app_property_id) propByApp.set(p.app_property_id, p);

  const out: Conversation[] = input.matches.map((m) => {
    const list = input.messagesByMatch[m.id] ?? [];
    const last = list[list.length - 1];
    const contact = contactByUser.get(m.demandante_id);
    const lastFromClient = !!last && last.sender_id === m.demandante_id;
    const seenAt = input.seen[m.id];
    const lastAgentMsg = [...list].reverse().find((x) => x.sender_id !== m.demandante_id);
    return {
      id: m.id,
      channel: "app",
      matchId: m.id,
      demandanteId: m.demandante_id,
      contact,
      name: contact?.full_name ?? "Interesado desde la app",
      property: propByApp.get(m.property_id),
      last,
      lastAt: last?.created_at ?? m.created_at,
      unanswered: lastFromClient,
      unread: lastFromClient && (!seenAt || Date.parse(last!.created_at) > Date.parse(seenAt)),
      agentId: lastAgentMsg?.sender_id ?? contact?.owner_id ?? null,
    };
  });

  // Sin responder primero, y dentro de cada grupo lo más reciente arriba.
  return out.sort(
    (a, b) => Number(b.unanswered) - Number(a.unanswered) || Date.parse(b.lastAt) - Date.parse(a.lastAt),
  );
}

/** "Último visto" por conversación. La base no guarda lecturas, así que vive en este navegador. */
export function useSeen(agencyId: string, userId: string | null) {
  const key = `pm.inbox.seen.${agencyId}.${userId ?? "anon"}`;
  const [seen, setSeen] = useState<Record<string, string>>(() => read(key));

  useEffect(() => setSeen(read(key)), [key]);

  const mark = useCallback(
    (matchId: string, iso: string) => {
      setSeen((prev) => {
        if (prev[matchId] && Date.parse(prev[matchId]) >= Date.parse(iso)) return prev;
        const next = { ...prev, [matchId]: iso };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* sin storage: queda solo en memoria */
        }
        return next;
      });
    },
    [key],
  );

  return { seen, mark };
}

function read(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Normaliza para buscar sin importar tildes ni mayúsculas. */
export function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
