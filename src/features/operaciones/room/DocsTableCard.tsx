import { useState } from "react";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { WhatsAppIcon } from "@/components/ui/icons";
import { whatsappLink } from "@/lib/whatsapp";
import { DEAL_DOCS, docProgress } from "@/lib/deals";
import {
  DOC_STATUS_LABEL,
  dateTime,
  docTarget,
  effectiveDocStatus,
  emptyDocState,
  profileName,
  reminderMessage,
  shortDate,
  targetContact,
} from "@/lib/dealRoom";
import type { DealDocState, DealDocStatus } from "@/types/db";
import { LinkBtn, Pill, RoomCard, type Tone } from "./primitives";
import type { Room } from "./room";

const STATUS_TONE: Record<DealDocStatus, Tone> = {
  pendiente: "neutral",
  recibido: "blue",
  validado: "green",
  vencido: "red",
};

/** Estado de cada documento de DEAL_DOCS. En fase 1 no se suben archivos. */
export function DocsTableCard({ room }: { room: Room }) {
  const { deal, isAdmin, profiles, profile } = room;
  const groups = DEAL_DOCS[deal.kind];
  const [filter, setFilter] = useState<string>("todos");
  const progress = docProgress(deal);
  const visible = filter === "todos" ? groups : groups.filter((g) => g.id === filter);

  const setDoc = (id: string, patch: Partial<DealDocState>, eventTitle?: string) => {
    const prev = deal.docs[id] ?? emptyDocState();
    const next: DealDocState = { ...prev, ...patch };
    if (patch.status) {
      next.done = patch.status === "recibido" || patch.status === "validado";
      next.at = new Date().toISOString();
      next.by = profile.id;
      next.validated_by = patch.status === "validado" ? profile.id : null;
    }
    room.update({ docs: { ...deal.docs, [id]: next } }, eventTitle ? { type: "document", title: eventTitle } : undefined);
  };

  return (
    <RoomCard
      title="Estado de documentos"
      subtitle={`${progress.done} de ${progress.total} recibidos o validados`}
      action={
        <button
          type="button"
          disabled
          title="Próximamente"
          aria-label="Subir archivo (próximamente)"
          className="text-xs px-2.5 py-1.5 rounded-xl border border-lilac text-lilac-text font-semibold opacity-60 cursor-not-allowed"
        >
          Subir archivo · Próximamente
        </button>
      }
    >
      <div className="mb-3 -mt-1 overflow-x-auto">
        <FilterTabs
          options={[{ value: "todos", label: "Todos" }, ...groups.map((g) => ({ value: g.id, label: g.title }))]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {!isAdmin && <p className="text-xs text-ink-soft mb-2">“Validado” lo marca administración.</p>}

      <div className="overflow-x-auto -mx-5 px-5">
        <table className="w-full text-sm min-w-[640px]">
          <caption className="sr-only">Documentos de la operación con estado, vencimiento y última actualización</caption>
          <thead>
            <tr className="text-left text-xs text-lilac-text">
              <th scope="col" className="py-2 pr-3 font-semibold">Documento</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Estado</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Vence</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Actualizado</th>
              <th scope="col" className="py-2 font-semibold"><span className="sr-only">Acciones</span></th>
            </tr>
          </thead>
          {visible.map((g) => {
            const contact = targetContact(deal, docTarget(g.id));
            return (
              <tbody key={g.id} className="border-t border-divider">
                <tr>
                  <th scope="rowgroup" colSpan={5} className="pt-3 pb-1 text-left text-xs uppercase tracking-[0.1em] text-brand-purple font-bold">
                    {g.title}
                  </th>
                </tr>
                {g.items.map((it) => {
                  const st = deal.docs[it.id] ?? emptyDocState();
                  const eff = effectiveDocStatus(st);
                  return (
                    <tr key={it.id} className="border-t border-divider-soft align-top">
                      <td className="py-2 pr-3">
                        <span className="text-ink font-semibold">{it.label}</span>
                        {it.hint && <span className="block text-xs text-lilac-text">{it.hint}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-col gap-1">
                          <Pill tone={STATUS_TONE[eff]}>{DOC_STATUS_LABEL[eff]}</Pill>
                          <select
                            value={st.status}
                            aria-label={`Estado de ${it.label}`}
                            onChange={(e) => {
                              const s = e.target.value as DealDocStatus;
                              setDoc(it.id, { status: s }, `${it.label}: ${DOC_STATUS_LABEL[s]}`);
                            }}
                            className="text-xs rounded-lg border border-lilac px-1.5 py-1 text-ink bg-surface"
                          >
                            {(Object.keys(DOC_STATUS_LABEL) as DealDocStatus[]).map((s) => (
                              <option key={s} value={s} disabled={s === "validado" && !isAdmin && st.status !== "validado"}>
                                {DOC_STATUS_LABEL[s]}
                                {s === "validado" && !isAdmin ? " (solo administración)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="date"
                          value={st.expires_at ?? ""}
                          aria-label={`Vencimiento de ${it.label}`}
                          onChange={(e) =>
                            setDoc(
                              it.id,
                              { expires_at: e.target.value || null },
                              e.target.value ? `${it.label}: vence el ${shortDate(e.target.value)}` : `${it.label}: sin vencimiento`,
                            )
                          }
                          className="text-xs rounded-lg border border-lilac px-1.5 py-1 text-ink bg-surface"
                        />
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-soft">
                        {st.at ? (
                          <>
                            {dateTime(st.at)}
                            <br />
                            {profileName(profiles, st.by)}
                            {st.status === "validado" && st.validated_by && <span className="block">Validó {profileName(profiles, st.validated_by)}</span>}
                          </>
                        ) : st.done ? (
                          "Dato anterior al historial"
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {(eff === "pendiente" || eff === "vencido") && (
                          <LinkBtn
                            external
                            href={whatsappLink(contact.phone, reminderMessage(contact.name, it.label.toLowerCase(), room.propertyTitle))}
                            label={`Pedir por WhatsApp: ${it.label}`}
                          >
                            <WhatsAppIcon size={12} /> Pedir
                          </LinkBtn>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
    </RoomCard>
  );
}
