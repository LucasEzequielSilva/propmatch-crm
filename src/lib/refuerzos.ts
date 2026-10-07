/**
 * Refuerzos de reserva: pagos a cuenta (de precio, o del primer mes y el
 * depósito en un alquiler) entre la reserva y el boleto/contrato. Viven en
 * `deal.payments` con `concept: "refuerzo"`; pueden estar programados
 * (`paid: false`, con `due_date`) o pagados.
 *
 * Plan de pago de una venta, con refuerzos:
 *   a cuenta       = reserva + refuerzos (todos, pagados o programados)
 *   anticipo total = máx(precio × % de anticipo, a cuenta)
 *   en el boleto   = anticipo total − a cuenta
 *   saldo          = precio − anticipo total (se paga en la escritura)
 */
import type { CurrencyCode, Deal, DealPayment } from "@/types/db";
import { amountInWords, numericDate } from "./docText";

export const isPaymentPaid = (p: Pick<DealPayment, "paid">) => p.paid !== false;

/** Fecha que se muestra: la prevista si está programado, si no la de pago. */
export const refuerzoDate = (p: Pick<DealPayment, "due_date" | "paid_at" | "paid">) =>
  (isPaymentPaid(p) ? p.paid_at ?? p.due_date : p.due_date ?? p.paid_at) ?? null;

export function refuerzosOf(deal: Pick<Deal, "payments">): DealPayment[] {
  return deal.payments
    .filter((p) => p.concept === "refuerzo")
    .sort((a, b) => String(refuerzoDate(a) ?? "9999").localeCompare(String(refuerzoDate(b) ?? "9999")));
}

export interface SalePlan {
  price: number | null;
  reserva: number;
  /** Refuerzos en la moneda de la operación (los de otra moneda no se suman). */
  refuerzos: number;
  refuerzosPaid: number;
  aCuenta: number;
  advancePct: number;
  advanceTotal: number | null;
  /** Lo que se paga al firmar el boleto. */
  advanceNet: number | null;
  /** Saldo a pagar en la escritura. */
  balance: number | null;
}

export function salePlan(deal: Pick<Deal, "payments" | "price" | "currency" | "reserva_amount" | "boleto_advance_pct">): SalePlan {
  const list = refuerzosOf(deal).filter((p) => p.currency === deal.currency);
  const refuerzos = list.reduce((a, p) => a + (p.amount || 0), 0);
  const refuerzosPaid = list.filter(isPaymentPaid).reduce((a, p) => a + (p.amount || 0), 0);
  const reserva = deal.reserva_amount ?? 0;
  const aCuenta = reserva + refuerzos;
  const advancePct = deal.boleto_advance_pct ?? 30;
  if (deal.price === null) {
    return { price: null, reserva, refuerzos, refuerzosPaid, aCuenta, advancePct, advanceTotal: null, advanceNet: null, balance: null };
  }
  const advanceTotal = Math.min(Math.max((deal.price * advancePct) / 100, aCuenta), deal.price);
  return {
    price: deal.price,
    reserva,
    refuerzos,
    refuerzosPaid,
    aCuenta,
    advancePct,
    advanceTotal,
    advanceNet: Math.max(advanceTotal - aCuenta, 0),
    balance: deal.price - advanceTotal,
  };
}

/** "Refuerzo de reserva de USD 5.000 (dólares estadounidenses cinco mil) el 15/10/2026 (abonado)" */
export function refuerzoLine(p: DealPayment): string {
  const date = refuerzoDate(p);
  return `Refuerzo de reserva de ${amountInWords(p.amount, p.currency as CurrencyCode)} ${date ? `el ${numericDate(date)}` : "en fecha a convenir"}${isPaymentPaid(p) ? " (abonado)" : ""}`;
}

/** Listado para los documentos: una línea por refuerzo. Vacío si no hay. */
export function refuerzosText(deal: Pick<Deal, "payments">): string {
  return refuerzosOf(deal)
    .map((p) => `– ${refuerzoLine(p)}.`)
    .join("\n");
}
