import { useState } from "react";
import { money } from "@/lib/format";
import { dealUid, shortDate, todayInput } from "@/lib/dealRoom";
import { isPaymentPaid, refuerzoDate, refuerzosOf } from "@/lib/refuerzos";
import type { CurrencyCode, DealPayment } from "@/types/db";
import { Field, NumberInput, inputClass } from "../ui";
import { Btn } from "./primitives";
import type { Room } from "./room";

/**
 * Refuerzos de reserva: varios pagos a cuenta con fecha prevista, monto,
 * moneda y pagado sí/no. Los pagados suman a «Pagado por el cliente»; todos
 * entran en el plan de pago (el saldo los descuenta) y en la reserva y el
 * boleto como listado (ver src/lib/refuerzos.ts y src/lib/docTemplates.ts).
 */
export function RefuerzosSection({ room }: { room: Room }) {
  const { deal, profile } = room;
  const list = refuerzosOf(deal);
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>(deal.currency);
  const [date, setDate] = useState(todayInput());
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState("");

  const add = () => {
    if (!amount || amount <= 0) return setError("Cargá un monto mayor a cero.");
    const p: DealPayment = {
      id: dealUid("pay"),
      concept: "refuerzo",
      amount,
      currency,
      due_date: date || null,
      paid,
      paid_at: paid ? date || todayInput() : null,
      receipt_text: "",
      notes: "",
      created_by: profile.id,
      created_at: new Date().toISOString(),
    };
    room.update(
      { payments: [...deal.payments, p] },
      { type: "payment", title: `${paid ? "Registró" : "Programó"} refuerzo de reserva: ${money(amount, currency)}${date ? ` (${shortDate(date)})` : ""}` },
    );
    setAdding(false);
    setAmount(null);
    setPaid(false);
    setError("");
  };

  const togglePaid = (p: DealPayment) => {
    const nowPaid = !isPaymentPaid(p);
    room.update(
      {
        payments: deal.payments.map((x) =>
          x.id === p.id ? { ...x, paid: nowPaid, paid_at: nowPaid ? (x.paid_at ?? todayInput()) : null, due_date: x.due_date ?? x.paid_at ?? null } : x,
        ),
      },
      { type: "payment", title: `${nowPaid ? "Marcó como pagado" : "Marcó como pendiente"} el refuerzo de ${money(p.amount, p.currency)}` },
    );
  };

  const remove = (p: DealPayment) =>
    room.update(
      { payments: deal.payments.filter((x) => x.id !== p.id) },
      { type: "payment", title: `Quitó el refuerzo de ${money(p.amount, p.currency)}` },
    );

  return (
    <>
      <div className="flex items-center justify-between mt-5 mb-2">
        <h3 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold">Refuerzos de reserva</h3>
        {!adding && (
          <Btn size="sm" onClick={() => setAdding(true)}>
            Agregar refuerzo
          </Btn>
        )}
      </div>
      {list.length === 0 && !adding && (
        <p className="text-xs text-ink-soft">Sin refuerzos. Si el comprador refuerza la seña en cuotas, cargalos acá: salen en la reserva y en el boleto.</p>
      )}
      {list.length > 0 && (
        <ul className="divide-y divide-divider">
          {list.map((p) => {
            const isPaid = isPaymentPaid(p);
            return (
              <li key={p.id} className="py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink font-semibold">{money(p.amount, p.currency)}</p>
                  <p className="text-xs text-ink-soft">
                    {isPaid ? `Pagado el ${shortDate(refuerzoDate(p))}` : `Previsto para el ${shortDate(refuerzoDate(p))}`}
                    {p.currency !== deal.currency ? " · otra moneda: no se suma" : ""}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ink font-semibold">
                  <input type="checkbox" checked={isPaid} onChange={() => togglePaid(p)} aria-label={`Refuerzo de ${money(p.amount, p.currency)} pagado`} />
                  Pagado
                </label>
                {room.isAdmin && (
                  <button type="button" onClick={() => remove(p)} className="text-xs text-rose-700 font-semibold px-1" aria-label={`Quitar refuerzo de ${money(p.amount, p.currency)}`}>
                    Quitar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <div className="rounded-xl border border-divider p-3 mt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Monto">
              <NumberInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Moneda">
              <select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)} className={inputClass}>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </Field>
            <Field label={paid ? "Fecha de pago" : "Fecha prevista"}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink font-semibold self-end min-h-11">
              <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              Ya está pagado
            </label>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-700 font-semibold mt-2">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-3">
            <Btn size="sm" onClick={() => setAdding(false)}>
              Cancelar
            </Btn>
            <Btn size="sm" variant="primary" onClick={add}>
              Guardar refuerzo
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}
