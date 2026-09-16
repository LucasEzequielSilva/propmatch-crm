import { Outlet, useLocation } from "react-router-dom";
import { useStore } from "@/data/store";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";

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
  const { persistFailed } = useStore();

  return (
    <div className="flex h-full" style={{ background: "white" }}>
      <Sidebar />
      {/* En celular el lugar de la barra inferior se descuenta del contenido. */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0 pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
        {persistFailed && (
          <div
            role="alert"
            className="px-4 md:px-8 py-2.5 text-sm border-b"
            style={{ background: "#FFF1F2", color: "#BE123C", borderColor: "#FECDD3", fontWeight: 600 }}
          >
            No se pudo guardar en este navegador (probablemente por espacio, las fotos ocupan mucho). Lo
            último que cargaste se pierde al recargar la página.
          </div>
        )}
        <div key={pathname} className="pm-enter flex-1 flex flex-col overflow-hidden min-w-0">
          <Outlet />
        </div>
      </main>
      <MobileNav />
    </div>
  );
}
