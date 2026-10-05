import { useCallback, useEffect, useMemo, useState } from "react";
import { marketInventory } from "@/lib/samples";
import { useStore } from "@/data/store";
import { fetchActiveAppProperties, MarketDataError } from "@/lib/marketData";
import { buildMarketPool, sortByMisalignment, type PortfolioRow } from "@/lib/market";
import { computeDiagnostic, type MarketListing } from "@/lib/propertyDiagnostic";

export type AppMarketState =
  | { status: "loading" }
  | { status: "ok"; listings: MarketListing[] }
  | { status: "error"; reason: "no_session" | "query"; message: string };

/**
 * Datos de la pantalla Mercado: propiedades activas de la app (si hay sesión)
 * + inventario del CRM. Sin sesión (demo) o con error de red se sigue solo
 * con el inventario, y `app` dice por qué.
 */
export function useMarket() {
  const { properties, photos, activities, appOffers, matches, opportunities, events, agency, isDemo } = useStore();
  // Comparables: sin los ejemplos en cuentas reales (sus precios son inventados).
  const comparables = useMemo(() => marketInventory(properties, isDemo), [properties, isDemo]);
  const [app, setApp] = useState<AppMarketState>({ status: "loading" });
  const [computedAt, setComputedAt] = useState(() => Date.now());

  const load = useCallback((force: boolean) => {
    let cancelled = false;
    setApp({ status: "loading" });
    fetchActiveAppProperties({ force })
      .then((listings) => {
        if (!cancelled) setApp({ status: "ok", listings });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = err instanceof MarketDataError ? err.reason : "query";
        setApp({ status: "error", reason, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (!cancelled) setComputedAt(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(false), [load]);

  const appListings = app.status === "ok" ? app.listings : null;

  const pool = useMemo(() => buildMarketPool(comparables, appListings), [comparables, appListings]);

  /** Tus disponibles, cada una con su diagnóstico (mismo cálculo que la ficha). */
  const portfolio: PortfolioRow[] = useMemo(() => {
    if (app.status === "loading") return [];
    const rows = properties
      .filter((p) => p.status === "disponible")
      .map((p) => ({
        property: p,
        diagnostic: computeDiagnostic(p, {
          inventory: comparables,
          appListings,
          photoCount: (photos[p.id] ?? []).length,
          activities,
          appOffers,
          matches,
          opportunities,
          events,
          channelsPublished: null,
          now: computedAt,
        }),
      }));
    return sortByMisalignment(rows);
  }, [app.status, appListings, properties, comparables, photos, activities, appOffers, matches, opportunities, events, computedAt]);

  return {
    app,
    loading: app.status === "loading",
    appListings,
    inventory: comparables,
    agencyId: agency.id,
    pool,
    portfolio,
    retry: () => load(true),
  };
}
