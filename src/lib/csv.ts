/**
 * Exportación a CSV.
 *
 * Separador `;` y BOM UTF-8 a propósito: es lo que Excel en español espera.
 * Con coma, Excel mete toda la fila en la columna A; sin BOM, se comen los
 * acentos.
 */

type Cell = string | number | null | undefined;

const SEPARATOR = ";";

function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Excel ejecuta como fórmula lo que empieza con = + - @ (o tab/CR). Un título
  // de propiedad como `=HYPERLINK(...)` se volvería un link al abrir el archivo.
  // Los números propios no se tocan: un -5 legítimo es un número, no texto.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  // Los números van con coma decimal, como el resto de la app.
  if (!/["\n;]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Convierte filas (la primera es el encabezado) en texto CSV. */
export function toCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(escapeCell).join(SEPARATOR)).join("\r\n");
}

/** Dispara la descarga del CSV en el navegador. */
export function downloadCsv(filename: string, rows: Cell[][]): void {
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** `reporte-propmatch-2026-09-16.csv` */
export function datedFilename(prefix: string, date = new Date()): string {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
  return `${prefix}-${stamp}.csv`;
}
