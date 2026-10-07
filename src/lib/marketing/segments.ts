/**
 * Segmentos de retargeting con los datos reales del CRM y quién puede recibir.
 *
 * Exclusiones automáticas (siempre, sin opción de saltearlas):
 *  - datos de ejemplo (is_sample, teléfonos/mails ficticios),
 *  - bajas vigentes (del canal o de todos),
 *  - sin consentimiento vigente para ese canal,
 *  - sin email / teléfono válido.
 */
import type {
  Activity,
  AppOffer,
  CalendarEvent,
  Contact,
  ContactRequirement,
  Deal,
  Match,
  Opportunity,
} from "@/types/db";
import { isSample, isSamplePhone } from "@/lib/samples";
import { lastTouch } from "@/lib/followups";
import { isSampleEmail, normalizeEmail, normalizePhone, type MarketingChannel } from "../../../shared/marketing";
import { blockOf, hasConsent } from "./block";
import type { MarketingData } from "./state";
import type { SegmentRules } from "./types";

export interface SegmentData {
  contacts: Contact[];
  requirements: ContactRequirement[];
  matches: Match[];
  events: CalendarEvent[];
  appOffers: AppOffer[];
  activities: Activity[];
  opportunities: Opportunity[];
  deals: Deal[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

function overlaps(aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null): boolean {
  const lo1 = aMin ?? 0;
  const hi1 = aMax ?? Infinity;
  const lo2 = bMin ?? 0;
  const hi2 = bMax ?? Infinity;
  return lo1 <= hi2 && lo2 <= hi1;
}

function usesSearch(r: SegmentRules): boolean {
  return !!(r.operation || r.propertyTypes.length || r.zones.length || r.priceMin !== null || r.priceMax !== null || r.roomsMin !== null);
}

export function ruleSummary(r: SegmentRules, propertyTitle?: (id: string) => string | undefined): string[] {
  const out: string[] = [];
  if (r.operation) out.push(r.operation === "venta" ? "Busca comprar" : r.operation === "alquiler" ? "Busca alquilar" : "Busca alquiler temporario");
  if (r.propertyTypes.length) out.push(`Tipo: ${r.propertyTypes.join(", ")}`);
  if (r.zones.length) out.push(`Zona: ${r.zones.join(", ")}`);
  if (r.priceMin !== null || r.priceMax !== null)
    out.push(`Presupuesto ${r.currency} ${r.priceMin?.toLocaleString("es-AR") ?? "0"} – ${r.priceMax?.toLocaleString("es-AR") ?? "sin tope"}`);
  if (r.roomsMin !== null) out.push(`${r.roomsMin}+ ambientes`);
  if (r.matchedProperty === "any") out.push("Matcheó con alguna propiedad");
  else if (r.matchedProperty) out.push(`Matcheó con ${propertyTitle?.(r.matchedProperty) ?? "una propiedad"}`);
  if (r.interactions.includes("visito_sin_oferta")) out.push("Visitó y no ofertó");
  if (r.interactions.includes("oferto_sin_cierre")) out.push("Ofertó y no cerró");
  if (r.interactions.includes("oportunidad_perdida")) out.push("Oportunidad perdida");
  if (r.noContactDays !== null) out.push(`Sin contacto hace ${r.noContactDays}+ días`);
  if (r.sources.length) out.push(`Origen: ${r.sources.join(", ")}`);
  if (r.kinds.length) out.push(`Tipo de contacto: ${r.kinds.join(", ")}`);
  if (r.statuses.length) out.push(`Estado: ${r.statuses.join(", ")}`);
  if (r.tags.length) out.push(`Etiqueta: ${r.tags.join(", ")}`);
  return out.length ? out : ["Todos los contactos"];
}

/** Índices para no recorrer todo por cada contacto. */
function indexes(d: SegmentData) {
  const by = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  return {
    reqs: by(d.requirements.filter((r) => r.is_active), (r) => r.contact_id),
    matches: by(d.matches.filter((m) => !m.is_dismissed), (m) => m.contact_id),
    visits: by(
      d.events.filter((e) => e.type === "visita" && Date.parse(e.starts_at) <= Date.now() && e.status !== "cancelada" && e.status !== "no_show"),
      (e) => e.contact_id,
    ),
    offers: by(d.appOffers, (o) => o.contact_id),
    offerActs: by(d.activities.filter((a) => !!a.app_offer_id), (a) => a.contact_id),
    opps: by(d.opportunities, (o) => o.contact_id),
    closedDeals: by(d.deals.filter((x) => x.status === "cerrada"), (x) => x.client_contact_id),
  };
}

export function matchesRules(
  c: Contact,
  r: SegmentRules,
  idx: ReturnType<typeof indexes>,
  d: SegmentData,
  tags: Record<string, string[]>,
  now: number,
): boolean {
  if (r.sources.length && !r.sources.includes(c.source)) return false;
  if (r.kinds.length && !r.kinds.includes(c.kind)) return false;
  if (r.statuses.length && !r.statuses.includes(c.status)) return false;
  if (r.tags.length) {
    const mine = new Set((tags[c.id] ?? []).map(norm));
    if (!r.tags.some((t) => mine.has(norm(t)))) return false;
  }

  if (usesSearch(r)) {
    const reqs = idx.reqs.get(c.id) ?? [];
    const ok = reqs.some((q) => {
      if (r.operation && q.operation !== r.operation) return false;
      if (r.propertyTypes.length && q.property_types.length && !q.property_types.some((t) => r.propertyTypes.includes(t))) return false;
      if (r.propertyTypes.length && !q.property_types.length) return false;
      if (r.zones.length) {
        const want = r.zones.map(norm);
        if (!q.zones.some((z) => want.some((w) => norm(z).includes(w) || w.includes(norm(z))))) return false;
      }
      if (r.priceMin !== null || r.priceMax !== null) {
        if (q.currency !== r.currency) return false;
        if (q.budget_min === null && q.budget_max === null) return false;
        if (!overlaps(q.budget_min, q.budget_max, r.priceMin, r.priceMax)) return false;
      }
      if (r.roomsMin !== null && (q.rooms_min === null || q.rooms_min < r.roomsMin)) return false;
      return true;
    });
    if (!ok) return false;
  }

  if (r.matchedProperty) {
    const ms = idx.matches.get(c.id) ?? [];
    if (r.matchedProperty === "any" ? !ms.length : !ms.some((m) => m.property_id === r.matchedProperty)) return false;
  }

  const hasOffer = (idx.offers.get(c.id)?.length ?? 0) > 0 || (idx.offerActs.get(c.id)?.length ?? 0) > 0;
  if (r.interactions.includes("visito_sin_oferta")) {
    if (!(idx.visits.get(c.id)?.length ?? 0) || hasOffer) return false;
  }
  if (r.interactions.includes("oferto_sin_cierre")) {
    const accepted = (idx.offers.get(c.id) ?? []).some((o) => o.status === "accepted");
    if (!hasOffer || (idx.closedDeals.get(c.id)?.length ?? 0) > 0 || accepted) return false;
  }
  if (r.interactions.includes("oportunidad_perdida")) {
    if (!(idx.opps.get(c.id) ?? []).some((o) => o.stage === "perdida")) return false;
  }

  if (r.noContactDays !== null) {
    const t = lastTouch(c.id, d, now) ?? Date.parse(c.created_at);
    if (now - t < r.noContactDays * 86_400_000) return false;
  }
  return true;
}

export type ExclusionReason = "ejemplo" | "baja" | "sin_consentimiento" | "sin_email" | "sin_telefono";

export const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  ejemplo: "Dato de ejemplo",
  baja: "Se dio de baja",
  sin_consentimiento: "Sin consentimiento",
  sin_email: "Sin email válido",
  sin_telefono: "Sin teléfono válido",
};

/** Por qué no se le puede mandar por ese canal (o null si se puede). */
export function exclusionOf(c: Contact, channel: MarketingChannel, m: MarketingData): ExclusionReason | null {
  if (isSample(c) || isSamplePhone(c.phone) || isSampleEmail(c.email)) return "ejemplo";
  const b = blockOf(m, c);
  if (channel === "email" ? b.email : b.whatsapp) return "baja";
  if (channel === "email" && !normalizeEmail(c.email)) return "sin_email";
  if (channel === "whatsapp" && !normalizePhone(c.phone)) return "sin_telefono";
  if (!hasConsent(m, c, channel)) return "sin_consentimiento";
  return null;
}

export interface Audience {
  matched: Contact[];
  eligible: Contact[];
  excluded: { contact: Contact; reason: ExclusionReason }[];
  byReason: Record<ExclusionReason, number>;
}

export function evaluateSegment(rules: SegmentRules, channel: MarketingChannel, d: SegmentData, m: MarketingData, now = Date.now()): Audience {
  const idx = indexes(d);
  const matched = d.contacts.filter((c) => matchesRules(c, rules, idx, d, m.tags, now));
  const eligible: Contact[] = [];
  const excluded: Audience["excluded"] = [];
  const byReason: Record<ExclusionReason, number> = { ejemplo: 0, baja: 0, sin_consentimiento: 0, sin_email: 0, sin_telefono: 0 };
  for (const c of matched) {
    const why = exclusionOf(c, channel, m);
    if (why) {
      excluded.push({ contact: c, reason: why });
      byReason[why]++;
    } else eligible.push(c);
  }
  return { matched, eligible, excluded, byReason };
}

/** Todas las etiquetas usadas (para sugerir). */
export function allTags(tags: Record<string, string[]>): string[] {
  const s = new Set<string>();
  for (const list of Object.values(tags)) for (const t of list) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, "es"));
}
