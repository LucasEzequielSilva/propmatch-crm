import type { IconProps } from "@/components/ui/icons";

/** Ícono de "Mercado": barras con una línea de tendencia. Mismo trazo que el resto (stroke 2, 24×24). */
export function MercadoIcon({ size = 20, color = "currentColor", className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M3 21H21" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M6 17V13M11 17V10M16 17V12M20 17V7" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
