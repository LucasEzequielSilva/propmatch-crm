import { useState } from "react";
import { money } from "@/lib/format";
import {
  PAYMENT_CONCEPT_LABEL,
  dealUid,
  financeSummary,
  profileName,
  shortDate,
  todayInput,
} from "@/lib/dealRoom";
import type { CurrencyCode, DealCommission, DealPayment, DealPaymentConcept } from "@/types/db";
import { Field, NumberInput, inputClass } from "../ui";
import { Btn, Modal, Restricted, RoomCard, Stat } from "./primitives";
import type { Room } from "./room";
import { RefuerzosSection } from "./RefuerzosSection";
import { isPaymentPaid } from "@/lib/refuerzos";

/** Control financiero: visible solo para administración o el responsable (gating visual). */
export function FinanceCard({ room, onRegisterPayment }: { room: Room; onRegisterPayment: () => void }) {
  const { deal, property, canSensitive, isAdmin, profiles, isSale } = room;
  if (!canSensitive) {
    return (
      <RoomCard title="Control financiero">
        <Restricted>Lo ven administración y el responsable de la operación.</Restricted>
      </RoomCard>
    );
  }
  const f = financeSummary(deal, property);
  const cur = deal.currency;
  const c = deal.commission;
  const setCommission = (patch: Partial<DealCommission>) => room.update({ commission: { ...c, ...patch } });

  const removePayment = (p: DealPayment) =>
    room.update(
      { payments: deal.payments.filter((x) => x.id !== p.id) },
      { type: "payment", title: `Anuló el pago: ${PAYMENT_CONCEPT_LABEL[p.concept]} ${money(p.amount, p.currency)}` },
    );

  return (
    <RoomCard title="Control financiero" action={<Btn size="sm" onClick={onRegisterPayment}>Registrar pago</Btn>}>
      <div className="grid grid-cols-2 gap-3">
        <Stat label={isSale ? "Monto convenido" : "Alquiler mensual"} value={money(f.price, cur)} />
        {isSale && <Stat label={`${cur}/m²`} value={f.pricePerM2 ? money(f.pricePerM2, cur) : "—"} hint={!f.pricePerM2 ? "Falta la superficie" : undefined} />}
        {isSale && <Stat label={`Anticipo (${deal.boleto_advance_pct ?? 30}%)`} value={money(f.advanceTotal, cur)} />}
        {isSale && <Stat label="Saldo a la escritura" value={money(f.balanceAtDeed, cur)} />}
        {f.refuerzosTotal > 0 && (
          <Stat label="Refuerzos" value={money(f.refuerzosTotal, cur)} hint={f.refuerzosPaid < f.refuerzosTotal ? `Pagado: ${money(f.refuerzosPaid, cur)}` : "Todos pagados"} />
        )}
        <Stat label="Pagado por el cliente" value={money(f.paidByClient, cur)} />
        {isSale && <Stat label="Saldo pendiente" value={money(f.pendingPrice, cur)} />}
      </div>

      <RefuerzosSection room={room} />

      <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mt-5 mb-2">Pagos registrados</h3>
      {/* Los refuerzos programados (sin pagar) se ven arriba, en «Refuerzos de reserva». */}
      {deal.payments.filter(isPaymentPaid).length === 0 ? (
        <p className="text-xs text-ink-soft">Sin pagos registrados.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {deal.payments.filter(isPaymentPaid).map((p) => (
            <li key={p.id} className="py-2 flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink font-semibold">
                  {PAYMENT_CONCEPT_LABEL[p.concept]} · {money(p.amount, p.currency)}
                </p>
                <p className="text-xs text-ink-soft">
                  {shortDate(p.paid_at)}
                  {p.receipt_text ? ` · Comprobante: ${p.receipt_text}` : ""}
                  {p.notes ? ` · ${p.notes}` : ""}
                </p>
              </div>
              {isAdmin && (
                <button type="button" onClick={() => removePayment(p)} className="text-xs text-rose-700 font-semibold px-1" aria-label={`Anular pago de ${PAYMENT_CONCEPT_LABEL[p.concept]}`}>
                  Anular
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {f.otherCurrency.length > 0 && (
        <p className="text-xs text-state-amber-text mt-1">Hay pagos en otra moneda: no se suman a los totales (no hay tipo de cambio).</p>
      )}

      <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mt-5 mb-2">Comisión</h3>
      <div className="space-y-3">
        <CommissionSide
          label={isSale ? "Comprador" : "Inquilino"}
          mode={c.buyer_mode}
          value={c.buyer_value}
          currency={cur}
          disabled={!isAdmin}
          onChange={(mode, value) => setCommission({ buyer_mode: mode, buyer_value: value })}
        />
        <CommissionSide
          label={isSale ? "Vendedor" : "Propietario"}
          mode={c.seller_mode}
          value={c.seller_value}
          currency={cur}
          disabled={!isAdmin}
          onChange={(mode, value) => setCommission({ seller_mode: mode, seller_value: value })}
        />
        <Field label={`Gastos (${cur})`}>
          {isAdmin ? <NumberInput value={c.expenses || null} onChange={(v) => setCommission({ expenses: v ?? 0 })} /> : <p className="text-sm text-ink">{money(c.expenses, cur)}</p>}
        </Field>
        {!isAdmin && <p className="text-xs text-ink-soft">La comisión la edita administración.</p>}
        {!isSale && <p className="text-xs text-ink-soft">En alquiler, el % se calcula sobre el valor total del contrato ({deal.contract_months ?? 24} meses).</p>}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-4">
        <Stat label="Comisión total" value={money(f.commissionGross, cur)} />
        <Stat label="Cobrado" value={money(f.commissionCollected, cur)} />
        <Stat label="Pendiente de cobro" value={money(f.commissionPending, cur)} />
        <Stat label="Neto agencia" value={money(f.netAgency, cur)} hint="Comisión menos gastos" />
      </div>
      {f.splits.length > 0 && (
        <>
          <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mt-5 mb-2">Reparto interno</h3>
          <ul className="space-y-1">
            {f.splits.map((s) => (
              <li key={s.user_id} className="flex justify-between text-sm">
                <span className="text-ink">
                  {profileName(profiles, s.user_id)} <span className="text-xs text-lilac-text">({s.share_pct}%)</span>
                </span>
                <span className="text-ink font-semibold">{money(s.amount, cur)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-ink-soft mt-5 border-t border-divider pt-3">
        Esta sección se oculta según el rol, pero por ahora los datos se guardan en este navegador y no tienen protección
        de acceso: cualquiera que use este equipo podría verlos.
      </p>
    </RoomCard>
  );
}

function CommissionSide({
  label,
  mode,
  value,
  currency,
  disabled,
  onChange,
}: {
  label: string;
  mode: "percent" | "fixed";
  value: number;
  currency: CurrencyCode;
  disabled: boolean;
  onChange: (mode: "percent" | "fixed", value: number) => void;
}) {
  return (
    <fieldset className="grid grid-cols-[1fr_auto] gap-2 items-end" disabled={disabled}>
      <legend className="text-xs text-lilac-text font-semibold mb-1">{label}</legend>
      <NumberInput value={value || null} onChange={(v) => onChange(mode, v ?? 0)} />
      <select
        value={mode}
        aria-label={`Tipo de comisión de ${label}`}
        onChange={(e) => onChange(e.target.value as "percent" | "fixed", value)}
        className={`${inputClass} !w-auto`}
      >
        <option value="percent">%</option>
        <option value="fixed">{currency} fijo</option>
      </select>
    </fieldset>
  );
}

/** Alta de un pago: es un registro administrativo, no mueve dinero. */
export function PaymentModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { deal, profile } = room;
  const [concept, setConcept] = useState<DealPaymentConcept>(deal.payments.some((p) => p.concept === "reserva") ? "anticipo" : "reserva");
  const [amount, setAmount] = useState<number | null>(concept === "reserva" ? deal.reserva_amount : null);
  const [currency, setCurrency] = useState<CurrencyCode>(deal.currency);
  const [date, setDate] = useState(todayInput());
  const [receipt, setReceipt] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (!amount || amount <= 0) return setError("Cargá un monto mayor a cero.");
    const payment: DealPayment = {
      id: dealUid("pay"),
      concept,
      amount,
      currency,
      paid_at: date || null,
      receipt_text: receipt.trim(),
      notes: notes.trim(),
      created_by: profile.id,
      created_at: new Date().toISOString(),
    };
    room.update(
      { payments: [...deal.payments, payment] },
      { type: "payment", title: `Registró pago: ${PAYMENT_CONCEPT_LABEL[concept]} ${money(amount, currency)}`, detail: receipt.trim() || null },
    );
    onClose();
  };

  return (
    <Modal
      title="Registrar pago"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={submit}>
            Guardar pago
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Concepto">
          <select value={concept} onChange={(e) => setConcept(e.target.value as DealPaymentConcept)} className={inputClass}>
            {(Object.keys(PAYMENT_CONCEPT_LABEL) as DealPaymentConcept[]).map((k) => (
              <option key={k} value={k}>
                {PAYMENT_CONCEPT_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Monto">
          <NumberInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Moneda">
          <select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)} className={inputClass}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Comprobante (número o descripción)">
            <input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="Ej: Transferencia 0042-xxxx, recibo N° 15" className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Nota">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-rose-700 font-semibold mt-3">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-soft mt-3">Es un registro administrativo: PropMatch no mueve ni cobra dinero.</p>
    </Modal>
  );
}
