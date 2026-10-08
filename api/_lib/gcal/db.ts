/** Piezas comunes de acceso al Supabase PROPIO del CRM para Google Calendar. */

export const NO_DB_MESSAGE = "Falta configurar la base del CRM.";

/** La base no está configurada o falta aplicar la migración: la UI dice «Falta configurar la base del CRM». */
export class NoDb extends Error {}

/** Tabla sin crear (migración sin aplicar). */
export const missingTable = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? ""));
