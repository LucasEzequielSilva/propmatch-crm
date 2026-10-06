/**
 * ArgenpropAdapter: conexión por CREDENCIALES emitidas por Argenprop
 * (auth_method = 'credentials'), cifradas igual que los tokens OAuth.
 *
 * Estado: la publicación NO está disponible. Argenprop no publica su API; la
 * especificación (API de Publicación de Avisos) se entrega a integradores, y
 * PropMatch todavía no lo es. No se inventan endpoints.
 *
 * El formulario para dejar las credenciales cargadas se habilita con
 * ARGENPROP_CREDENTIALS_ENABLED=1 (apagado por defecto: hasta tener el alta de
 * integrador no conviene que una inmobiliaria pida la integración, porque
 * Argenprop puede darle de baja los avisos cargados a mano).
 */
import { encrypt } from "../../crypto.js";
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { maskApiUser, parseArgenpropCredentials } from "../argenpropCredentials.js";
import { readConnection, toConnectionStatus } from "../connections.js";
import { withOptionalColumns } from "../dbCompat.js";
import type { AgencyScope, Availability, PortalAdapter } from "../types.js";
import { unavailableResult } from "./unavailable.js";

const NOT_INTEGRATOR =
  "Argenprop entrega su sistema de publicación solo a integradores registrados. PropMatch está tramitando ese registro; hasta entonces no se puede publicar desde acá.";

export function argenpropFormEnabled(): boolean {
  return process.env.ARGENPROP_CREDENTIALS_ENABLED === "1" && !!process.env.INTEGRATIONS_ENC_KEY;
}

function availability(): Availability {
  return argenpropFormEnabled()
    ? { state: "needs_approval", reason: `${NOT_INTEGRATOR} Podés dejar tus credenciales cargadas desde ya.` }
    : { state: "coming_soon", reason: NOT_INTEGRATOR };
}

export type SaveCredentialsResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "in_use" | "disabled" | "server_error"; field?: string; message: string };

/** Guarda (o reemplaza) las credenciales de la agencia, cifradas. Sin verificación: no hay endpoint documentado. */
export async function saveArgenpropCredentials(scope: AgencyScope, raw: unknown): Promise<SaveCredentialsResult> {
  if (!argenpropFormEnabled()) return { ok: false, code: "disabled", message: NOT_INTEGRATOR };
  const parsed = parseArgenpropCredentials(raw);
  if (!parsed.ok) return { ok: false, code: "invalid", field: parsed.field, message: parsed.message };
  const c = parsed.value;
  const db = supabaseAdmin();

  // Una cuenta de Argenprop pertenece a una sola inmobiliaria.
  const { data: taken } = await db
    .from("agency_integrations")
    .select("agency_id")
    .eq("provider", "argenprop")
    .eq("external_account_id", c.user)
    .neq("agency_id", scope.agencyId)
    .limit(1);
  if (taken && taken.length > 0)
    return { ok: false, code: "in_use", message: "Ese usuario de Argenprop ya está conectado a otra inmobiliaria en PropMatch." };

  const row = {
    agency_id: scope.agencyId,
    provider: "argenprop",
    status: "connected",
    external_account_id: c.user,
    account_label: maskApiUser(c.user),
    // Todo el secreto va cifrado (AES-256-GCM) en la misma columna que los tokens OAuth.
    access_token_enc: encrypt(JSON.stringify(c)),
    refresh_token_enc: null,
    expires_at: null,
    scopes: null,
    connected_by: scope.userId,
    auth_method: "credentials",
    last_error: null,
    last_checked_at: null, // sin verificar
  };
  const { error } = await withOptionalColumns("connection", row, (r) =>
    db.from("agency_integrations").upsert(r, { onConflict: "agency_id,provider" }),
  );
  if (error) return { ok: false, code: "server_error", message: "No pudimos guardar las credenciales. Probá de nuevo en un rato." };
  return { ok: true };
}

export const ArgenpropAdapter: PortalAdapter = {
  id: "argenprop",
  name: "Argenprop",
  authMethod: "credentials",
  channels: ["argenprop"],
  availability,

  async status(scope) {
    const av = availability();
    const row = av.state === "coming_soon" ? null : await readConnection(scope.agencyId, "argenprop");
    return toConnectionStatus("argenprop", "credentials", av, row);
  },
  async connect() {
    if (!argenpropFormEnabled()) throw new Error("unavailable");
    return { form: true };
  },
  async disconnect(scope) {
    // No hay endpoint documentado de revocación: se borran las credenciales de PropMatch.
    const { error } = await supabaseAdmin().from("agency_integrations").delete().eq("agency_id", scope.agencyId).eq("provider", "argenprop");
    if (error) throw new Error("server_error");
  },
  async refresh() {
    /* credenciales fijas: no hay nada que renovar */
  },
  async validate() {
    return unavailableResult("argenprop", NOT_INTEGRATOR);
  },
  async publish() {
    return unavailableResult("argenprop", NOT_INTEGRATOR);
  },
  async update() {
    return unavailableResult("argenprop", NOT_INTEGRATOR);
  },
  async lifecycle() {
    return unavailableResult("argenprop", NOT_INTEGRATOR);
  },
  mapStatus() {
    return { status: "error", message: NOT_INTEGRATOR };
  },
};
