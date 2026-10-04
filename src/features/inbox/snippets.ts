import type { Property } from "@/types/db";

/** Respuestas rápidas: solo arman texto; el agente lo revisa y lo envía. */
export interface Snippet {
  id: string;
  label: string;
  build: (v: { nombre: string; propiedad: string | null; direccion: string | null }) => string | null;
}

export const SNIPPETS: Snippet[] = [
  {
    id: "visita",
    label: "Confirmar visita",
    build: ({ nombre, propiedad }) =>
      `Hola ${nombre}, ¿te queda bien coordinar una visita${propiedad ? ` a ${propiedad}` : ""}? Decime qué día y horario te viene mejor y lo confirmo.`,
  },
  {
    id: "requisitos",
    label: "Pedir requisitos",
    build: ({ nombre, propiedad }) =>
      `Hola ${nombre}, para avanzar${propiedad ? ` con ${propiedad}` : ""} necesito saber: presupuesto aproximado, fecha en la que querés mudarte y si la operación sería con crédito o contado.`,
  },
  {
    id: "ubicacion",
    label: "Compartir ubicación",
    build: ({ nombre, direccion }) =>
      direccion ? `Hola ${nombre}, te paso la ubicación: ${direccion}.` : null,
  },
];

export function addressOf(p: Property | undefined): string | null {
  if (!p) return null;
  const street = [p.street, p.street_number].filter(Boolean).join(" ");
  const place = [p.zone ?? p.locality].filter(Boolean).join("");
  const full = [street, place].filter(Boolean).join(", ");
  return full || null;
}
