import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function ReportesPage() {
  return (
    <>
      <AppHeader
        title="Reportes"
        breadcrumb={["PropMatch", "Reportes"]}
        subtitle="Entendé el rendimiento de tu negocio y detectá nuevas oportunidades."
      />
      <div className="flex-1 overflow-y-auto px-8 pb-10">
        <EmptyState
          title="Pendiente de conexión"
          description="El funnel y las métricas se agregan por SQL sobre matches, opportunities y activities."
        />
      </div>
    </>
  );
}
