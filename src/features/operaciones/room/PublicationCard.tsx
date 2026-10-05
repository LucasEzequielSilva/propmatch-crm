import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore } from "@/data/store";
import { PROPERTY_STATUS_LABEL } from "@/lib/format";
import { upsertPublications } from "@/lib/publicationSync";
import { usePublications } from "@/features/propiedades/usePublications";
import type { PublicationChannel, PublicationStatus } from "@/types/db";
import { Btn, Pill, RoomCard, type Tone } from "./primitives";
import type { Room } from "./room";

const STATUS_LABEL: Record<PublicationStatus, string> = {
  draft: "Borrador",
  pending: "En cola",
  published: "Publicada",
  error: "Con error",
  paused: "Pausada",
  removed: "Dada de baja",
};

const STATUS_TONE: Record<PublicationStatus, Tone> = {
  draft: "neutral",
  pending: "blue",
  published: "green",
  error: "red",
  paused: "amber",
  removed: "neutral",
};

/**
 * Estado real de los canales de la propiedad. Pausar es manual: deja el
 * estado en la base; los portales se pausan desde cada portal (todavía no
 * hay conectores que lo hagan solos).
 */
export function PublicationCard({ room }: { room: Room }) {
  const { property } = room;
  const { agency } = useStore();
  const { channelsOf, isPersistent, loading } = usePublications();
  const [overrides, setOverrides] = useState<Partial<Record<PublicationChannel, PublicationStatus>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!property) {
    return (
      <RoomCard title="Estado de publicación">
        <p className="text-sm text-ink-soft">La operación no tiene propiedad.</p>
      </RoomCard>
    );
  }

  const channels = channelsOf(property)
    .filter((c) => c.info.channel !== "web")
    .map((c) => ({ ...c, status: overrides[c.info.channel] ?? c.status }))
    .filter((c) => c.status !== null);
  const active = channels.filter((c) => c.status === "published" || c.status === "pending");
  const persistent = isPersistent(property);

  const pauseAll = async () => {
    setBusy(true);
    setError(null);
    const { rows, error: err } = await upsertPublications(
      active.map((c) => ({ agencyId: agency.id, propertyId: property.app_property_id!, channel: c.info.channel, status: "paused" as const })),
    );
    setBusy(false);
    if (err) return setError("No se pudo guardar. Probá de nuevo en un rato.");
    setOverrides((prev) => ({ ...prev, ...Object.fromEntries(rows.map((r) => [r.channel, r.status])) }));
    room.update({}, { type: "updated", title: `Marcó como pausados: ${active.map((c) => c.info.name).join(", ")}` });
  };

  return (
    <RoomCard
      title="Estado de publicación"
      subtitle={`Propiedad: ${PROPERTY_STATUS_LABEL[property.status as keyof typeof PROPERTY_STATUS_LABEL] ?? property.status}`}
    >
      {loading ? (
        <p className="text-sm text-ink-soft">Cargando canales…</p>
      ) : channels.length === 0 ? (
        <p className="text-sm text-ink-soft">No hay publicaciones en portales registradas para esta propiedad.</p>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => (
            <li key={c.info.channel} className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink">{c.info.name}</span>
              <Pill tone={STATUS_TONE[c.status!]}>{STATUS_LABEL[c.status!]}</Pill>
            </li>
          ))}
        </ul>
      )}

      {active.length > 0 && persistent && (
        <div className="mt-4">
          <Btn size="sm" onClick={pauseAll} disabled={busy}>
            {busy ? "Guardando…" : "Marcar canales como pausados"}
          </Btn>
          <p className="text-xs text-ink-soft mt-1.5">Solo cambia el estado en PropMatch: pausá el aviso también en cada portal.</p>
        </div>
      )}
      {active.length > 0 && !persistent && (
        <p className="text-xs text-ink-soft mt-3">Esta propiedad no está guardada en la base todavía: pausá los avisos desde cada portal.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-rose-700 font-semibold mt-2">
          {error}
        </p>
      )}
      <Link to={`/publicador/${property.id}`} className="inline-block mt-3 text-xs text-brand-purple font-semibold hover:underline">
        Abrir multipublicador →
      </Link>
    </RoomCard>
  );
}
