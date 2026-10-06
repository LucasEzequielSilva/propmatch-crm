import { useState } from "react";
import type { Contact } from "@/types/db";
import { recordConsent, recordManualUnsubscribe } from "@/lib/marketing/actions";
import { blockOf } from "@/lib/marketing/block";
import { CONSENT_METHOD_LABEL, type ConsentMethod, type MarketingChannel, type UnsubscribeScope } from "@/lib/marketing/types";
import { useStore } from "@/data/store";
import { useMarketing } from "@/lib/marketing/state";
import { SCOPE_LABEL } from "../../../shared/marketing";
import { Btn, Chip, Field, INPUT, Modal, Notice } from "./ui";

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

/**
 * Registrar consentimiento (con fecha y cómo lo dio) o una baja manual.
 * Un consentimiento nuevo es la única forma de revertir una baja.
 */
export function ConsentModal({ contact, mode, onClose }: { contact: Contact; mode: "consent" | "baja"; onClose: () => void }) {
  const { agency, contacts } = useStore();
  const m = useMarketing(agency.id);
  const block = blockOf(m, contact);
  const [channel, setChannel] = useState<MarketingChannel>(contact.email ? "email" : "whatsapp");
  const [method, setMethod] = useState<ConsentMethod>("formulario_web");
  const [evidence, setEvidence] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [scope, setScope] = useState<UnsubscribeScope>("all");
  const [note, setNote] = useState("");
  const [confirmResub, setConfirmResub] = useState(false);
  const blockedHere = channel === "email" ? block.email : block.whatsapp;
  const missingTarget = channel === "email" ? !contact.email : !contact.phone;

  if (mode === "baja") {
    return (
      <Modal
        title={`Dar de baja a ${contact.full_name}`}
        onClose={onClose}
        footer={
          <>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn
              kind="danger"
              onClick={() => {
                recordManualUnsubscribe(agency.id, contact, scope, note, contacts);
                onClose();
              }}
            >
              Registrar baja
            </Btn>
          </>
        }
      >
        <p className="text-sm" style={{ color: "#4B5563" }}>
          Pidió no recibir más mensajes. Queda marcado «No contactar» y el CRM bloquea los envíos por ese canal (campañas, WhatsApp, inbox).
        </p>
        <div className="flex flex-wrap gap-2">
          {(["all", "email", "whatsapp"] as UnsubscribeScope[]).map((s) => (
            <Chip key={s} active={scope === s} onClick={() => setScope(s)}>
              {SCOPE_LABEL[s]}
            </Chip>
          ))}
        </div>
        <Field label="Nota (opcional)">
          <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: lo pidió por teléfono" maxLength={300} />
        </Field>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Consentimiento de ${contact.full_name}`}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn
            kind="primary"
            disabled={missingTarget || !date || (blockedHere && !confirmResub)}
            onClick={() => {
              recordConsent(
                agency.id,
                contact,
                { channel, status: "granted", method, evidence: evidence || null, givenAt: new Date(`${date}T12:00:00`).toISOString() },
                contacts,
              );
              onClose();
            }}
          >
            Registrar consentimiento
          </Btn>
        </>
      }
    >
      <div className="flex gap-2">
        <Chip active={channel === "email"} onClick={() => setChannel("email")}>
          Email
        </Chip>
        <Chip active={channel === "whatsapp"} onClick={() => setChannel("whatsapp")}>
          WhatsApp
        </Chip>
      </div>
      {missingTarget && <Notice tone="warn">Este contacto no tiene {channel === "email" ? "email" : "teléfono"} cargado.</Notice>}
      {blockedHere && (
        <Notice tone="danger">
          Está dado de baja por {channel === "email" ? "email" : "WhatsApp"}. Registrá un consentimiento nuevo SOLO si el contacto volvió a pedirlo
          expresamente.
          <label className="flex items-center gap-2 mt-2">
            <input type="checkbox" checked={confirmResub} onChange={(e) => setConfirmResub(e.target.checked)} />
            El contacto volvió a dar su consentimiento
          </label>
        </Notice>
      )}
      <Field label="¿Cómo lo dio?">
        <select className={INPUT} value={method} onChange={(e) => setMethod(e.target.value as ConsentMethod)}>
          {(Object.keys(CONSENT_METHOD_LABEL) as ConsentMethod[]).map((k) => (
            <option key={k} value={k}>
              {CONSENT_METHOD_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fecha en que lo dio">
        <input type="date" className={INPUT} value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Detalle / evidencia" hint="Dónde quedó constancia. Ley 25.326: el consentimiento tiene que ser libre, expreso e informado.">
        <input className={INPUT} value={evidence} onChange={(e) => setEvidence(e.target.value)} maxLength={300} placeholder="Ej.: casilla en el formulario de la web, 12/03" />
      </Field>
    </Modal>
  );
}
