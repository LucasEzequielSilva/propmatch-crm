/**
 * Diagnóstico PropMatch — Nivel 1 (datos internos).
 *
 * Responde, para una propiedad: ¿el precio está bien posicionado frente a
 * similares?, ¿cómo rinde la publicación?, ¿qué conviene hacer?
 *
 * Regla de oro: nada inventado. Todo número sale de datos reales del CRM
 * (inventario, matching, pipeline, agenda, leads sincronizados de la app) o
 * de las propiedades activas de la app. Lo que no se puede medir queda en
 * `null` ("sin datos"), nunca en 0.
 *
 * Es puro (sin React ni Supabase) para poder probarlo con `tsx`; ver
 * `propertyDiagnostic.examples.md`. Las lecturas de red viven en `marketData.ts`.
 */

import type {
  Activity,
  AppOffer,
  CalendarEvent,
  CurrencyCode,
  Match,
  OperationType,
  Opportunity,
  Property,
  PropertyType,
} from "@/types/db";
import { diagnose, type DiagnosticCheck } from "./listingDiagnostics";

/* ── Entrada ───────────────────────────────────────────────────────────────── */

/** Propiedad activa de la app ya traducida al vocabulario del CRM (ver `marketData.ts`). */
export interface MarketListing {
  id: string;
  title: string;
  type: PropertyType;
  operation: OperationType;
  /** La app solo tiene precios en USD. */
  currency: CurrencyCode;
  price: number;
  rooms: number | null;
  /** `barrio` de la app. */
  zone: string | null;
}

export interface DiagnosticContext {
  /** Todo el inventario de la agencia (incluye a la propiedad diagnosticada). */
  inventory: Property[];
  /** `null` = no se pudo leer la app (sin sesión, error de red): se sigue solo con el inventario. */
  appListings: MarketListing[] | null;
  photoCount: number;
  activities: Activity[];
  appOffers: AppOffer[];
  /** Matching del CRM (contactos compatibles). */
  matches: Match[];
  opportunities: Opportunity[];
  events: CalendarEvent[];
  /** Canales externos con estado `published`. `null` = todavía no se sabe. */
  channelsPublished: number | null;
  now?: number;
}

/* ── Salida ────────────────────────────────────────────────────────────────── */

export type Confidence = "alta" | "media" | "baja" | "sin_datos";
export type ComparableLevel = "zona_tipo" | "zona" | "tipo";
export type Positioning = "debajo" | "dentro" | "encima";
export type SignalStatus = "verde" | "amarillo" | "rojo" | "sin_datos";

export interface Comparable {
  key: string;
  source: "crm" | "app";
  sourceLabel: string;
  /** Solo para las del CRM: id para linkear a su ficha. */
  propertyId: string | null;
  title: string;
  zone: string | null;
  type: PropertyType;
  rooms: number | null;
  surface: number | null;
  price: number;
  currency: CurrencyCode;
  pricePerM2: number | null;
  /** Diferencia de precio de este comparable vs la propiedad diagnosticada (fracción). */
  diffVsTarget: number | null;
  /** 0–100, solo para ordenar: misma zona/tipo, ambientes y m² parecidos. */
  similarity: number;
}

export interface PriceAnalysis {
  current: number | null;
  currency: CurrencyCode;
  surface: number | null;
  pricePerM2: number | null;
  /** `false` con confianza baja o sin datos: no se muestran rango ni sugerido. */
  showRange: boolean;
  min: number | null;
  max: number | null;
  p25: number | null;
  p75: number | null;
  median: number | null;
  medianRooms: number | null;
  /** Ajuste por ambientes aplicado a la mediana (fracción, ±0,18 como máximo). */
  roomsAdjustment: number | null;
  suggested: number | null;
  /** Fracción: +0,068 = 6,8 % por encima. */
  diffVsMedian: number | null;
  /** Distancia al borde más cercano del rango P25–P75 (0 si está adentro). */
  diffVsRange: number | null;
  positioning: Positioning | null;
  zonePricePerM2: number | null;
  zonePricePerM2Count: number;
}

export interface DemandAnalysis {
  daysPublished: number | null;
  publishedSince: string | null;
  /** Tiene `app_property_id`: hay datos reales de interés de la app. */
  appLinked: boolean;
  /** Swipes a la derecha (null = no está en la app). */
  interested: number | null;
  appMatches: number | null;
  appVisits: number | null;
  agendaVisits: { done: number; upcoming: number };
  offers: { count: number; pending: number; best: number | null; bestVsPrice: number | null } | null;
  openOpportunities: number;
  compatibleContacts: { count: number; bestScore: number | null; avgScore: number | null; withoutOpportunity: number };
  channelsPublished: number | null;
  interestPerWeek: number | null;
  /** Propiedades de la agencia en la app con las que se compara el interés. */
  peerCount: number;
  /** 0–100: percentil de interés diario vs esos pares (null si hay menos de 3). */
  peerPercentile: number | null;
}

export interface ScoreComponent {
  id: "precio" | "demanda" | "conversion" | "competencia" | "ficha";
  label: string;
  /** Peso nominal (suma 1 entre los cinco). */
  weight: number;
  /** Peso después de excluir los componentes sin datos. */
  effectiveWeight: number | null;
  value: number | null;
  included: boolean;
  /** Dato del que sale, o por qué quedó afuera. */
  source: string;
  formula: string;
}

export interface Signal {
  id: "precio" | "demanda" | "conversion" | "competencia" | "dias" | "ficha";
  label: string;
  status: SignalStatus;
  detail: string;
}

export interface Recommendation {
  id: string;
  /** 1 = primero. */
  priority: 1 | 2 | 3;
  title: string;
  why: string;
  action: { label: string; to?: string; kind?: "share" };
}

export interface PropertyDiagnostic {
  computedAt: string;
  currency: CurrencyCode;
  level: ComparableLevel | null;
  levelLabel: string;
  /** Cuántos comparables hubo en cada nivel del escalonado (para el método). */
  countsByLevel: Record<ComparableLevel, number>;
  comparables: Comparable[];
  confidence: Confidence;
  confidenceLabel: string;
  /** Avisos de método: moneda, app no disponible, etc. */
  notes: string[];
  price: PriceAnalysis;
  demand: DemandAnalysis;
  competition: { count: number; cheaper: number | null; cheaperShare: number | null };
  quality: { checks: DiagnosticCheck[]; ok: number; total: number };
  score: { value: number | null; components: ScoreComponent[]; summary: string };
  signals: Signal[];
  narrative: string[];
  recommendations: Recommendation[];
  sources: { crm: number; app: number; appAvailable: boolean };
}

/* ── Umbrales (elegidos, documentados en el reporte y en la nota de método) ── */

/** Mínimo de comparables para mostrar rango/sugerido y para escalar el nivel. */
const MIN_COMPARABLES = 3;
/** Confianza alta: al menos esto en el nivel más específico (zona + tipo). */
const HIGH_CONFIDENCE = 8;
const ROOMS_TOLERANCE = 1;
const SURFACE_TOLERANCE = 0.25;
/** Menos días que esto: muy poco para medir interés en el score. */
const MIN_DAYS_FOR_DEMAND = 7;
/** Interesados mínimos para calcular una conversión con sentido. */
const MIN_INTERESTED_FOR_CONVERSION = 3;
/** Referencias de escala (solo para el score, nunca se muestran como dato). */
const DEMAND_REF_PER_WEEK = 3;
const CONVERSION_REF = 0.25;
/** Días publicada: [verde hasta, amarillo hasta]; más que eso, rojo. */
const DAYS_THRESHOLDS: Record<OperationType, [number, number]> = {
  alquiler: [30, 60],
  alquiler_temporal: [30, 60],
  venta: [90, 180],
};

const WEIGHTS: Record<ScoreComponent["id"], number> = {
  precio: 0.35,
  demanda: 0.25,
  conversion: 0.15,
  competencia: 0.1,
  ficha: 0.15,
};

/** Títulos con los que `store.tsx` registra los leads reales de la app (acoplado a propósito: no hay otro campo). */
const APP_MATCH_TITLE = "Match confirmado desde la app";
const APP_VISIT_TITLE = "Visita propuesta desde la app";

const DAY_MS = 86_400_000;

/* ── Utilidades numéricas ──────────────────────────────────────────────────── */

export const normalizeText = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

/** Misma definición que la Edge Function `compute_property_diagnostic` de la app. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Percentil con interpolación lineal — idéntico al de la app. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v);

function surfaceOf(p: Pick<Property, "surface_total" | "surface_covered">): number | null {
  const s = p.surface_total ?? p.surface_covered;
  return s && s > 0 ? s : null;
}

/* ── Comparables ───────────────────────────────────────────────────────────── */

interface Candidate extends Omit<Comparable, "diffVsTarget" | "similarity"> {
  zoneKeys: string[];
}

function zoneKeysOf(p: Pick<Property, "zone" | "locality">): string[] {
  return [...new Set([normalizeText(p.zone), normalizeText(p.locality)].filter(Boolean))];
}

function isSimilarSize(target: Property, c: Candidate): boolean {
  if (target.rooms != null && c.rooms != null && Math.abs(target.rooms - c.rooms) > ROOMS_TOLERANCE) return false;
  const ts = surfaceOf(target);
  if (ts && c.surface && Math.abs(c.surface - ts) / ts > SURFACE_TOLERANCE) return false;
  return true;
}

function similarityOf(target: Property, targetZones: string[], c: Candidate): number {
  let s = 100;
  if (c.type !== target.type) s -= 30;
  if (!c.zoneKeys.some((z) => targetZones.includes(z))) s -= 30;
  if (target.rooms != null && c.rooms != null) s -= 10 * Math.abs(target.rooms - c.rooms);
  const ts = surfaceOf(target);
  if (ts && c.surface) s -= 40 * Math.abs(c.surface - ts) / ts;
  return clamp(round(s), 0, 100);
}

const LEVEL_LABEL: Record<ComparableLevel, string> = {
  zona_tipo: "misma zona y mismo tipo",
  zona: "misma zona (cualquier tipo)",
  tipo: "mismo tipo (cualquier zona)",
};

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  alta: "confianza alta",
  media: "confianza media",
  baja: "confianza baja",
  sin_datos: "sin comparables",
};

function buildCandidates(target: Property, ctx: DiagnosticContext): { list: Candidate[]; crm: number; app: number } {
  const crm: Candidate[] = ctx.inventory
    .filter((p) => p.id !== target.id && p.status === "disponible" && p.price != null && p.price > 0)
    .map((p) => {
      const surface = surfaceOf(p);
      return {
        key: `crm:${p.id}`,
        source: "crm" as const,
        sourceLabel: "Tu inventario",
        propertyId: p.id,
        title: p.title,
        zone: p.zone ?? p.locality,
        type: p.type,
        rooms: p.rooms,
        surface,
        price: p.price!,
        currency: p.currency,
        pricePerM2: surface ? p.price! / surface : null,
        zoneKeys: zoneKeysOf(p),
        operation: p.operation,
      };
    })
    .map(({ operation, ...c }) => ({ ...c, _op: operation }) as Candidate & { _op: OperationType })
    .filter((c) => c._op === target.operation);

  // Las de la app que ya están en el CRM (vinculadas) se cuentan una sola vez, como inventario.
  const linked = new Set(ctx.inventory.map((p) => p.app_property_id).filter(Boolean));
  const app: Candidate[] = (ctx.appListings ?? [])
    .filter((l) => !linked.has(l.id) && l.operation === target.operation && l.price > 0)
    .map((l) => ({
      key: `app:${l.id}`,
      source: "app" as const,
      sourceLabel: "Mercado PropMatch (app)",
      propertyId: null,
      title: l.title,
      zone: l.zone,
      type: l.type,
      rooms: l.rooms,
      surface: null, // la app no guarda m²
      price: l.price,
      currency: l.currency,
      pricePerM2: null,
      zoneKeys: [normalizeText(l.zone)].filter(Boolean),
    }));

  // Sin un tipo de cambio real no se convierte ARS↔USD: solo misma moneda.
  const sameCurrency = [...crm, ...app].filter((c) => c.currency === target.currency);
  return {
    list: sameCurrency,
    crm: sameCurrency.filter((c) => c.source === "crm").length,
    app: sameCurrency.filter((c) => c.source === "app").length,
  };
}

/**
 * Escalonado: zona+tipo → zona → tipo. Se usa el primer nivel con al menos
 * MIN_COMPARABLES; si ninguno llega, el más específico que tenga alguno.
 */
function pickComparables(target: Property, candidates: Candidate[]) {
  const targetZones = zoneKeysOf(target);
  const similar = candidates.filter((c) => isSimilarSize(target, c));
  const inZone = (c: Candidate) => targetZones.length > 0 && c.zoneKeys.some((z) => targetZones.includes(z));
  const byLevel: Record<ComparableLevel, Candidate[]> = {
    zona_tipo: similar.filter((c) => inZone(c) && c.type === target.type),
    zona: similar.filter((c) => inZone(c)),
    tipo: similar.filter((c) => c.type === target.type),
  };
  const order: ComparableLevel[] = ["zona_tipo", "zona", "tipo"];
  const level =
    order.find((l) => byLevel[l].length >= MIN_COMPARABLES) ?? order.find((l) => byLevel[l].length > 0) ?? null;

  const price = target.price;
  const comparables: Comparable[] = (level ? byLevel[level] : [])
    .map(({ zoneKeys: _z, ...c }) => ({
      ...c,
      diffVsTarget: price ? (c.price - price) / price : null,
      similarity: similarityOf(target, targetZones, { ...c, zoneKeys: _z }),
    }))
    .sort((a, b) => b.similarity - a.similarity || a.price - b.price);

  return {
    level,
    comparables,
    countsByLevel: {
      zona_tipo: byLevel.zona_tipo.length,
      zona: byLevel.zona.length,
      tipo: byLevel.tipo.length,
    },
  };
}

function confidenceOf(level: ComparableLevel | null, n: number): Confidence {
  if (n === 0) return "sin_datos";
  if (n < MIN_COMPARABLES) return "baja";
  if (level === "zona_tipo" && n >= HIGH_CONFIDENCE) return "alta";
  return "media";
}

/* ── Precio ────────────────────────────────────────────────────────────────── */

function analyzePrice(target: Property, comps: Comparable[], confidence: Confidence): PriceAnalysis {
  const current = target.price != null && target.price > 0 ? target.price : null;
  const surface = surfaceOf(target);
  const showRange = confidence === "alta" || confidence === "media";
  const prices = comps.map((c) => c.price);
  const perM2 = comps.map((c) => c.pricePerM2).filter((v): v is number => v != null);

  const base: PriceAnalysis = {
    current,
    currency: target.currency,
    surface,
    pricePerM2: current && surface ? current / surface : null,
    showRange,
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    p25: null,
    p75: null,
    median: prices.length ? median(prices) : null,
    medianRooms: null,
    roomsAdjustment: null,
    suggested: null,
    diffVsMedian: null,
    diffVsRange: null,
    positioning: null,
    zonePricePerM2: perM2.length >= MIN_COMPARABLES ? median(perM2) : null,
    zonePricePerM2Count: perM2.length,
  };
  if (current && base.median) base.diffVsMedian = (current - base.median) / base.median;
  if (!showRange) return base;

  const p25 = round(percentile(prices, 25));
  const p75 = round(percentile(prices, 75));
  const med = base.median!;

  // Mismo ajuste que la Edge Function `compute_property_diagnostic` de la app
  // (repo propmatch, supabase/functions/compute_property_diagnostic/index.ts):
  // 6 % por ambiente de diferencia con la mediana de ambientes, tope ±18 %.
  const rooms = comps.map((c) => c.rooms).filter((r): r is number => r != null);
  const medianRooms = rooms.length ? median(rooms) : null;
  const adjustment =
    medianRooms != null && target.rooms != null ? clamp((target.rooms - medianRooms) * 0.06, -0.18, 0.18) : 0;
  // La app redondea a 10 (alquileres en USD); para precios grandes (ventas, ARS) eso es ruido.
  const step = med >= 100_000 ? 1000 : 10;
  const suggested = Math.round((med * (1 + adjustment)) / step) * step;

  let positioning: Positioning | null = null;
  let diffVsRange: number | null = null;
  if (current) {
    if (current > p75) {
      positioning = "encima";
      diffVsRange = (current - p75) / p75;
    } else if (current < p25) {
      positioning = "debajo";
      diffVsRange = (current - p25) / p25;
    } else {
      positioning = "dentro";
      diffVsRange = 0;
    }
  }

  return {
    ...base,
    p25,
    p75,
    medianRooms,
    roomsAdjustment: medianRooms != null && target.rooms != null ? adjustment : null,
    suggested,
    positioning,
    diffVsRange,
  };
}

/* ── Demanda ───────────────────────────────────────────────────────────────── */

interface AppCounts {
  interested: number;
  matches: number;
  visits: number;
}

function appCountsByProperty(activities: Activity[]): Map<string, AppCounts> {
  const out = new Map<string, AppCounts>();
  const swipeSeen = new Set<string>();
  for (const a of activities) {
    if (!a.property_id) continue;
    const row = out.get(a.property_id) ?? { interested: 0, matches: 0, visits: 0 };
    if (a.app_swipe_id) {
      if (swipeSeen.has(a.app_swipe_id)) continue;
      swipeSeen.add(a.app_swipe_id);
      row.interested++;
    } else if (a.type === "match_creado" && a.title === APP_MATCH_TITLE) row.matches++;
    else if (a.type === "visita_programada" && a.title === APP_VISIT_TITLE) row.visits++;
    else continue;
    out.set(a.property_id, row);
  }
  return out;
}

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

function analyzeDemand(target: Property, ctx: DiagnosticContext, now: number): DemandAnalysis {
  const since = target.published_at ?? target.created_at;
  const days = daysSince(since, now);
  const appLinked = !!target.app_property_id;
  const counts = appCountsByProperty(ctx.activities);
  const mine = counts.get(target.id) ?? { interested: 0, matches: 0, visits: 0 };

  const offersRows = ctx.appOffers.filter((o) => o.property_id === target.id);
  let offers: DemandAnalysis["offers"] = null;
  if (appLinked) {
    const best = offersRows.length ? Math.max(...offersRows.map((o) => o.amount_usd)) : null;
    offers = {
      count: offersRows.length,
      pending: offersRows.filter((o) => o.status === "pending").length,
      best,
      // Las ofertas de la app son en USD: solo se comparan con un precio en USD.
      bestVsPrice:
        best != null && target.currency === "USD" && target.price ? (best - target.price) / target.price : null,
    };
  }

  const visits = ctx.events.filter((e) => e.property_id === target.id && e.type === "visita");
  const compatible = ctx.matches.filter((m) => m.property_id === target.id && !m.is_dismissed);
  const opps = ctx.opportunities.filter((o) => o.property_id === target.id);
  const openOpps = opps.filter((o) => o.stage !== "perdida" && o.stage !== "cierre");
  const withOpp = new Set(opps.map((o) => o.contact_id));

  const interested = appLinked ? mine.interested : null;
  const interestPerWeek = interested != null && days != null && days >= 1 ? (interested / days) * 7 : null;

  // Pares: otras propiedades disponibles de la agencia que están en la app, con ≥1 día publicadas.
  const peerRates = ctx.inventory
    .filter((p) => p.id !== target.id && p.app_property_id && p.status === "disponible")
    .map((p) => {
      const d = daysSince(p.published_at ?? p.created_at, now);
      return d != null && d >= 1 ? (counts.get(p.id)?.interested ?? 0) / d : null;
    })
    .filter((r): r is number => r != null);
  let peerPercentile: number | null = null;
  if (interestPerWeek != null && peerRates.length >= MIN_COMPARABLES) {
    const rate = interestPerWeek / 7;
    const below = peerRates.filter((r) => r < rate).length;
    const ties = peerRates.filter((r) => r === rate).length;
    peerPercentile = round(((below + ties / 2) / peerRates.length) * 100);
  }

  const scores = compatible.map((m) => m.score);
  return {
    daysPublished: days,
    publishedSince: since,
    appLinked,
    interested,
    appMatches: appLinked ? mine.matches : null,
    appVisits: appLinked ? mine.visits : null,
    agendaVisits: {
      done: visits.filter((e) => new Date(e.starts_at).getTime() <= now).length,
      upcoming: visits.filter((e) => new Date(e.starts_at).getTime() > now).length,
    },
    offers,
    openOpportunities: openOpps.length,
    compatibleContacts: {
      count: compatible.length,
      bestScore: scores.length ? Math.max(...scores) : null,
      avgScore: scores.length ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      withoutOpportunity: compatible.filter((m) => !withOpp.has(m.contact_id)).length,
    },
    channelsPublished: ctx.channelsPublished,
    interestPerWeek,
    peerCount: peerRates.length,
    peerPercentile,
  };
}

/* ── Score ─────────────────────────────────────────────────────────────────── */

/**
 * Subscores 0–100. Cada uno devuelve `null` si no hay datos para calcularlo.
 *
 *  precio:      dentro de P25–P75 = 100. Por encima: 100 − 400·d (d = distancia
 *               relativa a P75; +10 % → 60, +25 % → 0). Por debajo penaliza la
 *               mitad: 100 − 200·d (−10 % → 80). Requiere confianza media/alta.
 *  demanda:     interesados por día. Con ≥3 pares de la agencia en la app:
 *               percentil vs esos pares. Si no: escala fija, 3 interesados por
 *               semana = 100. Requiere estar en la app y ≥7 días publicada.
 *  conversion:  (visitas + ofertas de la app) / interesados; 25 % = 100.
 *               Requiere ≥3 interesados.
 *  competencia: 100 × (1 − comparables más baratos / comparables). Requiere ≥3.
 *  ficha:       % de chequeos de `listingDiagnostics` que pasan (sin contar la
 *               autorización, que no ve el comprador).
 */
function buildScore(
  price: PriceAnalysis,
  demand: DemandAnalysis,
  competition: PropertyDiagnostic["competition"],
  quality: PropertyDiagnostic["quality"],
): PropertyDiagnostic["score"] {
  const pct = (v: number) => `${Math.round(v * 100)} %`;
  const comps: Omit<ScoreComponent, "effectiveWeight" | "included" | "weight">[] = [];

  // Precio
  {
    let value: number | null = null;
    let source = "Pocos comparables para un rango confiable.";
    if (price.positioning && price.diffVsRange != null) {
      const d = Math.abs(price.diffVsRange);
      value =
        price.positioning === "dentro"
          ? 100
          : price.positioning === "encima"
            ? clamp(100 - 400 * d, 0, 100)
            : clamp(100 - 200 * d, 0, 100);
      source =
        price.positioning === "dentro"
          ? "Precio dentro del rango P25–P75 de comparables."
          : `Precio ${pct(d)} ${price.positioning === "encima" ? "por encima" : "por debajo"} del rango P25–P75.`;
    } else if (price.current == null) source = "La propiedad no tiene precio cargado.";
    comps.push({
      id: "precio",
      label: "Precio vs rango",
      value,
      source,
      formula: "Dentro del rango = 100 · encima: 100 − 400 × distancia · debajo: 100 − 200 × distancia",
    });
  }

  // Demanda
  {
    let value: number | null = null;
    let source: string;
    if (!demand.appLinked) source = "No está en la app: no hay interesados reales para medir.";
    else if (demand.daysPublished == null || demand.daysPublished < MIN_DAYS_FOR_DEMAND)
      source = `Menos de ${MIN_DAYS_FOR_DEMAND} días publicada: muy poco tiempo para medir interés.`;
    else if (demand.peerPercentile != null) {
      value = demand.peerPercentile;
      source = `${demand.interested} interesados en ${demand.daysPublished} días; percentil ${demand.peerPercentile} entre ${demand.peerCount} propiedades tuyas en la app.`;
    } else {
      value = clamp(((demand.interestPerWeek ?? 0) / DEMAND_REF_PER_WEEK) * 100, 0, 100);
      source = `${demand.interested} interesados en ${demand.daysPublished} días (${(demand.interestPerWeek ?? 0).toFixed(1).replace(".", ",")} por semana). Pocas propiedades tuyas para comparar: escala fija.`;
    }
    comps.push({
      id: "demanda",
      label: "Demanda / interés",
      value,
      source,
      formula: `Percentil de interesados/día vs tus otras propiedades en la app (≥3); si no, ${DEMAND_REF_PER_WEEK} por semana = 100`,
    });
  }

  // Conversión
  {
    let value: number | null = null;
    let source: string;
    if (demand.interested == null) source = "No está en la app: no hay interesados reales.";
    else if (demand.interested < MIN_INTERESTED_FOR_CONVERSION)
      source = `Solo ${demand.interested} interesados: muy pocos para medir conversión.`;
    else {
      const actions = (demand.appVisits ?? 0) + (demand.offers?.count ?? 0);
      const ratio = Math.min(1, actions / demand.interested);
      value = clamp((ratio / CONVERSION_REF) * 100, 0, 100);
      source = `${actions} visitas u ofertas sobre ${demand.interested} interesados (${pct(ratio)}).`;
    }
    comps.push({
      id: "conversion",
      label: "Conversión",
      value,
      source,
      formula: `(visitas + ofertas de la app) / interesados; ${pct(CONVERSION_REF)} = 100`,
    });
  }

  // Competencia
  {
    let value: number | null = null;
    let source = "Menos de 3 comparables.";
    if (competition.cheaperShare != null) {
      value = 100 * (1 - competition.cheaperShare);
      source = `${competition.cheaper} de ${competition.count} comparables están más baratos.`;
    }
    comps.push({
      id: "competencia",
      label: "Competencia",
      value,
      source,
      formula: "100 × (1 − comparables más baratos / comparables)",
    });
  }

  // Ficha
  {
    const scored = quality.checks.filter((c) => c.id !== "authorization");
    const ok = scored.filter((c) => c.ok).length;
    comps.push({
      id: "ficha",
      label: "Calidad de la ficha",
      value: (ok / scored.length) * 100,
      source: `${ok} de ${scored.length} chequeos de la ficha completos.`,
      formula: "% de chequeos de la ficha que pasan (sin autorización)",
    });
  }

  const available = comps.filter((c) => c.value != null);
  const totalWeight = available.reduce((s, c) => s + WEIGHTS[c.id], 0);
  const components: ScoreComponent[] = comps.map((c) => ({
    ...c,
    value: c.value == null ? null : round(c.value),
    weight: WEIGHTS[c.id],
    included: c.value != null,
    effectiveWeight: c.value != null && available.length >= 2 ? WEIGHTS[c.id] / totalWeight : null,
  }));

  if (available.length < 2) {
    return { value: null, components, summary: "Faltan datos para un score confiable." };
  }
  const value = round(available.reduce((s, c) => s + (c.value! * WEIGHTS[c.id]) / totalWeight, 0));
  const weakest = components.filter((c) => c.included).sort((a, b) => a.value! - b.value!)[0];
  const summary =
    weakest.value! >= 80
      ? `Todos los componentes medidos están bien (${available.length} de 5 con datos).`
      : `Lo que más resta: ${weakest.label.toLowerCase()} (${weakest.value}/100). ${available.length} de 5 componentes con datos.`;
  return { value, components, summary };
}

/* ── Semáforos ─────────────────────────────────────────────────────────────── */

const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1).replace(".", ",")} %`;

function level3(value: number | null, green: number, amber: number): SignalStatus {
  if (value == null) return "sin_datos";
  return value >= green ? "verde" : value >= amber ? "amarillo" : "rojo";
}

function buildSignals(
  target: Property,
  d: Pick<PropertyDiagnostic, "price" | "demand" | "competition" | "quality" | "score">,
): Signal[] {
  const comp = (id: ScoreComponent["id"]) => d.score.components.find((c) => c.id === id)!;
  const { price, demand } = d;

  let priceStatus: SignalStatus = "sin_datos";
  let priceDetail = "Pocos comparables para estimar un rango.";
  if (price.positioning) {
    const dist = Math.abs(price.diffVsRange ?? 0);
    priceStatus = price.positioning === "dentro" ? "verde" : price.positioning === "debajo" || dist <= 0.1 ? "amarillo" : "rojo";
    priceDetail =
      price.positioning === "dentro"
        ? "Dentro del rango de similares."
        : `${fmtPct(price.diffVsRange!)} vs el rango de similares.`;
  } else if (price.current == null) priceDetail = "Sin precio cargado.";

  const [g, a] = DAYS_THRESHOLDS[target.operation];
  const days = demand.daysPublished;
  const daysStatus: SignalStatus = days == null ? "sin_datos" : days <= g ? "verde" : days <= a ? "amarillo" : "rojo";

  const dem = comp("demanda");
  const conv = comp("conversion");
  const ficha = comp("ficha");

  return [
    { id: "precio", label: "Precio", status: priceStatus, detail: priceDetail },
    { id: "demanda", label: "Demanda", status: level3(dem.value, 60, 30), detail: dem.source },
    { id: "conversion", label: "Consultas y visitas", status: level3(conv.value, 60, 30), detail: conv.source },
    {
      id: "competencia",
      label: "Competencia",
      status:
        d.competition.cheaperShare == null
          ? "sin_datos"
          : d.competition.cheaperShare <= 1 / 3
            ? "verde"
            : d.competition.cheaperShare <= 2 / 3
              ? "amarillo"
              : "rojo",
      detail: comp("competencia").source,
    },
    {
      id: "dias",
      label: "Días publicada",
      status: daysStatus,
      detail:
        days == null
          ? "Sin fecha de publicación."
          : `${days} ${days === 1 ? "día" : "días"} (verde hasta ${g}, amarillo hasta ${a} para ${target.operation === "venta" ? "venta" : "alquiler"}).`,
    },
    { id: "ficha", label: "Ficha", status: level3(ficha.value, 100, 70), detail: ficha.source },
  ];
}

/* ── Lectura cruzada (reglas, no IA) ───────────────────────────────────────── */

interface Facts {
  price: "alto" | "bajo" | "ok" | null;
  /** Distancia al rango (fracción, positiva). */
  priceDist: number;
  demand: "alta" | "media" | "baja" | null;
  stale: boolean;
  fichaWeak: boolean;
  appLinked: boolean;
  days: number | null;
  median: number | null;
  currency: CurrencyCode;
  comparables: number;
  interested: number | null;
}

interface NarrativeRule {
  id: string;
  /** Solo una regla por grupo (la primera que aplique). */
  group: "ficha" | "precio" | "datos";
  when: (f: Facts) => boolean;
  text: (f: Facts) => string;
}

const money = (v: number | null, c: CurrencyCode) => (v == null ? "—" : `${c} ${Math.round(v).toLocaleString("es-AR")}`);

/** Tabla de reglas: se evalúan en orden; gana la primera de cada grupo. */
export const NARRATIVE_RULES: NarrativeRule[] = [
  {
    id: "ficha-primero",
    group: "ficha",
    when: (f) => f.fichaWeak && (f.price === "alto" || f.demand === "baja" || f.demand === null),
    text: () =>
      "La ficha está incompleta: antes de tocar el precio, priorizá fotos, descripción y datos faltantes. Es más barato que bajar el precio y mejora cómo se ve frente a similares.",
  },
  {
    id: "alto-con-interes",
    group: "precio",
    when: (f) => f.price === "alto" && (f.demand === "alta" || f.demand === "media"),
    text: () =>
      "El precio está por encima de similares, pero sigue generando interés. No recomendamos bajar agresivamente: probá un ajuste de 3–5 % y medí 14 días.",
  },
  {
    id: "alto-sin-interes-estancada",
    group: "precio",
    when: (f) => f.price === "alto" && f.demand === "baja" && f.stale,
    text: (f) =>
      `El precio está por encima de similares, genera poco interés y lleva ${f.days} días publicada. Conviene acercarlo a la mediana de comparables (${money(f.median, f.currency)}).`,
  },
  {
    id: "alto-sin-interes",
    group: "precio",
    when: (f) => f.price === "alto" && f.demand === "baja",
    text: () =>
      "El precio está por encima de similares y el interés es bajo. Si en 14 días no cambia, evaluá un ajuste hacia el rango.",
  },
  {
    id: "alto-sin-datos-demanda",
    group: "precio",
    when: (f) => f.price === "alto",
    text: (f) =>
      `El precio está ${Math.round(f.priceDist * 100)} % por encima del rango de similares. Sin datos de interés todavía no se puede saber si el mercado lo convalida.`,
  },
  {
    id: "bajo-con-interes",
    group: "precio",
    when: (f) => f.price === "bajo" && f.demand === "alta",
    text: () =>
      "El precio está por debajo de similares y genera mucho interés: podrías estar dejando dinero. Evaluá subirlo hacia el rango antes de cerrar con la primera oferta.",
  },
  {
    id: "bajo",
    group: "precio",
    when: (f) => f.price === "bajo",
    text: () =>
      "El precio está por debajo del rango de similares. Debería atraer interés; si no lo hace, el problema está en la ficha o en la difusión, no en el precio.",
  },
  {
    id: "ok-sin-interes",
    group: "precio",
    when: (f) => f.price === "ok" && f.demand === "baja",
    text: () =>
      "El precio está alineado con similares pero el interés es bajo: el problema no parece ser el precio. Revisá fotos, descripción y en qué canales está publicada.",
  },
  {
    id: "ok-con-interes",
    group: "precio",
    when: (f) => f.price === "ok" && (f.demand === "alta" || f.demand === "media"),
    text: () => "Precio alineado con similares y con interés: mantenelo y hacé seguimiento a los interesados.",
  },
  {
    id: "ok",
    group: "precio",
    when: (f) => f.price === "ok",
    text: () => "El precio está dentro del rango de propiedades similares.",
  },
  {
    id: "sin-rango",
    group: "precio",
    when: (f) => f.price === null,
    text: (f) =>
      f.comparables === 0
        ? "No encontramos propiedades similares activas para comparar el precio."
        : `Hay solo ${f.comparables} ${f.comparables === 1 ? "comparable" : "comparables"}: pocos para opinar sobre el precio con fundamento.`,
  },
  {
    id: "fuera-de-la-app",
    group: "datos",
    when: (f) => !f.appLinked,
    text: () =>
      "Esta propiedad no está en la app PropMatch, así que no hay datos de interés real (likes, visitas, ofertas) para medir cómo rinde.",
  },
];

function buildNarrative(f: Facts): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (const rule of NARRATIVE_RULES) {
    if (used.has(rule.group) || !rule.when(f)) continue;
    used.add(rule.group);
    out.push(rule.text(f));
  }
  return out;
}

/* ── Recomendaciones ───────────────────────────────────────────────────────── */

function buildRecommendations(target: Property, d: Omit<PropertyDiagnostic, "recommendations">): Recommendation[] {
  const recs: Recommendation[] = [];
  const edit = `/propiedades/${target.id}/editar`;
  const { price, demand, quality } = d;

  const failing = quality.checks.filter((c) => !c.ok && c.id !== "authorization");
  const photos = failing.find((c) => c.id === "photos");
  if (photos) {
    recs.push({
      id: "fotos",
      priority: 1,
      title: "Sumá fotos",
      why: photos.detail,
      action: { label: "Editar propiedad", to: edit },
    });
  }
  const otherFailing = failing.filter((c) => c.id !== "photos" && c.id !== "price");
  if (otherFailing.length) {
    recs.push({
      id: "ficha",
      priority: otherFailing.some((c) => c.id === "description") ? 1 : 2,
      title: `Completá la ficha: ${otherFailing.map((c) => c.label.toLowerCase()).join(", ")}`,
      why: otherFailing.map((c) => c.detail).join(" "),
      action: { label: "Editar propiedad", to: edit },
    });
  }
  if (price.current == null) {
    recs.push({
      id: "sin-precio",
      priority: 1,
      title: "Cargá el precio",
      why: "Sin precio no se puede comparar con similares ni medir la competencia.",
      action: { label: "Editar precio", to: edit },
    });
  }

  if (demand.offers && demand.offers.pending > 0) {
    const vs = demand.offers.bestVsPrice;
    recs.push({
      id: "ofertas",
      priority: 1,
      title: `Respondé ${demand.offers.pending} ${demand.offers.pending === 1 ? "oferta pendiente" : "ofertas pendientes"}`,
      why:
        `La mejor oferta es de ${money(demand.offers.best, "USD")}` +
        (vs != null ? ` (${fmtPct(vs)} vs el precio publicado).` : "."),
      action: { label: "Ver ofertas", to: "/ofertas" },
    });
  }

  if (price.positioning === "encima" && price.p75 != null) {
    recs.push({
      id: "precio-alto",
      priority: d.signals.find((s) => s.id === "demanda")?.status === "verde" ? 3 : 2,
      title: "Revisá el precio",
      why: `Está ${fmtPct(price.diffVsRange!)} por encima del techo del rango (${money(price.p75, price.currency)}) de ${d.comparables.length} comparables; la mediana es ${money(price.median, price.currency)}.`,
      action: { label: "Editar precio", to: edit },
    });
  } else if (price.positioning === "debajo" && price.p25 != null) {
    recs.push({
      id: "precio-bajo",
      priority: 3,
      title: "Confirmá que el precio no quedó bajo",
      why: `Está ${fmtPct(price.diffVsRange!)} por debajo del piso del rango (${money(price.p25, price.currency)}) de ${d.comparables.length} comparables.`,
      action: { label: "Editar precio", to: edit },
    });
  }

  if (demand.compatibleContacts.withoutOpportunity > 0) {
    const n = demand.compatibleContacts.withoutOpportunity;
    recs.push({
      id: "avisar",
      priority: 2,
      title: `Avisale a ${n} ${n === 1 ? "contacto compatible" : "contactos compatibles"}`,
      why: `El matching del CRM encontró ${demand.compatibleContacts.count} ${demand.compatibleContacts.count === 1 ? "contacto" : "contactos"} de tu cartera (mejor score ${demand.compatibleContacts.bestScore} %) y ${n === 1 ? "no tiene" : "no tienen"} oportunidad abierta sobre esta propiedad.`,
      action: { label: "Compartir ficha", kind: "share" },
    });
  }

  if (demand.channelsPublished === 0) {
    recs.push({
      id: "portales",
      priority: 2,
      title: "Publicala en portales",
      why: "No figura publicada en ningún canal externo; solo se ve en tu web.",
      action: { label: "Ir al publicador", to: `/publicador/${target.id}` },
    });
  }

  if (!demand.appLinked) {
    recs.push({
      id: "app",
      priority: 3,
      title: "Sumala a la app PropMatch para medir interés",
      why:
        target.currency === "USD"
          ? "Sin vínculo con la app no hay likes, visitas ni ofertas reales para medir la demanda."
          : "La app solo publica precios en USD; con el precio en ARS no se sincroniza y no hay datos de interés real.",
      action: { label: "Editar propiedad", to: edit },
    });
  }

  if (d.confidence === "baja" || d.confidence === "sin_datos") {
    recs.push({
      id: "comparables",
      priority: 3,
      title: "Cargá más propiedades de la zona",
      why: `Hay ${d.comparables.length} ${d.comparables.length === 1 ? "comparable" : "comparables"}; con al menos ${MIN_COMPARABLES} el diagnóstico estima un rango de precio.`,
      action: { label: "Cargar propiedad", to: "/propiedades/nueva" },
    });
  }

  return recs.sort((a, b) => a.priority - b.priority);
}

/* ── Entrada principal ─────────────────────────────────────────────────────── */

export function computeDiagnostic(target: Property, ctx: DiagnosticContext): PropertyDiagnostic {
  const now = ctx.now ?? Date.now();
  const cand = buildCandidates(target, ctx);
  const { level, comparables, countsByLevel } = pickComparables(target, cand.list);
  const confidence = confidenceOf(level, comparables.length);
  const price = analyzePrice(target, comparables, confidence);
  const demand = analyzeDemand(target, ctx, now);

  const cheaper = price.current != null ? comparables.filter((c) => c.price < price.current!).length : null;
  const competition = {
    count: comparables.length,
    cheaper,
    cheaperShare: cheaper != null && comparables.length >= MIN_COMPARABLES ? cheaper / comparables.length : null,
  };

  const checks = diagnose(target, ctx.photoCount);
  const quality = { checks, ok: checks.filter((c) => c.ok).length, total: checks.length };
  const score = buildScore(price, demand, competition, quality);
  const signals = buildSignals(target, { price, demand, competition, quality, score });

  const notes: string[] = [];
  if (ctx.appListings == null) {
    notes.push("No se pudo leer el mercado de la app: el diagnóstico usa solo tu inventario.");
  }
  if (target.currency === "ARS") {
    notes.push(
      "El precio está en ARS y no hay un tipo de cambio cargado: se compara solo con propiedades en ARS (las de la app están en USD y quedan afuera).",
    );
  } else {
    notes.push("Se compara solo con propiedades en USD (no se convierten precios en ARS).");
  }
  if (level && level !== "zona_tipo") {
    notes.push(
      `No hubo ${MIN_COMPARABLES} similares con misma zona y tipo; se amplió a ${LEVEL_LABEL[level]}.`,
    );
  }

  const demandComp = score.components.find((c) => c.id === "demanda")!;
  const fichaComp = score.components.find((c) => c.id === "ficha")!;
  const facts: Facts = {
    price:
      price.positioning === "encima" ? "alto" : price.positioning === "debajo" ? "bajo" : price.positioning ? "ok" : null,
    priceDist: Math.abs(price.diffVsRange ?? 0),
    demand:
      demandComp.value == null ? null : demandComp.value >= 60 ? "alta" : demandComp.value >= 30 ? "media" : "baja",
    stale: signals.find((s) => s.id === "dias")?.status === "rojo",
    fichaWeak: (fichaComp.value ?? 100) < 70,
    appLinked: demand.appLinked,
    days: demand.daysPublished,
    median: price.median,
    currency: target.currency,
    comparables: comparables.length,
    interested: demand.interested,
  };

  const partial: Omit<PropertyDiagnostic, "recommendations"> = {
    computedAt: new Date(now).toISOString(),
    currency: target.currency,
    level,
    levelLabel: level ? LEVEL_LABEL[level] : "sin comparables",
    countsByLevel,
    comparables,
    confidence,
    confidenceLabel: CONFIDENCE_LABEL[confidence],
    notes,
    price,
    demand,
    competition,
    quality,
    score,
    signals,
    narrative: buildNarrative(facts),
    sources: {
      crm: comparables.filter((c) => c.source === "crm").length,
      app: comparables.filter((c) => c.source === "app").length,
      appAvailable: ctx.appListings != null,
    },
  };
  return { ...partial, recommendations: buildRecommendations(target, partial) };
}

/** "+6,8 %" / "−3,0 %" — para la UI. */
export const formatPct = fmtPct;
