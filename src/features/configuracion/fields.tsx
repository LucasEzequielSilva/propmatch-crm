import type { ReactNode } from "react";

/** Piezas de formulario compartidas por las tarjetas de Configuración. */

export const inputClass =
  "w-full px-4 py-2.5 rounded-xl text-sm border outline-none transition-all bg-white " +
  "text-[#1F0A3C] placeholder:text-[#7C6A99] border-[#EDE9FE] focus:border-[#7C3AED] focus:ring-4 focus:ring-[#EDE9FE] " +
  "disabled:bg-[#FAFAFF] disabled:text-[#7C6A99] disabled:cursor-not-allowed";

export function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs mb-1.5" style={{ color: "#7C6A99", fontWeight: 600 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
