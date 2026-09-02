import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function AgendaPage() {
  const [query, setQuery] = useState("");

  return (
    <>
      <AppHeader
        title="Agenda"
        subtitle="Organizá tu día y no te pierdas ninguna oportunidad."
        search={{ placeholder: "Buscar evento...", value: query, onChange: setQuery }}
        action={{ label: "Nuevo evento", onClick: () => {} }}
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="La pantalla se portea en el próximo paso, sobre datos reales."
        />
      </div>
    </>
  );
}
