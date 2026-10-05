import { useState } from "react";
import { MailIcon, PhoneIcon, WhatsAppIcon } from "@/components/ui/icons";
import { whatsappLink } from "@/lib/whatsapp";
import { dateTime, partyRoleLabel, profileName, stageMessage } from "@/lib/dealRoom";
import { inputClass } from "../ui";
import { Btn, LinkBtn, RoomCard } from "./primitives";
import type { Room } from "./room";

interface Person {
  key: string;
  role: string;
  name: string;
  phone: string;
  email: string;
}

/** Contacto rápido con las partes y el escribano, y el feed de notas. */
export function NotesContactCard({ room }: { room: Room }) {
  const { deal, profiles } = room;
  const [text, setText] = useState("");
  const [editNotary, setEditNotary] = useState(false);

  const people: Person[] = [
    { key: "client", role: partyRoleLabel(deal.kind, "client"), ...deal.client },
    { key: "owner", role: partyRoleLabel(deal.kind, "owner"), ...deal.owner },
    ...(deal.guarantor.name.trim() ? [{ key: "guarantor", role: "Garante", ...deal.guarantor }] : []),
    { key: "escribano", role: "Escribano", name: deal.escribano, phone: deal.escribano_phone, email: deal.escribano_email },
  ];

  const notes = deal.events.filter((e) => e.type === "note").reverse();

  const addNote = () => {
    const value = text.trim();
    if (!value) return;
    room.update({}, { type: "note", title: value });
    setText("");
  };

  return (
    <RoomCard title="Notas y contacto">
      <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mb-2">Contacto rápido</h3>
      <ul className="space-y-3 mb-5">
        {people.map((p) => {
          const msg = stageMessage(deal, room.propertyTitle, p.name);
          return (
            <li key={p.key}>
              <p className="text-sm text-ink font-semibold truncate">
                {p.name || <span className="text-ink-soft font-normal">Sin cargar</span>}{" "}
                <span className="text-xs text-lilac-text font-medium">· {p.role}</span>
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {p.phone && (
                  <LinkBtn href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} label={`Llamar a ${p.name || p.role}`}>
                    <PhoneIcon size={12} /> Llamar
                  </LinkBtn>
                )}
                {p.phone && (
                  <LinkBtn external href={whatsappLink(p.phone, msg)} label={`WhatsApp a ${p.name || p.role}`}>
                    <WhatsAppIcon size={12} /> WhatsApp
                  </LinkBtn>
                )}
                {p.email && (
                  <LinkBtn
                    href={`mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(room.propertyTitle)}&body=${encodeURIComponent(msg)}`}
                    label={`Email a ${p.name || p.role}`}
                  >
                    <MailIcon size={12} /> Email
                  </LinkBtn>
                )}
                {!p.phone && !p.email && p.key !== "escribano" && <span className="text-xs text-ink-soft">Sin teléfono ni email</span>}
                {p.key === "escribano" && (
                  <Btn size="sm" variant="ghost" onClick={() => setEditNotary((v) => !v)} aria-expanded={editNotary}>
                    {editNotary ? "Listo" : p.name || p.phone || p.email ? "Editar" : "Cargar escribano"}
                  </Btn>
                )}
              </div>
              {p.key === "escribano" && editNotary && (
                <div className="grid gap-2 mt-2">
                  <input aria-label="Nombre y registro del escribano" placeholder="Nombre y registro" value={deal.escribano} onChange={(e) => room.update({ escribano: e.target.value })} className={inputClass} />
                  <input aria-label="Teléfono del escribano" placeholder="Teléfono" value={deal.escribano_phone} onChange={(e) => room.update({ escribano_phone: e.target.value })} className={inputClass} />
                  <input aria-label="Email del escribano" type="email" placeholder="Email" value={deal.escribano_email} onChange={(e) => room.update({ escribano_email: e.target.value })} className={inputClass} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mb-2">Notas</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          addNote();
        }}
      >
        <label className="sr-only" htmlFor="deal-note">
          Nueva nota
        </label>
        <textarea
          id="deal-note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Acuerdos, pendientes, lo que hablaron con cada parte…"
          className={inputClass}
        />
        <div className="flex justify-end mt-2">
          <Btn type="submit" size="sm" variant="primary" disabled={!text.trim()}>
            Agregar nota
          </Btn>
        </div>
      </form>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.slice(0, 8).map((n) => (
            <li key={n.id} className="rounded-xl bg-lavender px-3 py-2">
              <p className="text-sm text-ink whitespace-pre-wrap break-words">{n.title}</p>
              {n.detail && n.detail !== n.title && <p className="text-xs text-ink-soft">{n.detail}</p>}
              <p className="text-xs text-lilac-text mt-0.5">
                {dateTime(n.created_at)} · {n.actor_id ? profileName(profiles, n.actor_id) : "Dato anterior"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </RoomCard>
  );
}
