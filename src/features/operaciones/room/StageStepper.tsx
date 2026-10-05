import { CheckIcon } from "@/components/ui/icons";
import { money } from "@/lib/format";
import { docProgress } from "@/lib/deals";
import { shortDate, stagesOf, type StageInfo } from "@/lib/dealRoom";
import type { Room } from "./room";

/** Dato real que se muestra debajo de cada etapa. */
function stageDatum(room: Room, s: StageInfo): string | null {
  const { deal, isSale } = room;
  switch (s.stage) {
    case "negociacion":
      return deal.price !== null ? money(deal.price, deal.currency) : null;
    case "reserva":
      if (deal.reserva_amount === null) return null;
      return `${money(deal.reserva_amount, deal.currency)}${deal.reserva_valid_until ? ` · vence ${shortDate(deal.reserva_valid_until)}` : ""}`;
    case "documentacion": {
      const d = docProgress(deal);
      return `Documentos ${d.done}/${d.total}`;
    }
    case "contrato":
      if (deal.signing_date) return `Firma ${shortDate(deal.signing_date)}`;
      return isSale ? `Anticipo ${deal.boleto_advance_pct ?? 30}%` : deal.contract_months ? `${deal.contract_months} meses` : null;
    case "firma": {
      const roles = isSale ? (["client", "owner"] as const) : (["client", "owner", ...(deal.guarantor.name.trim() ? (["guarantor"] as const) : [])] as const);
      const signed = roles.filter((r) => deal.signatures[r]?.signed).length;
      if (isSale && deal.escritura_date) return `Escritura ${shortDate(deal.escritura_date)}`;
      return `Firmas ${signed}/${roles.length}`;
    }
    case "cierre":
      if (isSale) return deal.escritura_date ? `Escritura ${shortDate(deal.escritura_date)}` : null;
      return deal.start_date ? `Inicio ${shortDate(deal.start_date)}` : null;
  }
}

export function StageStepper({ room }: { room: Room }) {
  const stages = stagesOf(room.deal);
  return (
    <nav aria-label="Etapas de la operación" className="rounded-2xl border border-lilac bg-surface shadow-[var(--shadow-card)] p-4 md:p-5 mb-5">
      <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stages.map((s, i) => {
          const datum = stageDatum(room, s);
          const isCurrent = s.state === "current";
          const isDone = s.state === "done";
          return (
            <li
              key={s.stage}
              aria-current={isCurrent ? "step" : undefined}
              className={`relative rounded-xl border px-3 py-2.5 ${isCurrent ? "border-brand-purple bg-lavender" : "border-lilac bg-surface"}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    isDone ? "bg-[image:var(--gradient-brand)] text-white" : isCurrent ? "bg-brand-purple text-white" : "bg-lavender text-lilac-text border border-lilac"
                  }`}
                >
                  {isDone ? <CheckIcon size={12} color="white" /> : i + 1}
                </span>
                <span className="text-sm text-ink font-bold truncate">{s.label}</span>
                <span className="sr-only">
                  {isDone ? "(completada)" : isCurrent ? "(etapa actual)" : "(pendiente)"}
                </span>
              </div>
              <p className="text-xs text-ink-soft mt-1.5 truncate">{datum ?? "—"}</p>
              <p className="text-xs mt-0.5 text-lilac-text">
                {isDone
                  ? s.completedAt
                    ? `Completada ${shortDate(s.completedAt)}`
                    : "Completada"
                  : `${s.done}/${s.total} pasos`}
              </p>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
