import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import { AlertTriangleIcon, CalendarIcon } from "@/components/ui/icons";
import { dealNumberLabel, daysUntil, isChecked, shortDate, todayInput } from "@/lib/dealRoom";
import type { Deal } from "@/types/db";
import { Btn, RoomCard } from "./primitives";
import type { Room } from "./room";

type DateField = "reserva_valid_until" | "signing_date" | "escritura_date" | "start_date";

interface KeyDate {
  field: DateField;
  label: string;
  /** Prefijo del título del evento en Agenda: así se reconoce si ya está agendado. */
  eventTitle: string;
}

function keyDates(isSale: boolean): KeyDate[] {
  return isSale
    ? [
        { field: "reserva_valid_until", label: "Vencimiento de la reserva", eventTitle: "Vence la reserva" },
        { field: "signing_date", label: "Firma del boleto", eventTitle: "Firma de boleto" },
        { field: "escritura_date", label: "Escritura", eventTitle: "Escritura" },
      ]
    : [
        { field: "reserva_valid_until", label: "Vencimiento de la reserva", eventTitle: "Vence la reserva" },
        { field: "signing_date", label: "Firma del contrato", eventTitle: "Firma de contrato" },
        { field: "start_date", label: "Inicio del contrato", eventTitle: "Entrega de llaves" },
      ];
}

/** Alertas reales de vencimiento, para mostrar arriba de la columna derecha. */
export function dealAlerts(deal: Deal): { tone: "red" | "amber"; text: string }[] {
  if (deal.status !== "en_curso") return [];
  const out: { tone: "red" | "amber"; text: string }[] = [];
  // La reserva deja de importar una vez firmado el boleto (venta) o el contrato (alquiler).
  if (deal.reserva_valid_until && !isChecked(deal.steps[deal.kind === "venta" ? "boleto" : "firma"])) {
    const d = daysUntil(deal.reserva_valid_until);
    if (d < 0) out.push({ tone: "red", text: `La reserva venció el ${shortDate(deal.reserva_valid_until)}.` });
    else if (d <= 3) out.push({ tone: "amber", text: d === 0 ? "La reserva vence hoy." : `La reserva vence en ${d} ${d === 1 ? "día" : "días"} (${shortDate(deal.reserva_valid_until)}).` });
  }
  if (deal.kind === "venta" && deal.escritura_date && !isChecked(deal.steps.escritura)) {
    const d = daysUntil(deal.escritura_date);
    if (d < 0) out.push({ tone: "red", text: `La escritura estaba prevista para el ${shortDate(deal.escritura_date)} y no está marcada como hecha.` });
    else if (d <= 7) out.push({ tone: "amber", text: d === 0 ? "La escritura es hoy." : `Escritura en ${d} ${d === 1 ? "día" : "días"} (${shortDate(deal.escritura_date)}).` });
  }
  return out;
}

export function AlertsBox({ deal }: { deal: Deal }) {
  const alerts = dealAlerts(deal);
  if (!alerts.length) return null;
  return (
    <div role="status" className="space-y-2">
      {alerts.map((a) => (
        <p
          key={a.text}
          className={`flex items-start gap-2 text-xs font-semibold rounded-xl border px-3 py-2 ${
            a.tone === "red" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-state-amber-bg text-state-amber-text border-state-amber-border"
          }`}
        >
          <AlertTriangleIcon size={14} color="currentColor" className="mt-0.5 flex-shrink-0" />
          {a.text}
        </p>
      ))}
    </div>
  );
}

export function KeyDatesCard({ room }: { room: Room }) {
  const { deal, isSale } = room;
  const { events, addEvent } = useStore();
  const number = dealNumberLabel(deal.number);

  const linked = events.filter((e) => deal.event_ids.includes(e.id));

  const schedule = (k: KeyDate) => {
    const date = deal[k.field];
    if (!date) return;
    const [y, m, d] = date.split("-").map(Number);
    const start = new Date(y, m - 1, d, 10, 0);
    const end = new Date(y, m - 1, d, 11, 0);
    const ev = addEvent({
      type: "reunion",
      title: `${k.eventTitle} · ${number} · ${room.propertyTitle}`,
      contact_id: deal.client_contact_id,
      property_id: deal.property_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      notes: `Creado desde la operación ${number}. Horario a confirmar.`,
      owner_id: deal.responsible_id,
    });
    room.update(
      { event_ids: [...deal.event_ids, ev.id] },
      { type: "calendar", title: `Agendó: ${k.label} (${shortDate(date)})` },
    );
  };

  return (
    <RoomCard title="Fechas clave" subtitle="Se agendan a las 10:00; el horario se ajusta en Agenda">
      <ul className="space-y-4">
        {keyDates(isSale).map((k) => {
          const value = deal[k.field];
          const ev = linked.filter((e) => e.title.startsWith(k.eventTitle)).at(-1);
          const evLocal = ev ? todayInput(new Date(ev.starts_at)) : null;
          return (
            <li key={k.field}>
              <label className="block">
                <span className="block text-xs text-lilac-text font-semibold mb-1">{k.label}</span>
                <input
                  type="date"
                  value={value ?? ""}
                  onChange={(e) => room.update({ [k.field]: e.target.value || null } as Partial<Deal>)}
                  className="w-full text-sm rounded-xl border border-lilac px-3 py-2 text-ink bg-surface"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {ev ? (
                  <>
                    <Link to="/agenda" className="inline-flex items-center gap-1 text-xs text-state-green-text font-semibold hover:underline">
                      <CalendarIcon size={12} /> En Agenda: {shortDate(evLocal)}
                    </Link>
                    {value && evLocal !== value && (
                      <>
                        <span className="text-xs text-state-amber-text">La fecha cambió.</span>
                        <Btn size="sm" variant="ghost" onClick={() => schedule(k)}>
                          Agendar la nueva fecha
                        </Btn>
                      </>
                    )}
                  </>
                ) : (
                  <Btn size="sm" variant="ghost" disabled={!value} onClick={() => schedule(k)} title={!value ? "Cargá la fecha primero" : undefined}>
                    <CalendarIcon size={12} /> Agendar
                  </Btn>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </RoomCard>
  );
}
