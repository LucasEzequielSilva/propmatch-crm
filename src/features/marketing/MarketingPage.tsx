import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/AppHeader";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { refreshServerState, refreshStatus } from "@/lib/marketing/api";
import { useMarketingCtx } from "./useMarketingCtx";
import { CampaignsTab } from "./CampaignsTab";
import { SegmentsTab } from "./SegmentsTab";
import { TemplatesTab } from "./TemplatesTab";
import { BajasTab } from "./BajasTab";
import { ReadinessBanner } from "./ReadinessBanner";

type Tab = "campanas" | "audiencias" | "plantillas" | "bajas";
const TABS: { value: Tab; label: string }[] = [
  { value: "campanas", label: "Campañas" },
  { value: "audiencias", label: "Audiencias" },
  { value: "plantillas", label: "Plantillas" },
  { value: "bajas", label: "Bajas y consentimientos" },
];

/**
 * Marketing: campañas de retargeting por email y WhatsApp con baja en un
 * clic. Se puede armar todo sin servidor; para ENVIAR hace falta el Supabase
 * del CRM, Resend y/o WhatsApp Cloud API (ver docs/marketing-puesta-en-marcha.md).
 */
export default function MarketingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "campanas") as Tab;
  const { agencyId } = useMarketingCtx();

  useEffect(() => {
    void refreshStatus(agencyId).then((s) => {
      if (s.configured.db) void refreshServerState(agencyId);
    });
  }, [agencyId]);

  return (
    <>
      <AppHeader title="Marketing" subtitle="Campañas por email y WhatsApp a tus contactos, con baja en un clic." />
      <div className="flex-1 overflow-y-auto px-4 md:px-8 pb-10">
        <div className="mt-5 space-y-4">
          <ReadinessBanner />
          <div className="overflow-x-auto -mx-1 px-1">
            <FilterTabs options={TABS} value={tab} onChange={(v) => setParams(v === "campanas" ? {} : { tab: v }, { replace: true })} />
          </div>
          {tab === "campanas" && <CampaignsTab />}
          {tab === "audiencias" && <SegmentsTab />}
          {tab === "plantillas" && <TemplatesTab />}
          {tab === "bajas" && <BajasTab />}
        </div>
      </div>
    </>
  );
}
