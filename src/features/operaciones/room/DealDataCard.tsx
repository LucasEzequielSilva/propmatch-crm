import type { Deal, DealParty } from "@/types/db";
import { Field, NumberInput, inputClass } from "../ui";
import { Restricted, RoomCard } from "./primitives";
import type { Room } from "./room";

/** Condiciones y datos de las partes que alimentan los modelos de documento. */
export function DealDataCard({ room }: { room: Room }) {
  const { deal, isSale, canSensitive } = room;
  const set = (patch: Partial<Deal>) => room.update(patch);

  return (
    <RoomCard title="Condiciones y partes" subtitle="Con estos datos se arman la reserva, el boleto y el contrato">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={isSale ? "Precio de venta" : "Alquiler mensual"}>
          <NumberInput value={deal.price} onChange={(v) => set({ price: v })} />
        </Field>
        <Field label="Moneda">
          <select value={deal.currency} onChange={(e) => set({ currency: e.target.value as Deal["currency"] })} className={inputClass}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </Field>
        <Field label="Comisión en los documentos (%)">
          <NumberInput value={deal.commission_pct} onChange={(v) => set({ commission_pct: v })} />
        </Field>
        <Field label="Reserva (monto)">
          <NumberInput value={deal.reserva_amount} onChange={(v) => set({ reserva_amount: v })} />
        </Field>
        {isSale ? (
          <Field label="Anticipo al boleto (%)">
            <NumberInput value={deal.boleto_advance_pct} onChange={(v) => set({ boleto_advance_pct: v })} />
          </Field>
        ) : (
          <>
            <Field label="Plazo (meses)">
              <NumberInput value={deal.contract_months} onChange={(v) => set({ contract_months: v })} />
            </Field>
            <Field label="Depósito (meses de alquiler)">
              <NumberInput value={deal.deposit_months} onChange={(v) => set({ deposit_months: v })} />
            </Field>
            <Field label="Destino">
              <input value={deal.destination} onChange={(e) => set({ destination: e.target.value })} className={inputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Actualización del alquiler">
                <textarea
                  value={deal.update_rule}
                  onChange={(e) => set({ update_rule: e.target.value })}
                  rows={2}
                  placeholder="Ej: Cada 3 meses, según el índice ICL del BCRA."
                  className={inputClass}
                />
              </Field>
            </div>
          </>
        )}
      </div>
      <p className="text-xs text-ink-soft mt-2">Las fechas (reserva, firma, escritura, inicio) se cargan en “Fechas clave”.</p>

      {!canSensitive && (
        <div className="mt-4">
          <Restricted>DNI, CUIT y domicilio de las partes los ven administración y el responsable de la operación.</Restricted>
        </div>
      )}

      <PartyFields title={isSale ? "Comprador" : "Inquilino"} party={deal.client} legal={canSensitive} onChange={(p) => set({ client: p })} />
      <PartyFields title={isSale ? "Vendedor" : "Propietario"} party={deal.owner} legal={canSensitive} onChange={(p) => set({ owner: p })} />
      {!isSale && <PartyFields title="Garante (opcional)" party={deal.guarantor} legal={canSensitive} onChange={(p) => set({ guarantor: p })} />}
    </RoomCard>
  );
}

function PartyFields({
  title,
  party,
  legal,
  onChange,
}: {
  title: string;
  party: DealParty;
  /** Muestra DNI, CUIT y domicilio. */
  legal: boolean;
  onChange: (p: DealParty) => void;
}) {
  const f = (key: keyof DealParty, label: string, placeholder?: string, type = "text") => (
    <Field label={label}>
      <input type={type} value={party[key]} onChange={(e) => onChange({ ...party, [key]: e.target.value })} placeholder={placeholder} className={inputClass} />
    </Field>
  );
  return (
    <details className="mt-4 rounded-xl border border-lilac group">
      <summary className="cursor-pointer px-4 py-3 text-sm text-ink font-bold flex items-center justify-between">
        <span>
          {title}
          {party.name && <span className="text-xs text-lilac-text font-medium"> · {party.name}</span>}
        </span>
        <span aria-hidden="true" className="text-lilac-text text-xs group-open:rotate-180 transition-transform">
          ▾
        </span>
      </summary>
      <div className="grid gap-4 sm:grid-cols-2 px-4 pb-4">
        <div className="sm:col-span-2">{f("name", "Nombre completo")}</div>
        {legal && f("dni", "DNI")}
        {legal && f("cuit", "CUIL / CUIT")}
        {f("civil_status", "Estado civil", "soltero/a, casado/a…")}
        {f("nationality", "Nacionalidad")}
        {legal && <div className="sm:col-span-2">{f("address", "Domicilio")}</div>}
        {f("phone", "Teléfono", undefined, "tel")}
        {f("email", "Email", undefined, "email")}
      </div>
    </details>
  );
}
