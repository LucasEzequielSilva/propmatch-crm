/**
 * Mercado PropMatch: propiedades activas de la app (de cualquier agencia o
 * dueño), para usarlas como comparables en el diagnóstico.
 *
 * La policy `properties_read_active` deja leer las filas `active` a cualquier
 * usuario autenticado. Solo lectura y con columnas mínimas: la app no guarda
 * m² ni baños, y `lat`/`lng` no son legibles a propósito.
 */

import { supabase } from "./supabase";
import { isDemoActive } from "./demo";
import { OPERATION_FROM_APP, TYPE_FROM_APP } from "./propertySync";
import type { MarketListing } from "./propertyDiagnostic";

interface ActiveAppPropertyRow {
  id: string;
  title: string;
  barrio: string | null;
  type: string;
  operation_type: string;
  rooms: number | null;
  price_usd_month: number | null;
  price_usd_sale: number | null;
}

export class MarketDataError extends Error {
  reason: "no_session" | "query";
  constructor(reason: "no_session" | "query", message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Una sola lectura por sesión del navegador; `force` la renueva ("Recalcular"). */
let cached: Promise<MarketListing[]> | null = null;

export function fetchActiveAppProperties(opts: { force?: boolean } = {}): Promise<MarketListing[]> {
  if (cached && !opts.force) return cached;

  const promise = (async () => {
    // Sin sesión real (modo demo) la RLS devuelve 0 filas sin error: eso se
    // leería como "no hay mercado", que es falso. Se corta antes.
    // En la demo tampoco: aunque el navegador tenga una sesión real abierta, la
    // demo trabaja solo con datos de ejemplo.
    const { data: session } = await supabase.auth.getSession();
    if (!session.session || isDemoActive()) {
      throw new MarketDataError("no_session", "No hay una sesión de PropMatch abierta.");
    }
    const { data, error } = await supabase
      .from("properties")
      .select("id, title, barrio, type, operation_type, rooms, price_usd_month, price_usd_sale")
      .eq("status", "active")
      .limit(5000);
    if (error) throw new MarketDataError("query", error.message);

    const out: MarketListing[] = [];
    for (const row of data as unknown as ActiveAppPropertyRow[]) {
      const type = TYPE_FROM_APP[row.type];
      const operation = OPERATION_FROM_APP[row.operation_type];
      if (!type || !operation) continue; // tipo u operación que el CRM no modela: no se adivina
      const price = operation === "venta" ? row.price_usd_sale : row.price_usd_month;
      if (price == null || !(Number(price) > 0)) continue;
      out.push({
        id: row.id,
        title: row.title,
        type,
        operation,
        currency: "USD",
        price: Number(price),
        rooms: row.rooms,
        zone: row.barrio,
      });
    }
    return out;
  })();

  cached = promise;
  // Un error no queda cacheado: el próximo intento vuelve a pedir.
  promise.catch(() => {
    if (cached === promise) cached = null;
  });
  return promise;
}
