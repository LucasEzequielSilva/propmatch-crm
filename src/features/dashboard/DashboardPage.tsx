import { useState } from "react";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";
import { greeting } from "@/lib/format";

export default function DashboardPage() {
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const firstName = profile?.full_name.split(" ")[0] ?? "";

  return (
    <>
      <AppHeader
        title={`${greeting()}, ${firstName}`}
        titleAccent={<span className="text-gradient-brand-h"> ✦</span>}
        subtitle="Así se mueve tu negocio hoy."
        search={{ placeholder: "Buscar...", value: query, onChange: setQuery }}
        action={{ label: "Agregar", onClick: () => {} }}
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="Los KPIs, el pipeline y el feed se calculan sobre datos reales en el próximo paso."
        />
      </div>
    </>
  );
}
