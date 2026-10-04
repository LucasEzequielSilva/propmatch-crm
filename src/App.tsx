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
import MultipublicadorPage from "@/features/propiedades/MultipublicadorPage";
import MultipublicadorVivoPage from "@/features/propiedades/MultipublicadorVivoPage";
import InstagramPublisherPage from "@/features/instagram/InstagramPublisherPage";
import OportunidadesPage from "@/features/oportunidades/OportunidadesPage";
import OfertasPage from "@/features/ofertas/OfertasPage";
import InboxPage from "@/features/inbox/InboxPage";
import MatchesPage from "@/features/matches/MatchesPage";
import VerMatchPage from "@/features/matches/VerMatchPage";
import AgendaPage from "@/features/agenda/AgendaPage";
import ReportesPage from "@/features/reportes/ReportesPage";
import ConfiguracionPage from "@/features/configuracion/ConfiguracionPage";
import FichaPage from "@/features/ficha/FichaPage";
import ImportarPage from "@/features/importar/ImportarPage";
import OperacionesPage from "@/features/operaciones/OperacionesPage";
import OperacionDetallePage from "@/features/operaciones/OperacionDetallePage";
import DocumentoPage from "@/features/operaciones/DocumentoPage";

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
          {/* Ficha que recibe el cliente: pública, sin sesión y sin el layout del CRM. */}
          <Route path="/ficha" element={<FichaPage />} />

          <Route path="/login" element={<PublicOnly />}>
            <Route index element={<LoginPage />} />
          </Route>

          <Route element={<RequireSession />}>
            <Route path="operaciones/:dealId/documento/:kind" element={<DocumentoPage />} />
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />

              <Route path="inbox" element={<InboxPage />} />
              <Route path="contactos" element={<ContactosPage />} />
              <Route path="contactos/:contactId" element={<ContactoDetallePage />} />

              <Route path="propiedades" element={<PropiedadesPage />} />
              <Route path="propiedades/nueva" element={<SubirPropiedadPage />} />
              <Route path="propiedades/:propertyId" element={<PropiedadDetallePage />} />
              <Route path="propiedades/:propertyId/editar" element={<SubirPropiedadPage />} />

              <Route path="publicador" element={<MultipublicadorPage />} />
              <Route path="publicador/:propertyId" element={<MultipublicadorVivoPage />} />
              <Route path="publicador/:propertyId/instagram" element={<InstagramPublisherPage />} />

              <Route path="oportunidades" element={<OportunidadesPage />} />
              <Route path="ofertas" element={<OfertasPage />} />
              <Route path="operaciones" element={<OperacionesPage />} />
              <Route path="operaciones/:dealId" element={<OperacionDetallePage />} />

              <Route path="matches" element={<MatchesPage />} />
              <Route path="matches/:matchId" element={<VerMatchPage />} />

              <Route path="agenda" element={<AgendaPage />} />
              <Route path="reportes" element={<ReportesPage />} />
              <Route path="configuracion" element={<ConfiguracionPage />} />
              <Route path="importar" element={<ImportarPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}

/** Área privada: sin sesión abierta, al login. Espera a que se resuelva la sesión de Supabase antes de redirigir, para no mandar al login a alguien que ya estaba logueado. */
function RequireSession() {
  const { currentUserId, sessionLoading } = useStore();
  if (sessionLoading) return null;
  if (!currentUserId) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Con la sesión ya abierta, el login no tiene sentido. */
function PublicOnly() {
  const { currentUserId, sessionLoading } = useStore();
  if (sessionLoading) return null;
  if (currentUserId) return <Navigate to="/" replace />;
  return <Outlet />;
}
