import { useCallback, useEffect, useMemo, useState } from "react";
import { marketInventory } from "@/lib/samples";
import { useStore } from "@/data/store";
import { fetchActiveAppProperties, MarketDataError } from "@/lib/marketData";
import { computeDiagnostic, type MarketListing, type PropertyDiagnostic } from "@/lib/propertyDiagnostic";
import type { Property } from "@/types/db";

type MarketState =
  | { status: "loading" }
  | { status: "ok"; listings: MarketListing[] }
  | { status: "error"; reason: "no_session" | "query"; message: string };

/**
 * Junta lo que el diagnóstico necesita (store + mercado de la app) y lo
 * recalcula cuando cambia algo. Si la app no responde, se sigue con el
 * inventario del CRM y `marketError` lo dice.
 */
export function useDiagnostic(property: Property, channelsPublished: number | null) {
  const { properties: allProperties, photos, activities, appOffers, matches, opportunities, events, isDemo } = useStore();
  // Los ejemplos no son comparables de una propiedad real (precios inventados), salvo en la demo.
  const properties = useMemo(() => marketInventory(allProperties, isDemo), [allProperties, isDemo]);
  const [market, setMarket] = useState<MarketState>({ status: "loading" });
  const [computedAt, setComputedAt] = useState(() => Date.now());

  const load = useCallback((force: boolean) => {
    let cancelled = false;
    setMarket({ status: "loading" });
    fetchActiveAppProperties({ force })
      .then((listings) => {
        if (!cancelled) setMarket({ status: "ok", listings });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = err instanceof MarketDataError ? err.reason : "query";
        setMarket({ status: "error", reason, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        if (!cancelled) setComputedAt(Date.now());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(false), [load]);

  const photoCount = (photos[property.id] ?? []).length;

  const diagnostic: PropertyDiagnostic | null = useMemo(() => {
    if (market.status === "loading") return null;
    return computeDiagnostic(property, {
      inventory: properties,
      appListings: market.status === "ok" ? market.listings : null,
      photoCount,
      activities,
      appOffers,
      matches,
      opportunities,
      events,
      channelsPublished,
      now: computedAt,
    });
  }, [market, property, properties, photoCount, activities, appOffers, matches, opportunities, events, channelsPublished, computedAt]);

  return {
    diagnostic,
    loading: market.status === "loading",
    marketError: market.status === "error" ? market : null,
    recalc: () => load(true),
  };
}
