import { NavLink } from "react-router-dom";
import { useStore } from "@/data/store";
import {
  AgendaIcon,
  ContactsIcon,
  HomeIcon,
  MatchesIcon,
  OpportunitiesIcon,
  OperacionesIcon,
  PropertiesIcon,
  ReportesIcon,
  SettingsIcon,
  LogoutIcon,
  type IconProps,
} from "@/components/ui/icons";

interface NavItem {
  to: string;
  label: string;
  icon: (p: IconProps) => React.ReactElement;
  badge?: "matches" | "offers";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Inicio", icon: HomeIcon },
  { to: "/contactos", label: "Contactos", icon: ContactsIcon },
  { to: "/propiedades", label: "Propiedades", icon: PropertiesIcon },
  { to: "/oportunidades", label: "Oportunidades", icon: OpportunitiesIcon },
  { to: "/publicador", label: "Publicaciones", icon: PropertiesIcon },
  { to: "/ofertas", label: "Ofertas", icon: OperacionesIcon, badge: "offers" },
  { to: "/operaciones", label: "Operaciones", icon: OperacionesIcon },
  { to: "/matches", label: "Matches", icon: MatchesIcon, badge: "matches" },
  { to: "/agenda", label: "Agenda", icon: AgendaIcon },
  { to: "/reportes", label: "Reportes", icon: ReportesIcon },
];

export function Sidebar() {
  const { profile, agency, matches, appOffers, signOut } = useStore();
  const pendingMatches = matches.filter((m) => !m.is_reviewed && !m.is_dismissed).length;
  const pendingOffers = appOffers.filter((o) => o.status === "pending").length;

  return (
    <aside
      className="hidden lg:flex w-64 flex-shrink-0 flex-col border-r overflow-y-auto"
      style={{ borderColor: "#EDE9FE", backgroundColor: "#FDFCFF" }}
    >
      {/* Logo */}
      <div className="px-6 py-6 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
          style={{ background: "var(--gradient-brand)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 12L12 3L21 12V21H15V15H9V21H3V12Z" fill="white" fillOpacity="0.9" />
            <circle cx="16" cy="8" r="3" fill="white" fillOpacity="0.7" />
          </svg>
        </div>
        <div className="min-w-0">
          <div>
            <span className="text-lg tracking-tight" style={{ color: "#3B0764", fontWeight: 800 }}>
              Prop
            </span>
            <span className="text-lg tracking-tight text-gradient-brand-h" style={{ fontWeight: 800 }}>
              Match
            </span>
          </div>
          {agency.name && (
            <p className="text-xs truncate -mt-0.5" style={{ color: "#A78BFA" }}>
              {agency.name}
            </p>
          )}
        </div>
      </div>

      {/* Etiqueta de sección */}
      <div className="px-6 mb-2">
        <span
          className="uppercase"
          style={{ color: "#A78BFA", fontSize: "10px", letterSpacing: "0.12em", fontWeight: 600 }}
        >
          Menú principal
        </span>
      </div>

      {/* Navegación */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const badgeCount =
            item.badge === "matches" ? pendingMatches : item.badge === "offers" ? pendingOffers : 0;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 text-left"
              style={({ isActive }) =>
                isActive
                  ? {
                    background: "var(--gradient-nav-active)",
                    color: "#7C3AED",
                    fontWeight: 600,
                  }
                  : { color: "#6B7280", fontWeight: 500 }
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className="w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 transition-all"
                    style={
                      isActive ? { background: "var(--gradient-brand)" } : { background: "#F3F4F6" }
                    }
                  >
                    <Icon size={16} color={isActive ? "#fff" : "#9CA3AF"} />
                  </span>
                  <span>{item.label}</span>
                  {badgeCount > 0 && (
                    <span
                      className="ml-auto px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--gradient-brand)",
                        color: "white",
                        fontSize: "10px",
                        fontWeight: 700,
                      }}
                    >
                      {badgeCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Pie */}
      <div className="px-3 pb-4 space-y-0.5 border-t pt-4" style={{ borderColor: "#EDE9FE" }}>
        <NavLink
          to="/configuracion"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-all duration-150"
          style={({ isActive }) =>
            isActive
              ? { background: "var(--gradient-nav-active)", color: "#7C3AED", fontWeight: 600 }
              : { color: "#6B7280", fontWeight: 500 }
          }
        >
          {({ isActive }) => (
            <>
              <span
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                style={isActive ? { background: "var(--gradient-brand)" } : { background: "#F3F4F6" }}
              >
                <SettingsIcon size={16} color={isActive ? "#fff" : "#9CA3AF"} />
              </span>
              <span>Configuración</span>
            </>
          )}
        </NavLink>

        {/* Usuario */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-violet-50">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0"
            style={{ background: "var(--gradient-brand)", color: "white", fontWeight: 700 }}
          >
            {profile.initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate" style={{ color: "#1F2937", fontWeight: 600 }}>
              {profile.full_name}
            </p>
            <p className="text-xs truncate" style={{ color: "#9CA3AF" }}>
              {profile.role === "owner"
                ? "Dueño"
                : profile.role === "admin"
                  ? "Administrador"
                  : "Agente inmobiliario"}
            </p>
          </div>
          <button
            onClick={signOut}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-violet-100 flex-shrink-0"
          >
            <LogoutIcon size={14} color="#C4B5FD" />
          </button>
        </div>
      </div>
    </aside>
  );
}
