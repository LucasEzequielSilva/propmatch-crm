import { useEffect, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { BellIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";

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
  const { profile } = useAuth();

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
            <button
              className="relative w-10 h-10 flex items-center justify-center rounded-xl transition-all hover:bg-violet-50"
              style={{ background: "#F5F3FF" }}
              aria-label="Notificaciones"
            >
              <BellIcon />
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
                style={{ background: "#EC4899" }}
              />
            </button>

            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm cursor-pointer flex-shrink-0"
              style={{ background: "var(--gradient-brand)", color: "white", fontWeight: 700 }}
              title={profile?.full_name}
            >
              {profile?.initials ?? "?"}
            </div>
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
