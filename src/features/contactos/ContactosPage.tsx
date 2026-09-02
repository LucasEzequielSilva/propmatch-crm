import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function ContactosPage() {
  const [query, setQuery] = useState("");

  return (
    <>
      <AppHeader
        title="Contactos"
        subtitle="Gestioná y conocé mejor a cada persona."
        search={{ placeholder: "Buscar contacto...", value: query, onChange: setQuery }}
        action={{ label: "Nuevo contacto", onClick: () => {} }}
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
