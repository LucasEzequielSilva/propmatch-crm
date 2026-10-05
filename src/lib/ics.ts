/**
 * Archivos .ics (RFC 5545), puro y sin DOM.
 *
 * Lo usan el Estudio de Instagram (un recordatorio por publicación) y la
 * Agenda (exportar todos los eventos visibles). Un .ics con varios VEVENT se
 * importa de una vez en Google Calendar, Apple Calendar u Outlook.
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
  startIso: string;
  /** Fin explícito. Si no viene, se usa `durationMin`. */
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
}

function vevent(e: IcsEvent, stamp: string): string[] {
  const start = new Date(e.startIso);
  const end = e.endIso ? new Date(e.endIso) : new Date(start.getTime() + (e.durationMin ?? 30) * MIN);
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}@propmatch`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
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
    ...events.flatMap((e) => vevent(e, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
