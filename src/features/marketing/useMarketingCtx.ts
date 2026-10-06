import { useMemo } from "react";
import { useStore } from "@/data/store";
import { useMarketing } from "@/lib/marketing/state";
import type { RenderData } from "@/lib/marketing/render";
import type { SegmentData } from "@/lib/marketing/segments";

/** Todo lo que usan las pantallas de Marketing, de una vez. */
export function useMarketingCtx() {
  const store = useStore();
  const m = useMarketing(store.agency.id);
  const segmentData: SegmentData = useMemo(
    () => ({
      contacts: store.contacts,
      requirements: store.requirements,
      matches: store.matches,
      events: store.events,
      appOffers: store.appOffers,
      activities: store.activities,
      opportunities: store.opportunities,
      deals: store.deals,
    }),
    [store.contacts, store.requirements, store.matches, store.events, store.appOffers, store.activities, store.opportunities, store.deals],
  );
  const renderData: RenderData = useMemo(
    () => ({
      agency: store.agency,
      profile: store.profile,
      properties: store.properties,
      requirements: store.requirements,
      matches: store.matches,
      coverPhoto: store.coverPhoto,
    }),
    [store.agency, store.profile, store.properties, store.requirements, store.matches, store.coverPhoto],
  );
  return { store, agencyId: store.agency.id, m, segmentData, renderData };
}
