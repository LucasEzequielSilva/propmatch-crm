import type { Property } from "@/types/db";

// Las respuestas rápidas ahora son editables: viven en automationState/automationDefaults.
export function addressOf(p: Property | undefined): string | null {
  if (!p) return null;
  const street = [p.street, p.street_number].filter(Boolean).join(" ");
  const place = [p.zone ?? p.locality].filter(Boolean).join("");
  const full = [street, place].filter(Boolean).join(", ");
  return full || null;
}
