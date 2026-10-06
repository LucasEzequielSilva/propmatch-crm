/**
 * ZonapropAdapter: esqueleto "no disponible".
 *
 * Por qué (ver docs/integraciones-multitenant.md, sección Zonaprop):
 *  - Zonaprop no publica documentación de API abierta; la de integradores
 *    (open-docs.navent.com) no es pública y el acceso lo habilita Zonaprop.
 *  - Integradores que la usan describen una autorización con login de
 *    Zonaprop (tipo OAuth) y planes asignados a la "cuenta API".
 *  - Zonaprop restringe qué CRMs pueden publicar (2clics dejó de poder).
 * Paso único del dueño de PropMatch: pedir el alta como integrador a
 * Zonaprop. Hasta tenerla no hay endpoints que llamar (no se inventan).
 */
import { toConnectionStatus } from "../connections.js";
import type { Availability, PortalAdapter } from "../types.js";
import { unavailableResult } from "./unavailable.js";

const REASON =
  "Zonaprop habilita la publicación desde sistemas externos solo a integradores aprobados. PropMatch está tramitando ese alta; cuando esté, vas a poder conectar tu cuenta con un clic.";

const availability = (): Availability => ({ state: "coming_soon", reason: REASON });

export const ZonapropAdapter: PortalAdapter = {
  id: "zonaprop",
  name: "Zonaprop",
  authMethod: "oauth",
  channels: ["zonaprop"],
  availability,
  async status() {
    return toConnectionStatus("zonaprop", "oauth", availability(), null);
  },
  async connect() {
    throw new Error("unavailable");
  },
  async disconnect() {
    /* no hay conexión que borrar */
  },
  async refresh() {
    throw new Error("unavailable");
  },
  async validate() {
    return unavailableResult("zonaprop", REASON);
  },
  async publish() {
    return unavailableResult("zonaprop", REASON);
  },
  async update() {
    return unavailableResult("zonaprop", REASON);
  },
  async lifecycle() {
    return unavailableResult("zonaprop", REASON);
  },
  mapStatus() {
    return { status: "error", message: REASON };
  },
};
