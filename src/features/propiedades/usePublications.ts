/**
 * Estado de las publicaciones externas de las propiedades de la agencia.
 *
 * Con la tabla `property_publications` disponible y la propiedad ya en la
 * base (`app_property_id`), todo se guarda ahí. Si no, queda en memoria
 * (modo local) con el mismo shape, para que la pantalla no distinga.
 *
 * `queue` deja los canales sin conector en `pending` ("en cola"). Nunca marca
 * `published` ni inventa IDs externos. Mercado Libre tiene conector real: lo
 * escribe el servidor (api/meli/publish) y la fila que devuelve entra por `applyRow`.
 */

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/data/store";
import { fetchAgencyPublications, upsertPublications } from "@/lib/publicationSync";
import type { Property, PropertyPublication, PublicationChannel, PublicationStatus } from "@/types/db";
import { isSample, SAMPLE_PUBLISH_BLOCKED } from "@/lib/samples";
import { encodeExactGeo } from "../../../shared/publicSite";

export interface ChannelInfo {
  channel: PublicationChannel;
  name: string;
  /** Iniciales para el logo del canal. */
  short: string;
  /** Color de marca del canal (fondo del logo). */
  color: string;
}

/** Canales externos en el orden en que se muestran. `web` es el propio y no se encola. */
export const EXTERNAL_CHANNELS: ChannelInfo[] = [
  { channel: "mercadolibre", name: "Mercado Libre Inmuebles", short: "ML", color: "#FFE600" },
  { channel: "zonaprop", name: "Zonaprop", short: "ZP", color: "#F26122" },
  { channel: "argenprop", name: "Argenprop", short: "AP", color: "#0F766E" },
  { channel: "cabaprop", name: "CABAPROP", short: "CP", color: "#1D4ED8" },
  { channel: "facebook", name: "Facebook", short: "f", color: "#1877F2" },
  { channel: "instagram", name: "Instagram", short: "IG", color: "#E1306C" },
];
export const WEB_CHANNEL: ChannelInfo = { channel: "web", name: "Mi web", short: "W", color: "#7C3AED" };

export interface ChannelState {
  info: ChannelInfo;
  /** `null` = nunca se intentó publicar en este canal. */
  status: PublicationStatus | null;
  externalId: string | null;
  externalUrl: string | null;
  errorMessage: string | null;
  lastSyncedAt: string | null;
}

export function usePublications() {
  const { agency } = useStore();
  /** `null` = tabla no disponible (modo local). */
  const [remote, setRemote] = useState<PropertyPublication[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [local, setLocal] = useState<Record<string, Partial<Record<PublicationChannel, PublicationStatus>>>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Si la petición falla (sin red, backend caído) se cae al modo local en vez de quedar cargando para siempre.
    fetchAgencyPublications(agency.id)
      .catch(() => null)
      .then((rows) => {
        if (cancelled) return;
        setRemote(rows);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agency.id]);

  /** Se guarda en la base solo si hay tabla y la propiedad ya existe allá. */
  const isPersistent = useCallback((p: Property) => remote !== null && !!p.app_property_id && !isSample(p), [remote]);

  const channelsOf = useCallback(
    (p: Property): ChannelState[] =>
      [...EXTERNAL_CHANNELS, WEB_CHANNEL].map((info) => {
        if (info.channel === "web") {
          // Canal propio: aparece en la web si está sincronizada, disponible y no la ocultaron.
          const row = isPersistent(p) ? remote!.find((r) => r.property_id === p.app_property_id && r.channel === "web") : undefined;
          const status: PublicationStatus | null = !isPersistent(p)
            ? null
            : row?.status === "removed"
              ? "removed"
              : p.status !== "disponible"
                ? "paused"
                : "published";
          return {
            info,
            status,
            externalId: row?.external_id ?? null,
            externalUrl: row?.external_url ?? null,
            errorMessage: null,
            lastSyncedAt: row?.last_synced_at ?? null,
          };
        }
        if (isPersistent(p)) {
          const row = remote!.find((r) => r.property_id === p.app_property_id && r.channel === info.channel);
          return {
            info,
            status: row?.status ?? null,
            externalId: row?.external_id ?? null,
            externalUrl: row?.external_url ?? null,
            errorMessage: row?.error_message ?? null,
            lastSyncedAt: row?.last_synced_at ?? null,
          };
        }
        return {
          info,
          status: local[p.id]?.[info.channel] ?? null,
          externalId: null,
          externalUrl: null,
          errorMessage: null,
          lastSyncedAt: null,
        };
      }),
    [isPersistent, remote, local],
  );

  /** Deja los canales indicados en cola (o los re-encola si estaban en error). */
  const queue = useCallback(
    async (p: Property, channels: PublicationChannel[]) => {
      if (channels.length === 0) return;
      // Seguridad: una propiedad de ejemplo no se publica en ningún portal (ni en cola local).
      if (isSample(p)) {
        setError(SAMPLE_PUBLISH_BLOCKED);
        return;
      }
      if (!isPersistent(p)) {
        setLocal((prev) => ({
          ...prev,
          [p.id]: { ...prev[p.id], ...Object.fromEntries(channels.map((c) => [c, "pending"])) },
        }));
        return;
      }
      const { rows, error: err } = await upsertPublications(
        channels.map((channel) => ({
          agencyId: agency.id,
          propertyId: p.app_property_id!,
          channel,
          status: "pending" as const,
        })),
      );
      setError(err);
      if (!err) {
        setRemote((prev) => [
          ...(prev ?? []).filter((r) => !rows.some((n) => n.property_id === r.property_id && n.channel === r.channel)),
          ...rows,
        ]);
      }
    },
    [agency.id, isPersistent],
  );

  /** Reemplaza (o agrega) una fila que ya guardó el servidor. */
  const applyRow = useCallback((row: PropertyPublication) => {
    setRemote((prev) =>
      prev === null
        ? [row]
        : [...prev.filter((r) => !(r.property_id === row.property_id && r.channel === row.channel)), row],
    );
  }, []);

  /**
   * «Mostrar en mi web» y «Mostrar ubicación exacta» de una propiedad. Se guarda
   * en la fila web de `property_publications`: status `removed` = oculta;
   * `external_id = "geo:lat,lng"` = ubicación exacta autorizada (ver
   * shared/publicSite.ts); `external_url` = link a la ficha pública.
   */
  const setWeb = useCallback(
    async (p: Property, opts: { visible: boolean; exact: { lat: number; lng: number } | null; url: string | null }) => {
      if (isSample(p)) {
        setError(SAMPLE_PUBLISH_BLOCKED);
        return false;
      }
      if (!isPersistent(p)) return false;
      const { rows, error: err } = await upsertPublications([
        {
          agencyId: agency.id,
          propertyId: p.app_property_id!,
          channel: "web",
          status: opts.visible ? "published" : "removed",
          externalId: opts.exact ? encodeExactGeo(opts.exact.lat, opts.exact.lng) : null,
          externalUrl: opts.url,
        },
      ]);
      setError(err);
      if (err) return false;
      for (const r of rows) applyRow(r);
      return true;
    },
    [agency.id, isPersistent, applyRow],
  );

  return { channelsOf, queue, applyRow, setWeb, isPersistent, loading, error, persistentMode: remote !== null };
}
