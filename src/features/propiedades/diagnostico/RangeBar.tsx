import { money } from "@/lib/format";
import type { PriceAnalysis } from "@/lib/propertyDiagnostic";

/**
 * Barra de rango: de mínimo a máximo de los comparables, con la banda
 * P25–P75 y las marcas del precio publicado y del sugerido. Los valores van
 * también en texto (leyenda y `aria-label`), no solo en la posición.
 */
export function RangeBar({ price }: { price: PriceAnalysis }) {
  const { min, max, p25, p75, median, current, suggested, currency } = price;
  if (min == null || max == null || p25 == null || p75 == null) return null;

  const points = [min, max, current, suggested].filter((v): v is number => v != null);
  let lo = Math.min(...points);
  let hi = Math.max(...points);
  if (hi === lo) {
    lo = lo * 0.9;
    hi = hi * 1.1 || 1;
  }
  const pad = (hi - lo) * 0.04;
  lo -= pad;
  hi += pad;
  const pos = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;

  const description =
    `Comparables entre ${money(min, currency)} y ${money(max, currency)}; ` +
    `rango competitivo ${money(p25, currency)} a ${money(p75, currency)}` +
    (current != null ? `; precio publicado ${money(current, currency)}` : "") +
    (suggested != null ? `; precio sugerido ${money(suggested, currency)}` : "") +
    ".";

  return (
    <div>
      <div role="img" aria-label={description} className="relative h-12 mx-1">
        {/* Rango total de comparables */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-2 rounded-full"
          style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})`, background: "#EDE9FE" }}
        />
        {/* Banda P25–P75 */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-4 rounded-md"
          style={{
            left: pos(p25),
            width: `max(4px, calc(${pos(p75)} - ${pos(p25)}))`,
            background: "#C4B5FD",
            border: "1px solid #7C3AED",
          }}
        />
        {median != null && (
          <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4" style={{ left: pos(median), background: "#5B21B6" }} />
        )}
        {suggested != null && (
          <div
            className="absolute top-0 bottom-0 -translate-x-1/2"
            style={{ left: pos(suggested), borderLeft: "2px dashed #7C3AED" }}
          />
        )}
        {current != null && (
          <div className="absolute top-0 bottom-0 -translate-x-1/2 flex flex-col items-center" style={{ left: pos(current) }}>
            <span aria-hidden="true" style={{ color: "#1F0A3C", fontSize: 10, lineHeight: "10px" }}>
              ▼
            </span>
            <span className="flex-1 w-0.5" style={{ background: "#1F0A3C" }} />
          </div>
        )}
      </div>

      <div className="flex justify-between text-xs mt-1" style={{ color: "#7458C4", fontWeight: 600 }}>
        <span>Mín. {money(min, currency)}</span>
        <span>Máx. {money(max, currency)}</span>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs" style={{ color: "#374151" }}>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block w-4 h-3 rounded-sm" style={{ background: "#C4B5FD", border: "1px solid #7C3AED" }} />
          Rango competitivo (P25–P75): <strong>{money(p25, currency)} – {money(p75, currency)}</strong>
        </li>
        {median != null && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-0.5 h-3" style={{ background: "#5B21B6" }} />
            Mediana: <strong>{money(median, currency)}</strong>
          </li>
        )}
        {current != null && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-0.5 h-3" style={{ background: "#1F0A3C" }} />
            Precio publicado: <strong>{money(current, currency)}</strong>
          </li>
        )}
        {suggested != null && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-3" style={{ borderLeft: "2px dashed #7C3AED" }} />
            Sugerido: <strong>{money(suggested, currency)}</strong>
          </li>
        )}
      </ul>
    </div>
  );
}
