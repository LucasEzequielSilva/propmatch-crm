import { Link } from "react-router-dom";
import type { ChannelConversation } from "@/lib/inbox/api";
import { SOURCE_META, SourceIcon, type InboxSource } from "./channelMeta";

/**
 * Filtro por canal del inbox unificado. Los canales que todavía no tienen
 * conversaciones (o el servidor no está configurado) muestran "Conectar" y
 * llevan a Configuración → Canales.
 */
export function SourceFilter({
  value,
  onChange,
  appCount,
  channelConversations,
  channelsConfigured,
}: {
  value: InboxSource;
  onChange: (s: InboxSource) => void;
  appCount: number;
  channelConversations: ChannelConversation[];
  channelsConfigured: boolean;
}) {
  const count = (ch: string) => channelConversations.filter((c) => c.channel === ch).length;
  const items: { value: InboxSource; label: string; n: number | null }[] = [
    { value: "all", label: "Todos los canales", n: null },
    { value: "app", label: SOURCE_META.app.label, n: appCount },
    { value: "whatsapp", label: SOURCE_META.whatsapp.label, n: count("whatsapp") },
    { value: "instagram", label: SOURCE_META.instagram.label, n: count("instagram") },
    { value: "messenger", label: SOURCE_META.messenger.label, n: count("messenger") },
  ];

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Filtrar por canal">
      {items.map((it) => {
        const active = value === it.value;
        const external = it.value !== "all" && it.value !== "app";
        const empty = external && it.n === 0;
        if (empty && !channelsConfigured) {
          return (
            <li key={it.value}>
              <Link
                to="/configuracion#canales"
                title="Conectá el canal desde Configuración"
                className="text-xs px-3 py-1.5 rounded-full border border-dashed inline-flex items-center gap-1.5 min-h-[32px]"
                style={{ borderColor: "#DDD6FE", color: "#6B5A8E", background: "#FDFCFF" }}
              >
                <SourceIcon source={it.value as "whatsapp"} size={12} />
                {it.label} · <span style={{ fontWeight: 700 }}>Conectar</span>
              </Link>
            </li>
          );
        }
        return (
          <li key={it.value}>
            <button
              onClick={() => onChange(it.value)}
              aria-pressed={active}
              className="text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 min-h-[32px]"
              style={
                active
                  ? { borderColor: "#7C3AED", background: "#F5F3FF", color: "#5B21B6", fontWeight: 700 }
                  : { borderColor: "#EDE9FE", background: "white", color: "#6B5A8E", fontWeight: 500 }
              }
            >
              {it.value !== "all" && <SourceIcon source={it.value} size={12} />}
              {it.label}
              {it.n !== null && <span style={{ opacity: 0.7 }}>{it.n}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
