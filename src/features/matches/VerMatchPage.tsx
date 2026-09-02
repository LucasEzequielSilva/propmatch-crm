import { useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { EmptyState } from "@/components/ui/states";

export default function VerMatchPage() {
  const navigate = useNavigate();
  const { matchId } = useParams();

  return (
    <>
      <AppHeader
        title="Detalle del match"
        breadcrumb={["Matches", "Detalle"]}
        subtitle={matchId ? `Match ${matchId.slice(0, 8)}` : undefined}
        compact
      />
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <EmptyState
          title="Pendiente de conexión"
          description="El desglose de factores sale de la fila de matches, no de constantes."
          action={{ label: "Volver a Matches", onClick: () => navigate("/matches") }}
        />
      </div>
    </>
  );
}
