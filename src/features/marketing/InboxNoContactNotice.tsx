import { useStore } from "@/data/store";
import { useContactBlock } from "@/lib/marketing/block";

/**
 * Aviso en el inbox: este contacto pidió no recibir más mensajes. Responder
 * algo que él mismo preguntó sigue siendo posible; lo que no se puede es
 * mandarle promociones ni campañas.
 */
export function InboxNoContactNotice({ contactId, phone, email }: { contactId: string | null | undefined; phone?: string | null; email?: string | null }) {
  const { agency, contactById } = useStore();
  const c = contactById(contactId);
  const block = useContactBlock(agency.id, { id: c?.id ?? contactId ?? "", phone: c?.phone ?? phone ?? null, email: c?.email ?? email ?? null });
  if (!block.any) return null;
  return (
    <p role="note" className="text-xs mb-2 px-3 py-2 rounded-lg border" style={{ background: "#FFF1F2", color: "#9F1239", borderColor: "#FECDD3", fontWeight: 600 }}>
      ⛔ {block.label}: pidió no recibir más mensajes. Respondé solo lo que te consulte; no le mandes promociones ni propiedades que no pidió.
    </p>
  );
}
