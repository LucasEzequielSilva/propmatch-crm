import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, SectionHeader, Badge } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import {
  ChevronLeftIcon,
  EditIcon,
  HomeIcon,
  MapPinIcon,
  MatchesIcon,
  MatchesSolidIcon,
  StarIcon,
} from "@/components/ui/icons";
import { useStore, STAGE_LABEL } from "@/data/store";
import {
  PROPERTY_STATUS_LABEL,
  PROPERTY_STATUS_STYLE,
  PROPERTY_TYPE_LABEL,
  avatarGradient,
  initials,
  money,
  relativeTime,
} from "@/lib/format";
import type { PropertyStatus } from "@/types/db";
import { ShareListingModal } from "@/components/share/ShareListingModal";
import { WhatsAppButton, WhatsAppModal } from "@/components/share/WhatsAppModal";
import { AUTHORIZATION_TONE_STYLE, authorizationState } from "@/lib/authorization";
import { ownerReport } from "@/lib/ownerReport";
import { WhatsAppIcon } from "@/components/ui/icons";

const OPERATION_LABEL: Record<string, string> = {
  venta: "Venta",
  alquiler: "Alquiler",
  alquiler_temporal: "Alquiler temporal",
};

const STATUSES = Object.keys(PROPERTY_STATUS_LABEL) as PropertyStatus[];

/**
 * Ficha de la propiedad, con las personas compatibles al lado.
 * En el prototipo las cards no llevaban a ningún lado.
 */
export default function PropiedadDetallePage() {
  const navigate = useNavigate();
  const { propertyId } = useParams();
  const {
    propertyById,
    profileById,
    contactById,
    photos,
    matches,
    opportunities,
    events,
    activities,
    updateProperty,
    createOpportunityFromMatch,
  } = useStore();

  const property = propertyById(propertyId);
  const [activePhoto, setActivePhoto] = useState(0);
  // Recién cargada y con matches, la propiedad abre directo el "avisales".
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharing, setSharing] = useState(searchParams.get("compartir") === "1");
  const [reportOpen, setReportOpen] = useState(false);

  const gallery = property ? (photos[property.id] ?? []) : [];

  const propertyMatches = useMemo(
    () => (property ? matches.filter((m) => m.property_id === property.id) : []),
    [matches, property],
  );

  const propertyOpps = useMemo(
    () => (property ? opportunities.filter((o) => o.property_id === property.id) : []),
    [opportunities, property],
  );

  if (!property) {
    return (
      <>
        <AppHeader title="Propiedad" breadcrumb={["Propiedades"]} compact />
        <div className="flex-1 overflow-y-auto px-4 md:px-8">
          <EmptyState
            icon={<HomeIcon size={24} color="#7C3AED" />}
            title="Esta propiedad no existe"
            description="Puede que la hayas eliminado o que el link esté desactualizado."
            action={{ label: "Volver a Propiedades", onClick: () => navigate("/propiedades") }}
          />
        </div>
      </>
    );
  }

  const statusStyle = PROPERTY_STATUS_STYLE[property.status];
  const agent = profileById(property.owner_agent_id);
  const owner = contactById(property.owner_contact_id);
  const auth = authorizationState(property.authorization_type, property.authorization_expires_at);
  const authStyle = AUTHORIZATION_TONE_STYLE[auth.tone];
  const report = ownerReport(property.id, { matches, opportunities, events, activities });
  const cover = gallery[activePhoto] ?? null;

  return (
    <>
      <AppHeader
        title={property.title}
        breadcrumb={["Propiedades", property.title]}
        subtitle={[property.zone, property.province].filter(Boolean).join(", ")}
        compact
      >
        <button
          onClick={() => navigate("/propiedades")}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all hover:border-violet-300"
          style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600, background: "white" }}
        >
          <ChevronLeftIcon size={14} color="#7C3AED" />
          Volver
        </button>
        <button
          onClick={() => setSharing(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "#25D366", fontWeight: 600 }}
        >
          <WhatsAppIcon size={14} color="white" />
          Compartir ficha
        </button>
        <button
          onClick={() => navigate(`/operaciones?propiedad=${property.id}`)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border transition-all hover:bg-violet-50"
          style={{ borderColor: "#EDE9FE", color: "#7C3AED", fontWeight: 600, background: "white" }}
        >
          Iniciar operación
        </button>
        <button
          onClick={() => navigate(`/propiedades/${property.id}/editar`)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-95"
          style={{ background: "var(--gradient-brand)", fontWeight: 600, boxShadow: "var(--shadow-cta)" }}
        >
          <EditIcon size={13} color="white" />
          Editar
        </button>
        <select
          value={property.status}
          onChange={(e) => updateProperty(property.id, { status: e.target.value as PropertyStatus })}
          className="px-4 py-2.5 rounded-xl text-sm border outline-none transition-all focus:border-[#A78BFA] focus:ring-4 focus:ring-[#EDE9FE]"
          style={{ borderColor: "#EDE9FE", background: "white", color: "#1F0A3C", fontWeight: 600 }}
          aria-label="Estado de la propiedad"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROPERTY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </AppHeader>

      {sharing && (
        <ShareListingModal
          property={property}
          onClose={() => {
            setSharing(false);
            if (searchParams.has("compartir")) setSearchParams({}, { replace: true });
          }}
        />
      )}
      {reportOpen && owner && <WhatsAppModal contact={owner} property={property} onClose={() => setReportOpen(false)} />}

      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10">
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
          <div className="space-y-6 min-w-0">
            {/* Galería */}
            <Card>
              <div className="relative" style={{ height: 380, background: "#F5F3FF" }}>
                {cover ? (
                  <img src={cover} alt={property.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                    <HomeIcon size={44} color="#DDD6FE" />
                    <p className="text-sm" style={{ color: "#C4B5FD" }}>
                      Sin fotos cargadas
                    </p>
                  </div>
                )}

                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <span
                    className="text-xs px-2.5 py-1 rounded-full border backdrop-blur-sm"
                    style={{
                      background: `${statusStyle.bg}E6`,
                      color: statusStyle.text,
                      borderColor: statusStyle.border,
                      fontWeight: 600,
                    }}
                  >
                    {PROPERTY_STATUS_LABEL[property.status]}
                  </span>
                  <span
                    className="text-xs px-2.5 py-1 rounded-full backdrop-blur-sm"
                    style={{ background: "rgba(255,255,255,0.9)", color: "#7C3AED", fontWeight: 600 }}
                  >
                    {PROPERTY_TYPE_LABEL[property.type]} · {OPERATION_LABEL[property.operation]}
                  </span>
                </div>

                <button
                  onClick={() => updateProperty(property.id, { is_featured: !property.is_featured })}
                  aria-label={property.is_featured ? "Quitar de destacadas" : "Destacar propiedad"}
                  className="absolute top-4 right-4 w-9 h-9 rounded-xl flex items-center justify-center backdrop-blur-sm transition-all"
                  style={{
                    background: property.is_featured ? "var(--gradient-brand)" : "rgba(255,255,255,0.9)",
                  }}
                >
                  <StarIcon size={15} color={property.is_featured ? "white" : "#9CA3AF"} />
                </button>
              </div>

              {gallery.length > 1 && (
                <div className="p-3 flex gap-2 overflow-x-auto" style={{ background: "white" }}>
                  {gallery.map((url, idx) => (
                    <button
                      key={url}
                      onClick={() => setActivePhoto(idx)}
                      className="rounded-lg overflow-hidden flex-shrink-0 transition-all"
                      style={{
                        width: 80,
                        height: 56,
                        outline: idx === activePhoto ? "2px solid #7C3AED" : "1px solid #EDE9FE",
                        outlineOffset: idx === activePhoto ? 1 : 0,
                      }}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Datos */}
            <Card>
              <div className="px-6 py-5 border-b" style={{ borderColor: "#F3F0FF" }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                      {property.title}
                    </h2>
                    <div className="flex items-center gap-1.5 mt-1">
                      <MapPinIcon size={13} />
                      <span className="text-sm" style={{ color: "#A78BFA" }}>
                        {[property.street, property.street_number, property.zone, property.province]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                      {money(property.price, property.currency)}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#A78BFA" }}>
                      Publicada {relativeTime(property.published_at).toLowerCase()}
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Ambientes", value: property.rooms },
                  { label: "Dormitorios", value: property.bedrooms },
                  { label: "Baños", value: property.bathrooms },
                  { label: "Cocheras", value: property.garages },
                  { label: "Sup. total", value: property.surface_total && `${property.surface_total} m²` },
                  { label: "Sup. cubierta", value: property.surface_covered && `${property.surface_covered} m²` },
                  { label: "Antigüedad", value: property.age_years !== null ? `${property.age_years} años` : null },
                  { label: "Comisión", value: property.commission_pct && `${property.commission_pct}%` },
                ].map((spec) => (
                  <div
                    key={spec.label}
                    className="rounded-xl p-3 text-center"
                    style={{ background: "#FDFCFF", border: "1px solid #F3F0FF" }}
                  >
                    <p className="text-base" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                      {spec.value ?? "—"}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#A78BFA" }}>
                      {spec.label}
                    </p>
                  </div>
                ))}
              </div>

              {property.description && (
                <div className="px-6 pb-6">
                  <p
                    className="text-xs uppercase mb-2"
                    style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
                  >
                    Descripción
                  </p>
                  <p className="text-sm leading-relaxed" style={{ color: "#374151" }}>
                    {property.description}
                  </p>
                </div>
              )}

              {property.features.length > 0 && (
                <div className="px-6 pb-6">
                  <p
                    className="text-xs uppercase mb-2"
                    style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
                  >
                    Características
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {property.features.map((f) => (
                      <span
                        key={f}
                        className="text-xs px-3 py-1.5 rounded-full"
                        style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 500 }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(property.expenses || property.taxes) && (
                <div className="px-6 pb-6 flex gap-6 flex-wrap">
                  {property.expenses !== null && (
                    <div>
                      <p className="text-xs" style={{ color: "#A78BFA", fontWeight: 600 }}>
                        Expensas
                      </p>
                      <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                        {money(property.expenses, "ARS")}
                      </p>
                    </div>
                  )}
                  {property.taxes !== null && (
                    <div>
                      <p className="text-xs" style={{ color: "#A78BFA", fontWeight: 600 }}>
                        Impuestos
                      </p>
                      <p className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                        {money(property.taxes, "ARS")}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Oportunidades */}
            {propertyOpps.length > 0 && (
              <Card>
                <SectionHeader
                  inCard
                  title="Oportunidades sobre esta propiedad"
                  subtitle={`${propertyOpps.length} en el pipeline`}
                  action={{ label: "Ver pipeline", onClick: () => navigate("/oportunidades") }}
                />
                <div className="p-4 space-y-2">
                  {propertyOpps.map((opp) => {
                    const contact = contactById(opp.contact_id);
                    return (
                      <div
                        key={opp.id}
                        className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:bg-violet-50"
                        style={{ border: "1px solid #F3F0FF" }}
                        onClick={() => contact && navigate(`/contactos/${contact.id}`)}
                      >
                        <div
                          className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGradient(contact?.full_name)} flex items-center justify-center text-white flex-shrink-0`}
                          style={{ fontSize: 11, fontWeight: 700 }}
                        >
                          {initials(contact?.full_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                            {contact?.full_name ?? "Sin contacto"}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: "#A78BFA" }}>
                            {relativeTime(opp.updated_at)}
                          </p>
                        </div>
                        <Badge bg="#F5F3FF" text="#7C3AED" border="#DDD6FE">
                          {STAGE_LABEL[opp.stage]}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>

          {/* Columna derecha */}
          <div className="space-y-6">
            {/* Propietario y autorización */}
            <Card>
              <SectionHeader
                inCard
                title="Propietario"
                subtitle="Uso interno: no aparece en la ficha"
                action={{ label: owner ? "Cambiar" : "Cargar", onClick: () => navigate(`/propiedades/${property.id}/editar`) }}
              />
              <div className="p-5 space-y-4">
                {owner ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigate(`/contactos/${owner.id}`)}
                      className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(owner.full_name)} flex items-center justify-center text-white flex-shrink-0 text-xs`}
                      style={{ fontWeight: 700 }}
                      aria-label={`Ver ${owner.full_name}`}
                    >
                      {initials(owner.full_name)}
                    </button>
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => navigate(`/contactos/${owner.id}`)}
                        className="text-sm truncate block text-left hover:underline"
                        style={{ color: "#1F0A3C", fontWeight: 700 }}
                      >
                        {owner.full_name}
                      </button>
                      <p className="text-xs truncate" style={{ color: "#7C6A99" }}>
                        {owner.phone ?? "Sin teléfono"}
                      </p>
                    </div>
                    <WhatsAppButton compact label="Mandar informe por WhatsApp" onClick={() => setReportOpen(true)} />
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: "#A78BFA" }}>
                    Todavía no cargaste quién es el dueño.
                  </p>
                )}

                <span
                  className="inline-block text-xs px-3 py-1.5 rounded-lg"
                  style={{ background: authStyle.bg, color: authStyle.text, border: `1px solid ${authStyle.border}`, fontWeight: 700 }}
                >
                  {auth.label}
                </span>

                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Interesados", value: report.interested },
                    { label: "Avisados", value: report.sentTo },
                    { label: "En conversación", value: report.inProgress },
                    { label: "Visitas", value: report.visitsDone + report.visitsUpcoming },
                  ].map((k) => (
                    <div key={k.label} className="rounded-xl px-3 py-2.5" style={{ background: "#FAFAFF", border: "1px solid #F3F0FF" }}>
                      <p className="text-lg" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                        {k.value}
                      </p>
                      <p className="text-xs" style={{ color: "#A78BFA", fontWeight: 600 }}>
                        {k.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Personas compatibles */}
            <Card>
              <div className="px-5 py-4 relative overflow-hidden" style={{ background: "var(--gradient-brand-wide)" }}>
                <div
                  className="absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-20"
                  style={{ background: "white" }}
                />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-1">
                    <MatchesSolidIcon size={15} />
                    <p
                      className="text-white text-xs uppercase"
                      style={{ letterSpacing: "0.1em", fontWeight: 700 }}
                    >
                      Personas compatibles
                    </p>
                  </div>
                  <p className="text-white text-lg" style={{ fontWeight: 800 }}>
                    {propertyMatches.length}{" "}
                    {propertyMatches.length === 1 ? "coincidencia" : "coincidencias"}
                  </p>
                  <p className="text-white text-xs mt-0.5" style={{ opacity: 0.75 }}>
                    De tu cartera de contactos
                  </p>
                </div>
              </div>

              {propertyMatches.length === 0 ? (
                <EmptyState
                  compact
                  icon={<MatchesIcon size={22} color="#7C3AED" />}
                  title="Nadie encaja todavía"
                  description="Ningún contacto llega al 50% con los criterios que tienen cargados."
                  action={{ label: "Ver contactos", onClick: () => navigate("/contactos") }}
                />
              ) : (
                <div className="p-4 space-y-2.5">
                  {propertyMatches.map((match) => {
                    const contact = contactById(match.contact_id);
                    if (!contact) return null;
                    const hasOpp = propertyOpps.some((o) => o.contact_id === contact.id);
                    return (
                      <div
                        key={match.id}
                        className="p-3 rounded-xl transition-all hover:bg-violet-50 cursor-pointer"
                        style={{ border: "1px solid #F3F0FF" }}
                        onClick={() => navigate(`/matches/${match.id}`)}
                      >
                        <div className="flex items-center gap-2.5 mb-2">
                          <div
                            className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGradient(contact.full_name)} flex items-center justify-center text-white flex-shrink-0`}
                            style={{ fontSize: 11, fontWeight: 700 }}
                          >
                            {initials(contact.full_name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                              {contact.full_name}
                            </p>
                            <p className="text-xs" style={{ color: "#A78BFA" }}>
                              {contact.phone ?? contact.email ?? "Sin contacto"}
                            </p>
                          </div>
                          <span
                            className="text-xs px-2 py-1 rounded-full flex-shrink-0"
                            style={{
                              background: "var(--gradient-soft)",
                              border: "1px solid #EDE9FE",
                              color: "#7C3AED",
                              fontWeight: 700,
                            }}
                          >
                            {match.score}%
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-1 mb-2.5">
                          {match.reasons.slice(0, 2).map((r) => (
                            <span
                              key={r}
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 500, fontSize: 10 }}
                            >
                              ✓ {r}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            createOpportunityFromMatch(match.id);
                          }}
                          disabled={hasOpp}
                          className="w-full py-2 rounded-lg text-xs text-white transition-all hover:opacity-90"
                          style={
                            hasOpp
                              ? { background: "#F0FDF4", color: "#16A34A", fontWeight: 700, border: "1px solid #BBF7D0" }
                              : { background: "var(--gradient-brand)", fontWeight: 600 }
                          }
                        >
                          {hasOpp ? "✓ Ya está en el pipeline" : "Crear oportunidad"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {agent && (
              <Card padded>
                <p
                  className="text-xs uppercase mb-3"
                  style={{ color: "#A78BFA", fontWeight: 700, letterSpacing: "0.1em" }}
                >
                  Agente responsable
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(agent.full_name)} flex items-center justify-center text-white flex-shrink-0`}
                    style={{ fontWeight: 700, fontSize: 12 }}
                  >
                    {agent.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                      {agent.full_name}
                    </p>
                    <p className="text-xs truncate" style={{ color: "#A78BFA" }}>
                      {agent.email}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
