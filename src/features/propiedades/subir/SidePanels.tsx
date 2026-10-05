/**
 * Columna derecha del alta: calidad de la ficha, estado por canal y
 * compradores compatibles. Todo calculado con datos reales; nada inventado.
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { AlertTriangleIcon, CheckIcon, ClockIcon, MatchesSolidIcon } from "@/components/ui/icons";
import { useStore } from "@/data/store";
import type { DiagnosticCheck } from "@/lib/listingDiagnostics";
import { computeMatch, MATCH_THRESHOLD } from "@/lib/matching";
import type { CurrencyCode, Property, PropertyStatus, PublicationStatus } from "@/types/db";
import { INTEGRATION_GUIDES } from "../integrationGuides";
import { EXTERNAL_CHANNELS, WEB_CHANNEL, usePublications } from "../usePublications";
import { useMeliConnection } from "../useIntegrations";

const PANEL_TITLE = "text-xs uppercase";
const PANEL_TITLE_STYLE = { color: "#7458C4", fontWeight: 700, letterSpacing: "0.1em" } as const;

/** A qué sección del formulario lleva cada check del diagnóstico. */
export const CHECK_SECTION: Record<string, string> = {
  title: "informacion",
  description: "informacion",
  photos: "galeria",
  price: "precios",
  coords: "ubicacion",
  size: "superficies",
  authorization: "propietario",
};

/* ── (a) Índice de calidad ─────────────────────────────────────────────── */

export function QualityPanel({ checks, onJump }: { checks: DiagnosticCheck[]; onJump: (sectionId: string) => void }) {
  const ok = checks.filter((c) => c.ok).length;
  const pct = checks.length ? Math.round((100 * ok) / checks.length) : 0;
  return (
    <Card padded>
      <h2 className={PANEL_TITLE} style={PANEL_TITLE_STYLE}>
        Índice de calidad de ficha
      </h2>
      <div className="flex items-center gap-4 mt-3">
        <ScoreRing score={pct} size={76} strokeWidth={7} />
        <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>
          {ok} de {checks.length} requisitos para publicar en portales
          <span className="block text-xs mt-0.5" style={{ color: "#7C6A99", fontWeight: 500 }}>
            Las mismas reglas que revisa el Multipublicador.
          </span>
        </p>
      </div>
      <ul className="mt-4 space-y-1">
        {checks.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onJump(CHECK_SECTION[c.id] ?? "informacion")}
              className="w-full flex items-start gap-2.5 text-left px-2 py-2 min-h-11 rounded-lg hover:bg-violet-50"
            >
              <span
                className="w-5 h-5 mt-0.5 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: c.ok ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${c.ok ? "#BBF7D0" : "#FDE68A"}` }}
                aria-hidden="true"
              >
                {c.ok ? <CheckIcon size={10} color="#16A34A" /> : <span style={{ color: "#B45309", fontSize: 11, fontWeight: 800 }}>!</span>}
              </span>
              <span className="min-w-0">
                <span className="block text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                  {c.label}
                  <span className="sr-only">{c.ok ? ": cumple" : ": falta"}</span>
                </span>
                <span className="block text-xs" style={{ color: "#7C6A99" }}>
                  {c.detail}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── (b) Estado por canal ──────────────────────────────────────────────── */

type Tone = "ok" | "wait" | "error" | "off";
const TONE: Record<Tone, { bg: string; text: string; border: string }> = {
  ok: { bg: "#F0FDF4", text: "#15803D", border: "#BBF7D0" },
  wait: { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A" },
  error: { bg: "#FFF1F2", text: "#BE123C", border: "#FECDD3" },
  off: { bg: "#F8FAFC", text: "#475569", border: "#E2E8F0" },
};

interface ChannelRowData {
  key: string;
  name: string;
  short: string;
  color: string;
  label: string;
  tone: Tone;
  detail?: string | null;
  requirements: { text: string; ok?: boolean }[];
}

function externalLabel(status: PublicationStatus | null, connected: boolean): { label: string; tone: Tone } {
  switch (status) {
    case "published":
      return { label: "Publicado", tone: "ok" };
    case "pending":
      return { label: "En cola", tone: "wait" };
    case "error":
      return { label: "Error", tone: "error" };
    case "draft":
      return { label: "Borrador", tone: "off" };
    case "paused":
    case "removed":
      return { label: "Inactiva", tone: "off" };
    default:
      return connected ? { label: "Conectado · sin publicar", tone: "off" } : { label: "Sin conexión", tone: "off" };
  }
}

export function ChannelsPanel({
  saved,
  currency,
  status,
  photoCount,
  appLinked,
}: {
  /** La propiedad tal como está guardada (en el alta, `undefined`). */
  saved: Property | undefined;
  currency: CurrencyCode;
  status: PropertyStatus;
  photoCount: number;
  appLinked: boolean;
}) {
  const { channelsOf } = usePublications();
  const meli = useMeliConnection();

  const rows: ChannelRowData[] = useMemo(() => {
    const out: ChannelRowData[] = [];

    // App PropMatch: lo único que hoy se publica de verdad (al guardar).
    const usd = currency === "USD";
    let app: { label: string; tone: Tone; detail?: string };
    if (!appLinked) app = { label: "Sin conexión", tone: "off", detail: "Tu cuenta no está vinculada a una inmobiliaria en la app." };
    else if (!usd) app = { label: "No se puede publicar", tone: "wait", detail: "La app solo acepta precios en USD." };
    else if (saved?.sync_status === "synced")
      app = saved.status === "disponible"
        ? { label: "Publicada", tone: "ok" }
        : { label: "Pausada en la app", tone: "off", detail: "Solo las disponibles se ven en la app." };
    else if (saved?.sync_status === "syncing") app = { label: "Sincronizando", tone: "wait" };
    else if (saved?.sync_status === "error") app = { label: "Error", tone: "error", detail: "Falló la última sincronización. Se reintenta al guardar." };
    else
      app = {
        label: "Se publica al guardar",
        tone: "off",
        detail: status === "disponible" ? undefined : "Se sube pausada: solo las disponibles se ven en la app.",
      };
    out.push({
      key: "app",
      name: "App PropMatch",
      short: "PM",
      color: "#7C3AED",
      ...app,
      requirements: [{ text: "Precio en USD", ok: usd }],
    });

    out.push({
      key: "web",
      name: WEB_CHANNEL.name,
      short: WEB_CHANNEL.short,
      color: WEB_CHANNEL.color,
      label: "Ficha pública disponible",
      tone: "ok",
      detail: "Canal propio: la ficha se comparte por link.",
      requirements: [],
    });

    const states = saved ? channelsOf(saved) : null;
    for (const info of EXTERNAL_CHANNELS) {
      const st = states?.find((s) => s.info.channel === info.channel) ?? null;
      const connected = info.channel === "mercadolibre" && meli.connected;
      const { label, tone } = externalLabel(st?.status ?? null, connected);
      const guide = INTEGRATION_GUIDES[info.channel];
      const requirements: { text: string; ok?: boolean }[] = guide.needs.map((text) => ({ text }));
      if (info.channel === "cabaprop") {
        // Única regla de cantidad de fotos documentada por un portal.
        const i = requirements.findIndex((r) => /3 fotos/.test(r.text));
        if (i >= 0) requirements[i] = { text: requirements[i].text, ok: photoCount >= 3 };
      }
      out.push({
        key: info.channel,
        name: info.name,
        short: info.short,
        color: info.color,
        label,
        tone,
        detail: st?.errorMessage ?? null,
        requirements,
      });
    }
    return out;
  }, [appLinked, currency, saved, status, channelsOf, meli.connected, photoCount]);

  return (
    <Card padded>
      <h2 className={PANEL_TITLE} style={PANEL_TITLE_STYLE}>
        Estado por canal
      </h2>
      <p className="text-xs mt-1" style={{ color: "#7C6A99" }}>
        Los portales se conectan desde el Multipublicador. Hasta que haya conector, lo que publiques queda en cola.
      </p>
      <ul className="mt-3 divide-y" style={{ borderColor: "#F3F0FF" }}>
        {rows.map((r) => (
          <ChannelRow key={r.key} row={r} />
        ))}
      </ul>
    </Card>
  );
}

function ChannelRow({ row }: { row: ChannelRowData }) {
  const tone = TONE[row.tone];
  const logo = row.color;
  return (
    <li className="py-2.5" style={{ borderColor: "#F3F0FF" }}>
      <div className="flex items-center gap-3">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs"
          style={{ background: logo, color: logo === "#FFE600" ? "#1F2937" : "white", fontWeight: 800 }}
          aria-hidden="true"
        >
          {row.short}
        </span>
        <span className="min-w-0 flex-1 text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
          {row.name}
        </span>
        <span
          className="text-xs px-2 py-0.5 rounded-full border whitespace-nowrap flex items-center gap-1"
          style={{ background: tone.bg, color: tone.text, borderColor: tone.border, fontWeight: 600 }}
        >
          {row.tone === "ok" && <CheckIcon size={10} color={tone.text} />}
          {row.tone === "wait" && <ClockIcon size={10} color={tone.text} />}
          {row.tone === "error" && <AlertTriangleIcon size={10} color={tone.text} />}
          {row.label}
        </span>
      </div>
      {row.detail && (
        <p className="text-xs mt-1 ml-11" style={{ color: row.tone === "error" ? "#BE123C" : "#7C6A99" }}>
          {row.detail}
        </p>
      )}
      {row.requirements.length > 0 && (
        <details className="ml-11 mt-1">
          <summary className="text-xs cursor-pointer min-h-8 flex items-center" style={{ color: "#7C3AED", fontWeight: 600 }}>
            Requisitos
          </summary>
          <ul className="mt-1 space-y-1">
            {row.requirements.map((req) => (
              <li key={req.text} className="text-xs flex gap-1.5" style={{ color: "#7C6A99" }}>
                <span aria-hidden="true" style={{ color: req.ok === undefined ? "#C4B5FD" : req.ok ? "#16A34A" : "#B45309", fontWeight: 800 }}>
                  {req.ok === undefined ? "•" : req.ok ? "✓" : "!"}
                </span>
                <span>
                  {req.text}
                  {req.ok !== undefined && <span className="sr-only">{req.ok ? " (cumple)" : " (falta)"}</span>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/* ── (c) Compradores compatibles ───────────────────────────────────────── */

export interface CompatibleBuyers {
  count: number;
  top: { id: string; name: string; score: number }[];
  topReasons: [string, number][];
}

/**
 * El mismo motor que la pantalla de Matches, contra los requerimientos
 * reales, mientras se completa el formulario. Sin precio no se calcula
 * (`null`): el presupuesto pesa 30% y daría resultados engañosos.
 */
export function useCompatibleBuyers(draft: Property | null): CompatibleBuyers | null {
  const { requirements, contactById } = useStore();
  return useMemo(() => {
    if (!draft || !draft.price) return null;
    const hits = requirements
      .filter((r) => r.is_active && r.operation === draft.operation)
      .map((r) => ({ req: r, m: computeMatch(r, draft) }))
      .filter((h) => h.m.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.m.score - a.m.score);

    const reasonCount = new Map<string, number>();
    for (const h of hits) for (const reason of h.m.reasons) reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);

    return {
      count: hits.length,
      top: hits.slice(0, 3).map((h) => ({ id: h.req.id, name: contactById(h.req.contact_id)?.full_name ?? "Contacto", score: h.m.score })),
      topReasons: [...reasonCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
    };
  }, [draft, requirements, contactById]);
}

export function BuyersPanel({ result, onSeeAll }: { result: CompatibleBuyers | null; onSeeAll: () => void }) {
  return (
    <Card padded>
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--gradient-brand)" }} aria-hidden="true">
          <MatchesSolidIcon size={14} />
        </span>
        <h2 className={PANEL_TITLE} style={PANEL_TITLE_STYLE}>
          Compradores compatibles
        </h2>
      </div>
      {result === null ? (
        <p className="text-sm mt-3" style={{ color: "#7C6A99" }}>
          Completá el precio para calcular con quién podría encajar.
        </p>
      ) : result.count === 0 ? (
        <p className="text-sm mt-3" style={{ color: "#7C6A99" }}>
          Todavía ningún contacto de tu cartera encaja con estos datos.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>
            <span className="text-2xl text-gradient-brand-h" style={{ fontWeight: 800 }}>
              {result.count}
            </span>{" "}
            {result.count === 1 ? "contacto busca algo así" : "contactos buscan algo así"}
          </p>
          <ul className="mt-3 space-y-1.5">
            {result.top.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                  {b.name}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 700 }}>
                  {b.score}%
                </span>
              </li>
            ))}
          </ul>
          {result.topReasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {result.topReasons.map(([reason, count]) => (
                <span key={reason} className="text-xs px-2 py-1 rounded-lg" style={{ background: "#F0FDF4", color: "#15803D", fontWeight: 600 }}>
                  ✓ {reason} · {count}
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        onClick={onSeeAll}
        className="w-full mt-4 min-h-11 rounded-xl text-sm border transition-all hover:bg-violet-50"
        style={{ borderColor: "#DDD6FE", color: "#7C3AED", fontWeight: 600, background: "white" }}
      >
        Ver compradores
      </button>
    </Card>
  );
}
