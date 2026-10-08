/**
 * Google Calendar ↔ Agenda del CRM: piezas PURAS (sin red, sin DOM, sin
 * imports). Se usan desde el navegador (src/lib/gcal), desde el servidor
 * (api/_lib/gcal) y desde las pruebas (scripts/gcal.test.ts).
 *
 * Modelo (ver docs/google-calendar.md):
 *   - Cada agente conecta SU cuenta de Google. PropMatch escribe en su
 *     calendario principal ("primary").
 *   - CRM → Google: cada evento / visita / tarea con fecha del agente se manda
 *     como un evento de Google con un id DETERMINÍSTICO (mismo ítem del CRM =
 *     mismo id de Google, siempre) y `extendedProperties.private.propmatchId`.
 *     Reintentar o mandar dos veces no duplica nada.
 *   - Google → CRM: los cambios de horario y los borrados de esos eventos
 *     vuelven al CRM; gana el último cambio. Los demás eventos del agente se
 *     muestran como «Ocupado» y no se guardan en el CRM.
 */

import type { IcsEvent } from "./ics.js";

/* ── Constantes ───────────────────────────────────────────────────────────── */

export const GCAL_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
/** Scope mínimo: eventos del calendario + quién es (email). Nada de Gmail, Drive ni contactos. */
export const GCAL_SCOPES = ["openid", "email", GCAL_EVENTS_SCOPE] as const;

/** Tipos de ítem del CRM que se mandan a Google. `visit` = visita pedida desde la app (solo lectura en el CRM). */
export type GcalKind = "event" | "task" | "visit";

export const MAX_UPSERT_ITEMS = 10;
export const MAX_DELETE_ITEMS = 20;
/** Ventana máxima que se puede pedir de «Ocupado» en un pull. */
export const MAX_BUSY_RANGE_DAYS = 70;
/** Un evento del CRM no dura más que esto (corta datos rotos). */
const MAX_EVENT_DAYS = 14;

const DAY_MS = 86_400_000;

/* ── Ids ──────────────────────────────────────────────────────────────────── */

const PM_ID = /^(event|task|visit):[A-Za-z0-9_-]{1,80}$/;

export function isPropmatchId(v: unknown): v is string {
  return typeof v === "string" && PM_ID.test(v);
}

export function propmatchId(kind: GcalKind, id: string): string {
  return `${kind}:${id}`;
}

export function splitPropmatchId(pmId: string): { kind: GcalKind; id: string } | null {
  if (!isPropmatchId(pmId)) return null;
  const i = pmId.indexOf(":");
  return { kind: pmId.slice(0, i) as GcalKind, id: pmId.slice(i + 1) };
}

/** Alfabeto de los ids de eventos de Google: base32hex en minúscula (a–v, 0–9). */
const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/**
 * Id de evento de Google a partir de un digest (sha256 de `<usuario>:<propmatchId>`,
 * lo calcula el servidor). Google acepta ids propios de 5 a 1024 caracteres
 * de [a-v0-9]: con uno fijo por ítem, insertar dos veces da 409 en vez de un
 * duplicado.
 */
export function googleEventIdFromDigest(digest: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "pm";
  for (const byte of digest.slice(0, 20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32HEX[(value << (5 - bits)) & 31];
  return out;
}

export function isGoogleEventId(v: unknown): v is string {
  return typeof v === "string" && /^[a-v0-9]{5,1024}$/.test(v);
}

/* ── Fechas ───────────────────────────────────────────────────────────────── */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isDateOnly = (s: string) => DATE_ONLY.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function isoOrNull(s: unknown): string | null {
  if (typeof s !== "string" || s.length > 40) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** "2026-10-08" + n días (en UTC: solo aritmética de calendario). */
export function addDaysToDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export interface GcalTimes {
  allDay: boolean;
  /** ISO (UTC) o, si es de día completo, "YYYY-MM-DD". */
  start: string;
  /** Exclusivo. Igual formato que `start`. */
  end: string;
}

export function sameTimes(a: GcalTimes | null | undefined, b: GcalTimes | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.allDay !== b.allDay) return false;
  if (a.allDay) return a.start === b.start && a.end === b.end;
  return Date.parse(a.start) === Date.parse(b.start) && Date.parse(a.end) === Date.parse(b.end);
}

/* ── Lo que el navegador manda (datos mínimos) ────────────────────────────── */

/**
 * Un ítem del CRM tal como viaja a /api/integrations/gcal-upsert. SOLO lo
 * necesario para el evento: nada de precios, notas internas, teléfonos ni ids
 * de la base. El link al CRM lo arma el servidor (no se acepta del cliente).
 */
export interface GcalItem extends GcalTimes {
  propmatchId: string;
  title: string;
  /** "Visita · Confirmada", "Llamada", "Tarea"… */
  typeLabel: string | null;
  contactName: string | null;
  propertyTitle: string | null;
  /** Dirección de la propiedad (va en «Ubicación»). */
  location: string | null;
}

export interface GcalUpsertRequestItem extends GcalItem {
  /** Último cambio del ítem en el CRM (ISO). Para «gana el último cambio». */
  crmUpdatedAt: string;
  /** Horario que este navegador mandó la última vez (null = nunca). */
  known: GcalTimes | null;
}

const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  // Sin caracteres de control (salvo nada: todo en una línea).
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

export function parseTimes(raw: unknown): GcalTimes | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.start !== "string" || typeof r.end !== "string") return null;
  if (r.allDay === true) {
    if (!isDateOnly(r.start) || !isDateOnly(r.end) || r.end <= r.start) return null;
    if (Date.parse(r.end) - Date.parse(r.start) > MAX_EVENT_DAYS * DAY_MS) return null;
    return { allDay: true, start: r.start, end: r.end };
  }
  const s = isoOrNull(r.start);
  const e = isoOrNull(r.end);
  if (!s || !e) return null;
  const span = Date.parse(e) - Date.parse(s);
  if (span <= 0 || span > MAX_EVENT_DAYS * DAY_MS) return null;
  return { allDay: false, start: s, end: e };
}

/** Valida los datos de un ítem (sin los campos de sincronización). */
export function parseItem(raw: unknown): GcalItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isPropmatchId(r.propmatchId)) return null;
  const times = parseTimes(r);
  if (!times) return null;
  const title = cleanText(r.title, 200);
  if (!title) return null;
  return {
    propmatchId: r.propmatchId,
    ...times,
    title,
    typeLabel: cleanText(r.typeLabel, 60),
    contactName: cleanText(r.contactName, 120),
    propertyTitle: cleanText(r.propertyTitle, 160),
    location: cleanText(r.location, 300),
  };
}

/** Valida un ítem del pedido de gcal-upsert. Devuelve null si algo no cierra. */
export function parseUpsertItem(raw: unknown): GcalUpsertRequestItem | null {
  const item = parseItem(raw);
  if (!item) return null;
  const r = raw as Record<string, unknown>;
  const crmUpdatedAt = isoOrNull(r.crmUpdatedAt);
  if (!crmUpdatedAt) return null;
  const known = r.known == null ? null : parseTimes(r.known);
  if (r.known != null && !known) return null;
  return { ...item, crmUpdatedAt, known };
}

export function parseUpsertBody(body: unknown): GcalUpsertRequestItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_UPSERT_ITEMS) return null;
  const out: GcalUpsertRequestItem[] = [];
  for (const it of items) {
    const p = parseUpsertItem(it);
    if (!p) return null;
    out.push(p);
  }
  return new Set(out.map((i) => i.propmatchId)).size === out.length ? out : null;
}

export function parseDeleteBody(body: unknown): string[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_DELETE_ITEMS) return null;
  const ids = items.map((i) => (i && typeof i === "object" ? (i as { propmatchId?: unknown }).propmatchId : i));
  return ids.every(isPropmatchId) ? [...new Set(ids as string[])] : null;
}

export interface PullRequest {
  syncToken: string | null;
  pageToken: string | null;
  /** Ventana de «Ocupado» (null = no traerlos). */
  busy: { timeMin: string; timeMax: string } | null;
  titles: boolean;
}

export function parsePullBody(body: unknown): PullRequest | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const token = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 2048 && /^[\w\-.~+/=]+$/.test(v) ? v : null);
  if (b.syncToken != null && !token(b.syncToken)) return null;
  if (b.pageToken != null && !token(b.pageToken)) return null;
  let busy: PullRequest["busy"] = null;
  if (b.busy != null) {
    const r = b.busy as Record<string, unknown>;
    const a = isoOrNull(r?.timeMin);
    const z = isoOrNull(r?.timeMax);
    if (!a || !z || z <= a || Date.parse(z) - Date.parse(a) > MAX_BUSY_RANGE_DAYS * DAY_MS) return null;
    busy = { timeMin: a, timeMax: z };
  }
  return { syncToken: token(b.syncToken), pageToken: token(b.pageToken), busy, titles: b.titles === true };
}

/* ── CRM → cuerpo del evento de Google ────────────────────────────────────── */

export interface GoogleEventBody {
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string };
  end: { date: string } | { dateTime: string };
  status: "confirmed";
  transparency: "opaque" | "transparent";
  extendedProperties: { private: { propmatchId: string; propmatchKind: GcalKind } };
  source: { title: string; url: string };
  reminders: { useDefault: true };
}

/** Texto del evento: tipo, cliente, propiedad, dirección y link al CRM. Nada confidencial. */
export function itemDescription(item: GcalItem, link: string, footer: string): string {
  return [
    item.typeLabel,
    item.contactName ? `Cliente: ${item.contactName}` : null,
    item.propertyTitle ? `Propiedad: ${item.propertyTitle}` : null,
    item.location ? `Dirección: ${item.location}` : null,
    "",
    `Ver en PropMatch: ${link}`,
    footer,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function buildGoogleEvent(item: GcalItem, opts: { googleEventId: string; appUrl: string }): GoogleEventBody {
  const base = opts.appUrl.replace(/\/+$/, "");
  const link = `${base}/agenda`;
  const kind = splitPropmatchId(item.propmatchId)?.kind ?? "event";
  const description = itemDescription(
    item,
    link,
    "Creado desde PropMatch CRM. Si cambiás el horario o lo borrás acá, también cambia en el CRM.",
  );
  const when = (v: string) => (item.allDay ? { date: v } : { dateTime: v });
  return {
    id: opts.googleEventId,
    summary: item.title,
    description,
    ...(item.location ? { location: item.location } : {}),
    start: when(item.start),
    end: when(item.end),
    status: "confirmed",
    // Las tareas (día completo) no marcan al agente como ocupado todo el día.
    transparency: item.allDay ? "transparent" : "opaque",
    extendedProperties: { private: { propmatchId: item.propmatchId, propmatchKind: kind } },
    source: { title: "PropMatch CRM", url: link },
    reminders: { useDefault: true },
  };
}

/* ── Google → forma interna ───────────────────────────────────────────────── */

/** Lo que nos importa de un evento de la API de Google. */
export interface GoogleEventLite extends Partial<GcalTimes> {
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  /** ISO de la última modificación en Google. */
  updated: string | null;
  summary: string | null;
  transparent: boolean;
  declined: boolean;
  propmatchId: string | null;
}

function parseWhen(v: unknown): { allDay: boolean; value: string } | null {
  if (!v || typeof v !== "object") return null;
  const w = v as { date?: unknown; dateTime?: unknown };
  if (typeof w.dateTime === "string") {
    const iso = isoOrNull(w.dateTime);
    return iso ? { allDay: false, value: iso } : null;
  }
  if (typeof w.date === "string" && isDateOnly(w.date)) return { allDay: true, value: w.date };
  return null;
}

export function parseGoogleEvent(raw: unknown): GoogleEventLite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  const status = r.status === "cancelled" ? "cancelled" : r.status === "tentative" ? "tentative" : "confirmed";
  const priv = (r.extendedProperties as { private?: Record<string, unknown> } | undefined)?.private;
  const pm = isPropmatchId(priv?.propmatchId) ? (priv!.propmatchId as string) : null;
  const attendees = Array.isArray(r.attendees) ? (r.attendees as { self?: unknown; responseStatus?: unknown }[]) : [];
  const out: GoogleEventLite = {
    id: r.id,
    status,
    updated: isoOrNull(r.updated),
    summary: typeof r.summary === "string" ? r.summary.slice(0, 200) : null,
    transparent: r.transparency === "transparent",
    declined: attendees.some((a) => a && a.self === true && a.responseStatus === "declined"),
    propmatchId: pm,
  };
  const s = parseWhen(r.start);
  const e = parseWhen(r.end);
  if (s && e && s.allDay === e.allDay) {
    out.allDay = s.allDay;
    out.start = s.value;
    out.end = e.value;
  }
  return out;
}

export const timesOf = (g: GoogleEventLite): GcalTimes | null =>
  g.start && g.end && g.allDay !== undefined ? { allDay: g.allDay, start: g.start, end: g.end } : null;

/** Cambio de un evento creado por PropMatch, tal como vuelve en el pull. */
export interface GcalChange {
  googleEventId: string;
  /** Puede faltar en los borrados: Google solo manda id + status. El navegador lo busca por id. */
  propmatchId: string | null;
  cancelled: boolean;
  times: GcalTimes | null;
  updated: string | null;
}

/** Bloque «Ocupado» (evento de Google que no es de PropMatch). */
export interface GcalBusy extends GcalTimes {
  id: string;
  /** null si el agente eligió no ver títulos. */
  title: string | null;
}

/**
 * De una página del listado incremental (syncToken), los cambios que importan
 * al CRM: los eventos de PropMatch y todos los borrados (que llegan sin
 * extendedProperties; el navegador sabe cuáles son suyos).
 */
export function changesFromItems(items: unknown[]): GcalChange[] {
  const out: GcalChange[] = [];
  for (const raw of items) {
    const g = parseGoogleEvent(raw);
    if (!g) continue;
    if (g.status === "cancelled") {
      out.push({ googleEventId: g.id, propmatchId: g.propmatchId, cancelled: true, times: null, updated: g.updated });
    } else if (g.propmatchId) {
      out.push({ googleEventId: g.id, propmatchId: g.propmatchId, cancelled: false, times: timesOf(g), updated: g.updated });
    }
  }
  return out;
}

/** Eventos ajenos a PropMatch que ocupan al agente. */
export function busyFromItems(items: unknown[], opts: { titles: boolean }): GcalBusy[] {
  const out: GcalBusy[] = [];
  for (const raw of items) {
    const g = parseGoogleEvent(raw);
    if (!g || g.propmatchId || g.status === "cancelled" || g.transparent || g.declined) continue;
    const t = timesOf(g);
    if (!t) continue;
    out.push({ id: g.id, ...t, title: opts.titles ? g.summary || "Ocupado" : null });
  }
  return out;
}

/* ── Conflictos: gana el último cambio ────────────────────────────────────── */

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/** true si el cambio de Google es POSTERIOR al último cambio en el CRM. Empate o fechas inválidas → gana el CRM. */
export function googleWins(googleUpdated: string | null, crmUpdatedAt: string | null): boolean {
  const g = ms(googleUpdated);
  const c = ms(crmUpdatedAt);
  if (Number.isNaN(g)) return false;
  if (Number.isNaN(c)) return true;
  return g > c;
}

export type UpsertConflict = "none" | "google_changed" | "google_deleted";

/**
 * Antes de pisar un evento existente en Google: ¿alguien lo cambió allá
 * (horario distinto del que mandamos la última vez, o lo borró) DESPUÉS del
 * último cambio en el CRM? Si sí, no se pisa: se devuelve el conflicto y el
 * navegador aplica lo de Google. Si no lo conocíamos (`known` null), se pisa.
 */
export function detectConflict(input: {
  google: GoogleEventLite | null;
  known: GcalTimes | null;
  crmUpdatedAt: string;
}): UpsertConflict {
  const { google, known } = input;
  if (!google || !known) return "none";
  const deleted = google.status === "cancelled";
  const moved = !deleted && !sameTimes(timesOf(google), known);
  if (!deleted && !moved) return "none";
  if (!googleWins(google.updated, input.crmUpdatedAt)) return "none";
  return deleted ? "google_deleted" : "google_changed";
}

/** Estado local de un ítem al procesar un cambio que vino de Google. */
export interface LocalForPull {
  exists: boolean;
  kind: GcalKind;
  times: GcalTimes | null;
  crmUpdatedAt: string | null;
  /** Lo que se mandó por última vez (null = este navegador nunca lo mandó). */
  pushed: { times: GcalTimes; hash: string } | null;
  currentHash: string | null;
}

export type PullAction =
  /** Nada que hacer (eco de nuestro propio cambio, o no es nuestro). */
  | "ignore"
  /** Aplicar el horario de Google al CRM. */
  | "apply_times"
  /** Borrado en Google → en el CRM: visita cancelada / evento borrado. */
  | "apply_delete"
  /** Borrado en Google de algo que el CRM no puede borrar (tarea, visita de la app): se deja de sincronizar. */
  | "unlink"
  /** El CRM cambió después: se vuelve a mandar lo del CRM. */
  | "push";

export function decidePullAction(change: GcalChange, local: LocalForPull): PullAction {
  if (!local.exists || !local.pushed) return "ignore";
  const crmChangedSincePush = local.currentHash !== null && local.currentHash !== local.pushed.hash;
  const crmIsNewer = crmChangedSincePush && !googleWins(change.updated, local.crmUpdatedAt);

  if (change.cancelled) {
    if (crmIsNewer) return "push";
    return local.kind === "event" ? "apply_delete" : "unlink";
  }
  const g = change.times;
  if (!g) return "ignore";
  if (sameTimes(g, local.times)) return "ignore";
  // Google sigue con lo último que mandamos: el CRM cambió y el push está en camino.
  if (sameTimes(g, local.pushed.times)) return "ignore";
  // Las visitas de la app se gestionan en la app: Google no las puede mover.
  if (local.kind === "visit") return "push";
  if (crmIsNewer) return "push";
  return "apply_times";
}

/* ── Hash de cambios (para no reenviar lo mismo) ──────────────────────────── */

/** FNV-1a de 32 bits, en hex. No es criptográfico: solo detecta cambios. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function itemHash(i: GcalItem): string {
  return fnv1a(
    JSON.stringify([i.propmatchId, i.title, i.allDay, i.start, i.end, i.typeLabel, i.contactName, i.propertyTitle, i.location]),
  );
}

/* ── Ítems del CRM → GcalItem ─────────────────────────────────────────────── */

type EventTypeLike = "visita" | "llamada" | "reunion" | "seguimiento" | "publicacion";

const TYPE_LABEL: Record<EventTypeLike, string> = {
  visita: "Visita",
  llamada: "Llamada",
  reunion: "Reunión",
  seguimiento: "Seguimiento",
  publicacion: "Publicación",
};

const VISIT_STATUS_LABEL: Record<string, string> = {
  por_confirmar: "Por confirmar",
  confirmada: "Confirmada",
  realizada: "Realizada",
  reprogramada: "Reprogramada",
  no_show: "No vino",
  cancelada: "Cancelada",
};

export interface CrmEventLike {
  id: string;
  type: EventTypeLike;
  title: string;
  owner_id: string | null;
  starts_at: string;
  ends_at: string;
  status?: string;
  created_at: string;
  updated_at?: string;
  is_sample?: boolean;
}

export interface CrmTaskLike {
  id: string;
  text: string;
  owner_id: string | null;
  due_date: string | null;
  is_done: boolean;
  created_at: string;
  updated_at?: string;
  is_sample?: boolean;
}

export interface CrmVisitLike {
  id: string;
  title: string;
  start: Date;
  end: Date;
  ownerId: string | null;
  statusLabel: string | null;
  cancelled: boolean;
}

export interface ItemContext {
  contactName: string | null;
  propertyTitle: string | null;
  address: string | null;
}

/** ¿Este evento del CRM va al Google del usuario? Ejemplos nunca; cancelados tampoco (se borran de Google). */
export function eventIsSyncable(e: CrmEventLike, userId: string): boolean {
  if (e.is_sample) return false;
  if (e.owner_id !== null && e.owner_id !== userId) return false;
  if (e.type === "visita" && e.status === "cancelada") return false;
  return parseTimes({ allDay: false, start: e.starts_at, end: e.ends_at }) !== null;
}

export function taskIsSyncable(t: CrmTaskLike, userId: string): boolean {
  if (t.is_sample || t.is_done || !t.due_date) return false;
  if (t.owner_id !== null && t.owner_id !== userId) return false;
  return isDateOnly(t.due_date.slice(0, 10));
}

export function visitIsSyncable(v: CrmVisitLike, userId: string): boolean {
  return !v.cancelled && v.ownerId === userId && v.end > v.start;
}

export function eventToItem(e: CrmEventLike, ctx: ItemContext): GcalItem {
  const status = e.type === "visita" ? VISIT_STATUS_LABEL[e.status ?? "por_confirmar"] : null;
  return {
    propmatchId: propmatchId("event", e.id),
    title: e.title,
    allDay: false,
    start: new Date(e.starts_at).toISOString(),
    end: new Date(e.ends_at).toISOString(),
    typeLabel: [TYPE_LABEL[e.type] ?? null, status].filter(Boolean).join(" · ") || null,
    contactName: ctx.contactName,
    propertyTitle: ctx.propertyTitle,
    location: ctx.address,
  };
}

export function taskToItem(t: CrmTaskLike, ctx: ItemContext): GcalItem {
  const day = (t.due_date ?? "").slice(0, 10);
  return {
    propmatchId: propmatchId("task", t.id),
    title: `Tarea: ${t.text}`,
    allDay: true,
    start: day,
    end: addDaysToDate(day, 1),
    typeLabel: "Tarea",
    contactName: ctx.contactName,
    propertyTitle: null,
    location: null,
  };
}

export function visitToItem(v: CrmVisitLike, ctx: ItemContext): GcalItem {
  return {
    propmatchId: propmatchId("visit", v.id),
    title: v.title,
    allDay: false,
    start: v.start.toISOString(),
    end: v.end.toISOString(),
    typeLabel: ["Visita pedida desde la app", v.statusLabel].filter(Boolean).join(" · "),
    contactName: ctx.contactName,
    propertyTitle: ctx.propertyTitle,
    location: ctx.address,
  };
}

/** Lo que vuelve de Google para un evento o una tarea, en campos del CRM. */
export function crmPatchFromTimes(kind: GcalKind, t: GcalTimes): { starts_at: string; ends_at: string } | { due_date: string } | null {
  if (kind === "task") return t.allDay ? { due_date: t.start } : { due_date: new Date(t.start).toISOString().slice(0, 10) };
  if (kind === "event" && !t.allDay) return { starts_at: t.start, ends_at: t.end };
  // Un evento con horario que pasaron a «todo el día» en Google: se mantiene el horario del CRM.
  return null;
}

/* ── Vuelta del OAuth ─────────────────────────────────────────────────────── */

export const GCAL_RETURN_TARGETS = {
  agenda: "/agenda",
  integraciones: "/configuracion/integraciones",
} as const;

export type GcalReturnTarget = keyof typeof GCAL_RETURN_TARGETS;

export function parseGcalReturn(v: unknown): GcalReturnTarget {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(GCAL_RETURN_TARGETS, v) ? (v as GcalReturnTarget) : "agenda";
}

/** Siempre APP_URL + un path fijo de la lista: no hay redirección abierta. */
export function buildGcalReturnUrl(appUrl: string, target: unknown, reason?: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const path = GCAL_RETURN_TARGETS[parseGcalReturn(target)];
  if (!reason) return `${base}${path}?gcal=ok`;
  const safe = /^[a-z_]{1,32}$/.test(reason) ? reason : "server";
  return `${base}${path}?gcal=error&reason=${safe}`;
}

/** Email del id_token (vino directo del endpoint de tokens de Google por TLS: no hace falta verificar firma). */
export function emailFromIdToken(idToken: unknown): { email: string | null; sub: string | null } {
  if (typeof idToken !== "string") return { email: null, sub: null };
  const parts = idToken.split(".");
  if (parts.length !== 3) return { email: null, sub: null };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(
      typeof atob === "function" ? decodeURIComponent(escape(atob(b64))) : "",
    ) as { email?: unknown; sub?: unknown };
    return {
      email: typeof json.email === "string" ? json.email.slice(0, 254) : null,
      sub: typeof json.sub === "string" ? json.sub.slice(0, 64) : null,
    };
  } catch {
    return { email: null, sub: null };
  }
}

/** ¿Google dio el permiso del calendario? (En la pantalla de consentimiento se puede destildar.) */
export function grantedCalendarScope(scope: unknown): boolean {
  return typeof scope === "string" && scope.split(/\s+/).includes(GCAL_EVENTS_SCOPE);
}

/* ── Opción B: link de suscripción (.ics) por agente ──────────────────────── */

/** Lo que entra en el link: desde 30 días atrás hasta 6 meses adelante. */
export const FEED_PAST_DAYS = 30;
export const FEED_FUTURE_DAYS = 183;
export const FEED_MAX_ITEMS = 500;
/** Tope del cuerpo de gcal-feed-push (JSON), en caracteres. */
export const FEED_MAX_BODY_CHARS = 400_000;
/** Mínimo entre dos gcal-feed-push del mismo agente (rate limit). */
export const FEED_MIN_PUSH_SECONDS = 5;

/** Token del link: 32 bytes aleatorios en base64url (43 caracteres). */
export function isFeedToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** "<token>.ics" (último segmento del path) → token, o null. */
export function feedTokenFromFile(file: unknown): string | null {
  const f = Array.isArray(file) ? file[0] : file;
  if (typeof f !== "string") return null;
  const m = /^([A-Za-z0-9_-]{43})\.ics$/.exec(f);
  return m ? m[1] : null;
}

/** ¿Cae en la ventana del link? Por el FIN (un evento en curso sigue). */
export function inFeedWindow(t: GcalTimes, now: Date): boolean {
  const end = t.allDay ? Date.parse(`${t.end}T00:00:00Z`) : Date.parse(t.end);
  const start = t.allDay ? Date.parse(`${t.start}T00:00:00Z`) : Date.parse(t.start);
  return end >= now.getTime() - FEED_PAST_DAYS * DAY_MS && start <= now.getTime() + FEED_FUTURE_DAYS * DAY_MS;
}

/**
 * Valida el snapshot que manda el navegador. Lo que no cierra se descarta
 * (no se rechaza todo por un ítem roto); fuera de ventana, también. Más de
 * FEED_MAX_ITEMS o un cuerpo que no es una lista → null.
 */
export function parseFeedBody(body: unknown, now: Date): GcalItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length > FEED_MAX_ITEMS) return null;
  const seen = new Set<string>();
  const out: GcalItem[] = [];
  for (const raw of items) {
    const it = parseItem(raw);
    if (!it || seen.has(it.propmatchId) || !inFeedWindow(it, now)) continue;
    seen.add(it.propmatchId);
    out.push(it);
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** UID estable por ítem del CRM: Google actualiza el evento en vez de duplicarlo. */
export const feedUid = (pmId: string) => `pm-${pmId.replace(":", "-")}`;

/** Ítems guardados → eventos .ics (se arman en el servidor; el navegador no manda texto .ics). */
export function feedIcsEvents(items: GcalItem[], appUrl: string): IcsEvent[] {
  const link = `${appUrl.replace(/\/+$/, "")}/agenda`;
  return items.map((i) => ({
    uid: feedUid(i.propmatchId),
    title: i.title,
    description: itemDescription(i, link, "Calendario de PropMatch CRM (solo lectura). Los cambios se hacen en el CRM."),
    location: i.location ?? undefined,
    allDay: i.allDay,
    startIso: i.start,
    endIso: i.end,
  }));
}
