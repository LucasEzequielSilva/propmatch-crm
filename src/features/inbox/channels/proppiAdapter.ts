import type { Contact } from "@/types/db";
import type { ChannelConversation, ChannelMessage } from "@/lib/inbox/api";
import type { MessageRow } from "@/lib/leadSync";
import type { Conversation } from "../conversations";
import { displayName } from "./channelMeta";

/**
 * Adapta una conversación de WhatsApp/Instagram/Messenger a la forma que
 * espera InboxAssist (Proppi), pensada para los chats de la app. Así se
 * reutiliza sin tocar el componente de Proppi.
 */
export function toAssistConversation(c: ChannelConversation, contact: Contact | undefined): Conversation {
  const clientId = `client:${c.external_thread_id}`;
  return {
    id: `ch:${c.id}`,
    // InboxAssist no usa el canal; Messenger no está en la unión `Channel` de la app.
    channel: c.channel as Conversation["channel"],
    matchId: `ch:${c.id}`,
    demandanteId: clientId,
    contact,
    name: displayName(c),
    property: undefined,
    last: undefined,
    lastAt: c.last_message_at ?? c.created_at,
    unanswered: c.last_message_direction === "in",
    unread: c.unread_count > 0,
    agentId: c.assigned_to,
  };
}

export function toAssistMessages(c: ChannelConversation, messages: ChannelMessage[]): MessageRow[] {
  const clientId = `client:${c.external_thread_id}`;
  return messages.map((m) => ({
    id: m.id,
    match_id: `ch:${c.id}`,
    sender_id: m.direction === "in" ? clientId : "agency",
    content: m.body ?? (m.has_media ? `(${m.type})` : null),
    created_at: m.created_at,
  }));
}
