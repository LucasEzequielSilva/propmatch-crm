/**
 * Registro de adapters del servidor. Para sumar un portal: crear
 * adapters/<portal>.ts que cumpla PortalAdapter y agregarlo acá (checklist en
 * docs/integraciones-multitenant.md). El cliente tiene su par con textos y
 * logos en src/lib/integrations/registry.ts.
 */
import { ArgenpropAdapter } from "./adapters/argenprop.js";
import { MercadoLibreAdapter } from "./adapters/mercadolibre.js";
import { MetaAdapter } from "./adapters/meta.js";
import { ZonapropAdapter } from "./adapters/zonaprop.js";
import type { PortalAdapter, PortalId } from "./types.js";

export const ADAPTERS: Record<PortalId, PortalAdapter> = {
  mercadolibre: MercadoLibreAdapter,
  meta: MetaAdapter,
  argenprop: ArgenpropAdapter,
  zonaprop: ZonapropAdapter,
};

export const PORTAL_IDS = Object.keys(ADAPTERS) as PortalId[];

export function adapterFor(id: unknown): PortalAdapter | null {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(ADAPTERS, id) ? ADAPTERS[id as PortalId] : null;
}
