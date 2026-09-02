import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionHeader, Badge } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import {
  ActivityIcon,
  ContactsIcon,
  HomeIcon,
  MapPinIcon,
  MatchesSolidIcon,
  OpportunitiesIcon,
  StarOutlineIcon,
} from "@/components/ui/icons";
import { useStore, STAGE_LABEL } from "@/data/store";
import {
  avatarGradient,
  greeting,
  initials,
  money,
  moneyCompact,
  relativeTime,
} from "@/lib/format";
import type { OpportunityStage } from "@/types/db";

const STAGE_BADGE: Record<OpportunityStage, { bg: string; text: string; border: string }> = {
  nuevos: { bg: "#F5F3FF", text: "#7C3AED", border: "#DDD6FE" },
  contactados: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  visita: { bg: "#ECFEFF", text: "#0E7490", border: "#CFFAFE" },
  negociacion: { bg: "#FFFBEB", text: "#B45309", border: "#FDE68A" },
  cierre: { bg: "#F0FDF4", text: "#047857", border: "#D1FAE5" },
  perdida: { bg: "#FFF1F2", text: "#E11D48", border: "#FECDD3" },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const {
    profile,
    properties,
    contacts,
    opportunities,
    matches,
    activities,
    contactById,
    propertyById,
    coverPhoto,
  } = useStore();

  const [query, setQuery] = useState("");
  const firstName = profile.full_name.split(" ")[0];

  const kpis = useMemo(() => {
    const monthAgo = Date.now() - 30 * 86_400_000;
    const weekAgo = Date.now() - 7 * 86_400_000;
    const activeProps = properties.filter((p) => p.status === "disponible");
    const newContacts = contacts.filter((c) => new Date(c.created_at).getTime() > monthAgo);
    const newContactsWeek = contacts.filter((c) => new Date(c.created_at).getTime() > weekAgo);
    const openOpps = opportunities.filter((o) => o.stage !== "perdida");
    const pipelineValue = openOpps.reduce((s, o) => s + (o.value ?? 0), 0);
    return { activeProps, newContacts, newContactsWeek, openOpps, pipelineValue };
  }, [properties, contacts, opportunities]);

  /** Búsqueda global: cruza propiedades, contactos y oportunidades. */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return {
      properties: properties.filter((p) => p.title.toLowerCase().includes(q)).slice(0, 5),
      contacts: contacts.filter((c) => c.full_name.toLowerCase().includes(q)).slice(0, 5),
    };
  }, [query, properties, contacts]);

  const recentOpps = useMemo(
    () =>
      [...opportunities]
        .filter((o) => o.stage !== "perdida")
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 4),
    [opportunities],
  );

  const topMatches = useMemo(() => matches.slice(0, 3), [matches]);
  const recentActivity = activities.slice(0, 5);

  return (
    <>
      <AppHeader
        title={`${greeting()}, ${firstName}`}
        titleAccent={<span className="text-gradient-brand-h"> ✦</span>}
        subtitle="Así se mueve tu negocio hoy."
        search={{ placeholder: "Buscar...", value: query, onChange: setQuery }}
        action={{ label: "Agregar", onClick: () => navigate("/propiedades/nueva") }}
      />

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {searchResults ? (
          <SearchResults
            results={searchResults}
            coverPhoto={coverPhoto}
            onClear={() => setQuery("")}
            onProperty={() => navigate("/propiedades")}
            onContact={() => navigate("/contactos")}
          />
        ) : (
          <>
            {/* KPIs */}
            <div className="mt-8 grid grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard
                value={String(kpis.activeProps.length)}
                label="Propiedades activas"
                sub={`${properties.length} en cartera`}
                icon={<HomeIcon size={22} color="#7C3AED" />}
                iconBg="#F5F3FF"
                badge={`${properties.length - kpis.activeProps.length} no disponibles`}
                badgeBg="#F5F3FF"
                badgeText="#7C3AED"
                bar="linear-gradient(90deg, #7C3AED, #A855F7)"
                barWidth={(kpis.activeProps.length / Math.max(1, properties.length)) * 100}
              />
              <StatCard
                value={String(kpis.newContacts.length)}
                label="Nuevos contactos"
                sub={`${kpis.newContactsWeek.length} esta semana`}
                icon={<ContactsIcon size={22} color="#EC4899" />}
                iconBg="#FDF2F8"
                badge={`+${kpis.newContactsWeek.length}`}
                bar="linear-gradient(90deg, #EC4899, #F472B6)"
                barWidth={(kpis.newContacts.length / Math.max(1, contacts.length)) * 100}
              />
              <StatCard
                value={String(kpis.openOpps.length)}
                label="Oportunidades activas"
                sub={`${matches.length} matches disponibles`}
                icon={<OpportunitiesIcon size={22} color="#8B5CF6" />}
                iconBg="#F5F3FF"
                badge={`${matches.length} matches`}
                badgeBg="#F5F3FF"
                badgeText="#7C3AED"
                bar="linear-gradient(90deg, #8B5CF6, #C084FC)"
                barWidth={72}
              />
              <StatCard
                value={moneyCompact(kpis.pipelineValue)}
                label="Valor del pipeline"
                sub="Operaciones abiertas"
                icon={<StarOutlineIcon size={22} />}
                iconBg="#FAF5FF"
                badge="Activo"
                badgeBg="#F0FDF4"
                badgeText="#16A34A"
                bar="linear-gradient(90deg, #A855F7, #EC4899)"
                barWidth={90}
              />
            </div>

            <div className="mt-8 grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Oportunidades recientes */}
              <div className="xl:col-span-2 min-w-0">
                <Card>
                  <SectionHeader
                    inCard
                    title="Oportunidades recientes"
                    subtitle={`${kpis.openOpps.length} oportunidades activas`}
                    action={{ label: "Ver todas", onClick: () => navigate("/oportunidades") }}
                  />
                  {recentOpps.length === 0 ? (
                    <EmptyState
                      compact
                      title="Todavía no hay oportunidades"
                      description="Convertí un match en oportunidad para verlas acá."
                      action={{ label: "Ver matches", onClick: () => navigate("/matches") }}
                    />
                  ) : (
                    <div className="bg-white overflow-x-auto">
                      <table className="w-full" style={{ minWidth: 620 }}>
                        <thead>
                          <tr style={{ background: "#FDFCFF", borderBottom: "1px solid #F3F0FF" }}>
                            {["Cliente", "Propiedad", "Etapa", "Valor", "Actividad"].map((h) => (
                              <th
                                key={h}
                                className="text-left px-5 py-3 text-xs uppercase tracking-wide whitespace-nowrap"
                                style={{ color: "#A78BFA", letterSpacing: "0.06em", fontWeight: 600 }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {recentOpps.map((opp, idx) => {
                            const contact = contactById(opp.contact_id);
                            const property = propertyById(opp.property_id);
                            const badge = STAGE_BADGE[opp.stage];
                            return (
                              <tr
                                key={opp.id}
                                onClick={() => navigate("/oportunidades")}
                                className="transition-all hover:bg-violet-50 cursor-pointer"
                                style={{
                                  borderBottom:
                                    idx < recentOpps.length - 1 ? "1px solid #F9F7FF" : undefined,
                                }}
                              >
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <div
                                      className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient(contact?.full_name)} flex items-center justify-center text-xs text-white flex-shrink-0`}
                                      style={{ fontWeight: 700 }}
                                    >
                                      {initials(contact?.full_name)}
                                    </div>
                                    <span
                                      className="text-sm whitespace-nowrap"
                                      style={{ color: "#1F2937", fontWeight: 500 }}
                                    >
                                      {contact?.full_name ?? "—"}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5">
                                  <p className="text-sm" style={{ color: "#374151", fontWeight: 500 }}>
                                    {property?.title ?? "—"}
                                  </p>
                                  <p className="text-xs" style={{ color: "#C4B5FD" }}>
                                    {property?.zone ?? ""}
                                  </p>
                                </td>
                                <td className="px-5 py-3.5">
                                  <Badge bg={badge.bg} text={badge.text} border={badge.border}>
                                    {STAGE_LABEL[opp.stage]}
                                  </Badge>
                                </td>
                                <td className="px-5 py-3.5 whitespace-nowrap">
                                  <span className="text-sm" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                                    {money(opp.value, opp.currency)}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 whitespace-nowrap">
                                  <span className="text-xs" style={{ color: "#A78BFA" }}>
                                    {relativeTime(opp.updated_at)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              </div>

              {/* Actividad */}
              <div className="xl:col-span-1 min-w-0">
                <Card className="h-full">
                  <SectionHeader
                    inCard
                    title="Actividad reciente"
                    subtitle="Últimas acciones del equipo"
                  />
                  <div className="p-5 space-y-4">
                    {recentActivity.map((a, idx) => (
                      <div key={a.id} className="flex gap-3 relative">
                        {idx < recentActivity.length - 1 && (
                          <div
                            className="absolute left-[18px] top-8 w-px"
                            style={{ height: "calc(100% + 8px)", background: "#EDE9FE" }}
                          />
                        )}
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 z-10"
                          style={{ background: "#F5F3FF", color: "#7C3AED" }}
                        >
                          <ActivityIcon type={iconFor(a.type)} />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm" style={{ color: "#374151", fontWeight: 500 }}>
                            {a.title}
                          </p>
                          {a.detail && (
                            <p
                              className="text-xs mt-0.5 truncate"
                              style={{ color: "#1F0A3C", fontWeight: 600 }}
                            >
                              {a.detail}
                            </p>
                          )}
                          <p className="text-xs mt-1" style={{ color: "#C4B5FD" }}>
                            {relativeTime(a.created_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>

            {/* Matches */}
            <div className="mt-8">
              <SectionHeader
                title="Matches para revisar"
                subtitle="Clientes con alta compatibilidad de propiedades"
                action={{ label: "Ver todos", onClick: () => navigate("/matches") }}
              />
              {topMatches.length === 0 ? (
                <Card>
                  <EmptyState
                    compact
                    title="Todavía no hay matches"
                    description="Cargá propiedades y qué busca cada contacto para que el sistema los cruce."
                  />
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {topMatches.map((match) => {
                    const contact = contactById(match.contact_id);
                    const property = propertyById(match.property_id);
                    if (!contact || !property) return null;
                    return (
                      <div
                        key={match.id}
                        onClick={() => navigate(`/matches/${match.id}`)}
                        className="rounded-2xl border overflow-hidden transition-all hover:shadow-lg cursor-pointer"
                        style={{
                          borderColor: "#EDE9FE",
                          background: "white",
                          boxShadow: "var(--shadow-card)",
                        }}
                      >
                        <div
                          className="px-5 pt-5 pb-4 relative overflow-hidden"
                          style={{ background: "var(--gradient-soft)" }}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-baseline gap-1">
                                <span
                                  className="text-4xl leading-none text-gradient-brand"
                                  style={{ fontWeight: 800 }}
                                >
                                  {match.score}%
                                </span>
                                <span className="text-sm" style={{ color: "#7C3AED", fontWeight: 600 }}>
                                  MATCH
                                </span>
                              </div>
                              <div className="flex items-center gap-1 mt-1">
                                {[...Array(5)].map((_, i) => (
                                  <div
                                    key={i}
                                    className="h-1.5 rounded-full"
                                    style={{
                                      width: i < Math.round((match.score / 100) * 5) ? "18px" : "10px",
                                      background:
                                        i < Math.round((match.score / 100) * 5)
                                          ? "var(--gradient-brand-h)"
                                          : "#E9D5FF",
                                    }}
                                  />
                                ))}
                              </div>
                            </div>
                            <div
                              className="w-20 h-20 rounded-full opacity-10 absolute -right-6 -top-6"
                              style={{ background: "#EC4899" }}
                            />
                          </div>
                        </div>

                        <div className="p-5">
                          <div className="flex items-center gap-3 mb-4">
                            <div
                              className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(contact.full_name)} flex items-center justify-center text-sm text-white flex-shrink-0`}
                              style={{ fontWeight: 700 }}
                            >
                              {initials(contact.full_name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                                {contact.full_name}
                              </p>
                              <p className="text-xs" style={{ color: "#A78BFA" }}>
                                Busca su propiedad ideal
                              </p>
                            </div>
                          </div>

                          <div
                            className="rounded-xl p-3 mb-4"
                            style={{ background: "#FDFCFF", border: "1px solid #EDE9FE" }}
                          >
                            <div className="flex items-start gap-2">
                              <HomeIcon size={14} color="#7C3AED" />
                              <div className="min-w-0">
                                <p className="text-sm truncate" style={{ color: "#1F2937", fontWeight: 500 }}>
                                  {property.title}
                                </p>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <MapPinIcon size={10} />
                                  <p className="text-xs" style={{ color: "#9CA3AF" }}>
                                    {property.zone}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1.5 mb-4">
                            {match.reasons.slice(0, 3).map((tag) => (
                              <span
                                key={tag}
                                className="text-xs px-2.5 py-1 rounded-full"
                                style={{ background: "#F5F3FF", color: "#7C3AED", fontWeight: 500 }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                              {money(property.price, property.currency)}
                            </span>
                            <span
                              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-white"
                              style={{ background: "var(--gradient-brand)", fontWeight: 600 }}
                            >
                              <MatchesSolidIcon size={11} />
                              Ver match
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function iconFor(type: string): string {
  if (type.startsWith("contacto")) return "contact";
  if (type === "propiedad_publicada") return "property";
  if (type === "visita_programada") return "calendar";
  if (type === "etapa_avanzada") return "arrow";
  if (type === "llamada") return "eye";
  return "match";
}

function SearchResults({
  results,
  coverPhoto,
  onClear,
  onProperty,
  onContact,
}: {
  results: {
    properties: { id: string; title: string; zone: string | null; price: number | null }[];
    contacts: { id: string; full_name: string; email: string | null }[];
  };
  coverPhoto: (id: string) => string | null;
  onClear: () => void;
  onProperty: () => void;
  onContact: () => void;
}) {
  const empty = results.properties.length === 0 && results.contacts.length === 0;

  return (
    <div className="mt-8">
      <SectionHeader
        title="Resultados de la búsqueda"
        subtitle={`${results.properties.length} propiedades · ${results.contacts.length} contactos`}
        action={{ label: "Limpiar", onClick: onClear }}
      />
      {empty ? (
        <Card>
          <EmptyState compact title="Sin resultados" description="Probá con otro nombre o dirección." />
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {results.properties.length > 0 && (
            <Card>
              <SectionHeader inCard title="Propiedades" />
              <div className="p-3">
                {results.properties.map((p) => {
                  const photo = coverPhoto(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={onProperty}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-violet-50 text-left"
                    >
                      <div
                        className="w-11 h-11 rounded-lg overflow-hidden flex-shrink-0"
                        style={{ background: "#F5F3FF" }}
                      >
                        {photo && <img src={photo} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                          {p.title}
                        </p>
                        <p className="text-xs" style={{ color: "#A78BFA" }}>
                          {p.zone}
                        </p>
                      </div>
                      <span className="text-sm whitespace-nowrap" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                        {money(p.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          )}

          {results.contacts.length > 0 && (
            <Card>
              <SectionHeader inCard title="Contactos" />
              <div className="p-3">
                {results.contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={onContact}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-violet-50 text-left"
                  >
                    <div
                      className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGradient(c.full_name)} flex items-center justify-center text-xs text-white flex-shrink-0`}
                      style={{ fontWeight: 700 }}
                    >
                      {initials(c.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 600 }}>
                        {c.full_name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "#A78BFA" }}>
                        {c.email}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
