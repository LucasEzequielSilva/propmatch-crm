import type { Contact } from "@/types/db";
import { useStore } from "@/data/store";
import { useContactBlock } from "@/lib/marketing/block";
import { NoContactBadge } from "./ui";

/** Badge "No contactar" de un contacto (vacío si no está dado de baja). */
export function ContactNoContactBadge({ contact, size = "sm" }: { contact: Pick<Contact, "id" | "email" | "phone">; size?: "xs" | "sm" }) {
  const { agency } = useStore();
  const block = useContactBlock(agency.id, contact);
  return <NoContactBadge label={block.label} size={size} />;
}
