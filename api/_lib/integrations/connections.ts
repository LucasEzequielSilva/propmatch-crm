/**
 * Lectura y marcas de la conexión (agency_integrations) de UNA agencia.
 * Siempre filtra por agency_id del usuario autenticado. Nunca selecciona las
 * columnas de tokens/credenciales.
 */
import { supabaseAdmin } from "../supabaseAdmin.js";
import { isMissingColumn, markMissing, schemaFlags, withOptionalColumns, type DbError } from "./dbCompat.js";
import type { AuthMethod, Availability, ConnectionStatus, PortalId } from "./types.js";

export interface ConnectionRow {
  id: string;
  status: string;
  account_label: string | null;
  created_at: string | null;
  auth_method?: AuthMethod | null;
  last_error?: string | null;
  last_checked_at?: string | null;
}

const BASE = "id, status, account_label, created_at";
const FULL = `${BASE}, auth_method, last_error, last_checked_at`;

export async function readConnection(agencyId: string, provider: string): Promise<ConnectionRow | null> {
  const db = supabaseAdmin();
  const q = (cols: string) =>
    db.from("agency_integrations").select(cols).eq("agency_id", agencyId).eq("provider", provider).maybeSingle();
  if (!schemaFlags().connection) {
    const { data, error } = await q(FULL);
    if (!error) return (data as ConnectionRow | null) ?? null;
    if (!isMissingColumn(error)) return null; // tabla inexistente u otro fallo: "no conectado"
    markMissing("connection");
  }
  const { data, error } = await q(BASE);
  return error ? null : ((data as ConnectionRow | null) ?? null);
}

/** Guarda el último error legible (o lo limpia con null). Sin la migración, no hace nada. */
export async function recordConnectionCheck(agencyId: string, provider: string, lastError: string | null): Promise<void> {
  if (schemaFlags().connection) return;
  const db = supabaseAdmin();
  await withOptionalColumns(
    "connection",
    { last_error: lastError, last_checked_at: new Date().toISOString() },
    async (row): Promise<{ error: DbError | null }> => {
      if (Object.keys(row).length === 0) return { error: null };
      const { error } = await db.from("agency_integrations").update(row).eq("agency_id", agencyId).eq("provider", provider);
      return { error };
    },
  ).catch(() => undefined);
}

/** Fila → estado para Configuración → Integraciones. */
export function toConnectionStatus(
  portal: PortalId,
  authMethod: AuthMethod,
  availability: Availability,
  row: ConnectionRow | null,
): ConnectionStatus {
  const state: ConnectionStatus["state"] =
    availability.state === "coming_soon" && !row
      ? "unavailable"
      : !row
        ? "not_connected"
        : row.status === "connected"
          ? "connected"
          : row.status === "needs_reauth"
            ? "needs_reauth"
            : "error";
  return {
    portal,
    state,
    accountLabel: row?.account_label ?? null,
    connectedAt: row?.created_at ?? null,
    lastError: row?.last_error ?? null,
    lastCheckedAt: row?.last_checked_at ?? null,
    authMethod: (row?.auth_method as AuthMethod | undefined) ?? authMethod,
    availability,
  };
}
