import type { RequirementInput } from "@/data/store";
import type { FormState } from "@/features/propiedades/subir/form";
import type { VozBusqueda, VozPropiedad } from "../../../shared/voz";

/**
 * Pasa lo dictado a los formularios. Solo pisa los campos que se detectaron:
 * lo que no se dijo queda como estaba. Nunca guarda: el agente revisa y guarda.
 */

const s = (n: number | null) => (n === null ? null : String(n));

export function applyPropiedadToForm(form: FormState, d: VozPropiedad, opts: { isNew: boolean }): FormState {
  const f: FormState = { ...form };
  if (d.operation) f.operation = d.operation;
  if (d.type) f.type = d.type;
  if (d.subtype) f.subtype = d.subtype;
  if (d.title) f.title = d.title;
  if (d.description) f.description = d.description;
  if (d.price !== null) f.price = s(d.price)!;
  if (d.currency) f.currency = d.currency;
  if (d.expenses !== null) f.expenses = s(d.expenses)!;
  if (d.expenses_currency) f.expensesCurrency = d.expenses_currency;
  if (d.rooms !== null) f.rooms = s(d.rooms)!;
  if (d.bedrooms !== null) f.bedrooms = d.bedrooms;
  if (d.bathrooms !== null) f.bathrooms = d.bathrooms;
  if (d.toilettes !== null) f.toilettes = d.toilettes;
  if (d.garages !== null) f.garages = d.garages;
  if (d.surface_total !== null) f.surfaceTotal = s(d.surface_total)!;
  if (d.surface_covered !== null) f.surfaceCovered = s(d.surface_covered)!;
  if (d.age_years !== null) f.age = s(d.age_years)!;
  if (d.zone) f.locality = d.zone;
  if (d.street) f.street = d.street;
  if (d.street_number) f.streetNumber = d.street_number;
  if (d.floor) f.floor = d.floor;
  if (d.unit) f.unit = d.unit;
  if (d.credit_eligible !== null) f.creditEligible = d.credit_eligible;
  if (d.accepts_swap !== null) f.acceptsSwap = d.accepts_swap;
  if (d.features.length) {
    // En un alta los amenities de ejemplo del formulario se reemplazan; en una edición se suman.
    f.features = opts.isNew ? [...d.features] : [...new Set([...form.features, ...d.features])];
  }
  return f;
}

export function applyBusquedaToRequirement(req: RequirementInput, d: VozBusqueda): RequirementInput {
  const r: RequirementInput = { ...req };
  if (d.operation) r.operation = d.operation;
  if (d.property_types.length) r.property_types = [...d.property_types];
  if (d.zones.length) r.zones = [...d.zones];
  if (d.budget_min !== null) r.budget_min = d.budget_min;
  if (d.budget_max !== null) r.budget_max = d.budget_max;
  if (d.currency) r.currency = d.currency;
  // La búsqueda del CRM no tiene "ambientes mínimos": 3 ambientes ≈ 2 dormitorios.
  const bedrooms = d.bedrooms_min ?? (d.rooms_min !== null && d.rooms_min >= 2 ? d.rooms_min - 1 : null);
  if (bedrooms !== null) r.bedrooms_min = bedrooms;
  if (d.bathrooms_min !== null) r.bathrooms_min = d.bathrooms_min;
  if (d.surface_min !== null) r.surface_min = d.surface_min;
  if (d.features.length) r.features = [...new Set([...req.features, ...d.features])];
  return r;
}

/** Lo que no tiene campo en la búsqueda y va a las notas del contacto. */
export function busquedaNotes(d: VozBusqueda): string | null {
  const lines: string[] = [];
  if (d.rooms_min !== null) lines.push(`Ambientes mínimos: ${d.rooms_min}`);
  if (d.timeframe) lines.push(`Plazo: ${d.timeframe}`);
  lines.push(...d.notes);
  return lines.length ? `Dictado: ${lines.join(" · ")}` : null;
}
