import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "@/data/store";
import {
  AgendaIcon,
  ContactsIcon,
  HomeIcon,
  LogoutIcon,
  MatchesIcon,
  OpportunitiesIcon,
  OperacionesIcon,
  PropertiesIcon,
  ReportesIcon,
  SettingsIcon,
  type IconProps,
} from "@/components/ui/icons";

/**
 * Navegación en el celular.
 *
 * El sidebar de escritorio ocupa 256 px: en un teléfono se come la pantalla.
 * Abajo va una barra de pestañas con lo que un agente usa en la calle
 * (inicio, contactos, propiedades, agenda) y "Más" abre el resto. Queda al
 * alcance del pulgar, como en cualquier app.
 */

interface Item {
  to: string;
  label: string;
  icon: (p: IconProps) => React.ReactElement;
}

const TABS: Item[] = [
  { to: "/", label: "Inicio", icon: HomeIcon },
  { to: "/contactos", label: "Contactos", icon: ContactsIcon },
  { to: "/propiedades", label: "Propiedades", icon: PropertiesIcon },
  { to: "/agenda", label: "Agenda", icon: AgendaIcon },
];

const MORE: Item[] = [
  { to: "/oportunidades", label: "Oportunidades", icon: OpportunitiesIcon },
  { to: "/publicador", label: "Publicaciones", icon: PropertiesIcon },
  { to: "/ofertas", label: "Ofertas", icon: OperacionesIcon },
  { to: "/operaciones", label: "Operaciones", icon: OperacionesIcon },
  { to: "/matches", label: "Matches", icon: MatchesIcon },
  { to: "/reportes", label: "Reportes", icon: ReportesIcon },
  { to: "/configuracion", label: "Configuración", icon: SettingsIcon },
];

export function MobileNav() {
  const { matches, profile, agency, signOut } = useStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const pendingMatches = matches.filter((m) => !m.is_reviewed && !m.is_dismissed).length;
  const moreActive = MORE.some((i) => pathname.startsWith(i.to)) || pathname.startsWith("/importar");

  // Al navegar, la hoja se cierra sola.
  useEffect(() => setMoreOpen(false), [pathname]);

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t flex"
        style={{
          background: "rgba(253,252,255,0.97)",
          borderColor: "#EDE9FE",
          paddingBottom: "env(safe-area-inset-bottom)",
          backdropFilter: "blur(8px)",
        }}
        aria-label="Navegación principal"
      >
        {TABS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 h-16"
          >
            {({ isActive }) => <TabContent item={item} active={isActive} />}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 h-16 relative"
          aria-expanded={moreOpen}
        >
          <span className="relative">
            <span
              className="w-10 h-7 rounded-full flex items-center justify-center gap-[3px]"
              style={{ background: moreActive ? "#EDE9FE" : "transparent" }}
            >
              {[0, 1, 2].map((i) => (
                <span key={i} className="w-1 h-1 rounded-full" style={{ background: moreActive ? "#7C3AED" : "#9CA3AF" }} />
              ))}
            </span>
            {pendingMatches > 0 && (
              <span className="absolute top-0 right-1 w-2 h-2 rounded-full" style={{ background: "#EC4899" }} />
            )}
          </span>
          <span className="text-[11px]" style={{ color: moreActive ? "#7C3AED" : "#6B7280", fontWeight: moreActive ? 700 : 500 }}>
            Más
          </span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="lg:hidden pm-backdrop fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(31,10,60,0.35)" }}
          onClick={() => setMoreOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Más opciones"
        >
          <div
            className="pm-modal w-full rounded-t-3xl p-4"
            style={{ background: "white", paddingBottom: "calc(16px + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "#DDD6FE" }} />
            <div className="flex items-center gap-3 px-2 pb-4 mb-2 border-b" style={{ borderColor: "#F3F0FF" }}>
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm text-white"
                style={{ background: "var(--gradient-brand)", fontWeight: 700 }}
              >
                {profile.initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 700 }}>
                  {profile.full_name}
                </p>
                <p className="text-xs truncate" style={{ color: "#7C6A99" }}>
                  {agency.name}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {MORE.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.to);
                return (
                  <button
                    key={item.to}
                    onClick={() => navigate(item.to)}
                    className="flex items-center gap-3 px-3 py-3.5 rounded-2xl text-left"
                    style={{ background: active ? "var(--gradient-nav-active)" : "#FAFAFF", border: "1px solid #F3F0FF" }}
                  >
                    <Icon size={18} color={active ? "#7C3AED" : "#6B7280"} />
                    <span className="text-sm flex-1" style={{ color: active ? "#7C3AED" : "#1F0A3C", fontWeight: 600 }}>
                      {item.label}
                    </span>
                    {item.to === "/matches" && pendingMatches > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white" style={{ background: "var(--gradient-brand)", fontWeight: 700 }}>
                        {pendingMatches}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={signOut}
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-sm"
              style={{ color: "#E11D48", fontWeight: 600, background: "#FFF1F2" }}
            >
              <LogoutIcon size={15} color="#E11D48" />
              Cerrar sesión
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function TabContent({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <>
      <span
        className="w-12 h-7 rounded-full flex items-center justify-center transition-all"
        style={{ background: active ? "#EDE9FE" : "transparent" }}
      >
        <Icon size={19} color={active ? "#7C3AED" : "#9CA3AF"} />
      </span>
      <span className="text-[11px]" style={{ color: active ? "#7C3AED" : "#6B7280", fontWeight: active ? 700 : 500 }}>
        {item.label}
      </span>
    </>
  );
}
