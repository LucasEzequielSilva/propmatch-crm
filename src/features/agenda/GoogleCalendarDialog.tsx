/**
 * «Google Calendar» en la Agenda: conectar la cuenta (sincronización al
 * instante, opción A) y/o suscribirse con un link (.ics, opción B).
 * Cada agente ve y maneja solo lo suyo.
 */
import { useEffect, useState } from "react";
import { useGoogleCalendar, type FeedController } from "@/lib/gcal/GoogleCalendarProvider";

const INK = "#1F0A3C";
const MUTED = "#7C6A99";

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

export function GoogleCalendarDialog({ onClose }: { onClose: () => void }) {
  const { feed } = useGoogleCalendar();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="pm-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(31,10,60,0.35)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gcal-dialog-title"
    >
      <div
        className="pm-modal rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "white", boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b flex items-center gap-3" style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}>
          <div className="flex-1 min-w-0">
            <h2 id="gcal-dialog-title" className="text-lg tracking-tight" style={{ color: INK, fontWeight: 800 }}>
              Google Calendar
            </h2>
            <p className="text-xs mt-0.5" style={{ color: MUTED }}>
              Tus visitas, eventos y tareas con fecha, en tu calendario de Google. Cada agente conecta el suyo.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-11 h-11 rounded-lg flex items-center justify-center transition-all hover:bg-violet-50"
            style={{ color: "#7458C4", fontSize: 22, lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-6">
          <FeedSection feed={feed} />
        </div>
      </div>
    </div>
  );
}

/** Opción B: link de suscripción. También se usa en Configuración → Integraciones. */
export function FeedSection({ feed }: { feed: FeedController }) {
  const [copied, setCopied] = useState(false);
  const primary = "min-h-11 px-4 rounded-xl text-sm text-white disabled:opacity-60";
  const outline = "min-h-11 px-4 rounded-xl text-sm border bg-white disabled:opacity-60 hover:bg-violet-50";

  const copy = async () => {
    if (!feed.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="gcal-feed-title">
      <h3 id="gcal-feed-title" className="text-sm" style={{ color: INK, fontWeight: 800 }}>
        Suscribir en Google Calendar
      </h3>
      <p className="text-xs mt-1" style={{ color: MUTED }}>
        Un link privado con tu agenda (30 días atrás y 6 meses adelante). Google lo actualiza cada varias horas; para que sea al
        instante, usá «Conectar Google Calendar» (cuando esté disponible). Va solo lo tuyo: título, horario, cliente, propiedad y
        dirección. Nada de precios ni notas internas.
      </p>

      {feed.state === "loading" && <p className="text-xs mt-3" style={{ color: MUTED }}>Verificando…</p>}
      {feed.state === "demo" && (
        <p className="text-xs mt-3 px-3 py-2 rounded-lg" style={{ background: "#F5F3FF", color: "#5B21B6" }}>
          En la demo no se generan links. Creá tu cuenta para usarlo con tu agenda real.
        </p>
      )}
      {feed.state === "hidden" && (
        <p className="text-xs mt-3 px-3 py-2 rounded-lg" style={{ background: "#F5F3FF", color: "#5B21B6" }}>
          No está disponible en este entorno (o tu usuario todavía no está vinculado a una inmobiliaria).
        </p>
      )}
      {feed.state === "no_db" && (
        <p role="status" className="text-xs mt-3 px-3 py-2 rounded-lg" style={{ background: "#FFFBEB", color: "#92400E" }}>
          Falta configurar la base del CRM. Avisale al administrador (ver docs/google-calendar.md).
        </p>
      )}

      {feed.state === "inactive" && (
        <button type="button" disabled={feed.busy} onClick={() => void feed.create()} className={`${primary} mt-3`} style={{ background: "#7C3AED", fontWeight: 700 }}>
          {feed.busy ? "Generando…" : "Generar mi link"}
        </button>
      )}

      {feed.state === "active" && (
        <div className="mt-3 space-y-3">
          {feed.url ? (
            <div className="flex gap-2">
              <input
                readOnly
                value={feed.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Link de suscripción"
                className="flex-1 min-w-0 min-h-11 px-3 rounded-xl text-xs border outline-none bg-white text-[#1F0A3C] border-[#EDE9FE] focus:border-[#7C3AED]"
              />
              <button type="button" onClick={() => void copy()} className={outline} style={{ borderColor: "#DDD6FE", color: "#5B21B6", fontWeight: 700 }}>
                {copied ? "¡Copiado!" : "Copiar"}
              </button>
            </div>
          ) : (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "#F5F3FF", color: "#5B21B6" }}>
              Tenés un link activo, pero lo generaste en otro navegador (lo mostramos una sola vez). Si no lo tenés a mano, generá uno
              nuevo.
            </p>
          )}
          <ol className="list-decimal pl-5 text-xs space-y-1" style={{ color: "#374151" }}>
            <li>Copiá el link. No lo compartas: quien lo tenga ve tu agenda.</li>
            <li>
              En Google Calendar (en la compu): <strong>Otros calendarios → + → Desde URL</strong> → pegá el link → «Agregar calendario».
            </li>
            <li>Listo. Aparece como «PropMatch — Mi agenda». En el celular se ve solo, con la misma cuenta.</li>
          </ol>
          <p className="text-xs" style={{ color: MUTED }}>
            {feed.eventCount} {feed.eventCount === 1 ? "evento" : "eventos"} en el link
            {feed.pushedAt ? ` · actualizado ${fmtWhen(feed.pushedAt)}` : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={feed.busy}
              onClick={() => {
                if (window.confirm("¿Generar un link nuevo? El anterior deja de andar y vas a tener que volver a suscribirte en Google Calendar.")) void feed.rotate();
              }}
              className={outline}
              style={{ borderColor: "#DDD6FE", color: "#5B21B6", fontWeight: 700 }}
            >
              Generar link nuevo
            </button>
            <button
              type="button"
              disabled={feed.busy}
              onClick={() => {
                if (window.confirm("¿Desactivar el link? Google deja de recibir tu agenda (lo ya suscripto queda sin actualizar).")) void feed.revoke();
              }}
              className={outline}
              style={{ borderColor: "#FECDD3", color: "#BE123C", fontWeight: 700 }}
            >
              Desactivar
            </button>
          </div>
        </div>
      )}

      {feed.error && (
        <p role="alert" className="text-xs mt-2" style={{ color: "#BE123C" }}>
          {feed.error}
        </p>
      )}
    </section>
  );
}
