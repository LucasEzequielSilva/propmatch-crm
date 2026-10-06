/**
 * Montos en letras y fechas largas para los documentos de operaciones.
 * (Antes vivían en deals.ts; deals.ts los sigue exportando.)
 */
import { parseLocalDate } from "@/lib/authorization";

const UNITS = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
  "veintisiete", "veintiocho", "veintinueve",
];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = [
  "", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos",
  "seiscientos", "setecientos", "ochocientos", "novecientos",
];

function below1000(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r < 30) {
    if (r) parts.push(UNITS[r]);
  } else {
    const t = Math.floor(r / 10);
    const u = r % 10;
    parts.push(u ? `${TENS[t]} y ${UNITS[u]}` : TENS[t]);
  }
  return parts.join(" ");
}

/** 185000 -> "ciento ochenta y cinco mil". */
export function numberToWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? "un millón" : `${below1000(millions).replace(/uno$/, "ún")} millones`);
  if (thousands) parts.push(thousands === 1 ? "mil" : `${below1000(thousands).replace(/uno$/, "ún")} mil`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

const CURRENCY_WORDS = { USD: "dólares estadounidenses", ARS: "pesos argentinos" } as const;

/** "USD 185.000 (dólares estadounidenses ciento ochenta y cinco mil)" */
export function amountInWords(amount: number | null, currency: "USD" | "ARS"): string {
  if (amount === null || amount === undefined) return "________________";
  const n = Math.round(amount).toLocaleString("es-AR");
  return `${currency} ${n} (${CURRENCY_WORDS[currency]} ${numberToWords(amount)})`;
}

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function longDate(value: string | Date | null | undefined): string {
  if (!value) return "____ de ____________ de ______";
  const d = typeof value === "string" ? parseLocalDate(value) : value;
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "15/10/2026" */
export function numericDate(value: string | null | undefined): string {
  if (!value) return "__/__/____";
  const d = parseLocalDate(value);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
