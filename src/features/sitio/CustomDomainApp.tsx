import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { StoreProvider } from "@/data/store";
import FichaPage from "@/features/ficha/FichaPage";

const SitioPage = lazy(() => import("./SitioPage"));
const SitioPropiedadPage = lazy(() => import("./SitioPropiedadPage"));

/**
 * App que se sirve cuando el host es el dominio propio de una inmobiliaria
 * (ver customDomain.ts y docs/web-dominio-propio.md): solo la web pública,
 * en la raíz. El CRM no se expone en ese dominio.
 */
export default function CustomDomainApp() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<SitioPage />} />
            <Route path="/p/:id" element={<SitioPropiedadPage />} />
            <Route path="/sitio/:slug" element={<SitioPage />} />
            <Route path="/sitio/:slug/p/:id" element={<SitioPropiedadPage />} />
            <Route path="/ficha" element={<FichaPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </StoreProvider>
  );
}
