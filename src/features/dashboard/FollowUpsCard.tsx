import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/Card";
import { WhatsAppButton, WhatsAppModal } from "@/components/share/WhatsAppModal";
import { useStore } from "@/data/store";
import { useFollowUps } from "@/data/useFollowUps";
import { avatarGradient, initials } from "@/lib/format";
import { firstName } from "@/lib/whatsapp";
import type { FollowUp } from "@/lib/followups";

/**
 * "Para contactar hoy": la lista de trabajo del agente al abrir el CRM.
 *
 * Cada fila se resuelve en un toque: escribir por WhatsApp (con la plantilla
 * que corresponde al motivo), marcar que ya se habló por otro medio, o
 * posponer. Cualquiera de las tres la saca de la lista.
 */

const PRIORITY_STYLE = {
  1: { dot: "#E11D48", label: "Urgente" },
  2: { dot: "#F59E0B", label: "Hoy" },
  3: { dot: "#A78BFA", label: "Cuando puedas" },
} as const;

const COLLAPSED = 5;

export function FollowUpsCard() {
  const navigate = useNavigate();
  const { propertyById, logActivity, snoozeFollowUp } = useStore();
  const followUps = useFollowUps();
  const [expanded, setExpanded] = useState(false);
  const [writing, setWriting] = useState<FollowUp | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const visible = expanded ? followUps : followUps.slice(0, COLLAPSED);
  const urgent = followUps.filter((f) => f.priority === 1).length;

  function markDone(f: FollowUp) {
    logActivity({
      type: "llamada",
      title: `Seguimiento a ${firstName(f.contact.full_name)}`,
      detail: f.reason,
      contact_id: f.contact.id,
      property_id: null,
    });
    flash(f.contact.full_name);
  }

  function flash(name: string) {
    setDone(name);
    setTimeout(() => setDone(null), 2200);
  }

  return (
    <Card>
      <div
        className="px-5 py-4 border-b flex items-center justify-between gap-3"
        style={{ borderColor: "#F3F0FF", background: "white" }}
      >
        <div className="min-w-0">
          <h2 className="text-base" style={{ color: "#1F0A3C", fontWeight: 700 }}>
            Para contactar hoy
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#A78BFA" }}>
            {followUps.length === 0
              ? "Estás al día con tus contactos"
              : `${followUps.length} ${followUps.length === 1 ? "contacto" : "contactos"}${urgent ? ` · ${urgent} ${urgent === 1 ? "urgente" : "urgentes"}` : ""}`}
          </p>
        </div>
        {done && (
          <span className="pm-toast text-xs px-3 py-1.5 rounded-lg" style={{ background: "#F0FDF4", color: "#15803D", fontWeight: 600 }}>
            ✓ {firstName(done)} listo
          </span>
        )}
      </div>

      {followUps.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-3xl">🎉</p>
          <p className="text-sm mt-2" style={{ color: "#7C6A99" }}>
            Nadie esperando respuesta. Buen momento para cargar propiedades.
          </p>
        </div>
      ) : (
        <div className="p-3 pm-stagger">
          {visible.map((f) => {
            const p = PRIORITY_STYLE[f.priority];
            return (
              <div key={f.contact.id} className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-violet-50">
                <button
                  onClick={() => navigate(`/contactos/${f.contact.id}`)}
                  className={`relative w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(f.contact.full_name)} flex items-center justify-center text-xs text-white flex-shrink-0`}
                  style={{ fontWeight: 700 }}
                  aria-label={`Ver ${f.contact.full_name}`}
                >
                  {initials(f.contact.full_name)}
                  <span
                    className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
                    style={{ background: p.dot }}
                    title={p.label}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => navigate(`/contactos/${f.contact.id}`)}
                    className="text-sm truncate block max-w-full text-left hover:underline"
                    style={{ color: "#1F0A3C", fontWeight: 600 }}
                  >
                    {f.contact.full_name}
                  </button>
                  <p className="text-xs truncate" style={{ color: f.priority === 1 ? "#BE123C" : "#7C6A99", fontWeight: f.priority === 1 ? 600 : 400 }}>
                    {f.reason}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <WhatsAppButton compact label={`WhatsApp a ${f.contact.full_name}`} onClick={() => setWriting(f)} />
                  <button
                    onClick={() => markDone(f)}
                    className="h-9 px-2.5 rounded-xl text-xs border transition-all hover:bg-white"
                    style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600, background: "#FDFCFF" }}
                    title="Ya hablé con este contacto por otro medio"
                  >
                    ✓ Hecho
                  </button>
                  <button
                    onClick={() => snoozeFollowUp(f.contact.id, 3)}
                    className="h-9 px-2.5 rounded-xl text-xs transition-all hover:bg-white"
                    style={{ color: "#A78BFA", fontWeight: 600 }}
                    title="No mostrar por 3 días"
                  >
                    Posponer
                  </button>
                </div>
              </div>
            );
          })}
          {followUps.length > COLLAPSED && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full mt-1 py-2 rounded-xl text-xs transition-all hover:bg-violet-50"
              style={{ color: "#7C3AED", fontWeight: 600 }}
            >
              {expanded ? "Ver menos" : `Ver los ${followUps.length - COLLAPSED} restantes`}
            </button>
          )}
        </div>
      )}

      {writing && (
        <WhatsAppModal
          key={writing.contact.id}
          contact={writing.contact}
          property={propertyById(writing.propertyId)}
          template={writing.template}
          onClose={() => setWriting(null)}
          onSent={() => flash(writing.contact.full_name)}
        />
      )}
    </Card>
  );
}
