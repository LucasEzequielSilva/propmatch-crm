import { useState } from "react";
import { DownloadIcon } from "@/components/ui/icons";
import { datedFilename, downloadCsv } from "@/lib/csv";
import { EVENT_TYPE_LABEL, dateTime, dealNumberLabel, profileName } from "@/lib/dealRoom";
import type { DealEventType } from "@/types/db";
import { Btn, Pill, RoomCard, type Tone } from "./primitives";
import type { Room } from "./room";

const TYPE_TONE: Partial<Record<DealEventType, Tone>> = {
  stage_changed: "brand",
  status_changed: "brand",
  payment: "green",
  document: "blue",
  signature: "green",
  note: "amber",
};

const PAGE = 12;

/** Historial de la operación: solo se agregan filas. */
export function HistoryCard({ room }: { room: Room }) {
  const { deal, profiles } = room;
  const [showAll, setShowAll] = useState(false);
  const events = [...deal.events].reverse();
  const shown = showAll ? events : events.slice(0, PAGE);

  const exportCsv = () =>
    downloadCsv(datedFilename(`historial-${dealNumberLabel(deal.number).toLowerCase()}`), [
      ["Fecha", "Tipo", "Qué pasó", "Detalle", "Quién"],
      ...deal.events.map((e) => [dateTime(e.created_at), EVENT_TYPE_LABEL[e.type], e.title, e.detail ?? "", e.actor_id ? profileName(profiles, e.actor_id) : "—"]),
    ]);

  return (
    <RoomCard
      title="Historial"
      subtitle={`${deal.events.length} movimientos · no se editan ni se borran`}
      action={
        <Btn size="sm" onClick={exportCsv} disabled={!deal.events.length}>
          <DownloadIcon size={12} /> Exportar CSV
        </Btn>
      }
    >
      {shown.length === 0 ? (
        <p className="text-sm text-ink-soft">Todavía no hay movimientos.</p>
      ) : (
        <ol className="space-y-3">
          {shown.map((e) => (
            <li key={e.id} className="flex gap-3">
              <span aria-hidden="true" className="mt-1.5 w-2 h-2 rounded-full bg-brand-purple flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={TYPE_TONE[e.type] ?? "neutral"}>{EVENT_TYPE_LABEL[e.type]}</Pill>
                  <span className="text-sm text-ink font-semibold break-words">{e.title}</span>
                </div>
                {e.detail && e.type !== "note" && <p className="text-xs text-ink-soft mt-0.5 break-words">{e.detail}</p>}
                {e.detail && e.type === "note" && e.detail !== e.title && <p className="text-xs text-ink-soft mt-0.5 break-words">{e.detail}</p>}
                <p className="text-xs text-lilac-text mt-0.5">
                  <time dateTime={e.created_at}>{dateTime(e.created_at)}</time>
                  {" · "}
                  {e.actor_id ? profileName(profiles, e.actor_id) : "Sistema / dato anterior"}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      {events.length > PAGE && (
        <div className="mt-3">
          <Btn size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
            {showAll ? "Ver menos" : `Ver los ${events.length} movimientos`}
          </Btn>
        </div>
      )}
    </RoomCard>
  );
}
