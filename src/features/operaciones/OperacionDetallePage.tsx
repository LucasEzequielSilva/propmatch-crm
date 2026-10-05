import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";
import { ChevronRightIcon } from "@/components/ui/icons";
import { useStore } from "@/data/store";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import { DOCUMENT_LABEL, docProgress, documentsFor, stepProgress, type DocumentKind } from "@/lib/deals";
import { STAGE_STATUS_TEXT, canSeeSensitive, dealNumberLabel, isAdminRole } from "@/lib/dealRoom";
import { Btn, Menu, MenuItem, Modal, Pill, type Tone } from "./room/primitives";
import type { Room } from "./room/room";
import { StageStepper } from "./room/StageStepper";
import { SummaryCards } from "./room/SummaryCards";
import { ChecklistCard } from "./room/ChecklistCard";
import { DocsTableCard } from "./room/DocsTableCard";
import { SignaturesCard } from "./room/SignaturesCard";
import { HistoryCard } from "./room/HistoryCard";
import { FinanceCard, PaymentModal } from "./room/FinanceCard";
import { AlertsBox, KeyDatesCard } from "./room/KeyDatesCard";
import { NotesContactCard } from "./room/NotesContactCard";
import { PublicationCard } from "./room/PublicationCard";
import { DealDataCard } from "./room/DealDataCard";

/** Deal room: el expediente completo de una venta o un alquiler. */
export default function OperacionDetallePage() {
  const navigate = useNavigate();
  const { dealId } = useParams();
  const { deals, propertyById, contactById, updateDeal, removeDeal, updateProperty, moveOpportunity, profile, profiles } = useStore();
  const deal = deals.find((d) => d.id === dealId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paying, setPaying] = useState(false);

  if (!deal) {
    return (
      <>
        <AppHeader title="Operación" compact />
        <EmptyState
          title="No encontramos esta operación"
          action={{ label: "Volver a Operaciones", onClick: () => navigate("/operaciones") }}
        />
      </>
    );
  }

  const property = propertyById(deal.property_id);
  const isSale = deal.kind === "venta";
  const isAdmin = isAdminRole(profile.role);
  const room: Room = {
    deal,
    property,
    propertyTitle: property?.title ?? "la propiedad",
    client: contactById(deal.client_contact_id),
    ownerContact: contactById(deal.owner_contact_id),
    profile,
    profiles,
    isAdmin,
    canSensitive: canSeeSensitive(deal, profile),
    isSale,
    update: (patch, event) => updateDeal(deal.id, patch, event),
  };

  const number = dealNumberLabel(deal.number);
  const kindLabel = isSale ? "Venta" : "Alquiler";
  const steps = stepProgress(deal);
  const docs = docProgress(deal);
  const statusText =
    deal.status === "cerrada" ? "Operación cerrada" : deal.status === "caida" ? "Operación caída" : STAGE_STATUS_TEXT[deal.kind][deal.stage];
  const statusTone: Tone = deal.status === "cerrada" ? "green" : deal.status === "caida" ? "red" : "brand";
  const canDelete = isAdmin || deal.responsible_id === profile.id;

  const closeDeal = () => {
    updateDeal(deal.id, { status: "cerrada" });
    if (property) updateProperty(property.id, { status: isSale ? "vendida" : "alquilada" });
    if (deal.opportunity_id) moveOpportunity(deal.opportunity_id, "cierre");
  };

  const dropDeal = () => {
    updateDeal(deal.id, { status: "caida" });
    if (property && property.status === "reservada") updateProperty(property.id, { status: "disponible" });
  };

  const reopen = () => {
    updateDeal(deal.id, { status: "en_curso" });
    // Al reabrir una caída, la propiedad vuelve a quedar reservada (como al crearla).
    if (property && property.status === "disponible") updateProperty(property.id, { status: "reservada" });
  };

  const openDocument = (k: DocumentKind) => {
    updateDeal(deal.id, {}, { type: "document", title: `Generó el modelo de ${DOCUMENT_LABEL[k]}` });
    window.open(`/operaciones/${deal.id}/documento/${k}`, "_blank", "noopener");
  };

  return (
    <>
      <AppHeader title={`Operación ${number}`} subtitle={`${kindLabel} — ${property?.title ?? "Sin propiedad"}`} compact />

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10">
        <nav aria-label="Ubicación" className="mt-5 mb-3">
          <ol className="flex flex-wrap items-center gap-1 text-xs">
            <li>
              <Link to="/operaciones" className="text-brand-purple font-semibold hover:underline">
                Operaciones
              </Link>
            </li>
            <li aria-hidden="true" className="text-lilac-faint">
              <ChevronRightIcon size={12} color="currentColor" />
            </li>
            <li aria-current="page" className="text-ink-soft font-medium min-w-0 break-words">
              Operación {number} · {kindLabel} — {property?.title ?? "Sin propiedad"}
            </li>
          </ol>
        </nav>

        <section aria-label="Encabezado de la operación" className="rounded-2xl border border-lilac bg-surface shadow-[var(--shadow-card)] p-5 mb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-ink text-white tracking-wide">{number}</span>
                <Pill tone="neutral">
                  {kindLabel}
                  {property ? ` · ${PROPERTY_TYPE_LABEL[property.type]}` : ""}
                </Pill>
                <Pill tone={statusTone}>{statusText}</Pill>
              </div>
              <h2 className="text-lg md:text-xl text-ink font-extrabold mt-2 break-words">{property?.title ?? "Sin propiedad"}</h2>
              <p className="text-xs text-ink-soft mt-1">
                Pasos {steps.done}/{steps.total} · Documentos {docs.done}/{docs.total}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Menu
                label="Generar documento"
                disabled={!room.canSensitive}
                title={!room.canSensitive ? "Lo generan administración o el responsable (incluye datos legales)" : undefined}
              >
                {(close) =>
                  documentsFor(deal.kind).map((k) => (
                    <MenuItem
                      key={k}
                      onClick={() => {
                        close();
                        openDocument(k);
                      }}
                    >
                      {DOCUMENT_LABEL[k]}
                    </MenuItem>
                  ))
                }
              </Menu>
              {room.canSensitive && (
                <Btn variant="primary" onClick={() => setPaying(true)}>
                  Registrar pago
                </Btn>
              )}
              <Menu label="Más" triggerLabel="Más acciones">
                {(close) => (
                  <>
                    {deal.status === "en_curso" ? (
                      <>
                        <MenuItem
                          onClick={() => {
                            close();
                            closeDeal();
                          }}
                        >
                          Marcar como cerrada
                        </MenuItem>
                        <MenuItem
                          onClick={() => {
                            close();
                            dropDeal();
                          }}
                        >
                          Marcar como caída
                        </MenuItem>
                      </>
                    ) : (
                      <MenuItem
                        onClick={() => {
                          close();
                          reopen();
                        }}
                      >
                        Reabrir operación
                      </MenuItem>
                    )}
                    <MenuItem
                      danger
                      disabled={!canDelete}
                      onClick={() => {
                        close();
                        setConfirmDelete(true);
                      }}
                    >
                      Eliminar operación{!canDelete ? " (solo administración o responsable)" : ""}
                    </MenuItem>
                  </>
                )}
              </Menu>
            </div>
          </div>
          <p className="text-xs text-lilac-text mt-3">
            Los modelos de documento son orientativos: que los revise un escribano o abogado antes de firmar.
          </p>
        </section>

        <StageStepper room={room} />
        <SummaryCards room={room} />

        <div className="xl:hidden mb-5">
          <AlertsBox deal={deal} />
        </div>

        <div className="grid gap-5 xl:grid-cols-10 items-start">
          <div className="space-y-5 xl:col-span-7 min-w-0">
            <ChecklistCard room={room} />
            <DocsTableCard room={room} />
            <SignaturesCard room={room} />
            <DealDataCard room={room} />
            <HistoryCard room={room} />
          </div>
          <div className="space-y-5 xl:col-span-3 min-w-0">
            <div className="hidden xl:block">
              <AlertsBox deal={deal} />
            </div>
            <FinanceCard room={room} onRegisterPayment={() => setPaying(true)} />
            <KeyDatesCard room={room} />
            <NotesContactCard room={room} />
            <PublicationCard room={room} />
          </div>
        </div>
      </div>

      {paying && room.canSensitive && <PaymentModal room={room} onClose={() => setPaying(false)} />}

      {confirmDelete && (
        <Modal
          title="¿Eliminar esta operación?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Btn onClick={() => setConfirmDelete(false)}>No, volver</Btn>
              <Btn
                variant="danger"
                onClick={() => {
                  removeDeal(deal.id);
                  navigate("/operaciones");
                }}
              >
                Sí, eliminar
              </Btn>
            </>
          }
        >
          <p className="text-sm text-ink">
            Se borra {number} con su checklist, pagos e historial. No se puede deshacer. Si la operación no prosperó, usá “Marcar como caída”.
          </p>
        </Modal>
      )}
    </>
  );
}
