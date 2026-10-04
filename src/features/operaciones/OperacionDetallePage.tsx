import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { CheckIcon, ChevronLeftIcon } from "@/components/ui/icons";
import { useStore } from "@/data/store";
import {
  DEAL_DOCS,
  DEAL_STEPS,
  DOCUMENT_LABEL,
  docProgress,
  documentsFor,
  stepProgress,
  type ChecklistItem,
} from "@/lib/deals";
import type { Deal, DealParty } from "@/types/db";
import { DEAL_STATUS_LABEL, DEAL_STATUS_STYLE } from "./OperacionesPage";
import { Field, NumberInput, SectionLabel, inputClass } from "./ui";

/** Expediente de una operación: datos, pasos, documentación y modelos para imprimir. */
export default function OperacionDetallePage() {
  const navigate = useNavigate();
  const { dealId } = useParams();
  const { deals, propertyById, updateDeal, removeDeal, updateProperty, moveOpportunity } = useStore();
  const deal = deals.find((d) => d.id === dealId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!deal) {
    return (
      <>
        <AppHeader title="Operación" compact />
        <EmptyState
          title="No encontramos esta operación"
          action={{ label: "Volver a Operaciones", onClick: () => navigate("/operaciones") }}
        />
      </>
    );
  }

  const property = propertyById(deal.property_id);
  const set = (patch: Partial<Deal>) => updateDeal(deal.id, patch);
  const steps = stepProgress(deal);
  const docs = docProgress(deal);
  const style = DEAL_STATUS_STYLE[deal.status];
  const isSale = deal.kind === "venta";

  const toggle = (bucket: "steps" | "docs", id: string) =>
    set({ [bucket]: { ...deal[bucket], [id]: !deal[bucket][id] } } as Partial<Deal>);

  const closeDeal = () => {
    set({ status: "cerrada" });
    if (property) updateProperty(property.id, { status: isSale ? "vendida" : "alquilada" });
    if (deal.opportunity_id) moveOpportunity(deal.opportunity_id, "cierre");
  };

  const dropDeal = () => {
    set({ status: "caida" });
    if (property && property.status === "reservada") updateProperty(property.id, { status: "disponible" });
  };

  const reopen = () => set({ status: "en_curso" });

  return (
    <>
      <AppHeader title={isSale ? "Venta" : "Alquiler"} subtitle={property?.title ?? "Operación"} compact />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10">
        <button
          onClick={() => navigate("/operaciones")}
          className="flex items-center gap-1 text-sm mt-5 mb-4"
          style={{ color: "#7C3AED", fontWeight: 600 }}
        >
          <ChevronLeftIcon size={14} /> Operaciones
        </button>

        {/* Estado y acciones */}
        <Card padded className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                  {property?.title ?? "Sin propiedad"}
                </p>
                <span
                  className="text-xs px-2.5 py-1 rounded-full"
                  style={{ background: style.bg, color: style.text, fontWeight: 600 }}
                >
                  {DEAL_STATUS_LABEL[deal.status]}
                </span>
              </div>
              <p className="text-xs mt-1" style={{ color: "#7C6A99" }}>
                Pasos {steps.done}/{steps.total} · Documentos {docs.done}/{docs.total}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {deal.status === "en_curso" ? (
                <>
                  <button
                    onClick={closeDeal}
                    className="px-4 py-2 rounded-xl text-sm text-white"
                    style={{ background: "linear-gradient(135deg, #10B981, #059669)", fontWeight: 600 }}
                  >
                    Marcar como cerrada
                  </button>
                  <button
                    onClick={dropDeal}
                    className="px-4 py-2 rounded-xl text-sm border"
                    style={{ borderColor: "#FECDD3", color: "#BE123C", fontWeight: 600 }}
                  >
                    Se cayó
                  </button>
                </>
              ) : (
                <button
                  onClick={reopen}
                  className="px-4 py-2 rounded-xl text-sm border"
                  style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600 }}
                >
                  Reabrir
                </button>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Columna izquierda: pasos + documentación */}
          <div className="space-y-5">
            <Card>
              <SectionHeader inCard title="Pasos de la operación" subtitle={`${steps.done} de ${steps.total} completados`} />
              <div className="px-5 py-3">
                {DEAL_STEPS[deal.kind].map((s, i) => (
                  <CheckRow key={s.id} item={s} index={i + 1} checked={!!deal.steps[s.id]} onToggle={() => toggle("steps", s.id)} />
                ))}
              </div>
            </Card>

            <Card>
              <SectionHeader inCard title="Documentación a reunir" subtitle={`${docs.done} de ${docs.total} recibidos`} />
              <div className="px-5 py-3 space-y-4">
                {DEAL_DOCS[deal.kind].map((g) => (
                  <div key={g.id}>
                    <p className="text-xs uppercase mb-1" style={{ color: "#7C3AED", fontWeight: 700, letterSpacing: "0.1em" }}>
                      {g.title}
                    </p>
                    {g.items.map((it) => (
                      <CheckRow key={it.id} item={it} checked={!!deal.docs[it.id]} onToggle={() => toggle("docs", it.id)} />
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Columna derecha: documentos + datos */}
          <div className="space-y-5">
            <Card>
              <SectionHeader
                inCard
                title="Armar documentos"
                subtitle="Se completan con los datos de abajo. Imprimí o guardá como PDF."
              />
              <div className="p-5 grid gap-2">
                {documentsFor(deal.kind).map((k) => (
                  <button
                    key={k}
                    onClick={() => window.open(`/operaciones/${deal.id}/documento/${k}`, "_blank")}
                    className="flex items-center justify-between px-4 py-3 rounded-xl border text-sm transition-all hover:bg-violet-50"
                    style={{ borderColor: "#EDE9FE", color: "#1F0A3C", fontWeight: 600 }}
                  >
                    {DOCUMENT_LABEL[k]}
                    <span className="text-xs" style={{ color: "#7C3AED" }}>
                      Abrir e imprimir →
                    </span>
                  </button>
                ))}
                <p className="text-xs mt-1" style={{ color: "#7458C4" }}>
                  Son modelos orientativos: que los revise un escribano o abogado antes de firmar.
                </p>
              </div>
            </Card>

            <Card padded>
              <SectionLabel>Condiciones</SectionLabel>
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
                <Field label="Comisión (%)">
                  <NumberInput value={deal.commission_pct} onChange={(v) => set({ commission_pct: v })} />
                </Field>
                <Field label="Reserva (monto)">
                  <NumberInput value={deal.reserva_amount} onChange={(v) => set({ reserva_amount: v })} />
                </Field>
                <Field label="Reserva vigente hasta">
                  <input type="date" value={deal.reserva_valid_until ?? ""} onChange={(e) => set({ reserva_valid_until: e.target.value || null })} className={inputClass} />
                </Field>

                {isSale ? (
                  <>
                    <Field label="Anticipo al boleto (%)">
                      <NumberInput value={deal.boleto_advance_pct} onChange={(v) => set({ boleto_advance_pct: v })} />
                    </Field>
                    <Field label="Fecha de escritura">
                      <input type="date" value={deal.escritura_date ?? ""} onChange={(e) => set({ escritura_date: e.target.value || null })} className={inputClass} />
                    </Field>
                    <Field label="Escribano">
                      <input value={deal.escribano} onChange={(e) => set({ escribano: e.target.value })} placeholder="Nombre y registro" className={inputClass} />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Plazo (meses)">
                      <NumberInput value={deal.contract_months} onChange={(v) => set({ contract_months: v })} />
                    </Field>
                    <Field label="Inicio del contrato">
                      <input type="date" value={deal.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value || null })} className={inputClass} />
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
            </Card>

            <PartyCard title={isSale ? "Comprador" : "Inquilino"} party={deal.client} onChange={(p) => set({ client: p })} />
            <PartyCard title={isSale ? "Vendedor" : "Propietario"} party={deal.owner} onChange={(p) => set({ owner: p })} />
            {!isSale && (
              <PartyCard title="Garante (opcional)" party={deal.guarantor} onChange={(p) => set({ guarantor: p })} />
            )}

            <Card padded>
              <SectionLabel>Notas</SectionLabel>
              <textarea
                value={deal.notes}
                onChange={(e) => set({ notes: e.target.value })}
                rows={4}
                placeholder="Acuerdos, pendientes, lo que hablaron con cada parte…"
                className={inputClass}
              />
            </Card>

            <div className="flex justify-end">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: "#BE123C", fontWeight: 600 }}>
                    ¿Eliminar esta operación?
                  </span>
                  <button
                    onClick={() => {
                      removeDeal(deal.id);
                      navigate("/operaciones");
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs text-white"
                    style={{ background: "#BE123C", fontWeight: 600 }}
                  >
                    Sí, eliminar
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 rounded-lg text-xs" style={{ color: "#7C6A99", fontWeight: 600 }}>
                    No
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-xs" style={{ color: "#BE123C", fontWeight: 600 }}>
                  Eliminar operación
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CheckRow({
  item,
  index,
  checked,
  onToggle,
}: {
  item: ChecklistItem;
  index?: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button onClick={onToggle} className="w-full flex items-start gap-3 py-2 text-left">
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5 border"
        style={
          checked
            ? { background: "var(--gradient-brand)", borderColor: "transparent", color: "white" }
            : { background: "white", borderColor: "#DDD6FE" }
        }
      >
        {checked && <CheckIcon size={12} color="white" />}
      </span>
      <span className="min-w-0">
        <span
          className="block text-sm"
          style={{ color: checked ? "#7458C4" : "#1F0A3C", fontWeight: 600, textDecoration: checked ? "line-through" : "none" }}
        >
          {index ? `${index}. ` : ""}
          {item.label}
        </span>
        {item.hint && !checked && (
          <span className="block text-xs" style={{ color: "#7458C4" }}>
            {item.hint}
          </span>
        )}
      </span>
    </button>
  );
}

function PartyCard({ title, party, onChange }: { title: string; party: DealParty; onChange: (p: DealParty) => void }) {
  const f = (key: keyof DealParty, label: string, placeholder?: string) => (
    <Field label={label}>
      <input value={party[key]} onChange={(e) => onChange({ ...party, [key]: e.target.value })} placeholder={placeholder} className={inputClass} />
    </Field>
  );
  return (
    <Card padded>
      <SectionLabel>{title}</SectionLabel>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{f("name", "Nombre completo")}</div>
        {f("dni", "DNI")}
        {f("cuit", "CUIL / CUIT")}
        {f("civil_status", "Estado civil", "soltero/a, casado/a…")}
        {f("nationality", "Nacionalidad")}
        <div className="sm:col-span-2">{f("address", "Domicilio")}</div>
        {f("phone", "Teléfono")}
        {f("email", "Email")}
      </div>
    </Card>
  );
}
