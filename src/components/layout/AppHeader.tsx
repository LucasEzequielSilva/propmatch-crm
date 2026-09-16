import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/data/store";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { NotificationsMenu } from "./NotificationsMenu";

/**
 * Header único de la aplicación.
 *
 * En el prototipo cada pantalla traía su propio header casi idéntico
 * (ContactosHeader, PropiedadesHeader, OportunidadesHeader, MatchesHeader,
 * AgendaHeader, ReportesHeader): ~500 líneas repetidas donde solo cambiaba el
 * título, el subtítulo y el botón de la derecha. Todo eso es este componente.
 *
 * Además el "buscador" de aquel header era un <div> decorativo. Acá es un
 * <input> de verdad, con debounce, que reporta hacia arriba.
 */

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  /** Migas: "PropMatch / Reportes". Solo Reportes las usaba. */
  breadcrumb?: string[];
  /** Adorno del título (el ✦ del dashboard). */
  titleAccent?: React.ReactNode;
  search?: {
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  };
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Controles extra a la izquierda del bloque de acciones. */
  children?: React.ReactNode;
  /** Oculta campana y avatar (pantallas de detalle con su propia barra). */
  compact?: boolean;
}

export function AppHeader({
  title,
  subtitle,
  breadcrumb,
  titleAccent,
  search,
  action,
  children,
  compact = false,
}: AppHeaderProps) {

  return (
    <header
      className="flex items-center justify-between gap-4 px-8 py-5 border-b flex-shrink-0"
      style={{ borderColor: "#EDE9FE", backgroundColor: "#FDFCFF" }}
    >
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <p className="text-xs mb-1" style={{ color: "#A78BFA", fontWeight: 500 }}>
            {breadcrumb.map((crumb, i) => (
              <span key={crumb}>
                {i > 0 && <span style={{ color: "#DDD6FE" }}> / </span>}
                <span
                  style={
                    i === breadcrumb.length - 1
                      ? { color: "#7C3AED", fontWeight: 600 }
                      : undefined
                  }
                >
                  {crumb}
                </span>
              </span>
            ))}
          </p>
        )}
        <h1 className="text-2xl tracking-tight truncate" style={{ color: "#1F0A3C", fontWeight: 800 }}>
          {title}
          {titleAccent}
        </h1>
        {subtitle && (
          <p className="text-sm mt-0.5" style={{ color: "#7C6A99" }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {children}

        {search && <HeaderSearch {...search} />}

        {!compact && (
          <>
            <NotificationsMenu />

            <AccountMenu />
          </>
        )}

        {action && (
          <button
            onClick={action.onClick}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm text-white transition-all hover:opacity-90 active:scale-95 whitespace-nowrap"
            style={{
              background: "var(--gradient-brand)",
              fontWeight: 600,
              boxShadow: "var(--shadow-cta)",
            }}
          >
            <PlusIcon />
            {action.label}
          </button>
        )}
      </div>
    </header>
  );
}

/** Avatar del header: acceso a Configuración y a cerrar sesión. */
function AccountMenu() {
  const { profile, agency, signOut } = useStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass = "w-full text-left px-4 py-2.5 text-sm transition-all hover:bg-violet-50";

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-10 h-10 rounded-full flex items-center justify-center text-sm transition-all hover:opacity-90"
        style={{ background: "var(--gradient-brand)", color: "white", fontWeight: 700 }}
        aria-label={`Cuenta de ${profile.full_name}`}
        aria-expanded={open}
      >
        {profile.initials}
      </button>

      {open && (
        <div
          className="pm-modal absolute right-0 mt-2 w-60 rounded-2xl border overflow-hidden z-50"
          style={{ background: "white", borderColor: "#EDE9FE", boxShadow: "0 12px 40px rgba(76, 29, 149, 0.15)" }}
        >
          <div className="px-4 py-3 border-b" style={{ borderColor: "#F5F3FF" }}>
            <p className="text-sm truncate" style={{ color: "#1F0A3C", fontWeight: 700 }}>
              {profile.full_name}
            </p>
            <p className="text-xs truncate" style={{ color: "#7C6A99" }}>
              {profile.email ?? agency.name}
            </p>
          </div>
          <button
            className={itemClass}
            style={{ color: "#1F0A3C", fontWeight: 500 }}
            onClick={() => {
              setOpen(false);
              navigate("/configuracion");
            }}
          >
            Configuración
          </button>
          <button
            className={itemClass + " border-t"}
            style={{ color: "#E11D48", fontWeight: 600, borderColor: "#F5F3FF" }}
            onClick={signOut}
          >
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

/** Input real, con debounce de 250 ms para no consultar en cada tecla. */
function HeaderSearch({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  // Si el padre limpia la búsqueda (por ejemplo al cambiar de filtro), seguirlo.
  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    if (local === value) return;
    const id = setTimeout(() => onChange(local), 250);
    return () => clearTimeout(id);
  }, [local, value, onChange]);

  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm focus-within:ring-2 focus-within:ring-[#DDD6FE] transition-all"
      style={{ background: "#F5F3FF", width: 220 }}
    >
      <SearchIcon />
      <input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent outline-none w-full text-[#1F0A3C] placeholder:text-[#C4B5FD]"
        style={{ fontSize: 14 }}
      />
      {local && (
        <button
          onClick={() => {
            setLocal("");
            onChange("");
          }}
          aria-label="Limpiar búsqueda"
          className="flex-shrink-0"
          style={{ color: "#C4B5FD", lineHeight: 1 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
