import { useId } from "react";
import { MailIcon, WhatsAppIcon } from "@/components/ui/icons";
import { whatsappLink } from "@/lib/whatsapp";
import { partyRoleLabel, shortDate, todayInput } from "@/lib/dealRoom";
import type { DealPartyRole, DealSignature } from "@/types/db";
import { LinkBtn, RoomCard } from "./primitives";
import type { Room } from "./room";

/**
 * Firmas en papel, cargadas a mano. No es firma electrónica: no hay
 * verificación de identidad ni constancia técnica, solo el registro de que
 * la persona firmó y cuándo.
 */
export function SignaturesCard({ room }: { room: Room }) {
  const { deal, isSale } = room;
  const docName = isSale ? "boleto" : "contrato";
  const roles: DealPartyRole[] = ["client", "owner", ...(deal.kind === "alquiler" && deal.guarantor.name.trim() ? (["guarantor"] as const) : [])];
  const signed = roles.filter((r) => deal.signatures[r]?.signed).length;

  return (
    <RoomCard title={`Firmas del ${docName}`} subtitle={`${signed} de ${roles.length} firmaron · registro manual de firma en papel`}>
      <ul className="divide-y divide-divider">
        {roles.map((r) => (
          <SignatureRow key={r} room={room} role={r} docName={docName} />
        ))}
      </ul>
    </RoomCard>
  );
}

function SignatureRow({ room, role, docName }: { room: Room; role: DealPartyRole; docName: string }) {
  const { deal, profile } = room;
  const party = deal[role];
  const sig: DealSignature = deal.signatures[role] ?? { signed: false, date: null, by: null, at: null };
  const checkId = useId();
  const roleLabel = partyRoleLabel(deal.kind, role);
  const name = party.name || roleLabel;

  const save = (next: DealSignature, title: string) =>
    room.update({ signatures: { ...deal.signatures, [role]: next } }, { type: "signature", title });

  const toggle = () => {
    const signed = !sig.signed;
    const date = signed ? sig.date ?? todayInput() : null;
    save(
      { signed, date, by: signed ? profile.id : null, at: signed ? new Date().toISOString() : null },
      signed ? `${name} firmó el ${docName} en papel (${shortDate(date)})` : `Se desmarcó la firma de ${name}`,
    );
  };

  const message = `Hola ${party.name ? party.name.trim().split(/\s+/)[0] : ""}, te escribo para coordinar la firma del ${docName} de ${room.propertyTitle}. ¿Qué día y horario te quedan bien?`;
  const mail = `mailto:${encodeURIComponent(party.email)}?subject=${encodeURIComponent(`Firma del ${docName} · ${room.propertyTitle}`)}&body=${encodeURIComponent(message)}`;

  return (
    <li className="py-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-48">
        <p className="text-sm text-ink font-semibold">{name}</p>
        <p className="text-xs text-lilac-text">{roleLabel}</p>
      </div>
      <div className="flex items-center gap-2">
        <input id={checkId} type="checkbox" checked={sig.signed} onChange={toggle} className="w-4 h-4 accent-brand-purple" />
        <label htmlFor={checkId} className="text-xs text-ink font-semibold">
          Firmó en papel
        </label>
        {sig.signed && (
          <input
            type="date"
            value={sig.date ?? ""}
            aria-label={`Fecha en que firmó ${name}`}
            onChange={(e) => save({ ...sig, date: e.target.value || null }, `Fecha de firma de ${name}: ${shortDate(e.target.value)}`)}
            className="text-xs rounded-lg border border-lilac px-1.5 py-1 text-ink bg-surface"
          />
        )}
      </div>
      {!sig.signed && (
        <div className="flex items-center gap-1">
          <LinkBtn external href={whatsappLink(party.phone, message)} label={`Reenviar por WhatsApp a ${name}`}>
            <WhatsAppIcon size={12} /> WhatsApp
          </LinkBtn>
          {party.email && (
            <LinkBtn href={mail} label={`Reenviar por email a ${name}`}>
              <MailIcon size={12} /> Email
            </LinkBtn>
          )}
        </div>
      )}
    </li>
  );
}
