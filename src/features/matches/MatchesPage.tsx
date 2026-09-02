import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function MatchesPage() {
  const [query, setQuery] = useState("");

  return (
    <>
      <AppHeader
        title="Matches"
        subtitle="Encontrá las mejores oportunidades entre tus contactos y propiedades."
        search={{ placeholder: "Buscar matches...", value: query, onChange: setQuery }}
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="Los scores los calcula compute_match() en Postgres; la pantalla solo los lee."
        />
      </div>
    </>
  );
}
