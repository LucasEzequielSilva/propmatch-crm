/**
 * Grupo de pestañas tipo segmented control.
 *
 * El prototipo lo repetía en Contactos ("Todos / Activos / Nuevos / Con
 * matches"), Matches ("Todos / Alta compatibilidad / ...") y Propiedades
 * ("Comprar / Alquilar"), siempre con los mismos estilos.
 */
export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "md" | "lg";
}) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl flex-shrink-0"
      style={{ background: "#F5F3FF" }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-lg text-sm transition-all whitespace-nowrap ${
              size === "lg" ? "px-5 py-1.5" : "px-4 py-1.5"
            }`}
            style={
              active
                ? {
                    background: "var(--gradient-brand)",
                    color: "white",
                    fontWeight: 600,
                    boxShadow: "0 2px 8px rgba(124,58,237,0.25)",
                  }
                : { color: "#7C6A99", fontWeight: 500 }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filtro desplegable.
 *
 * En el prototipo estos botones ("Zona", "Precio", "Tipo de propiedad"…) no
 * abrían nada: eran decorativos. Acá abren y filtran de verdad.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";

export function FilterDropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  allLabel = "Todos",
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const isActive = value !== null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm border transition-all hover:border-violet-300 whitespace-nowrap"
        style={
          isActive
            ? { background: "#F5F3FF", borderColor: "#DDD6FE", color: "#7C3AED", fontWeight: 600 }
            : { background: "white", borderColor: "#EDE9FE", color: "#7C6A99", fontWeight: 500 }
        }
      >
        {selected ? `${label}: ${selected.label}` : label}
        <ChevronDownIcon color={isActive ? "#A78BFA" : "#C4B5FD"} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-xl overflow-hidden z-50 py-1 max-h-72 overflow-y-auto"
          style={{
            background: "white",
            border: "1px solid #EDE9FE",
            boxShadow: "var(--shadow-pop)",
            minWidth: 190,
          }}
        >
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2.5 text-sm transition-all hover:bg-violet-50"
            style={{ color: value === null ? "#7C3AED" : "#374151", fontWeight: value === null ? 700 : 500 }}
          >
            {value === null && <span className="mr-2">✓</span>}
            {allLabel}
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2.5 text-sm transition-all hover:bg-violet-50"
              style={{
                color: opt.value === value ? "#7C3AED" : "#374151",
                fontWeight: opt.value === value ? 700 : 500,
              }}
            >
              {opt.value === value && <span className="mr-2">✓</span>}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
