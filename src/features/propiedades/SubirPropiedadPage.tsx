import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function SubirPropiedadPage() {
  const navigate = useNavigate();

  return (
    <>
      <AppHeader
        title="Subir propiedad"
        breadcrumb={["Propiedades", "Nueva propiedad"]}
        subtitle="Agregá una nueva propiedad a tu cartera."
        compact
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="El formulario del prototipo se conecta a properties, property_photos y property_match_prefs."
          action={{ label: "Volver a Propiedades", onClick: () => navigate("/propiedades") }}
        />
      </div>
    </>
  );
}
