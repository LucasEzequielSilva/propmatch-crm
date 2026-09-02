import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

/**
 * Marco de la aplicación: sidebar fijo + área de contenido.
 *
 * Cada pantalla renderiza su propio <AppHeader> dentro del <Outlet>, porque el
 * título, el buscador y el botón de acción son distintos en cada una.
 *
 * El `key` por ruta hace que React remonte el contenido al navegar, que es lo
 * que dispara la animación de entrada. Sin eso el contenido se reemplaza de
 * golpe y la app se siente entrecortada.
 */
export function AppLayout() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-full" style={{ background: "white" }}>
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div key={pathname} className="pm-enter flex-1 flex flex-col overflow-hidden min-w-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
