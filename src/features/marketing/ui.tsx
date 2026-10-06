/** Piezas chicas de UI de Marketing (mismos tokens que el resto del CRM). */
import type { ReactNode } from "react";

export const INPUT =
  "w-full px-3.5 py-2.5 rounded-xl text-sm border outline-none bg-white text-[#1F0A3C] border-[#EDE9FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE]";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="block text-xs mt-1" style={{ color: "#9CA3AF" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="text-xs px-3 py-1.5 rounded-full border transition-all"
      style={
        active
          ? { background: "#1F0A3C", color: "white", borderColor: "transparent", fontWeight: 600 }
          : { background: "white", color: "#7C6A99", borderColor: "#EDE9FE", fontWeight: 500 }
      }
    >
      {children}
    </button>
  );
}

export function Btn({
  children,
  onClick,
  kind = "secondary",
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const style =
    kind === "primary"
      ? { background: "var(--gradient-brand)", color: "white", fontWeight: 600, boxShadow: "var(--shadow-cta)" }
      : kind === "danger"
        ? { background: "#FFF1F2", color: "#BE123C", fontWeight: 600, borderColor: "#FECDD3" }
        : kind === "ghost"
          ? { background: "transparent", color: "#7C3AED", fontWeight: 600, borderColor: "transparent" }
          : { background: "white", color: "#7C3AED", fontWeight: 600, borderColor: "#EDE9FE" };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-4 py-2 rounded-xl text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${kind === "primary" ? "" : "border"}`}
      style={style}
    >
      {children}
    </button>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const s = {
    info: { bg: "#F5F3FF", fg: "#5B21B6", border: "#DDD6FE" },
    warn: { bg: "#FFFBEB", fg: "#92400E", border: "#FDE68A" },
    danger: { bg: "#FFF1F2", fg: "#9F1239", border: "#FECDD3" },
    ok: { bg: "#F0FDF4", fg: "#166534", border: "#BBF7D0" },
  }[tone];
  return (
    <div role="note" className="text-sm px-4 py-3 rounded-xl border" style={{ background: s.bg, color: s.fg, borderColor: s.border }}>
      {children}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div
      className="pm-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(31,10,60,0.35)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`pm-modal rounded-2xl w-full ${wide ? "max-w-4xl" : "max-w-lg"} max-h-[92vh] flex flex-col overflow-hidden`}
        style={{ background: "white", boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}>
          <p className="flex-1 text-base truncate" style={{ color: "#1F0A3C", fontWeight: 800 }}>
            {title}
          </p>
          <button onClick={onClose} aria-label="Cerrar" className="w-8 h-8 rounded-lg hover:bg-violet-50" style={{ color: "#7458C4", fontSize: 20 }}>
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t flex flex-wrap items-center justify-end gap-2" style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Badge rojo "No contactar". */
export function NoContactBadge({ label, size = "xs" }: { label: string | null; size?: "xs" | "sm" }) {
  if (!label) return null;
  return (
    <span
      title="Pidió no recibir más mensajes. Se revierte solo si vuelve a dar su consentimiento."
      className={`inline-flex items-center rounded-full border whitespace-nowrap align-middle ${size === "xs" ? "text-[10px] px-1.5 py-px" : "text-xs px-2 py-0.5"}`}
      style={{ background: "#FFF1F2", color: "#BE123C", borderColor: "#FECDD3", fontWeight: 700 }}
    >
      ⛔ {label}
    </span>
  );
}

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export const pct = (n: number | undefined, d: number | undefined) => (d ? `${Math.round(((n ?? 0) / d) * 100)}%` : "—");
