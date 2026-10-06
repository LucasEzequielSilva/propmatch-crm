/**
 * MetaAdapter (Facebook + Instagram, UNA conexión: provider 'meta').
 *
 * Es un adapter "externo": la conexión y la publicación ya existen y NO se
 * reescriben acá (api/_lib/routes/meta/*, api/_lib/metaPublish/*):
 *  - Conectar usa Facebook Login for Business desde el navegador (SDK de
 *    Facebook + /api/meta/publish-connect): no es un redirect que el motor
 *    pueda iniciar.
 *  - Publicar es un posteo que la persona redacta (texto, fotos elegidas,
 *    carrusel/story) y en Instagram son dos pasos con espera (contenedor →
 *    publicar). No es un "aviso" que se arme solo con la ficha.
 * Por eso el motor no publica en Meta: el diálogo «Publicar en portales» lleva
 * al panel de Meta de la propiedad. Este adapter sí informa el estado de la
 * conexión (para Configuración → Integraciones) y el borrado.
 */
import { supabaseAdmin } from "../../supabaseAdmin.js";
import { metaPublishConfigured, metaPublishEnabled } from "../../metaPublish/core.js";
import { readConnection, toConnectionStatus } from "../connections.js";
import type { Availability, PortalAdapter } from "../types.js";
import { unavailableResult } from "./unavailable.js";

const PANEL = "Facebook e Instagram se publican desde el panel de Meta de la propiedad: ahí elegís el texto y las fotos.";

function availability(): Availability {
  if (!metaPublishConfigured()) return { state: "not_configured", reason: "La conexión con Meta todavía no está configurada en el servidor." };
  if (!metaPublishEnabled())
    return { state: "needs_approval", reason: "Meta tiene que aprobar los permisos de publicación de PropMatch. Mientras tanto no se puede conectar." };
  return { state: "available" };
}

export const MetaAdapter: PortalAdapter = {
  id: "meta",
  name: "Facebook e Instagram",
  authMethod: "oauth",
  channels: ["facebook", "instagram"],
  availability,

  async status(scope) {
    const av = availability();
    if (av.state !== "available") return toConnectionStatus("meta", "oauth", av, null);
    return toConnectionStatus("meta", "oauth", av, await readConnection(scope.agencyId, "meta"));
  },
  async connect() {
    // El login de Meta se abre desde el navegador (SDK de Facebook).
    return {};
  },
  async disconnect(scope) {
    const { error } = await supabaseAdmin().from("agency_integrations").delete().eq("agency_id", scope.agencyId).eq("provider", "meta");
    if (error) throw new Error("server_error");
  },
  async refresh() {
    // Los tokens de Página de larga duración no vencen; si Meta los invalida, el uso marca needs_reauth.
  },
  async validate() {
    return unavailableResult("meta", PANEL);
  },
  async publish() {
    return unavailableResult("meta", PANEL);
  },
  async update() {
    return unavailableResult("meta", PANEL);
  },
  async lifecycle() {
    return unavailableResult("meta", PANEL);
  },
  mapStatus() {
    return { status: "published", message: null };
  },
};
