/** Piezas del formulario de propiedades (inputs, secciones numeradas, chips). */

import { useId } from "react";
import { Card } from "@/components/ui/Card";
import { CheckIcon, PlusIcon } from "@/components/ui/icons";

export const inputClass = (hasError: boolean) =>
  "w-full px-4 min-h-11 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] placeholder:text-[#7C6A99] focus:ring-4 focus:ring-[#EDE9FE] disabled:opacity-50 " +
  (hasError ? "border-[#FECDD3] focus:border-[#FB7185]" : "border-[#EDE9FE] focus:border-[#7C3AED]");

export const selectClass =
  "w-full px-4 min-h-11 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] border-[#EDE9FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE]";

/** Card numerada con ancla (`id`) para el subnav. */
export function FormSection({
  id,
  number,
  title,
  subtitle,
  done,
  children,
}: {
  id: string;
  number: number;
  title: string;
  subtitle?: string;
  done: boolean;
  children: React.ReactNode;
}) {
  const headingId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20">
      <Card>
        <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: "#F3F0FF" }}>
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-sm"
            style={
              done
                ? { background: "var(--gradient-brand)", color: "white", fontWeight: 800 }
                : { background: "#F5F3FF", color: "#7C3AED", fontWeight: 800 }
            }
            aria-hidden="true"
          >
            {done ? <CheckIcon size={14} color="white" /> : number}
          </span>
          <div className="min-w-0">
            <h2 id={headingId} tabIndex={-1} className="text-base outline-none" style={{ color: "#1F0A3C", fontWeight: 800 }}>
              {number}. {title}
              {done && <span className="sr-only"> (completa)</span>}
            </h2>
            {subtitle && (
              <p className="text-xs mt-0.5" style={{ color: "#7458C4" }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </Card>
    </section>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  /** Texto chico debajo del control (contadores, aclaraciones). */
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
      {hint && !error && <span className="block text-xs mt-1.5">{hint}</span>}
      {error && (
        <span className="block text-xs mt-1.5" style={{ color: "#E11D48", fontWeight: 500 }}>
          {error}
        </span>
      )}
    </label>
  );
}

/** Número + selector de moneda en una sola fila. */
export function MoneyField({
  label,
  value,
  onValue,
  currency,
  onCurrency,
  placeholder,
  error,
  hint,
  id: idProp,
  currencyId,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  currency: "USD" | "ARS";
  onCurrency: (c: "USD" | "ARS") => void;
  placeholder?: string;
  error?: string;
  hint?: React.ReactNode;
  /** id del input del número (para llevar el foco desde "Completar"). */
  id?: string;
  /** id del selector de moneda. */
  currencyId?: string;
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <div>
      <label htmlFor={id} className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </label>
      <div className="flex gap-2">
        <select
          id={currencyId}
          value={currency}
          onChange={(e) => onCurrency(e.target.value as "USD" | "ARS")}
          aria-label={`Moneda de ${label.toLowerCase()}`}
          className={selectClass.replace("w-full", "w-24 flex-shrink-0")}
        >
          <option value="USD">USD</option>
          <option value="ARS">ARS</option>
        </select>
        <input
          id={id}
          value={value}
          onChange={(e) => onValue(e.target.value.replace(/[^\d]/g, ""))}
          inputMode="numeric"
          placeholder={placeholder}
          className={inputClass(!!error)}
        />
      </div>
      {hint && !error && <div className="text-xs mt-1.5">{hint}</div>}
      {error && (
        <p className="text-xs mt-1.5" style={{ color: "#E11D48", fontWeight: 500 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  id,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** id del botón "Sumar": es el que recibe el foco desde "Completar". */
  id?: string;
}) {
  return (
    <div role="group" aria-label={label}>
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      <div
        className="flex items-center justify-between px-1.5 min-h-11 rounded-xl border"
        style={{ borderColor: "#EDE9FE", background: "white" }}
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          aria-label={`Restar ${label.toLowerCase()}`}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:bg-violet-100"
          style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 700 }}
        >
          −
        </button>
        <span className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }} aria-live="polite">
          {value}
        </span>
        <button
          id={id}
          type="button"
          onClick={() => onChange(value + 1)}
          aria-label={`Sumar ${label.toLowerCase()}`}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:bg-violet-100"
          style={{ background: "#F5F3FF" }}
        >
          <PlusIcon size={12} color="#7C3AED" />
        </button>
      </div>
    </div>
  );
}

export function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="text-xs px-3.5 min-h-11 rounded-full transition-all border"
      style={
        active
          ? { background: "var(--gradient-brand)", color: "white", borderColor: "transparent", fontWeight: 600 }
          : { background: "white", color: "#7C6A99", borderColor: "#EDE9FE", fontWeight: 500 }
      }
    >
      {active && "✓ "}
      {label}
    </button>
  );
}

/** Interruptor accesible (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 min-h-11 text-left"
    >
      <span
        className="relative w-10 h-6 rounded-full flex-shrink-0 transition-all"
        style={{ background: checked ? "var(--gradient-brand)" : "#DDD6FE" }}
        aria-hidden="true"
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
          style={{ left: checked ? 18 : 2, boxShadow: "0 1px 3px rgba(31,10,60,0.25)" }}
        />
      </span>
      <span>
        <span className="block text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>
          {label}
        </span>
        {description && (
          <span className="block text-xs" style={{ color: "#7C6A99" }}>
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

/** Tono de un contador: verde si está dentro de la regla, ámbar si no. */
export function CounterHint({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span style={{ color: ok ? "#15803D" : "#B45309", fontWeight: 600 }} aria-live="polite">
      {children}
    </span>
  );
}
