import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card } from "@/components/ui/Card";
import { SearchIcon } from "@/components/ui/icons";
import { useStore } from "@/data/store";
import { ChatView } from "./ChatView";
import { buildConversations, CHANNEL_META, norm, SOON_CHANNELS, useSeen } from "./conversations";
import { ConversationList } from "./ConversationList";
import { useInboxFeed } from "./inboxFeed";
import { ProfilePanel } from "./ProfilePanel";

type Tab = "todas" | "no_leidas" | "app";
type View = "list" | "chat" | "profile";

function Kpi({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl px-3 py-1.5 text-center min-w-[84px]" style={{ background: "#F5F3FF" }}>
      <p className="text-base leading-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "#7458C4", fontWeight: 600 }}>
        {label}
      </p>
    </div>
  );
}

export default function InboxPage() {
  const { agency, currentUserId, contacts, properties, opportunities, matches, profiles, profileById } = useStore();
  const feed = useInboxFeed(agency.id);
  const { seen, mark } = useSeen(agency.id, currentUserId);

  const [tab, setTab] = useState<Tab>("todas");
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");

  const all = useMemo(
    () =>
      buildConversations({
        matches: feed.matches,
        messagesByMatch: feed.messagesByMatch,
        contacts,
        properties,
        seen,
      }),
    [feed.matches, feed.messagesByMatch, contacts, properties, seen],
  );

  const base = useMemo(() => (agentId ? all.filter((c) => c.agentId === agentId) : all), [all, agentId]);
  const counts = {
    todas: base.length,
    no_leidas: base.filter((c) => c.unread).length,
    app: base.filter((c) => c.channel === "app").length,
  };
  const unanswered = all.filter((c) => c.unanswered).length;
  const activeLeads = opportunities.filter((o) => o.stage !== "cierre" && o.stage !== "perdida" && !o.closed_at).length;

  const visible = useMemo(() => {
    const q = norm(query.trim());
    return base.filter((c) => {
      if (tab === "no_leidas" && !c.unread) return false;
      if (tab === "app" && c.channel !== "app") return false;
      if (!q) return true;
      return norm(`${c.name} ${c.property?.title ?? ""} ${c.last?.content ?? ""}`).includes(q);
    });
  }, [base, tab, query]);

  // En pantallas anchas arranca con la primera conversación abierta; en celular se espera a que elijan.
  useEffect(() => {
    if (selectedId || visible.length === 0) return;
    if (window.matchMedia("(min-width: 768px)").matches) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  const selected = all.find((c) => c.id === selectedId) ?? null;
  const crmMatch = useMemo(
    () =>
      selected?.contact && selected.property
        ? matches.find(
            (m) => m.contact_id === selected.contact!.id && m.property_id === selected.property!.id && !m.is_dismissed,
          )
        : undefined,
    [matches, selected],
  );
  const selectedMatchId = selected?.matchId;
  const onSeen = useCallback((iso: string) => selectedMatchId && mark(selectedMatchId, iso), [selectedMatchId, mark]);

  const tabs: { value: Tab; label: string }[] = [
    { value: "todas", label: `Todas ${counts.todas}` },
    { value: "no_leidas", label: `No leídas ${counts.no_leidas}` },
    { value: "app", label: `App ${counts.app}` },
  ];

  const pane = "min-h-0 border-r overflow-hidden";

  return (
    <>
      <AppHeader
        breadcrumb={["Centro de comunicaciones"]}
        title="Inbox de conversaciones"
        subtitle="Respondé a quienes te escriben desde la app, con la ficha del comprador al lado."
      >
        <div className="flex gap-2">
          <Kpi label="Conversaciones" value={all.length} />
          <Kpi label="Sin responder" value={unanswered} />
          <Kpi label="Leads activos" value={activeLeads} />
        </div>
      </AppHeader>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-8 py-3 border-b flex-shrink-0" style={{ borderColor: "#EDE9FE" }}>
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: "#F5F3FF" }} role="group" aria-label="Filtrar conversaciones">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              aria-pressed={tab === t.value}
              className="rounded-lg text-sm px-3.5 min-h-[40px] md:min-h-[32px] whitespace-nowrap"
              style={
                tab === t.value
                  ? { background: "var(--gradient-brand)", color: "white", fontWeight: 600 }
                  : { color: "#6B5A8E", fontWeight: 500 }
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Canales por conectar">
          {SOON_CHANNELS.map((ch) => (
            <li
              key={ch}
              title="Disponible al conectar tu cuenta"
              aria-disabled="true"
              className="text-xs px-3 py-1.5 rounded-full border border-dashed cursor-not-allowed"
              style={{ borderColor: "#DDD6FE", color: "#6B5A8E", background: "#FDFCFF" }}
            >
              {CHANNEL_META[ch].label} · <span style={{ fontWeight: 700 }}>Conectar</span>
              <span className="sr-only">. Disponible al conectar tu cuenta</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 ml-auto w-full md:w-auto">
          {profiles.length > 1 && (
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label="Filtrar por agente"
              className="min-h-[44px] md:min-h-[40px] px-3 rounded-xl text-sm border bg-white"
              style={{ borderColor: "#EDE9FE", color: "#1F0A3C" }}
            >
              <option value="">Todos los agentes</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          )}
          <label
            className="flex items-center gap-2 px-4 min-h-[44px] md:min-h-[40px] rounded-xl text-sm focus-within:ring-2 focus-within:ring-[#7C3AED] flex-1 md:w-[260px] md:flex-none"
            style={{ background: "#F5F3FF" }}
          >
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar por nombre, propiedad o mensaje"
              placeholder="Buscar conversaciones…"
              className="bg-transparent outline-none w-full text-[#1F0A3C] placeholder:text-[#6F5E94]"
            />
          </label>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        <div className={`${view === "list" ? "block" : "hidden"} md:block ${pane} overflow-y-auto`} style={{ borderColor: "#EDE9FE" }}>
          <ConversationList
            items={visible}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setView("chat");
            }}
            loading={feed.loading}
            error={feed.error}
            hasAny={all.length > 0}
          />
        </div>

        <div
          className={`${view === "chat" ? "block" : "hidden"} ${view === "profile" ? "md:hidden xl:block" : "md:block"} ${pane}`}
          style={{ borderColor: "#EDE9FE" }}
        >
          {selected ? (
            <ChatView
              key={selected.matchId}
              conversation={selected}
              preview={feed.messagesByMatch[selected.matchId] ?? []}
              currentUserId={currentUserId}
              responsible={profileById(selected.agentId)}
              crmMatch={crmMatch}
              onBack={() => setView("list")}
              onProfile={() => setView("profile")}
              onSeen={onSeen}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-8 text-center">
              <p className="text-sm" style={{ color: "#7C6A99" }}>
                Elegí una conversación de la bandeja para verla acá.
              </p>
            </div>
          )}
        </div>

        <div className={`${view === "profile" ? "block" : "hidden"} xl:block min-h-0 overflow-hidden`}>
          {selected ? (
            <ProfilePanel conversation={selected} crmMatch={crmMatch} onBack={() => setView("chat")} />
          ) : (
            <div className="p-4">
              <Card padded>
                <p className="text-xs text-center" style={{ color: "#7C6A99" }}>
                  Acá vas a ver el perfil del comprador.
                </p>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
