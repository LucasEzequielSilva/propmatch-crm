/**
 * Motor de compatibilidad.
 *
 * El diseño de Figma Make ya definía el modelo: un score 0-100 desglosado en
 * factores, con umbrales de lectura. Lo que faltaba era calcularlo — en el
 * prototipo los scores estaban escritos a mano (Juan Pérez buscaba un lote y
 * le asignaban una casa con 86%).
 *
 * Pesos (suman 100):
 *   Presupuesto            30
 *   Ubicación              25
 *   Tipo de propiedad      20
 *   Ambientes / superficie 15
 *   Características        10
 */

import type { ContactRequirement, Match, Property } from "@/types/db";

const WEIGHTS = {
  budget: 0.3,
  location: 0.25,
  type: 0.2,
  size: 0.15,
  features: 0.1,
} as const;

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Dentro del rango = 100. Fuera, decae linealmente.
 * Más barato de lo buscado penaliza mucho menos que más caro: un cliente con
 * tope de 200k no descarta una de 180k, pero sí una de 260k.
 */
export function scoreBudget(
  price: number | null,
  min: number | null,
  max: number | null,
): number {
  if (price === null) return 50;
  if (min === null && max === null) return 60;

  if (max !== null && price > max) {
    const tolerance = max * 0.25;
    return Math.max(0, Math.round(100 * (1 - (price - max) / tolerance)));
  }
  if (min !== null && price < min) {
    const tolerance = min * 0.5;
    return Math.max(40, Math.round(100 - 40 * ((min - price) / tolerance)));
  }
  return 100;
}

export function scoreLocation(
  zone: string | null,
  locality: string | null,
  province: string | null,
  wanted: string[],
): number {
  if (!wanted.length) return 60;

  if (zone && wanted.some((z) => norm(z) === norm(zone))) return 100;
  if (locality && wanted.some((z) => norm(z) === norm(locality))) return 85;

  // Coincidencia parcial: "La Plata Centro" contra "La Plata".
  const haystack = norm(`${zone ?? ""} ${locality ?? ""}`);
  if (wanted.some((z) => haystack.includes(norm(z)) || norm(z).includes(norm(zone ?? locality ?? "~~")))) {
    return 70;
  }
  return province ? 30 : 10;
}

export function scoreType(type: string, wanted: string[]): number {
  if (!wanted.length) return 60;
  return wanted.includes(type) ? 100 : 0;
}

/** Promedia solo las dimensiones que el cliente efectivamente pidió. */
export function scoreSize(property: Property, req: ContactRequirement): number {
  const parts: number[] = [];

  if (req.rooms_min !== null) {
    const have = property.rooms ?? 0;
    parts.push(have >= req.rooms_min ? 100 : Math.max(0, 100 - 25 * (req.rooms_min - have)));
  }
  if (req.bedrooms_min !== null) {
    const have = property.bedrooms ?? 0;
    parts.push(have >= req.bedrooms_min ? 100 : Math.max(0, 100 - 30 * (req.bedrooms_min - have)));
  }
  if (req.bathrooms_min !== null) {
    const have = property.bathrooms ?? 0;
    parts.push(have >= req.bathrooms_min ? 100 : Math.max(0, 100 - 30 * (req.bathrooms_min - have)));
  }
  if (req.surface_min !== null || req.surface_max !== null) {
    const surface = property.surface_total;
    if (surface === null) parts.push(50);
    else if (req.surface_min !== null && surface < req.surface_min) {
      parts.push(Math.max(0, Math.round(100 * (surface / req.surface_min))));
    } else if (req.surface_max !== null && surface > req.surface_max) {
      parts.push(Math.max(50, Math.round(100 - 50 * ((surface - req.surface_max) / req.surface_max))));
    } else parts.push(100);
  }

  if (!parts.length) return 65;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function scoreFeatures(features: string[], wanted: string[]): number {
  if (!wanted.length) return 70;
  const hits = wanted.filter((w) => features.some((f) => norm(f) === norm(w))).length;
  return Math.round((100 * hits) / wanted.length);
}

export interface MatchBreakdown {
  score: number;
  score_budget: number;
  score_location: number;
  score_type: number;
  score_size: number;
  score_features: number;
  reasons: string[];
}

export function computeMatch(req: ContactRequirement, property: Property): MatchBreakdown {
  const budget = scoreBudget(property.price, req.budget_min, req.budget_max);
  const location = scoreLocation(property.zone, property.locality, property.province, req.zones);
  const type = scoreType(property.type, req.property_types);
  const size = scoreSize(property, req);
  const features = scoreFeatures(property.features, req.features);

  const score = Math.round(
    budget * WEIGHTS.budget +
      location * WEIGHTS.location +
      type * WEIGHTS.type +
      size * WEIGHTS.size +
      features * WEIGHTS.features,
  );

  // Los chips "✓ ..." que muestra la card de match.
  const reasons: string[] = [];
  if (budget >= 90) reasons.push("Presupuesto compatible");
  if (location === 100) reasons.push("Zona preferida");
  else if (location >= 70) reasons.push("Zona compatible");
  if (type === 100) reasons.push("Tipo de propiedad ideal");
  if (size >= 90 && property.rooms) reasons.push(`${property.rooms} ambientes`);
  if (features === 100 && req.features.length) reasons.push("Tiene todo lo buscado");

  return {
    score,
    score_budget: budget,
    score_location: location,
    score_type: type,
    score_size: size,
    score_features: features,
    reasons,
  };
}

/** Score mínimo para que un match se muestre. */
export const MATCH_THRESHOLD = 50;

/**
 * Recalcula todos los matches a partir de propiedades y requerimientos.
 * Filtros duros antes de puntuar: misma operación y propiedad disponible.
 */
export function buildMatches(
  properties: Property[],
  requirements: ContactRequirement[],
  previous: Match[] = [],
): Match[] {
  const seen = new Map(previous.map((m) => [`${m.requirement_id}:${m.property_id}`, m]));
  const out: Match[] = [];

  for (const req of requirements) {
    if (!req.is_active) continue;
    for (const property of properties) {
      if (property.status !== "disponible") continue;
      if (property.operation !== req.operation) continue;

      const b = computeMatch(req, property);
      if (b.score < MATCH_THRESHOLD) continue;

      const key = `${req.id}:${property.id}`;
      const prev = seen.get(key);

      // Un match nace cuando aparece el último de los dos lados. Si se fechara
      // "ahora", todos los matches serían siempre nuevos y el filtro "Nuevos"
      // no distinguiría nada.
      const bornAt =
        new Date(property.created_at) > new Date(req.updated_at)
          ? property.created_at
          : req.updated_at;

      out.push({
        id: prev?.id ?? `match-${req.id}-${property.id}`,
        agency_id: property.agency_id,
        contact_id: req.contact_id,
        requirement_id: req.id,
        property_id: property.id,
        origin: "crm",
        // Se preserva lo que el agente ya hizo con este match.
        is_reviewed: prev?.is_reviewed ?? false,
        is_dismissed: prev?.is_dismissed ?? false,
        created_at: prev?.created_at ?? bornAt,
        ...b,
      });
    }
  }

  return out.sort((a, b) => b.score - a.score);
}
