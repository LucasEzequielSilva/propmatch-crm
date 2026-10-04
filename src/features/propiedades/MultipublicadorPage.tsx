import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/data/store";
import { AppHeader } from "@/components/layout/AppHeader";
import { Card, Badge } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/states";
import { HomeIcon, PropertiesIcon, AlertTriangleIcon, MatchesSolidIcon, MapPinIcon } from "@/components/ui/icons";
import { MultipublicationModal, PlatformConfig } from "./MultipublicationModal";
import type { Property } from "@/types/db";
import { PROPERTY_TYPE_LABEL, money } from "@/lib/format";

export default function MultipublicadorPage() {
    const navigate = useNavigate();
    const { properties, photos } = useStore();
    const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
    const [publicationsMap, setPublicationsMap] = useState<Record<string, PlatformConfig[]>>({});

    const getPublications = (propId: string) => {
        return publicationsMap[propId] || [
            { id: "web", name: "Web PropMatch", status: "active", connected: true }
        ];
    };

    const { totalSynced, totalErrors, totalChannels } = useMemo(() => {
        let synced = 0;
        let errs = 0;
        let chans = 0;
        properties.forEach(p => {
            const pubs = getPublications(p.id);
            const activeOrPub = pubs.filter(c => c.status === 'published' || c.status === 'active').length;
            const errored = pubs.filter(c => c.status === 'error').length;
            if (activeOrPub > 0) synced++;
            if (errored > 0) errs++;
            chans += activeOrPub;
        });
        return { totalSynced: synced, totalErrors: errs, totalChannels: chans };
    }, [properties, publicationsMap]);

    return (
        <>
            <AppHeader
                title="Multipublicador"
                subtitle="Publicá tus propiedades en todos los portales desde un solo lugar."
                breadcrumb={["Publicaciones"]}
            />

            <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10">
                <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <StatCard
                        value={String(totalSynced)}
                        label="Propiedades conectadas"
                        sub="En al menos un canal"
                        icon={<MatchesSolidIcon size={22} color="#16A34A" />}
                        iconBg="#F0FDF4"
                        badge={properties.length > 0 ? `${Math.round((totalSynced / properties.length) * 100)}%` : "0%"}
                        badgeBg="#DCFCE7"
                        badgeText="#16A34A"
                        bar="linear-gradient(90deg, #16A34A, #22C55E)"
                        barWidth={properties.length > 0 ? (totalSynced / properties.length) * 100 : 0}
                    />
                    <StatCard
                        value={String(totalChannels)}
                        label="Canales activos Totales"
                        sub="En todo el inventario"
                        icon={<PropertiesIcon size={22} color="#7C3AED" />}
                        iconBg="#F5F3FF"
                        badge={`Avg ${properties.length ? (totalChannels / properties.length).toFixed(1) : 0}`}
                        bar="linear-gradient(90deg, #7C3AED, #A855F7)"
                        barWidth={100}
                    />
                    <StatCard
                        value={String(totalErrors)}
                        label="Errores de sincronización"
                        sub="Requieren tu atención"
                        icon={<AlertTriangleIcon size={22} color={totalErrors > 0 ? "#E11D48" : "#9CA3AF"} />}
                        iconBg={totalErrors > 0 ? "#FFF1F2" : "#F3F4F6"}
                        badge={totalErrors > 0 ? "Revisar" : "Todo Ok"}
                        badgeBg={totalErrors > 0 ? "#FFE4E6" : "#F3F4F6"}
                        badgeText={totalErrors > 0 ? "#E11D48" : "#4B5563"}
                        bar={totalErrors > 0 ? "linear-gradient(90deg, #E11D48, #F43F5E)" : "#E5E7EB"}
                        barWidth={totalErrors > 0 ? 100 : 0}
                    />
                </div>

                <Card>
                    <div className="px-6 py-5 border-b" style={{ borderColor: "#F3F0FF" }}>
                        <h2 className="text-xl tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
                            Distribución de propiedades
                        </h2>
                        <p className="text-sm mt-1" style={{ color: "#7C6A99" }}>
                            Panel de control unificado.
                        </p>
                    </div>

                    {properties.length === 0 ? (
                        <EmptyState
                            icon={<HomeIcon size={24} color="#7C3AED" />}
                            title="Aún no hay propiedades"
                            description="Cargá propiedades en tu CRM para empezar a distribuirlas."
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full bg-white text-left" style={{ minWidth: 800 }}>
                                <thead>
                                    <tr style={{ background: "#FDFCFF", borderBottom: "1px solid #F3F0FF" }}>
                                        <th className="px-5 py-4 text-xs uppercase tracking-wide whitespace-nowrap" style={{ color: "#A78BFA", letterSpacing: "0.06em", fontWeight: 600 }}>Propiedad y Ubicación</th>
                                        <th className="px-5 py-4 text-xs uppercase tracking-wide whitespace-nowrap" style={{ color: "#A78BFA", letterSpacing: "0.06em", fontWeight: 600 }}>Características</th>
                                        <th className="px-5 py-4 text-xs uppercase tracking-wide whitespace-nowrap" style={{ color: "#A78BFA", letterSpacing: "0.06em", fontWeight: 600 }}>Canales Externos</th>
                                        <th className="px-5 py-4 text-xs uppercase tracking-wide whitespace-nowrap text-right" style={{ color: "#A78BFA", letterSpacing: "0.06em", fontWeight: 600 }}>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {properties.map((p, idx) => {
                                        const pubs = getPublications(p.id);
                                        const activeCount = pubs.filter(c => c.status === 'published' || c.status === 'active').length;
                                        const errorCount = pubs.filter(c => c.status === 'error').length;
                                        const photo = (photos[p.id] || [])[0];

                                        return (
                                            <tr
                                                key={p.id}
                                                onClick={() => setSelectedProperty(p)}
                                                className="transition-all hover:bg-[#FAFAFF] cursor-pointer group"
                                                style={{ borderBottom: idx < properties.length - 1 ? "1px solid #F9F7FF" : undefined }}
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 relative shadow-sm" style={{ background: "#F5F3FF" }}>
                                                            {photo ? (
                                                                <img src={photo} alt={p.title} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center"><HomeIcon size={20} color="#DDD6FE" /></div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm truncate mb-0.5" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                                                                {p.title}
                                                            </p>
                                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                                <MapPinIcon size={12} color="#A78BFA" />
                                                                <span className="text-xs truncate" style={{ color: "#7C6A99", fontWeight: 500 }}>
                                                                    {[p.zone, p.province].filter(Boolean).join(", ")}
                                                                </span>
                                                            </div>
                                                            <div className="mt-1">
                                                                <Badge bg="#F5F3FF" text="#7C3AED" size="xs">{PROPERTY_TYPE_LABEL[p.type]}</Badge>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4 whitespace-nowrap">
                                                    <div className="flex flex-col gap-1 text-xs" style={{ color: "#6B7280" }}>
                                                        <span className="font-bold text-[#1F0A3C]">{money(p.price, p.currency)}</span>
                                                        {p.surface_total && <span><strong style={{ color: "#1F0A3C" }}>{p.surface_total}</strong> m²</span>}
                                                        {p.rooms && <span><strong style={{ color: "#1F0A3C" }}>{p.rooms}</strong> amb.</span>}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="flex flex-wrap gap-1.5 max-w-[200px]">
                                                        {pubs.filter(c => c.status === 'published' || c.status === 'active').map(c => (
                                                            <span key={c.id} className="text-[10px] px-2 py-0.5 rounded-md border" style={{ background: "#F8FAFC", borderColor: "#E2E8F0", color: "#475569", fontWeight: 700 }}>
                                                                {c.name}
                                                            </span>
                                                        ))}
                                                        {errorCount > 0 && (
                                                            <span className="text-[10px] px-2 py-0.5 rounded-md border flex items-center gap-1" style={{ background: "#FFF1F2", borderColor: "#FECDD3", color: "#BE123C", fontWeight: 700 }}>
                                                                <AlertTriangleIcon size={10} color="#BE123C" /> {errorCount} Error
                                                            </span>
                                                        )}
                                                        {activeCount === 0 && (
                                                            <span className="text-xs italic text-[#C4B5FD]">Ninguno</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setSelectedProperty(p); }}
                                                        className="px-4 py-2 rounded-xl text-xs transition-all flex items-center justify-center border font-bold hover:shadow-md hover:bg-violet-50 active:scale-95 ml-auto"
                                                        style={{ borderColor: "#EDE9FE", color: "#7C3AED", background: "white" }}
                                                    >
                                                        Configurar
                                                    </button>
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

            {selectedProperty && (
                <MultipublicationModal
                    property={selectedProperty}
                    coverPhoto={(photos[selectedProperty.id] || [])[0] || null}
                    activePublications={getPublications(selectedProperty.id)}
                    onClose={() => setSelectedProperty(null)}
                    onPublishComplete={(newPubs) => {
                        setPublicationsMap(prev => ({ ...prev, [selectedProperty.id]: newPubs }));
                        setSelectedProperty(null);
                    }}
                />
            )}
        </>
    );
}
