import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { StoreProvider, useStore } from "@/data/store";
import { AppLayout } from "@/components/layout/AppLayout";

import LoginPage from "@/features/auth/LoginPage";
import DashboardPage from "@/features/dashboard/DashboardPage";
import ContactosPage from "@/features/contactos/ContactosPage";
import ContactoDetallePage from "@/features/contactos/ContactoDetallePage";
import PropiedadesPage from "@/features/propiedades/PropiedadesPage";
import SubirPropiedadPage from "@/features/propiedades/SubirPropiedadPage";
import PropiedadDetallePage from "@/features/propiedades/PropiedadDetallePage";
import OportunidadesPage from "@/features/oportunidades/OportunidadesPage";
import MatchesPage from "@/features/matches/MatchesPage";
import VerMatchPage from "@/features/matches/VerMatchPage";
import AgendaPage from "@/features/agenda/AgendaPage";
import ReportesPage from "@/features/reportes/ReportesPage";

/**
 * Navegación.
 *
 * El prototipo resolvía esto con `useState("inicio")` y ocho ternarios
 * anidados: sin URLs, sin botón atrás, sin poder compartir el link de una
 * propiedad. Cada vista ya estaba en su propio archivo y ya recibía callbacks
 * (`onNuevaPropiedad`, `onVerMatch`, `onBack`), así que el mapeo a rutas es
 * directo y no toca el diseño.
 */
export default function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<PublicOnly />}>
            <Route index element={<LoginPage />} />
          </Route>

          <Route element={<RequireSession />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />

              <Route path="contactos" element={<ContactosPage />} />
              <Route path="contactos/:contactId" element={<ContactoDetallePage />} />

              <Route path="propiedades" element={<PropiedadesPage />} />
              <Route path="propiedades/nueva" element={<SubirPropiedadPage />} />
              <Route path="propiedades/:propertyId" element={<PropiedadDetallePage />} />
              <Route path="propiedades/:propertyId/editar" element={<SubirPropiedadPage />} />

              <Route path="oportunidades" element={<OportunidadesPage />} />

              <Route path="matches" element={<MatchesPage />} />
              <Route path="matches/:matchId" element={<VerMatchPage />} />

              <Route path="agenda" element={<AgendaPage />} />
              <Route path="reportes" element={<ReportesPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}

/** Área privada: sin sesión abierta, al login. */
function RequireSession() {
  const { currentUserId } = useStore();
  if (!currentUserId) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Con la sesión ya abierta, el login no tiene sentido. */
function PublicOnly() {
  const { currentUserId } = useStore();
  if (currentUserId) return <Navigate to="/" replace />;
  return <Outlet />;
}
