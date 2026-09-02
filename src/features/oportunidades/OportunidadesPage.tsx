import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function OportunidadesPage() {
  const [query, setQuery] = useState("");

  return (
    <>
      <AppHeader
        title="Oportunidades"
        subtitle="Seguí cada operación y acercate al cierre."
        search={{ placeholder: "Buscar oportunidad...", value: query, onChange: setQuery }}
        action={{ label: "Nueva oportunidad", onClick: () => {} }}
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
