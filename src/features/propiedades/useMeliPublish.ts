/**
 * Acciones sobre el aviso de Mercado Libre de una propiedad (api/meli/publish).
 * El servidor valida todo de nuevo; acá solo se arma el pedido y se traducen
 * las respuestas a texto. Sin datos simulados: si /api no está disponible
 * (vite dev no corre funciones), se informa tal cual.
 */
import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useStore } from "@/data/store";
import { saveCrmPublication } from "@/lib/crmPublications";
import type { Property, PropertyPublication } from "@/types/db";
import type { MeliTargetBody } from "./meliTarget";
import type { MeliIssue, MeliListingInput, MeliListingType } from "../../../shared/meliListing";

export type MeliAction = "check" | "publish" | "update" | "pause" | "activate" | "close" | "sync";

export interface MeliExtras {
  location: { stateId?: string | null; cityId?: string | null; neighborhoodId?: string | null } | null;
  guests: number | null;
  landAccess: string | null;
}

export function toMeliListing(p: Property, extras: MeliExtras): MeliListingInput {
  return {
    type: p.type,
    operation: p.operation,
    title: p.title,
    description: p.description,
    price: p.price,
    currency: p.currency,
    expenses: p.expenses,
    expensesCurrency: p.expenses_currency ?? "ARS",
    surfaceTotal: p.surface_total,
    surfaceCovered: p.surface_covered,
    rooms: p.rooms,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    garages: p.garages,
    ageYears: p.age_years,
    features: p.features,
    street: p.street,
    streetNumber: p.street_number,
    lat: p.lat,
    lng: p.lng,
    propertyCode: p.id,
    location: extras.location
      ? { neighborhoodId: extras.location.neighborhoodId ?? null, cityId: extras.location.cityId ?? null }
      : null,
    guests: extras.guests,
    landAccess: extras.landAccess,
  };
}

export interface MeliResult {
  ok: boolean;
  row: PropertyPublication | null;
  issues: MeliIssue[];
  message: string | null;
  warnings: string[];
  listingType?: MeliListingType;
  /** false = la publicación quedó solo en este navegador (falta la migración de solo-CRM). */
  storedOnServer?: boolean;
}

const GENERIC: Record<string, string> = {
  not_configured: "La integración con Mercado Libre todavía no está configurada en el servidor.",
  unauthorized: "Tu sesión venció. Volvé a iniciar sesión.",
  forbidden: "No tenés permiso para esta acción.",
  bad_request: "El pedido no es válido.",
  bad_listing: "Faltan datos básicos de la propiedad (tipo u operación).",
  sample: "Es una propiedad de ejemplo: no se publica en ningún portal.",
  server_error: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
};

export function useMeliPublish(onRow: (row: PropertyPublication) => void) {
  const [busy, setBusy] = useState<MeliAction | null>(null);
  const { agency } = useStore();
  const agencyId = agency.id;

  const run = useCallback(
    async (
      action: MeliAction,
      target: MeliTargetBody,
      listing?: MeliListingInput,
      listingType?: MeliListingType,
      /** Para marcar el botón ocupado mientras se suben fotos antes de llamar. */
      before?: () => Promise<Partial<MeliTargetBody> | string>,
    ): Promise<MeliResult> => {
      setBusy(action);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return { ok: false, row: null, issues: [], message: GENERIC.unauthorized, warnings: [] };
        let extra: Partial<MeliTargetBody> = {};
        if (before) {
          const b = await before();
          if (typeof b === "string") return { ok: false, row: null, issues: [], message: b, warnings: [] };
          extra = b;
        }
        const r = await fetch("/api/meli/publish", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...target, ...extra, listing, listingType }),
        });
        const isJson = r.headers.get("content-type")?.includes("application/json");
        if (!isJson) {
          return { ok: false, row: null, issues: [], message: "El servidor de publicación no está disponible en este entorno.", warnings: [] };
        }
        const j = (await r.json()) as {
          error?: string;
          message?: string;
          row?: PropertyPublication | null;
          issues?: MeliIssue[];
          warnings?: string[];
          listingType?: MeliListingType;
          packNote?: string | null;
          storedOnServer?: boolean;
        };
        if (j.row) {
          // Propiedad solo-CRM: se recuerda en el navegador (sin la migración es la única copia).
          if (!target.propertyId || j.row.local_only) saveCrmPublication(agencyId, target.crmPropertyId, j.row);
          onRow(j.row);
        }
        const warnings = [...(j.warnings ?? []), ...(j.packNote ? [j.packNote] : [])];
        return {
          ok: r.ok,
          row: j.row ?? null,
          issues: j.issues ?? [],
          message: r.ok ? null : j.message ?? GENERIC[j.error ?? ""] ?? "No se pudo completar la acción.",
          warnings,
          listingType: j.listingType,
          storedOnServer: j.storedOnServer,
        };
      } catch {
        return { ok: false, row: null, issues: [], message: "No hay conexión con el servidor. Probá de nuevo.", warnings: [] };
      } finally {
        setBusy(null);
      }
    },
    [onRow, agencyId],
  );

  return { run, busy };
}
