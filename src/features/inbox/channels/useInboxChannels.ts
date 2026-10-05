import { useMemo, useState } from "react";
import type { Conversation } from "../conversations";
import { channelIdOf, channelItemId, filterChannelConversations, type InboxSource } from "./channelMeta";
import { useChannelInbox } from "./useChannelInbox";

/**
 * Todo lo que InboxPage necesita para sumar WhatsApp/Instagram/Messenger a la
 * bandeja, en un solo hook para que la página cambie lo mínimo.
 */
export function useInboxChannels(input: {
  appVisible: Conversation[];
  tab: string;
  query: string;
  agentId: string;
  selectedId: string | null;
}) {
  const inbox = useChannelInbox();
  const [source, setSource] = useState<InboxSource>("all");

  const appItems = useMemo(
    () => (source === "all" || source === "app" ? input.appVisible : []),
    [source, input.appVisible],
  );
  const channelItems = useMemo(
    () => filterChannelConversations(inbox.conversations, { source, tab: input.tab, query: input.query, agentId: input.agentId }),
    [inbox.conversations, source, input.tab, input.query, input.agentId],
  );

  // Primera conversación de la lista unificada (la más reciente).
  const firstId = useMemo(() => {
    const a = appItems[0];
    const c = channelItems[0];
    if (!a && !c) return null;
    if (!c) return a!.id;
    if (!a) return channelItemId(c.id);
    return Date.parse(c.last_message_at ?? c.created_at) > Date.parse(a.lastAt) ? channelItemId(c.id) : a.id;
  }, [appItems, channelItems]);

  const selectedChannelId = channelIdOf(input.selectedId);
  const selected = selectedChannelId ? (inbox.conversations.find((c) => c.id === selectedChannelId) ?? null) : null;

  return {
    source,
    setSource,
    configured: inbox.configured,
    all: inbox.conversations,
    appItems,
    channelItems,
    firstId,
    selected,
    unread: inbox.conversations.filter((c) => c.unread_count > 0).length,
  };
}
