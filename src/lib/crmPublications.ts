/**
 * Publicaciones de Mercado Libre de propiedades que NO están en la app
 * (precio en pesos, o todavía sin sincronizar), recordadas en este navegador.
 *
 * Por qué existe: `property_publications.property_id` es FK a la tabla de la
 * app. Hasta que se aplique la migración 20261007120000 (crm_property_id), el
 * servidor no tiene dónde guardar esas publicaciones y devuelve la fila con
 * `local_only: true`. Acá se guarda para que:
 *  - la pantalla muestre el aviso (id, link, estado), y
 *  - la próxima acción mande `previous: { externalId }` y el servidor edite
 *    ESE aviso en vez de crear otro (lo verifica contra la cuenta de la agencia).
 * Con la migración aplicada, esto queda solo como caché: manda la base.
 *
 * Límite honesto: localStorage es por navegador. Otro equipo de la misma
 * inmobiliaria no ve estas publicaciones hasta aplicar la migración.
 */
import type { PropertyPublication } from "@/types/db";

const KEY = (agencyId: string) => `pm.crmpub.v1.${agencyId}`;
export const CRM_PUBLICATIONS_EVENT = "pm:crm-publications";

type Store = Record<string, PropertyPublication>;

function read(agencyId: string): Store {
  try {
    const raw = window.localStorage.getItem(KEY(agencyId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(agencyId: string, s: Store) {
  try {
    window.localStorage.setItem(KEY(agencyId), JSON.stringify(s));
  } catch {
    /* sin storage: se pierde al recargar */
  }
  try {
    window.dispatchEvent(new Event(CRM_PUBLICATIONS_EVENT));
  } catch {
    /* fuera del navegador (pruebas) */
  }
}

/** Todas las publicaciones recordadas de la agencia, por id de propiedad del CRM. */
export function loadCrmPublications(agencyId: string): Store {
  return read(agencyId);
}

export function getCrmPublication(agencyId: string, crmPropertyId: string): PropertyPublication | null {
  return read(agencyId)[crmPropertyId] ?? null;
}

/** Guarda (o reemplaza) la publicación de ML de una propiedad del CRM. */
export function saveCrmPublication(agencyId: string, crmPropertyId: string, row: PropertyPublication) {
  const s = read(agencyId);
  s[crmPropertyId] = { ...row, crm_property_id: crmPropertyId };
  write(agencyId, s);
}

/** Pista para el servidor: el aviso que este navegador recuerda (el servidor verifica que sea de la agencia). */
export function previousFor(agencyId: string, crmPropertyId: string): { externalId: string } | undefined {
  const row = getCrmPublication(agencyId, crmPropertyId);
  return row?.external_id && /^MLA\d{6,15}$/.test(row.external_id) ? { externalId: row.external_id } : undefined;
}
