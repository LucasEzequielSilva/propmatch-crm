import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { VozBusqueda, VozCurrency, VozData, VozOperation, VozPropiedad } from "../../../shared/voz";

/** Qué se detectó y qué no, para la tarjeta de revisión. */

export interface DetectedField {
  label: string;
  value: string;
}

export interface VozSummary {
  detected: DetectedField[];
  missing: string[];
  notes: string[];
  /** Solo propiedad: título y descripción sugeridos, aparte por largos. */
  title?: string | null;
  description?: string | null;
}

const OP: Record<VozOperation, string> = { venta: "Venta", alquiler: "Alquiler", alquiler_temporal: "Alquiler temporario" };
const OP_BUSCA: Record<VozOperation, string> = { venta: "Compra", alquiler: "Alquiler", alquiler_temporal: "Alquiler temporario" };

const nf = new Intl.NumberFormat("es-AR");
const money = (n: number, c: VozCurrency | null) => `${c === "USD" ? "USD " : c === "ARS" ? "$ " : ""}${nf.format(n)}${c ? "" : " (moneda sin detectar)"}`;
const yesNo = (b: boolean) => (b ? "Sí" : "No");

function push(out: VozSummary, label: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") out.missing.push(label);
  else out.detected.push({ label, value });
}

function summarizePropiedad(d: VozPropiedad): VozSummary {
  const out: VozSummary = { detected: [], missing: [], notes: d.notes, title: d.title, description: d.description };
  push(out, "Operación", d.operation && OP[d.operation]);
  push(out, "Tipo", d.type && PROPERTY_TYPE_LABEL[d.type] + (d.subtype ? ` · ${d.subtype}` : ""));
  push(out, "Zona", d.zone);
  const addr = [d.street, d.street_number].filter(Boolean).join(" ") + (d.floor ? `, piso ${d.floor}` : "") + (d.unit ? ` ${d.unit}` : "");
  push(out, "Dirección", addr.trim() || null);
  push(out, "Precio", d.price !== null ? money(d.price, d.currency) : null);
  if (d.expenses !== null) push(out, "Expensas", money(d.expenses, d.expenses_currency));
  push(out, "Ambientes", d.rooms !== null ? String(d.rooms) : null);
  push(out, "Dormitorios", d.bedrooms !== null ? String(d.bedrooms) : null);
  push(out, "Baños", d.bathrooms !== null ? String(d.bathrooms) : null);
  if (d.toilettes !== null) push(out, "Toilettes", String(d.toilettes));
  push(out, "Cocheras", d.garages !== null ? String(d.garages) : null);
  const sup = [d.surface_covered !== null ? `${nf.format(d.surface_covered)} m² cub.` : "", d.surface_total !== null ? `${nf.format(d.surface_total)} m² tot.` : ""]
    .filter(Boolean)
    .join(" · ");
  push(out, "Superficie", sup || null);
  push(out, "Antigüedad", d.age_years === null ? null : d.age_years === 0 ? "A estrenar" : `${d.age_years} años`);
  push(out, "Amenities", d.features.join(", ") || null);
  if (d.credit_eligible !== null) push(out, "Apto crédito", yesNo(d.credit_eligible));
  if (d.accepts_swap !== null) push(out, "Acepta permuta", yesNo(d.accepts_swap));
  return out;
}

function summarizeBusqueda(d: VozBusqueda): VozSummary {
  const out: VozSummary = { detected: [], missing: [], notes: d.notes };
  if (d.contact_name) push(out, "Nombre", d.contact_name);
  if (d.contact_phone) push(out, "Teléfono", d.contact_phone);
  push(out, "Operación", d.operation && OP_BUSCA[d.operation]);
  push(out, "Tipos", d.property_types.map((t) => PROPERTY_TYPE_LABEL[t]).join(", ") || null);
  push(out, "Zonas", d.zones.join(", ") || null);
  const range =
    d.budget_min !== null && d.budget_max !== null
      ? `${money(d.budget_min, d.currency)} a ${money(d.budget_max, d.currency)}`
      : d.budget_max !== null
        ? `Hasta ${money(d.budget_max, d.currency)}`
        : d.budget_min !== null
          ? `Desde ${money(d.budget_min, d.currency)}`
          : null;
  push(out, "Presupuesto", range);
  if (d.rooms_min !== null) push(out, "Ambientes (mín.)", String(d.rooms_min));
  push(out, "Dormitorios (mín.)", d.bedrooms_min !== null ? String(d.bedrooms_min) : null);
  if (d.bathrooms_min !== null) push(out, "Baños (mín.)", String(d.bathrooms_min));
  if (d.surface_min !== null) push(out, "Superficie (mín.)", `${nf.format(d.surface_min)} m²`);
  push(out, "Características", d.features.join(", ") || null);
  push(out, "Plazo", d.timeframe);
  return out;
}

export function summarize(r: VozData): VozSummary {
  return r.kind === "propiedad" ? summarizePropiedad(r.data) : summarizeBusqueda(r.data);
}
