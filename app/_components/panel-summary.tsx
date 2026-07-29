"use client";

import { useFilterVisibleJobs } from "../_lib/job-visibility";
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
 *
 * Nakliye izolasyonu (bkz. job-visibility.ts): `jobs`, `PanelSummaryHizmetVeren`e
 * ulaşmadan ÖNCE `useFilterVisibleJobs` ile süzülür — bu sayede panel-summary.ts#
 * getHizmetVerenPanelSummary'nin "Uygun İlanlar" sayacı VE "Son Hareketler"
 * listesindeki (gizli bir ilana ait eski bir teklifin gerçek başlığını
 * sızdırabilecek) `jobById.get(...)?.title` araması hiçbir ek değişikliğe
 * gerek kalmadan zaten güvenli hâle gelir — `jobById` artık yalnızca görünür
 * ilanları içerir, eşleşmeyen durumda mevcut "İlan" jenerik yedeği devreye
 * girer. Hizmet Alan dalı bu filtreden hiç etkilenmez (bkz. o hook'un no-op
 * davranışı).
 */
export function PanelSummary() {
  const session = useSession();
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const visibleJobs = useFilterVisibleJobs(session, jobs);

  if (!session) {
    return (
      <AuthGateNotice
        message="Panel özetinizi görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel"
      />
    );
  }

  if (session.role === "hizmet-veren") {
    return <PanelSummaryHizmetVeren session={session} jobs={visibleJobs} offers={offers} />;
  }

  return <PanelSummaryHizmetAlan session={session} jobs={jobs} offers={offers} />;
}
