import { isSample } from "@/lib/samples";

/**
 * Etiqueta "Ejemplo" para registros de la semilla (`is_sample`). Lila neutro,
 * con los mismos tokens que el resto de los chips (index.css). No renderiza
 * nada si el registro no es de ejemplo, así se puede poner en cualquier fila.
 */
export function SampleBadge({
  record,
  show,
  size = "xs",
  className = "",
}: {
  record?: { is_sample?: boolean } | null;
  /** Forzar (por ejemplo, un match cuyo contacto o propiedad es de ejemplo). */
  show?: boolean;
  size?: "xs" | "sm";
  className?: string;
}) {
  if (!(show ?? isSample(record))) return null;
  return (
    <span
      title="Dato de ejemplo: solo vive en este navegador. No se sincroniza, no se publica ni se envía."
      className={[
        "inline-flex items-center rounded-full border flex-shrink-0 whitespace-nowrap align-middle",
        size === "xs" ? "text-[10px] px-1.5 py-px" : "text-xs px-2 py-0.5",
        className,
      ].join(" ")}
      style={{
        background: "var(--color-lavender)",
        color: "var(--color-lilac-text)",
        borderColor: "var(--color-lilac)",
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      Ejemplo
    </span>
  );
}

/** Aviso en línea para acciones que se bloquean con datos de ejemplo. */
export function SampleNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="note"
      className="text-sm px-4 py-3 rounded-xl border"
      style={{ background: "var(--color-lavender)", color: "var(--color-lilac-text)", borderColor: "var(--color-lilac)", fontWeight: 600 }}
    >
      {children}
    </p>
  );
}
