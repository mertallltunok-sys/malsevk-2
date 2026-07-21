"use client";

import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { PanelSummaryHizmetAlan } from "./panel-summary-hizmet-alan";
import { PanelSummaryHizmetVeren } from "./panel-summary-hizmet-veren";

/**
 * Rol yalnızca oturumdaki (localStorage) `session.role` alanından okunur —
 * URL/query üzerinden gönderilen bir değer asla kabul edilmez. Hizmet Alan
 * ve Hizmet Veren görünümleri birbirini hiç render etmez (yalnızca eşleşen
 * dal mount edilir), bu yüzden bir rol diğerinin panel içeriğini göremez.
 */
export function PanelSummary() {
  const session = useSession();
  const jobs = useAllJobs();
  const offers = useAllOffers();

  if (!session) {
    return (
      <AuthGateNotice
        message="Panel özetinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel"
      />
    );
  }

  if (session.role === "hizmet-veren") {
    return <PanelSummaryHizmetVeren session={session} jobs={jobs} offers={offers} />;
  }

  return <PanelSummaryHizmetAlan session={session} jobs={jobs} offers={offers} />;
}
