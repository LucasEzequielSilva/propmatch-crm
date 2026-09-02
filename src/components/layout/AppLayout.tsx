import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

/**
 * Marco de la aplicación: sidebar fijo + área de contenido.
 *
 * Cada pantalla renderiza su propio <AppHeader> dentro del <Outlet>, porque el
 * título, el buscador y el botón de acción son distintos en cada una.
 */
export function AppLayout() {
  return (
    <div className="flex h-full" style={{ background: "white" }}>
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
