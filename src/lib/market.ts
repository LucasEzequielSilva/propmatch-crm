/**
 * Mercado — estadísticas por zona y tasador rápido ("¿cuánto pedir?").
 *
 * No tiene criterio propio: el tasador arma una propiedad "hipotética" y la
 * pasa por `computeDiagnostic` (mismos comparables por niveles, mínimo 3,
 * P25/P75, mediana y ajuste de 6 % por ambiente con tope ±18 %, igual que la
 * app). Las estadísticas por zona usan las mismas `median`/`percentile`.
 *
 * Regla de oro (la misma del diagnóstico): nada inventado. Con menos de 3
 * datos no hay rango; sin m² no hay USD/m²; solo USD (no hay tipo de cambio).
 * Es puro (sin React ni Supabase).
 */

import type { Activity, AppOffer, CalendarEvent, Match, OperationType, Opportunity, Property, PropertyType } from "@/types/db";
import {
  computeDiagnostic,
  median,
  normalizeText,
  percentile,
  type MarketListing,
  type PropertyDiagnostic,
} from "./propertyDiagnostic";

/** Igual que `MIN_COMPARABLES` del diagnóstico. */
export const MIN_MARKET_SAMPLE = 3;

export type MarketSource = "crm" | "app";

/** Una publicación activa en USD, venga del inventario o de la app. */
export interface MarketPoint {
  key: string;
  source: MarketSource;
  propertyId: string | null;
  title: string;
  zone: string;
  zoneKey: string;
  type: PropertyType;
  operation: OperationType;
  price: number;
  rooms: number | null;
  surface: number | null;
}

function surfaceOf(p: Pick<Property, "surface_total" | "surface_covered">): number | null {
  const s = p.surface_total ?? p.surface_covered;
  return s && s > 0 ? s : null;
}

/**
 * Junta inventario disponible + activas de la app, solo en USD y con zona.
 * Las de la app ya vinculadas a una propiedad del CRM se cuentan una sola vez
 * (como inventario), igual que en el diagnóstico.
 */
export function buildMarketPool(inventory: Property[], appListings: MarketListing[] | null): MarketPoint[] {
  const out: MarketPoint[] = [];
  for (const p of inventory) {
    const zone = (p.zone ?? p.locality ?? "").trim();
    if (p.status !== "disponible" || p.currency !== "USD" || !p.price || p.price <= 0 || !zone) continue;
    out.push({
      key: `crm:${p.id}`,
      source: "crm",
      propertyId: p.id,
      title: p.title,
      zone,
      zoneKey: normalizeText(zone),
      type: p.type,
      operation: p.operation,
      price: p.price,
      rooms: p.rooms,
      surface: surfaceOf(p),
    });
  }
  const linked = new Set(inventory.map((p) => p.app_property_id).filter(Boolean));
  for (const l of appListings ?? []) {
    const zone = (l.zone ?? "").trim();
    if (linked.has(l.id) || l.currency !== "USD" || !(l.price > 0) || !zone) continue;
    out.push({
      key: `app:${l.id}`,
      source: "app",
      propertyId: null,
      title: l.title,
      zone,
      zoneKey: normalizeText(zone),
      type: l.type,
      operation: l.operation,
      price: l.price,
      rooms: l.rooms,
      surface: null, // la app no guarda m²
    });
  }
  return out;
}

/* ── Estadísticas por zona ─────────────────────────────────────────────────── */

export interface ZoneStat {
  key: string;
  zone: string;
  type: PropertyType;
  operation: OperationType;
  count: number;
  crmCount: number;
  appCount: number;
  median: number;
  /** `null` con menos de 3 publicaciones. */
  p25: number | null;
  p75: number | null;
  min: number;
  max: number;
  /** Mediana de USD/m² — solo publicaciones con m² (en la práctica, tu inventario), y con al menos 3. */
  pricePerM2: number | null;
  withSurface: number;
}

export function computeZoneStats(pool: MarketPoint[]): ZoneStat[] {
  const groups = new Map<string, MarketPoint[]>();
  for (const p of pool) {
    const k = `${p.zoneKey}|${p.type}|${p.operation}`;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }

  const out: ZoneStat[] = [];
  for (const [key, list] of groups) {
    const prices = list.map((p) => p.price);
    const perM2 = list.filter((p) => p.surface).map((p) => p.price / p.surface!);
    const enough = prices.length >= MIN_MARKET_SAMPLE;
    // El nombre que más se repite (mismo barrio escrito distinto se agrupa por `zoneKey`).
    const names = new Map<string, number>();
    for (const p of list) names.set(p.zone, (names.get(p.zone) ?? 0) + 1);
    const zone = [...names].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      key,
      zone,
      type: list[0].type,
      operation: list[0].operation,
      count: list.length,
      crmCount: list.filter((p) => p.source === "crm").length,
      appCount: list.filter((p) => p.source === "app").length,
      median: median(prices),
      p25: enough ? Math.round(percentile(prices, 25)) : null,
      p75: enough ? Math.round(percentile(prices, 75)) : null,
      min: Math.min(...prices),
      max: Math.max(...prices),
      pricePerM2: perM2.length >= MIN_MARKET_SAMPLE ? median(perM2) : null,
      withSurface: perM2.length,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone, "es"));
}

/** Zonas para el selector: las del CRM primero, después las que aparecen en los datos. */
export function zoneOptions(base: readonly string[], pool: MarketPoint[]): string[] {
  const seen = new Set(base.map(normalizeText));
  const extra: string[] = [];
  for (const p of pool) {
    if (seen.has(p.zoneKey)) continue;
    seen.add(p.zoneKey);
    extra.push(p.zone);
  }
  return [...base, ...extra.sort((a, b) => a.localeCompare(b, "es"))];
}

/* ── Tasador rápido ────────────────────────────────────────────────────────── */

export interface ValuationInput {
  operation: OperationType;
  type: PropertyType;
  zone: string;
  rooms: number | null;
  bedrooms: number | null;
  surface: number | null;
}

/** Propiedad hipotética (sin precio) para pasar por el diagnóstico. */
function hypothetical(input: ValuationInput, agencyId: string): Property {
  const now = new Date().toISOString();
  return {
    id: "__tasador__",
    agency_id: agencyId,
    owner_agent_id: null,
    owner_contact_id: null,
    title: "Tasación rápida",
    description: null,
    type: input.type,
    operation: input.operation,
    status: "disponible",
    street: null,
    street_number: null,
    locality: input.zone,
    province: null,
    zone: input.zone,
    lat: null,
    lng: null,
    price: null,
    currency: "USD",
    expenses: null,
    taxes: null,
    commission_pct: null,
    surface_total: input.surface,
    surface_covered: null,
    rooms: input.rooms,
    bedrooms: input.bedrooms,
    bathrooms: null,
    garages: null,
    age_years: null,
    features: [],
    authorization_type: null,
    authorization_expires_at: null,
    is_featured: false,
    published_to_marketplace: false,
    published_at: null,
    created_at: now,
    updated_at: now,
  };
}

const NO_ACTIVITY = {
  photoCount: 0,
  activities: [] as Activity[],
  appOffers: [] as AppOffer[],
  matches: [] as Match[],
  opportunities: [] as Opportunity[],
  events: [] as CalendarEvent[],
  channelsPublished: null,
};

/**
 * "¿Cuánto pedir?": el diagnóstico de una propiedad hipotética con esos datos.
 * Como no tiene precio, la columna «Dif.» de los comparables se calcula contra
 * el precio sugerido (si lo hay).
 */
export function estimatePrice(
  input: ValuationInput,
  ctx: { inventory: Property[]; appListings: MarketListing[] | null; agencyId: string },
): PropertyDiagnostic {
  const d = computeDiagnostic(hypothetical(input, ctx.agencyId), {
    inventory: ctx.inventory,
    appListings: ctx.appListings,
    ...NO_ACTIVITY,
  });
  const ref = d.price.suggested;
  return {
    ...d,
    comparables: d.comparables.map((c) => ({ ...c, diffVsTarget: ref ? (c.price - ref) / ref : null })),
  };
}

/* ── Tu cartera vs. el mercado ─────────────────────────────────────────────── */

export interface PortfolioRow {
  property: Property;
  diagnostic: PropertyDiagnostic;
}

/** Peso para ordenar: más lejos del rango primero; dentro del rango después; sin datos al final. */
export function misalignment(d: PropertyDiagnostic): number {
  if (d.price.positioning == null || d.price.diffVsRange == null) return -1;
  return Math.abs(d.price.diffVsRange);
}

export function sortByMisalignment(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort(
    (a, b) =>
      misalignment(b.diagnostic) - misalignment(a.diagnostic) ||
      (a.diagnostic.score.value ?? 101) - (b.diagnostic.score.value ?? 101),
  );
}
