/**
 * Programación y recordatorio: todo puro (sin React ni DOM) para poder probarlo.
 *
 * Honestidad de producto: PropMatch no tiene servidor que publique a la hora indicada y la API
 * de Instagram no programa por sí sola. Entonces «programar» = fijar fecha y hora + crear un
 * RECORDATORIO (evento de Agenda, notificación y archivo .ics). Publicar sigue siendo manual.
 */

import type { StoredStatus } from "./postStore";

export const AR_TZ = "America/Argentina/Buenos_Aires";
/** Argentina no usa horario de verano desde 2009: el offset es fijo (-03:00). */
const AR_OFFSET = "-03:00";
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Pasado este tiempo sin marcarla como publicada, la publicación pasa a «Vencida» (criterio de producto). */
export const OVERDUE_AFTER_MS = 24 * HOUR;
export const REMINDER_MINUTES_BEFORE = 15;
/** Duración del bloque en la Agenda (no es la duración de nada en Instagram). */
export const AGENDA_BLOCK_MIN = 30;

export type DerivedStatus = "draft" | "scheduled" | "ready" | "published" | "overdue";

export interface StatusInput {
  status: StoredStatus;
  scheduledAt: string | null;
}

export function derivedStatus(p: StatusInput, now: number = Date.now()): DerivedStatus {
  if (p.status === "published") return "published";
  if (p.status !== "scheduled" || !p.scheduledAt) return "draft";
  const at = new Date(p.scheduledAt).getTime();
  if (Number.isNaN(at)) return "draft";
  if (now < at) return "scheduled";
  return now - at >= OVERDUE_AFTER_MS ? "overdue" : "ready";
}

export const STATUS_META: Record<DerivedStatus, { label: string; bg: string; text: string; hint: string }> = {
  draft: { label: "Borrador", bg: "#F3F4F6", text: "#4B5563", hint: "Todavía sin fecha ni recordatorio." },
  scheduled: { label: "Programada", bg: "#EFF6FF", text: "#1D4ED8", hint: "Tiene fecha y un recordatorio en la Agenda." },
  ready: { label: "Lista para publicar", bg: "#FEF3C7", text: "#92400E", hint: "Llegó la hora: subila a Instagram y marcala como publicada." },
  published: { label: "Publicada", bg: "#DCFCE7", text: "#15803D", hint: "Marcada como publicada." },
  overdue: { label: "Vencida", bg: "#FFE4E6", text: "#BE123C", hint: "Pasó la hora y no se marcó como publicada. Reprogramala o marcala." },
};

/* ── Zona horaria Argentina ───────────────────────────────────────────────── */

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: AR_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `{ date: "2026-10-05", time: "10:00" }` en hora argentina. */
export function arParts(iso: string | number | Date): { date: string; time: string } {
  const m: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(new Date(iso))) m[p.type] = p.value;
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${m.hour}:${m.minute}` };
}

/** Fecha y hora argentinas -> instante ISO (UTC). `null` si no son válidas. */
export function arToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00${AR_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** «lun 5 oct, 10:00» en hora argentina. */
export function formatAr(iso: string | null): string {
  if (!iso) return "Sin fecha";
  return new Intl.DateTimeFormat("es-AR", { timeZone: AR_TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function addDaysAr(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00${AR_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return arParts(d).date;
}

/** 0 = domingo ... 6 = sábado, del día argentino `date`. */
export function weekdayAr(date: string): number {
  return new Date(`${date}T12:00:00${AR_OFFSET}`).getUTCDay();
}

export interface Shortcut {
  id: string;
  label: string;
  date: string;
  time: string;
}

/**
 * Atajos NEUTROS: no hay una referencia citada sobre «mejores horarios», por eso NO ofrecemos
 * un «próximo horario sugerido». La hora de mañana/lunes (10:00) es un valor de ejemplo editable.
 */
export function shortcuts(now: number = Date.now()): Shortcut[] {
  const today = arParts(now).date;
  const soon = arParts(now + HOUR);
  // Redondea a la media hora siguiente; si cruza de día, igual vale (es "en una hora").
  const [h, m] = soon.time.split(":").map(Number);
  const rounded = m === 0 ? soon.time : m <= 30 ? `${String(h).padStart(2, "0")}:30` : `${String((h + 1) % 24).padStart(2, "0")}:00`;
  const daysToMon = ((1 - weekdayAr(today) + 7) % 7) || 7;
  const list: Shortcut[] = [
    { id: "hoy", label: "Hoy, en una hora", date: soon.date, time: rounded },
    { id: "manana", label: "Mañana 10:00", date: addDaysAr(today, 1), time: "10:00" },
    { id: "lunes", label: "Próximo lunes 10:00", date: addDaysAr(today, daysToMon), time: "10:00" },
  ];
  // Si mañana ya es lunes, el tercer atajo repetiría al segundo.
  return list.filter((s, i) => i < 2 || s.date !== list[1].date);
}

/* ── .ics (RFC 5545) ──────────────────────────────────────────────────────── */

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Pliega líneas a 75 octetos (UTF-8) con CRLF + espacio, sin cortar un carácter por la mitad. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = "";
      bytes = 0;
      limit = 74; // la línea de continuación empieza con un espacio
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export interface IcsInput {
  uid: string;
  title: string;
  description?: string;
  startIso: string;
  durationMin?: number;
  alarmMinutes?: number;
  /** Para que la salida sea determinística en pruebas. */
  stampIso?: string;
}

/** Evento con recordatorio (VALARM) `alarmMinutes` antes. El celular lo avisa aunque la app esté cerrada. */
export function buildIcs(i: IcsInput): string {
  const start = new Date(i.startIso);
  const end = new Date(start.getTime() + (i.durationMin ?? AGENDA_BLOCK_MIN) * MIN);
  const alarm = i.alarmMinutes ?? REMINDER_MINUTES_BEFORE;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PropMatch//Estudio de Instagram//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${i.uid}@propmatch`,
    `DTSTAMP:${icsUtc(i.stampIso ? new Date(i.stampIso) : new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(i.title)}`,
    ...(i.description ? [`DESCRIPTION:${icsText(i.description)}`] : []),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(i.title)}`,
    `TRIGGER:-PT${alarm}M`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Evento de agenda que representa a la publicación. */
export function agendaTimes(startIso: string): { starts_at: string; ends_at: string } {
  return { starts_at: startIso, ends_at: new Date(new Date(startIso).getTime() + AGENDA_BLOCK_MIN * MIN).toISOString() };
}

/** `true` si el instante ya pasó (no se puede programar «para el pasado»). */
export const isPast = (iso: string, now: number = Date.now()) => new Date(iso).getTime() <= now;
