import { useId, useState } from "react";
import { CheckIcon, ChevronDownIcon, WhatsAppIcon } from "@/components/ui/icons";
import { whatsappLink } from "@/lib/whatsapp";
import { stepProgress } from "@/lib/deals";
import {
  dateTime,
  emptyCheck,
  profileName,
  reminderMessage,
  stagesOf,
  stepTarget,
  targetContact,
  type StageInfo,
} from "@/lib/dealRoom";
import type { ChecklistItem } from "@/lib/deals";
import { LinkBtn, ProgressBar, RoomCard } from "./primitives";
import type { Room } from "./room";

/** Pasos agrupados por etapa, en acordeón. Abre la etapa actual. */
export function ChecklistCard({ room }: { room: Room }) {
  const { deal } = room;
  const stages = stagesOf(deal);
  const current = stages.find((s) => s.state === "current")?.stage ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current] : []));
  const total = stepProgress(deal);

  const toggleOpen = (stage: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  return (
    <RoomCard title="Checklist de la operación" subtitle={`${total.done} de ${total.total} pasos · cada tilde guarda fecha y autor`}>
      <div className="space-y-2">
        {stages.map((s) => (
          <StageSection key={s.stage} room={room} info={s} open={open.has(s.stage)} onToggle={() => toggleOpen(s.stage)} />
        ))}
      </div>
    </RoomCard>
  );
}

function StageSection({ room, info, open, onToggle }: { room: Room; info: StageInfo; open: boolean; onToggle: () => void }) {
  const panelId = useId();
  const pct = info.total ? (info.done / info.total) * 100 : 0;
  return (
    <div className={`rounded-xl border ${info.state === "current" ? "border-brand-purple" : "border-lilac"}`}>
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
        >
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm text-ink font-bold">{info.label}</span>
              {info.state === "current" && <span className="text-xs text-brand-purple font-semibold">· etapa actual</span>}
            </span>
            <span className="block mt-1.5 max-w-64">
              <ProgressBar value={pct} label={`${info.label}: ${Math.round(pct)}%`} />
            </span>
          </span>
          <span className="text-xs text-lilac-text font-semibold whitespace-nowrap">
            {info.done}/{info.total} · {Math.round(pct)}%
          </span>
          <span className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">
            <ChevronDownIcon size={12} color="currentColor" />
          </span>
        </button>
      </h3>
      {open && (
        <ul id={panelId} className="px-4 pb-3 divide-y divide-divider">
          {info.steps.map((s) => (
            <StepRow key={s.id} room={room} item={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StepRow({ room, item }: { room: Room; item: ChecklistItem }) {
  const { deal, profile, profiles } = room;
  const state = deal.steps[item.id] ?? emptyCheck();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(state.note ?? "");
  const checkId = useId();
  const target = stepTarget(item.id);
  const contact = target ? targetContact(deal, target) : null;

  const toggle = () => {
    const done = !state.done;
    room.update(
      {
        steps: {
          ...deal.steps,
          [item.id]: { ...state, done, at: done ? new Date().toISOString() : null, by: done ? profile.id : null },
        },
      },
      { type: "step", title: `${done ? "Completó" : "Desmarcó"}: ${item.label}` },
    );
  };

  const saveNote = () => {
    const value = note.trim() || null;
    if (value === (state.note ?? null)) return;
    room.update(
      { steps: { ...deal.steps, [item.id]: { ...state, note: value } } },
      { type: "note", title: value ? `Nota en «${item.label}»` : `Borró la nota de «${item.label}»`, detail: value },
    );
  };

  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex-shrink-0">
          <input id={checkId} type="checkbox" checked={state.done} onChange={toggle} className="peer sr-only" />
          <label
            htmlFor={checkId}
            aria-hidden="true"
            className={`w-5 h-5 rounded-md flex items-center justify-center border cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-brand-purple peer-focus-visible:outline-offset-2 ${
              state.done ? "bg-[image:var(--gradient-brand)] border-transparent" : "bg-surface border-lilac-faint"
            }`}
          >
            {state.done && <CheckIcon size={12} color="white" />}
          </label>
        </span>
        <div className="flex-1 min-w-0">
          <label htmlFor={checkId} className={`block text-sm font-semibold cursor-pointer ${state.done ? "text-lilac-text line-through" : "text-ink"}`}>
            {item.label}
          </label>
          {state.done ? (
            <p className="text-xs text-ink-soft">
              {state.at ? `Hecho el ${dateTime(state.at)}${state.by ? ` por ${profileName(profiles, state.by)}` : ""}` : "Hecho (sin fecha: dato anterior al historial)"}
            </p>
          ) : (
            item.hint && <p className="text-xs text-lilac-text">{item.hint}</p>
          )}
          {state.note && !noteOpen && <p className="text-xs text-ink mt-1 bg-lavender rounded-lg px-2 py-1">{state.note}</p>}
          {noteOpen && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => {
                saveNote();
                setNoteOpen(false);
              }}
              rows={2}
              autoFocus
              aria-label={`Nota para ${item.label}`}
              placeholder="Nota opcional (se guarda al salir del campo)"
              className="mt-1 w-full text-xs rounded-lg border border-lilac px-2 py-1.5 text-ink"
            />
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => setNoteOpen((o) => !o)}
            className="text-xs text-brand-purple font-semibold px-2 py-1 rounded-lg hover:bg-lavender"
            aria-label={`${state.note ? "Editar nota" : "Agregar nota"} de ${item.label}`}
          >
            Nota
          </button>
          {!state.done && contact && (
            <LinkBtn
              external
              href={whatsappLink(contact.phone, reminderMessage(contact.name, item.label.toLowerCase(), room.propertyTitle))}
              label={`Recordar por WhatsApp a ${contact.name || "la parte"}: ${item.label}`}
            >
              <WhatsAppIcon size={12} /> Recordar
            </LinkBtn>
          )}
        </div>
      </div>
    </li>
  );
}
