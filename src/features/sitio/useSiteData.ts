import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/data/store";
import { isSample } from "@/lib/samples";
import { usePublications } from "@/features/propiedades/usePublications";
import type { OperationType, Property, PropertyType } from "@/types/db";
import { decodeExactGeo, type PublicAgency, type PublicProperty, type PublicSite } from "../../../shared/publicSite";
import { PREVIEW_SLUG } from "./siteUrl";

export type SiteState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error" }
  /** Vista previa sin sesión: no hay datos que mostrar. */
  | { kind: "needs_session" }
  | { kind: "ok"; site: PublicSite; preview: boolean; notPublished: Set<string> };

const TYPE_TO_PUBLIC: Record<PropertyType, PublicProperty["type"]> = {
  casa: "casa",
  departamento: "depto",
  ph: "ph",
  terreno: "terreno",
  local: "local",
  oficina: "oficina",
};

const OP_TO_PUBLIC: Record<OperationType, PublicProperty["operation"]> = {
  venta: "venta",
  alquiler: "alquiler",
  alquiler_temporal: "temporario",
};

/**
 * Datos de la web pública. Con un slug real se piden a /api/web/site (sin
 * sesión, con caché en el CDN). Con `vista-previa` se arman con lo que hay en
 * ESTE navegador (también en la demo) y se marca lo que no saldría en la web
 * real: datos de ejemplo y propiedades sin sincronizar. Nunca se publica nada
 * desde la vista previa.
 */
export function useSiteData(slug: string): SiteState {
  const preview = slug === PREVIEW_SLUG;
  const [remote, setRemote] = useState<SiteState>({ kind: "loading" });
  const local = usePreviewSite(preview);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    setRemote({ kind: "loading" });
    fetch(`/api/web/site?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const isJson = r.headers.get("content-type")?.includes("application/json");
        if (r.status === 404) return { kind: "not_found" } as const;
        if (!r.ok || !isJson) return { kind: "error" } as const;
        const site = (await r.json()) as PublicSite;
        return { kind: "ok", site, preview: false, notPublished: new Set<string>() } as const;
      })
      .catch(() => ({ kind: "error" }) as const)
      .then((s) => {
        if (!cancelled) setRemote(s);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, preview]);

  return preview ? local : remote;
}

function usePreviewSite(enabled: boolean): SiteState {
  const { agency, properties, photos, currentUserId, sessionLoading, profiles } = useStore();
  const { channelsOf, loading } = usePublications();

  return useMemo<SiteState>(() => {
    if (!enabled) return { kind: "loading" };
    if (sessionLoading || loading) return { kind: "loading" };
    if (!currentUserId) return { kind: "needs_session" };
    const notPublished = new Set<string>();
    const list: PublicProperty[] = [];
    for (const p of properties) {
      if (p.status !== "disponible") continue;
      const web = channelsOf(p).find((c) => c.info.channel === "web");
      if (web?.status === "removed") continue;
      if (isSample(p) || !p.app_property_id) notPublished.add(p.id);
      list.push(toPublic(p, photos[p.id] ?? [], web?.externalId ?? null));
    }
    const owner = profiles.find((x) => x.role === "admin") ?? profiles[0];
    const brand = agency.branding ?? null;
    const a: PublicAgency = {
      name: brand?.displayName || agency.name,
      slug: PREVIEW_SLUG,
      whatsapp: brand?.whatsapp ?? brand?.phone ?? agency.phone ?? owner?.phone ?? null,
      email: brand?.email ?? agency.email ?? owner?.email ?? null,
      brand,
    };
    return { kind: "ok", site: { agency: a, properties: list, generatedAt: new Date().toISOString() }, preview: true, notPublished };
  }, [enabled, sessionLoading, loading, currentUserId, properties, photos, channelsOf, agency, profiles]);
}

function toPublic(p: Property, photos: string[], webExternalId: string | null): PublicProperty {
  const exact = decodeExactGeo(webExternalId);
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? "",
    type: TYPE_TO_PUBLIC[p.type],
    operation: OP_TO_PUBLIC[p.operation],
    // La web pública toma el precio de la app, que es en USD.
    price: p.currency === "USD" ? p.price : null,
    pricePeriod: p.operation === "venta" ? null : "mes",
    rooms: p.rooms,
    amenities: p.features ?? [],
    area: p.locality || p.zone || null,
    photos,
    exact,
    updatedAt: p.updated_at,
  };
}
