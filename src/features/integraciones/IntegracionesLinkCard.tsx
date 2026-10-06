import { Link } from "react-router-dom";
import { Card, SectionHeader } from "@/components/ui/Card";
import { PORTALS } from "@/lib/integrations/registry";
import { PortalLogo } from "./PortalLogo";

/** Acceso desde Configuración a Configuración → Integraciones. */
export function IntegracionesLinkCard() {
  return (
    <Card>
      <SectionHeader inCard title="Integraciones" subtitle="Portales conectados a tu inmobiliaria" />
      <div className="p-5 flex flex-col gap-3">
        <div className="flex gap-2" aria-hidden="true">
          {PORTALS.map((p) => (
            <PortalLogo key={p.id} meta={p} size={36} />
          ))}
        </div>
        <p className="text-sm" style={{ color: "#4B5563" }}>
          Conectá Mercado Libre y los demás portales una sola vez y publicá cada propiedad en todos a la vez.
        </p>
        <Link
          to="/configuracion/integraciones"
          className="self-start inline-flex items-center min-h-[44px] px-5 rounded-xl text-sm text-white"
          style={{ background: "var(--gradient-brand)", fontWeight: 700 }}
        >
          Ver integraciones
        </Link>
      </div>
    </Card>
  );
}
