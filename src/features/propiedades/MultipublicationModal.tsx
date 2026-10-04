import { useEffect, useState } from "react";
import { Property } from "@/types/db";
import { money } from "@/lib/format";
import { CheckCircleIcon, AlertTriangleIcon, HomeIcon } from "@/components/ui/icons";

export type PublishState = "idle" | "publishing" | "done";
export type PlatformStatus = "published" | "pending" | "error" | "unpublished" | "disconnected" | "active";

export interface PlatformConfig {
  id: string;
  name: string;
  status: PlatformStatus;
  lastSync?: string;
  externalId?: string;
  url?: string;
  errorMessage?: string;
  connected: boolean;
}

const INITIAL_PLATFORMS: PlatformConfig[] = [
  { id: "ml", name: "Mercado Libre", status: "unpublished", connected: true },
  { id: "zp", name: "Zonaprop", status: "unpublished", connected: true },
  { id: "ap", name: "Argenprop", status: "disconnected", connected: false },
  { id: "cp", name: "CABAPROP", status: "unpublished", connected: true },
  { id: "fb", name: "Facebook", status: "unpublished", connected: true },
  { id: "ig", name: "Instagram", status: "unpublished", connected: true },
  { id: "web", name: "Web PropMatch", status: "active", connected: true },
];

export function MultipublicationModal({
  property,
  coverPhoto,
  activePublications,
  onClose,
  onPublishComplete
}: {
  property: Property;
  coverPhoto: string | null;
  activePublications: PlatformConfig[];
  onClose: () => void;
  onPublishComplete: (newPubs: PlatformConfig[]) => void;
}) {
  const [platforms, setPlatforms] = useState<PlatformConfig[]>(
    INITIAL_PLATFORMS.map(p => {
      const active = activePublications.find(a => a.id === p.id);
      return active ? { ...p, ...active } : p;
    })
  );

  const [selected, setSelected] = useState<Set<string>>(new Set(
    platforms.filter(p => p.connected && p.status !== 'active').map(p => p.id)
  ));

  const [publishState, setPublishState] = useState<PublishState>("idle");

  // Determinar si hay cambios pendientes por sincronizar (simulado)
  const isSyncMode = platforms.some(p => p.status === 'published' && p.lastSync === "hace 2 días"); // mocked condition for sync mode

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handlePublish = () => {
    setPublishState("publishing");

    // Simular el proceso de publicación
    const simulatePlatform = (id: string, newStatus: PlatformStatus, err?: string, timeout: number = 1000) => {
      setTimeout(() => {
        setPlatforms(prev => prev.map(p => p.id === id ? {
          ...p,
          status: newStatus,
          errorMessage: err,
          lastSync: newStatus === 'published' ? 'ahora mismo' : p.lastSync,
          externalId: newStatus === 'published' ? `${id.toUpperCase()}${Math.floor(Math.random() * 10000)}` : p.externalId,
          url: newStatus === 'published' ? `https://demo.propmatch.com/ext/${id}/${property.id}` : p.url
        } : p));
      }, timeout);
    };

    Array.from(selected).forEach((id, index) => {
      // Configuramos para el demo que argenprop falle y el resto funcione
      simulatePlatform(id, "pending", undefined, 0); // Empiezan a cargar instantaneamente

      const time = 1000 + (index * 800);
      if (id === 'ap') {
        simulatePlatform(id, "error", "Falta superficie cubierta.", time);
      } else {
        simulatePlatform(id, "published", undefined, time);
      }
    });

    const totalTime = 1000 + (selected.size * 800) + 500;
    setTimeout(() => {
      setPublishState("done");
    }, totalTime);
  };

  const handleFinish = () => {
    onPublishComplete(platforms);
  };

  const successCount = platforms.filter(p => selected.has(p.id) && p.status === 'published').length;
  const errorCount = platforms.filter(p => selected.has(p.id) && p.status === 'error').length;

  return (
    <div
      className="pm-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      style={{ background: "rgba(31,10,60,0.35)" }}
      onClick={publishState === "publishing" ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Publicar propiedad"
    >
      <div
        className="pm-modal rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        style={{ background: "white", boxShadow: "var(--shadow-pop)", overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b flex items-center justify-between" style={{ borderColor: "#EDE9FE", background: "#FDFCFF" }}>
          <div>
            <p className="text-lg tracking-tight" style={{ color: "#1F0A3C", fontWeight: 800 }}>
              {isSyncMode ? "Sincronizar cambios" : "Publicar propiedad"}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: "#7C6A99" }}>
              Distribuye tu inventario a todos los canales
            </p>
          </div>
          {publishState !== "publishing" && (
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:bg-violet-50"
              style={{ color: "#A78BFA", fontSize: 20, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Ficha resumen */}
          <div className="flex gap-4 p-3 rounded-xl" style={{ border: "1px solid #EDE9FE", background: "#FAFAFF" }}>
            <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#F5F3FF] flex items-center justify-center flex-shrink-0">
              {coverPhoto ? (
                <img src={coverPhoto} alt="Cover" className="w-full h-full object-cover" />
              ) : (
                <HomeIcon size={24} color="#DDD6FE" />
              )}
            </div>
            <div className="flex-1 min-w-0 pr-2 pt-1">
              <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 700 }}>{property.title}</p>
              <p className="text-xs truncate mt-0.5" style={{ color: "#7C6A99" }}>
                {[property.zone, property.province].filter(Boolean).join(" · ")}
                <span className="mx-1 font-bold">·</span>
                {money(property.price, property.currency)}
              </p>
              <div className="flex gap-2 mt-1">
                <span className="text-[10px] uppercase font-bold" style={{ color: "#A78BFA" }}>
                  {property.surface_total ? `${property.surface_total} m²` : ''}
                  {property.bedrooms ? ` · ${property.bedrooms} dorm` : ''}
                  {property.bathrooms ? ` · ${property.bathrooms} baño` : ''}
                </span>
              </div>
            </div>
          </div>

          {publishState === "idle" && (
            <div>
              <p className="text-xs uppercase mb-3" style={{ color: "#7C3AED", fontWeight: 700, letterSpacing: "0.1em" }}>
                ¿Dónde querés publicar esta propiedad?
              </p>
              <div className="space-y-2">
                {platforms.map(platform => {
                  const isActive = platform.status === 'active';
                  const isConnected = platform.connected;
                  if (isActive) {
                    return (
                      <div key={platform.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ border: "1px solid #EDE9FE", opacity: 0.8 }}>
                        <input type="checkbox" disabled checked className="w-4 h-4 rounded text-violet-600 focus:ring-violet-500" />
                        <div className="flex-1">
                          <p className="text-sm font-bold text-[#1F0A3C]">{platform.name}</p>
                          <p className="text-xs font-semibold text-[#16A34A] mt-0.5">Activo (Propio)</p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={platform.id}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all hover:bg-violet-50"
                      style={{ border: `1px solid ${selected.has(platform.id) ? '#A78BFA' : '#F3F0FF'}` }}
                      onClick={() => isConnected && toggleSelect(platform.id)}
                    >
                      <input
                        type="checkbox"
                        disabled={!isConnected}
                        checked={selected.has(platform.id)}
                        onChange={(e) => { e.stopPropagation(); isConnected && toggleSelect(platform.id); }}
                        className="w-4 h-4 rounded text-violet-600 focus:ring-violet-500"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-[#1F0A3C]">{platform.name}</p>
                        {isConnected ? (
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-xs font-semibold text-[#7C6A99]">Conectado</span>
                            {platform.lastSync && (
                              <>
                                <span className="text-[#D1D5DB]">•</span>
                                <span className="text-xs text-[#A78BFA]">Última sincronización: {platform.lastSync}</span>
                              </>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs font-semibold text-[#F97316] mt-0.5">No conectado</p>
                        )}
                      </div>
                      {!isConnected && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPlatforms(prev => prev.map(p => p.id === platform.id ? { ...p, connected: true } : p)) }}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg border text-[#7C3AED] hover:bg-violet-50"
                          style={{ borderColor: "#EDE9FE" }}>
                          Conectar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {publishState === "publishing" && (
            <div className="flex flex-col items-center justify-center py-6">
              <p className="text-lg font-bold text-[#1F0A3C] mb-6">Procesando publicaciones...</p>
              <div className="w-full space-y-3">
                {platforms.filter(p => selected.has(p.id)).map(p => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-[#FAFAFF] border border-[#F3F0FF]">
                    <span className="text-sm font-bold text-[#1F0A3C]">{p.name}</span>
                    <span className="text-sm font-semibold flex items-center gap-1.5">
                      {p.status === "unpublished" && <span className="text-[#A78BFA]">Esperando...</span>}
                      {p.status === "pending" && <span className="text-yellow-600">⏳ Publicando...</span>}
                      {p.status === "published" && <span className="text-[#16A34A]">✓ Publicada</span>}
                      {p.status === "error" && <span className="text-red-500">⚠ Error</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {publishState === "done" && (
            <div className="flex flex-col items-center justify-center py-4">
              <h3 className="text-2xl font-black text-[#1F0A3C] tracking-tight mb-2">Publicación completada</h3>
              <p className="text-sm text-[#7C6A99] font-medium mb-6">
                {successCount} publicaciones exitosas<br />
                {errorCount > 0 && <span className="text-red-500">{errorCount} {errorCount === 1 ? 'publicación requiere' : 'publicaciones requieren'} atención.</span>}
              </p>

              <div className="w-full space-y-3 mb-6">
                {platforms.filter(p => selected.has(p.id) || p.status === 'error').map(p => (
                  <div key={p.id} className="flex items-start justify-between p-3 rounded-xl bg-[#FAFAFF] border border-[#F3F0FF]">
                    <div>
                      <span className="text-sm font-bold text-[#1F0A3C]">{p.name}</span>
                      {p.errorMessage && <p className="text-xs text-red-500 mt-1">"{p.errorMessage}"</p>}
                    </div>
                    <span className="text-sm font-bold">
                      {p.status === "published" && <span className="text-[#16A34A] flex items-center gap-1"><CheckCircleIcon size={14} color="#16A34A" /> Éxito</span>}
                      {p.status === "error" && <span className="text-red-500 flex items-center gap-1"><AlertTriangleIcon size={14} color="red" /> Falló</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t" style={{ borderColor: "#EDE9FE", background: "#FAFAFF" }}>
          {publishState === "idle" && (
            <button
              disabled={selected.size === 0}
              onClick={handlePublish}
              className="w-full py-3.5 rounded-xl flex items-center justify-center text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: "var(--gradient-brand)", fontWeight: 700, boxShadow: "var(--shadow-cta)", fontSize: '0.95rem' }}
            >
              {isSyncMode ? `Sincronizar cambios en ${selected.size} canales` : `Publicar en ${selected.size} canales`}
            </button>
          )}

          {publishState === "done" && (
            <div className="flex gap-3">
              <button
                onClick={handleFinish}
                className="flex-1 py-3.5 rounded-xl border flex items-center justify-center text-[#7C3AED] hover:bg-violet-50 transition-all font-bold"
                style={{ borderColor: "#EDE9FE" }}
              >
                Ver publicaciones
              </button>
              {errorCount > 0 && (
                <button
                  onClick={() => setPublishState("idle")}
                  className="flex-1 py-3.5 rounded-xl flex items-center justify-center text-white transition-all hover:opacity-90 active:scale-95 font-bold"
                  style={{ background: "var(--gradient-brand)", boxShadow: "var(--shadow-cta)" }}
                >
                  Corregir y Reintentar
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
