import { DOCUMENT_LABEL, documentsFor, type DocumentKind } from "@/lib/deals";
import { Btn, RoomCard } from "./primitives";
import type { Room } from "./room";

const DOC_HINT: Record<DocumentKind, string> = {
  reserva: "Reserva / oferta de compra con monto, plazo y condiciones.",
  boleto_compraventa: "Boleto con precio, anticipo, saldo y fecha de escritura.",
  contrato_alquiler: "Contrato con plazo, montos, ajustes y garantía.",
};

/**
 * Generador de documentos: reserva, boleto o contrato armados con los datos de
 * la operación. Se abren en otra pestaña, el texto se edita en pantalla y se
 * imprime o guarda como PDF (ver DocumentoPage).
 */
export function DocumentsCard({ room, onOpen }: { room: Room; onOpen: (k: DocumentKind) => void }) {
  return (
    <RoomCard
      title="Documentos para firmar"
      subtitle="Se completan solos con los datos de la operación. Podés editar el texto antes de imprimir o guardar como PDF."
    >
      <ul className="grid gap-2">
        {documentsFor(room.deal.kind).map((k) => (
          <li key={k} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border border-lilac px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink font-semibold">{DOCUMENT_LABEL[k]}</p>
              <p className="text-xs text-lilac-text mt-0.5">{DOC_HINT[k]}</p>
            </div>
            <Btn
              variant="primary"
              size="sm"
              className="min-h-11 sm:min-h-0"
              disabled={!room.canSensitive}
              title={!room.canSensitive ? "Lo generan administración o el responsable (incluye datos legales)" : undefined}
              onClick={() => onOpen(k)}
            >
              Abrir y personalizar →
            </Btn>
          </li>
        ))}
      </ul>
      <p className="text-xs text-lilac-text mt-3">
        Son modelos orientativos: que los revise un escribano o abogado antes de firmar.
      </p>
    </RoomCard>
  );
}
