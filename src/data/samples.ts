/**
 * Datos de ejemplo: alta, baja y migración dentro del store.
 *
 * - `sampleSlices` arma la semilla marcada (`is_sample: true`).
 * - `adoptSamples` se corre al abrir cualquier sesión (real o demo): marca lo
 *   viejo, agrega lo que falte (una vez por versión de la semilla, sin
 *   duplicar) y, en cuentas reales, hace que lo de ejemplo sea "mío".
 * - `stripSamples` es "Usar mis datos reales": saca todo lo de ejemplo y lo
 *   que cuelga de eso, sin tocar lo creado por el usuario ni lo traído de la app.
 * - `restoreSamples` es "Mostrar ejemplos otra vez".
 *
 * Reglas de seguridad y helpers de UI: src/lib/samples.ts.
 */

import type { AppOffer, Profile } from "@/types/db";
import type { StoreData } from "./store";
import {
  CURRENT_USER_ID,
  seedActivities,
  seedContacts,
  seedDeals,
  seedEvents,
  seedOffers,
  seedOpportunities,
  seedPhotos,
  seedProfiles,
  seedProperties,
  seedRequirements,
  seedTasks,
} from "./seed";

/**
 * Subir este número vuelve a ofrecer la semilla (solo lo que falte) a quien
 * no la ocultó. Si el usuario borró un ejemplo, no reaparece hasta el
 * próximo cambio de versión.
 */
export const SAMPLES_VERSION = 1;

/** Dueño de los ejemplos en la semilla. En una cuenta real pasa a ser el usuario. */
const SEED_USER_ID = CURRENT_USER_ID;

type WithId = { id: string; is_sample?: boolean };

const mark = <T extends object>(rows: T[]): T[] => rows.map((r) => ({ ...r, is_sample: true }));

export type SampleSlices = Pick<
  StoreData,
  | "profiles"
  | "contacts"
  | "requirements"
  | "properties"
  | "photos"
  | "opportunities"
  | "activities"
  | "events"
  | "tasks"
  | "deals"
  | "appOffers"
>;

/** Reemplaza el id del agente de la semilla por el del usuario, en cualquier campo. */
function remapUser<T>(value: T, userId: string): T {
  return JSON.parse(JSON.stringify(value), (_k, v) => (v === SEED_USER_ID ? userId : v)) as T;
}

/**
 * La semilla marcada. Con `userId` de una cuenta real, lo que era de "Valen"
 * (u-1) pasa a ser del usuario y no se agrega ese perfil inventado.
 */
export function sampleSlices(userId: string | null = null): SampleSlices {
  const base: SampleSlices = {
    profiles: mark(seedProfiles),
    contacts: mark(seedContacts),
    requirements: mark(seedRequirements),
    properties: mark(seedProperties),
    photos: seedPhotos,
    opportunities: mark(seedOpportunities),
    activities: mark(seedActivities),
    events: mark(seedEvents),
    tasks: mark(seedTasks),
    deals: mark(seedDeals),
    appOffers: mark(seedOffers),
  };
  if (!userId || userId === SEED_USER_ID) return base;
  return remapUser({ ...base, profiles: base.profiles.filter((p) => p.id !== SEED_USER_ID) }, userId);
}

/* ── Migración de datos guardados antes del campo `is_sample` ─────────────── */

const idSet = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
const SEED_IDS = {
  profiles: idSet(seedProfiles),
  contacts: idSet(seedContacts),
  requirements: idSet(seedRequirements),
  properties: idSet(seedProperties),
  opportunities: idSet(seedOpportunities),
  activities: idSet(seedActivities),
  events: idSet(seedEvents),
  tasks: idSet(seedTasks),
  deals: idSet(seedDeals),
};

/**
 * Marca como ejemplo lo que tiene id de la semilla y todavía no tiene la
 * marca (la demo guardaba la semilla sin `is_sample`). Nunca marca algo que
 * vino de la app (`app_property_id`, `app_user_id`). Idempotente.
 */
export function markLegacySamples<D extends Partial<StoreData>>(d: D): D {
  const fix = <T extends WithId>(rows: T[] | undefined, ids: Set<string>, isReal: (r: T) => boolean = () => false) =>
    rows?.map((r) => (r.is_sample === undefined && ids.has(r.id) && !isReal(r) ? { ...r, is_sample: true } : r));
  return {
    ...d,
    profiles: fix(d.profiles, SEED_IDS.profiles),
    contacts: fix(d.contacts, SEED_IDS.contacts, (c) => !!c.app_user_id),
    requirements: fix(d.requirements, SEED_IDS.requirements),
    properties: fix(d.properties, SEED_IDS.properties, (p) => !!p.app_property_id),
    opportunities: fix(d.opportunities, SEED_IDS.opportunities),
    activities: fix(d.activities, SEED_IDS.activities, (a) => !!a.app_offer_id || !!a.app_swipe_id),
    events: fix(d.events, SEED_IDS.events),
    tasks: fix(d.tasks, SEED_IDS.tasks),
    deals: fix(d.deals, SEED_IDS.deals),
  };
}

/** Reemplaza cada ejemplo viejo por su versión actual de la semilla (mismo id). */
function upgradeLegacySamples(d: StoreData, userId: string): StoreData {
  const fresh = sampleSlices(userId);
  const swap = <T extends WithId>(rows: T[], seed: T[]) => {
    const byId = new Map(seed.map((r) => [r.id, r]));
    return rows.map((r) => (r.is_sample && byId.has(r.id) ? byId.get(r.id)! : r));
  };
  const properties = swap(d.properties, fresh.properties);
  const upgraded = properties.filter((p, i) => p !== d.properties[i] && p.is_sample).map((p) => p.id);
  return {
    ...d,
    contacts: swap(d.contacts, fresh.contacts),
    requirements: swap(d.requirements, fresh.requirements),
    properties,
    photos: { ...d.photos, ...Object.fromEntries(upgraded.map((id) => [id, fresh.photos[id] ?? []])) },
    opportunities: swap(d.opportunities, fresh.opportunities),
    activities: swap(d.activities, fresh.activities),
    events: swap(d.events, fresh.events),
    tasks: swap(d.tasks, fresh.tasks),
  };
}

/* ── Alta ─────────────────────────────────────────────────────────────────── */

/** Agrega solo lo que no está (por id). Lo existente, aunque esté editado, se respeta. */
function addMissing<T extends { id: string }>(current: T[], extra: T[]): T[] {
  const have = new Set(current.map((r) => r.id));
  const missing = extra.filter((r) => !have.has(r.id));
  return missing.length ? [...current, ...missing] : current;
}

/** Agrega la semilla que falte. No duplica ni pisa nada. */
export function restoreSamples(d: StoreData, userId: string | null): StoreData {
  const s = sampleSlices(userId);
  const properties = addMissing(d.properties, s.properties);
  const addedProps = properties.slice(d.properties.length).map((p) => p.id);

  // Los números PM-xxxx no se pisan con los de operaciones reales.
  const realMax = d.deals.filter((x) => !x.is_sample).reduce((m, x) => Math.max(m, x.number || 0), 0);
  const sampleDeals = realMax ? s.deals.map((x, i) => ({ ...x, number: realMax + i + 1 })) : s.deals;

  const offerKey = new Set(d.appOffers.map((o) => o.app_offer_id));
  const offers: AppOffer[] = [...d.appOffers, ...s.appOffers.filter((o) => !offerKey.has(o.app_offer_id))];

  return {
    ...d,
    profiles: addMissing(d.profiles, s.profiles),
    contacts: addMissing(d.contacts, s.contacts),
    requirements: addMissing(d.requirements, s.requirements),
    properties,
    photos: { ...d.photos, ...Object.fromEntries(addedProps.map((id) => [id, s.photos[id] ?? []])) },
    opportunities: addMissing(d.opportunities, s.opportunities),
    activities: addMissing(d.activities, s.activities),
    events: addMissing(d.events, s.events),
    tasks: addMissing(d.tasks, s.tasks),
    deals: addMissing(d.deals, sampleDeals),
    appOffers: offers,
    samplesHidden: false,
    samplesVersion: SAMPLES_VERSION,
  };
}

/**
 * En una cuenta real, lo de ejemplo que todavía figura a nombre de "Valen"
 * (u-1, el agente de la demo) pasa a ser del usuario, y ese perfil inventado
 * se va. Solo toca registros de ejemplo.
 */
function adoptOwnership(d: StoreData, userId: string): StoreData {
  if (userId === SEED_USER_ID) return d;
  const re = <T extends WithId>(rows: T[]) => rows.map((r) => (r.is_sample ? remapUser(r, userId) : r));
  return {
    ...d,
    profiles: d.profiles.filter((p: Profile) => !(p.is_sample && p.id === SEED_USER_ID)),
    contacts: re(d.contacts),
    properties: re(d.properties),
    opportunities: re(d.opportunities),
    activities: re(d.activities),
    events: re(d.events),
    tasks: re(d.tasks),
    deals: re(d.deals),
  };
}

/**
 * Al abrir sesión. Cuentas reales: ejemplos visibles por defecto, salvo que
 * el usuario haya elegido "Usar mis datos reales" (`samplesHidden`). Demo:
 * siempre visibles. Idempotente: correrlo dos veces deja lo mismo.
 */
export function adoptSamples(d: StoreData, userId: string, opts: { alwaysVisible?: boolean } = {}): StoreData {
  let next = markLegacySamples(d);
  // Datos guardados antes de esta versión (p. ej. la demo con la semilla vieja):
  // los ejemplos viejos se reemplazan por los nuevos, más completos.
  if (next.samplesVersion === undefined) next = upgradeLegacySamples(next, userId);
  if (next.samplesHidden && !opts.alwaysVisible) return stripSamples(next);
  if (next.samplesVersion !== SAMPLES_VERSION || opts.alwaysVisible) next = restoreSamples(next, userId);
  return adoptOwnership(next, userId);
}

/* ── Baja ─────────────────────────────────────────────────────────────────── */

/**
 * "Usar mis datos reales". Saca todo lo marcado como ejemplo y lo que cuelga
 * de eso (búsquedas, actividades, oportunidades y fotos de esos contactos y
 * propiedades). Lo creado por el usuario se queda: si apuntaba a un ejemplo,
 * esa referencia se limpia (como hace `undoImport`).
 */
export function stripSamples(d: StoreData): StoreData {
  const ids = <T extends WithId>(rows: T[]) => new Set(rows.filter((r) => r.is_sample).map((r) => r.id));
  const sc = ids(d.contacts);
  const sp = ids(d.properties);
  const so = ids(d.opportunities);
  const sr = new Set(d.requirements.filter((r) => r.is_sample || sc.has(r.contact_id)).map((r) => r.id));
  const keep = <T extends WithId>(r: T) => !r.is_sample;
  const c = (id: string | null) => (id && sc.has(id) ? null : id);
  const p = (id: string | null) => (id && sp.has(id) ? null : id);
  const o = (id: string | null) => (id && so.has(id) ? null : id);

  return {
    ...d,
    profiles: d.profiles.filter(keep),
    contacts: d.contacts.filter(keep),
    requirements: d.requirements.filter((r) => !sr.has(r.id)),
    properties: d.properties.filter(keep).map((x) => ({ ...x, owner_contact_id: c(x.owner_contact_id) })),
    photos: Object.fromEntries(Object.entries(d.photos).filter(([id]) => !sp.has(id))),
    opportunities: d.opportunities
      .filter((x) => keep(x) && !sc.has(x.contact_id))
      .map((x) => ({ ...x, property_id: p(x.property_id) })),
    activities: d.activities.filter(
      (x) => keep(x) && !(x.contact_id && sc.has(x.contact_id)) && !(x.property_id && sp.has(x.property_id)) && !(x.opportunity_id && so.has(x.opportunity_id)),
    ),
    events: d.events
      .filter(keep)
      .map((x) => ({ ...x, contact_id: c(x.contact_id), property_id: p(x.property_id), opportunity_id: o(x.opportunity_id) })),
    tasks: d.tasks.filter(keep).map((x) => ({ ...x, contact_id: c(x.contact_id) })),
    deals: d.deals
      .filter(keep)
      .map((x) => ({
        ...x,
        property_id: p(x.property_id),
        client_contact_id: c(x.client_contact_id),
        owner_contact_id: c(x.owner_contact_id),
        opportunity_id: o(x.opportunity_id),
      })),
    appOffers: d.appOffers.filter((x) => !x.is_sample && !sc.has(x.contact_id) && !sp.has(x.property_id)),
    reviewedMatches: d.reviewedMatches.filter(
      (id) => ![...sr].some((r) => id.startsWith(`match-${r}-`)) && ![...sp].some((pid) => id.endsWith(`-${pid}`)),
    ),
    followUpSnoozes: Object.fromEntries(Object.entries(d.followUpSnoozes).filter(([id]) => !sc.has(id))),
    samplesHidden: true,
  };
}

/** Hay algo de ejemplo a la vista. */
export function hasSamples(d: Pick<StoreData, "properties" | "contacts" | "opportunities" | "deals" | "events">): boolean {
  return [d.properties, d.contacts, d.opportunities, d.deals, d.events].some((rows) => rows.some((r) => r.is_sample));
}
