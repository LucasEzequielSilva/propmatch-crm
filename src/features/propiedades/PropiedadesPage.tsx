import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function PropiedadesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  return (
    <>
      <AppHeader
        title="Propiedades"
        subtitle="Gestioná todas tus propiedades desde un solo lugar."
        search={{ placeholder: "Buscar propiedad...", value: query, onChange: setQuery }}
        action={{ label: "Nueva propiedad", onClick: () => navigate("/propiedades/nueva") }}
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="El listado se conecta a la tabla properties en el próximo paso."
          action={{ label: "Cargar una propiedad", onClick: () => navigate("/propiedades/nueva") }}
        />
      </div>
    </>
  );
}
