import type { ReactNode } from "react";

export const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all bg-surface " +
  "text-ink placeholder:text-ink-soft focus:ring-4 focus:ring-lilac " +
  "border-lilac focus:border-brand-purple";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1.5 text-ink-soft font-semibold">
        {label}
      </span>
      {children}
    </label>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs uppercase mb-3 text-brand-purple font-bold tracking-[0.1em]">
      {children}
    </p>
  );
}

/** Número con separador de miles; vacío = `null`. */
export function toNumber(text: string): number | null {
  const digits = text.replace(/[^\d,]/g, "").replace(",", ".");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function NumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value === null ? "" : value.toLocaleString("es-AR")}
      onChange={(e) => onChange(toNumber(e.target.value))}
      placeholder={placeholder}
      inputMode="decimal"
      className={inputClass}
    />
  );
}
