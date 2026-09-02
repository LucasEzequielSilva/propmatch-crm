import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/features/auth/AuthProvider";
import AuthPage from "@/features/auth/AuthPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { SetupNotice } from "@/components/layout/SetupNotice";
import { FullPageLoader } from "@/components/ui/states";
import { isSupabaseConfigured } from "@/lib/supabase";

import DashboardPage from "@/features/dashboard/DashboardPage";
import ContactosPage from "@/features/contactos/ContactosPage";
import PropiedadesPage from "@/features/propiedades/PropiedadesPage";
import SubirPropiedadPage from "@/features/propiedades/SubirPropiedadPage";
import OportunidadesPage from "@/features/oportunidades/OportunidadesPage";
import MatchesPage from "@/features/matches/MatchesPage";
import VerMatchPage from "@/features/matches/VerMatchPage";
import AgendaPage from "@/features/agenda/AgendaPage";
import ReportesPage from "@/features/reportes/ReportesPage";

/**
 * Navegación.
 *
 * El prototipo resolvía esto con `useState("inicio")` y ocho ternarios
 * anidados en App.tsx: sin URLs, sin botón atrás, sin poder compartir el link
 * de una propiedad. Cada vista ya estaba en su propio archivo y ya recibía
 * callbacks (`onNuevaPropiedad`, `onVerMatch`, `onBack`), así que el mapeo a
 * rutas es directo y no toca el diseño.
 */
export default function App() {
  if (!isSupabaseConfigured) return <SetupNotice />;

  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<PublicOnly />}>
            <Route index element={<AuthPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />

              <Route path="contactos" element={<ContactosPage />} />
              <Route path="contactos/:contactId" element={<ContactosPage />} />

              <Route path="propiedades" element={<PropiedadesPage />} />
              <Route path="propiedades/nueva" element={<SubirPropiedadPage />} />
              <Route path="propiedades/:propertyId" element={<PropiedadesPage />} />

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
    </AuthProvider>
  );
}

/** Área privada: exige sesión y agencia. */
function RequireAuth() {
  const { session, profile, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  // Sin sesión, o con sesión pero sin agencia todavía: al alta.
  if (!session || !profile) return <Navigate to="/auth" replace />;
  return <Outlet />;
}

/** Pantalla de login: si ya hay todo resuelto, adentro. */
function PublicOnly() {
  const { session, profile, loading } = useAuth();

  if (loading) return <FullPageLoader />;
  if (session && profile) return <Navigate to="/" replace />;
  return <Outlet />;
}
