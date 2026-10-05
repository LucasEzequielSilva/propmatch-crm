import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import { money, PROPERTY_TYPE_LABEL } from "@/lib/format";
import { computeMatch } from "@/lib/matching";
import {
  businessDaysUntil,
  contactSourceLabel,
  daysUntil,
  isChecked,
  partyRoleLabel,
  profileName,
  shortDate,
  todayInput,
} from "@/lib/dealRoom";
import { inputClass } from "../ui";
import { Pill } from "./primitives";
import type { Room } from "./room";

function Box({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-lilac bg-surface shadow-[var(--shadow-card)] p-4 flex flex-col min-w-0">
      <h2 className="text-xs uppercase tracking-[0.1em] text-brand-purple font-bold mb-2">{title}</h2>
      <div className="flex-1 min-w-0 space-y-1.5">{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
    </section>
  );
}

function address(room: Room): string | null {
  const p = room.property;
  if (!p) return null;
  const street = [p.street, p.street_number].filter(Boolean).join(" ");
  return [street, p.zone || p.locality].filter(Boolean).join(", ") || null;
}

/** La próxima fecha clave que todavía no pasó. */
export function nextKeyDate(room: Room): { label: string; date: string } | null {
  const { deal, isSale } = room;
  const today = todayInput();
  const candidates: { label: string; date: string | null }[] = [
    { label: "Vence la reserva", date: deal.reserva_valid_until },
    { label: isSale ? "Firma del boleto" : "Firma del contrato", date: deal.signing_date },
    ...(isSale ? [{ label: "Escritura", date: deal.escritura_date }] : [{ label: "Inicio del contrato", date: deal.start_date }]),
  ];
  return (
    candidates
      .filter((c): c is { label: string; date: string } => !!c.date && c.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
  );
}

export function SummaryCards({ room }: { room: Room }) {
  const { deal, property, client, isSale, profiles, canSensitive, isAdmin } = room;
  const { requirements } = useStore();

  // Match solo si el cliente tiene una búsqueda real cargada para esta operación.
  const match = useMemo(() => {
    if (!property || !deal.client_contact_id) return null;
    const op = isSale ? "venta" : "alquiler";
    const req = requirements.find((r) => r.contact_id === deal.client_contact_id && r.is_active && r.operation === op);
    return req ? computeMatch(req, property).score : null;
  }, [requirements, property, deal.client_contact_id, isSale]);

  const surface = property?.surface_covered || property?.surface_total;
  const dniDone = isChecked(deal.docs[isSale ? "c_dni" : "t_dni"]);
  const fundsDone = isSale ? isChecked(deal.docs.c_fondos) : isChecked(deal.docs.t_recibos);
  const titleDone = isSale ? isChecked(deal.steps.titulos) : isChecked(deal.docs.p_titulo);
  const next = nextKeyDate(room);
  const canEditTeam = isAdmin || deal.responsible_id === room.profile.id;
  const coSplit = deal.commission.splits.find((s) => s.user_id === deal.co_agent_id)?.share_pct ?? null;

  const setTeam = (responsible: string | null, co: string | null, coPct: number | null) => {
    const splits: { user_id: string; share_pct: number }[] = [];
    const pct = co ? Math.min(Math.max(coPct ?? 50, 0), 100) : 0;
    if (responsible) splits.push({ user_id: responsible, share_pct: 100 - pct });
    if (co && pct > 0) splits.push({ user_id: co, share_pct: pct });
    room.update(
      { responsible_id: responsible, co_agent_id: co, commission: { ...deal.commission, splits: splits.filter((s) => s.share_pct > 0) } },
      { type: "updated", title: `Equipo: ${profileName(profiles, responsible)}${co ? ` + ${profileName(profiles, co)} (${pct}%)` : ""}` },
    );
  };

  const close = deal.expected_close_date;
  const activeProfiles = profiles.filter((p) => p.is_active);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5 mb-5">
      <Box
        title="Inmueble"
        footer={
          property && (
            <Link to={`/propiedades/${property.id}`} className="text-xs text-brand-purple font-semibold hover:underline">
              Ver ficha →
            </Link>
          )
        }
      >
        <p className="text-sm text-ink font-bold truncate" title={property?.title}>
          {property?.title ?? "Sin propiedad"}
        </p>
        {address(room) && <p className="text-xs text-ink-soft truncate">{address(room)}</p>}
        <p className="text-sm text-ink font-semibold">
          {money(deal.price, deal.currency)}
          {!isSale && <span className="text-xs text-lilac-text font-medium"> / mes</span>}
        </p>
        <p className="text-xs text-ink-soft">
          {[property ? PROPERTY_TYPE_LABEL[property.type] : null, surface ? `${surface} m²` : null].filter(Boolean).join(" · ")}
        </p>
      </Box>

      <Box title={partyRoleLabel(deal.kind, "client")}>
        <p className="text-sm text-ink font-bold truncate">{deal.client.name || client?.full_name || "Sin cargar"}</p>
        <div className="flex flex-wrap gap-1">
          {match !== null && <Pill tone="brand">Match {match}%</Pill>}
          {contactSourceLabel(client) && <Pill>Origen: {contactSourceLabel(client)}</Pill>}
        </div>
        <ul className="text-xs space-y-0.5">
          <li className={dniDone ? "text-state-green-text" : "text-ink-soft"}>{dniDone ? "✓ DNI recibido" : "DNI pendiente"}</li>
          <li className={fundsDone ? "text-state-green-text" : "text-ink-soft"}>
            {isSale
              ? fundsDone
                ? "✓ Constancia de fondos recibida"
                : "Constancia de fondos pendiente"
              : fundsDone
                ? "✓ Recibos de sueldo recibidos"
                : "Recibos de sueldo pendientes"}
          </li>
        </ul>
      </Box>

      <Box title={partyRoleLabel(deal.kind, "owner")}>
        <p className="text-sm text-ink font-bold truncate">{deal.owner.name || room.ownerContact?.full_name || "Sin cargar"}</p>
        <p className={`text-xs ${titleDone ? "text-state-green-text" : "text-ink-soft"}`}>
          {isSale
            ? `Estudio de títulos: ${titleDone ? "hecho" : "pendiente"}`
            : `Título de propiedad: ${titleDone ? "recibido" : "pendiente"}`}
        </p>
        {deal.owner.phone && <p className="text-xs text-ink-soft truncate">{deal.owner.phone}</p>}
      </Box>

      <Box title="Equipo">
        {canEditTeam ? (
          <>
            <label className="block">
              <span className="block text-xs text-lilac-text font-semibold mb-1">Responsable</span>
              <select
                value={deal.responsible_id ?? ""}
                onChange={(e) => setTeam(e.target.value || null, deal.co_agent_id, coSplit)}
                className={`${inputClass} !py-1.5 !px-2 text-xs`}
              >
                <option value="">Sin asignar</option>
                {activeProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-lilac-text font-semibold mb-1">Co-agente</span>
              <select
                value={deal.co_agent_id ?? ""}
                onChange={(e) => setTeam(deal.responsible_id, e.target.value || null, coSplit)}
                className={`${inputClass} !py-1.5 !px-2 text-xs`}
              >
                <option value="">Ninguno</option>
                {activeProfiles
                  .filter((p) => p.id !== deal.responsible_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
              </select>
            </label>
            {deal.co_agent_id && canSensitive && (
              <label className="block">
                <span className="block text-xs text-lilac-text font-semibold mb-1">% del co-agente</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={coSplit ?? 50}
                  onChange={(e) => setTeam(deal.responsible_id, deal.co_agent_id, Number(e.target.value))}
                  className={`${inputClass} !py-1.5 !px-2 text-xs`}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-ink font-bold">{profileName(profiles, deal.responsible_id)}</p>
            {deal.co_agent_id && <p className="text-xs text-ink-soft">Con {profileName(profiles, deal.co_agent_id)}</p>}
          </>
        )}
      </Box>

      <Box title="Cronograma">
        <p className="text-xs text-ink-soft">
          Creada el <span className="text-ink font-semibold">{shortDate(deal.created_at)}</span>
        </p>
        <label className="block">
          <span className="block text-xs text-lilac-text font-semibold mb-1">Cierre estimado</span>
          <input
            type="date"
            value={close ?? ""}
            onChange={(e) => room.update({ expected_close_date: e.target.value || null })}
            className={`${inputClass} !py-1.5 !px-2 text-xs`}
          />
        </label>
        {close && (
          <p className="text-xs text-ink-soft">
            {daysUntil(close) >= 0
              ? `En ${businessDaysUntil(close)} días hábiles aprox. (no descuenta feriados)`
              : `Pasó hace ${-daysUntil(close)} días`}
          </p>
        )}
        <p className="text-xs text-ink-soft">
          Próxima fecha clave:{" "}
          <span className="text-ink font-semibold">{next ? `${next.label}, ${shortDate(next.date)}` : "sin fechas cargadas"}</span>
        </p>
      </Box>
    </div>
  );
}
