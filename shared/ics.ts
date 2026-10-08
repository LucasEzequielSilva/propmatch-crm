/**
 * Archivos .ics (RFC 5545), puro y sin DOM.
 *
 * Lo usan el Estudio de Instagram (un recordatorio por publicación), la
 * Agenda (exportar todos los eventos visibles) y el servidor (link de
 * suscripción por agente, api/_lib/gcal/feed.ts). Un .ics con varios VEVENT se
 * importa de una vez en Google Calendar, Apple Calendar u Outlook.
 *
 * Vive en shared/ para poder usarse desde src/ y desde api/ (sin imports).
 */

const MIN = 60_000;

/** Escapa texto según RFC 5545 (barra, punto y coma, coma y saltos de línea). */
export const icsText = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** `20261005T140000Z` */
export const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

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

export interface IcsEvent {
  /** Único y estable: el mismo evento reimportado se actualiza en vez de duplicarse. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  /** ISO con hora; o "YYYY-MM-DD" si `allDay`. */
  startIso: string;
  /** Evento de día completo (DTSTART;VALUE=DATE). `endIso` es exclusivo ("YYYY-MM-DD"). */
  allDay?: boolean;
  /** Fin explícito. Si no viene, se usa `durationMin` (o un día si `allDay`). */
  endIso?: string;
  durationMin?: number;
  /** Minutos antes para el aviso (VALARM). Sin definir = sin aviso. */
  alarmMinutes?: number;
}

export interface IcsCalendarOptions {
  /** Producto que figura en PRODID. */
  product?: string;
  /** Para que la salida sea determinística en pruebas. */
  stampIso?: string;
  /** Nombre del calendario al suscribirse (X-WR-CALNAME). */
  name?: string;
  /** Sugerencia de cada cuánto volver a pedirlo, en minutos (REFRESH-INTERVAL / X-PUBLISHED-TTL). */
  refreshMinutes?: number;
}

const icsDate = (d: string) => d.replace(/-/g, "");

function nextDay(d: string): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function vevent(e: IcsEvent, stamp: string): string[] {
  let when: string[];
  if (e.allDay) {
    const s = e.startIso.slice(0, 10);
    when = [`DTSTART;VALUE=DATE:${icsDate(s)}`, `DTEND;VALUE=DATE:${icsDate(e.endIso ? e.endIso.slice(0, 10) : nextDay(s))}`, "TRANSP:TRANSPARENT"];
  } else {
    const start = new Date(e.startIso);
    const end = e.endIso ? new Date(e.endIso) : new Date(start.getTime() + (e.durationMin ?? 30) * MIN);
    when = [`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`];
  }
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}@propmatch`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.alarmMinutes !== undefined
      ? [
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsText(e.title)}`,
        `TRIGGER:-PT${e.alarmMinutes}M`,
        "END:VALARM",
      ]
      : []),
    "END:VEVENT",
  ];
}

/** Calendario con uno o varios eventos. */
export function buildIcsCalendar(events: IcsEvent[], opts: IcsCalendarOptions = {}): string {
  const stamp = icsUtc(opts.stampIso ? new Date(opts.stampIso) : new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//PropMatch//${opts.product ?? "CRM"}//ES`,
    "CALSCALE:GREGORIAN",
    ...(opts.name ? ["METHOD:PUBLISH", `X-WR-CALNAME:${icsText(opts.name)}`] : []),
    ...(opts.refreshMinutes
      ? [`REFRESH-INTERVAL;VALUE=DURATION:PT${opts.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${opts.refreshMinutes}M`]
      : []),
    ...events.flatMap((e) => vevent(e, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
