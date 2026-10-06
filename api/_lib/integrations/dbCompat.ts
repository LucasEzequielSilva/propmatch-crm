/**
 * Compatibilidad con la base ANTES de aplicar la migración
 * 20261006120000_integrations_multitenant (columnas auth_method, last_error,
 * last_checked_at en agency_integrations y connection_id en
 * property_publications).
 *
 * Si se deploya el código antes de aplicar el SQL, PostgREST responde
 *  - PGRST204 "Could not find the 'x' column … in the schema cache" (insert/update/upsert), o
 *  - 42703 "column x does not exist" (select / filtro).
 * En ese caso se reintenta sin las columnas nuevas y se recuerda (por proceso)
 * para no pagar dos requests cada vez. Nunca rompe producción.
 *
 * Archivo sin imports de runtime: lo usan las pruebas sin red.
 */

export interface DbError {
  code?: string | null;
  message?: string | null;
}

export function isMissingColumn(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("column") && (m.includes("does not exist") || m.includes("schema cache"));
}

/** Columnas nuevas de la migración. */
export const NEW_CONNECTION_COLUMNS = ["auth_method", "last_error", "last_checked_at"] as const;
export const NEW_PUBLICATION_COLUMNS = ["connection_id"] as const;

const missing = { connection: false, publication: false };

export function schemaFlags() {
  return { ...missing };
}

/** Solo para pruebas. */
export function resetSchemaFlags() {
  missing.connection = false;
  missing.publication = false;
}

export function markMissing(kind: "connection" | "publication") {
  missing[kind] = true;
}

/** Saca del objeto las columnas que la base todavía no tiene. */
export function stripNew<T extends Record<string, unknown>>(kind: "connection" | "publication", row: T): T {
  if (!missing[kind]) return row;
  const cols: readonly string[] = kind === "connection" ? NEW_CONNECTION_COLUMNS : NEW_PUBLICATION_COLUMNS;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!cols.includes(k)) out[k] = v;
  return out as T;
}

/**
 * Ejecuta una escritura con las columnas nuevas y, si la base no las tiene,
 * la repite sin ellas. `run` recibe la fila a escribir.
 */
export async function withOptionalColumns<R extends { error: DbError | null }>(
  kind: "connection" | "publication",
  row: Record<string, unknown>,
  run: (row: Record<string, unknown>) => PromiseLike<R>,
): Promise<R> {
  const first = await run(stripNew(kind, row));
  if (!first.error || !isMissingColumn(first.error) || missing[kind]) return first;
  markMissing(kind);
  return run(stripNew(kind, row));
}
