import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";

/**
 * Piezas chicas del deal room. Colores por token (`text-ink`, `border-lilac`,
 * `bg-lavender`…, definidos en `index.css`) y la paleta `rose` de Tailwind
 * para lo negativo: nada de hex sueltos.
 */

export function RoomCard({
  title,
  subtitle,
  action,
  children,
  id,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`rounded-2xl border border-lilac bg-surface shadow-[var(--shadow-card)] overflow-hidden ${className}`}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-divider">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm text-ink font-bold">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-lilac-text mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0 flex items-center gap-2">{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";

const BTN: Record<BtnVariant, string> = {
  primary: "text-white bg-[image:var(--gradient-brand)] border-transparent shadow-[var(--shadow-cta)]",
  secondary: "bg-surface text-brand-purple border-lilac hover:bg-lavender",
  ghost: "bg-transparent text-brand-purple border-transparent hover:bg-lavender",
  danger: "bg-surface text-rose-700 border-rose-200 hover:bg-rose-50",
};

export function Btn({
  children,
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${pad} ${BTN[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Link con aspecto de botón (wa.me, tel:, mailto:). */
export function LinkBtn({
  href,
  children,
  label,
  external,
  size = "sm",
}: {
  href: string;
  children: ReactNode;
  label?: string;
  external?: boolean;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-xl border border-lilac bg-surface text-brand-purple font-semibold hover:bg-lavender transition-colors ${pad}`}
    >
      {children}
    </a>
  );
}

export type Tone = "neutral" | "brand" | "green" | "amber" | "blue" | "red";

const TONE: Record<Tone, string> = {
  neutral: "bg-lavender text-ink-soft border-lilac",
  brand: "bg-lavender text-brand-purple border-lilac",
  green: "bg-state-green-bg text-state-green-text border-state-green-border",
  amber: "bg-state-amber-bg text-state-amber-text border-state-amber-border",
  blue: "bg-state-blue-bg text-state-blue-text border-state-blue-border",
  red: "bg-rose-50 text-rose-700 border-rose-200",
};

export function Pill({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-semibold whitespace-nowrap ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 rounded-full overflow-hidden bg-lilac"
    >
      <div className="h-full rounded-full bg-[image:var(--gradient-brand-h)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Menú desplegable accesible: Escape y clic afuera cierran, flechas recorren. */
export function Menu({
  label,
  children,
  variant = "secondary",
  align = "right",
  disabled,
  title,
  triggerLabel,
}: {
  label: ReactNode;
  children: (close: () => void) => ReactNode;
  variant?: BtnVariant;
  align?: "left" | "right";
  disabled?: boolean;
  title?: string;
  /** aria-label del botón si `label` no es texto. */
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? []);
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[n].focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // Foco al primer ítem al abrir.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus());
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Btn
        variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={triggerLabel}
        disabled={disabled}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <ChevronDownIcon size={10} color="currentColor" />
      </Btn>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={`absolute z-30 mt-1 min-w-56 rounded-xl border border-lilac bg-surface shadow-[var(--shadow-pop)] py-1 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
  danger,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm font-semibold hover:bg-lavender focus:bg-lavender outline-none disabled:opacity-50 ${danger ? "text-rose-700" : "text-ink"}`}
    >
      {children}
    </button>
  );
}

/** Diálogo modal con foco atrapado de forma simple y Escape para cerrar. */
export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(
          ref.current.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("input, select, textarea, button")?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/45"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-lg rounded-2xl bg-surface shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-divider flex items-center justify-between">
          <h2 id={titleId} className="text-lg text-ink font-extrabold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="text-lilac-text text-2xl leading-none px-1">
            ×
          </button>
        </div>
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-divider flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/** Dato con etiqueta chica arriba. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-lilac-text font-semibold">{label}</p>
      <p className="text-sm text-ink font-bold truncate">{value}</p>
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  );
}

/** Aviso de que algo está restringido por rol. */
export function Restricted({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-soft bg-lavender border border-lilac rounded-xl px-3 py-2">{children}</p>;
}
