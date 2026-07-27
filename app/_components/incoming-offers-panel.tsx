"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { groupIncomingOffersByCategoryAndJob } from "../_lib/incoming-offer-grouping";
import { getJobRequestFilter, isOfferVisibleInNormalLists, sortIncomingOffersForDisplay } from "../_lib/job-requests";
import type { Offer } from "../_lib/types";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { IncomingOfferCategorySection } from "./incoming-offer-category-section";
import { JobRatingModal } from "./job-rating-modal";

export function IncomingOffersPanel() {
  const session = useSession();
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const searchParams = useSearchParams();
  const highlightOfferId = searchParams.get("offerId");
  const highlightJobId = searchParams.get("ilanId");

  // Değerlendirme modalı DEĞİŞTİRİLMEDİ (bkz. job-rating-modal.tsx) — yalnızca
  // NEREDE render edildiği değişti. Önceden incoming-offer-card.tsx'in KENDİ
  // yerel state'iydi; bir teklif "tamamlandi" olur olmaz o ilanın kutusu/kartı
  // aşağıdaki gruplamadan (Hizmet Kalemi Yaşam Döngüsü Senkronizasyonu, bkz.
  // "tamamlandi" filtresi) kalkabildiği için kart component'i AYNI render'da
  // unmount olabilir — yerel state orada tutulsaydı, modal hiç açılmadan
  // kaybolurdu. job-requests-panel.tsx zaten AYNI sorunu AYNI şekilde (state'i
  // listeye taşıyarak) çözmüştür — burada YENİ bir desen icat edilmedi, o
  // mevcut, kanıtlanmış desen uygulanır. `IncomingOfferCard`in kendisi hâlâ
  // TEK render noktası, tek iş mantığı sahibi; yalnızca bu iki state'in
  // "yaşadığı yer" değişti.
  const [ratingModalOffer, setRatingModalOffer] = useState<Offer | null>(null);
  const [justRated, setJustRated] = useState(false);

  // Store'daki HERHANGİ bir değişiklikte (bu ilanlarla ilgisiz olsa bile,
  // useSyncExternalStore tabanlı hook'ların doğası gereği) bu component
  // yeniden render olur — filtre+sıralama+gruplama zinciri (Hizmet Türü ->
  // İlan -> Teklifler) her seferinde tekrar hesaplanmasın diye `useMemo`ya
  // alınır (bkz. görev gereksinimi). Hesaplamanın KENDİSİ değişmedi, yalnızca
  // gereksiz tekrarı önleniyor.
  const groups = useMemo(() => {
    if (!session || session.role !== "hizmet-alan") return [];
    const jobById = new Map(jobs.map((job) => [job.id, job]));
    const myJobIds = new Set(
      jobs.filter((job) => job.requesterId === session.id).map((job) => job.id),
    );

    // "withdrawn": Hizmet Veren'in kabul edilmeden önce geri çektiği teklif —
    // aktif Gelen Teklifler listesinde hiç görünmez, tekrar kabul edilemez
    // (bkz. offers.ts#withdrawOffer, job-requests.ts#isOfferVisibleInNormalLists
    // — tek ortak doğruluk kaynağı, burada tekrar yazılmaz).
    //
    // OPERASYON HİZMET KALEMİ YAŞAM DÖNGÜSÜ SENKRONİZASYONU: bir ilanın
    // (hizmet kaleminin) TÜM teklifleri, o ilan `getJobRequestFilter` ile
    // "tamamlandi" olduğu (bkz. job-requests.ts — COMPLETED_OFFER_STATUSES,
    // tek ortak doğruluk kaynağı, burada tekrar yazılmaz) AN itibarıyla bu
    // ekrandan düşer — hem kazanan teklif (artık "mevcut Tamamlanan
    // sistemine", Hizmet Taleplerim > Tamamlandı'ya taşınmış sayılır) hem de
    // hâlâ "pending" kalan kardeşleri (artık anlamsız, aktif teklif
    // sayılmazlar). Bilinçli olarak yalnızca "tamamlandi" (offer.status ===
    // "completed") kontrol edilir — "kabul-edildi"/"devam-eden" (accepted/
    // in_progress/completion_requested/completion_disputed) BİLEREK hariç:
    // bu aşamalarda Hizmet Alan'ın "İşe Başlandı"/"Anlaşma Sağlanamadı"/
    // "Tamamlandığını Onayla"/"İtiraz Et" aksiyonlarını tam olarak BU
    // ekrandan (incoming-offer-card.tsx içindeki OfferOutcomePanel) verdiği
    // için bu akışlara ASLA dokunulmaz. Silinen bir ilanın teklifleri zaten
    // `myJobIds`den düştüğü için ayrıca burada ele alınmaz.
    const incoming = sortIncomingOffersForDisplay(
      offers
        .filter((offer) => myJobIds.has(offer.jobId))
        .filter(isOfferVisibleInNormalLists)
        .filter((offer) => {
          const job = jobById.get(offer.jobId);
          return !job || getJobRequestFilter(job, offers) !== "tamamlandi";
        })
        .filter((offer) => !highlightJobId || offer.jobId === highlightJobId),
    );
    return groupIncomingOffersByCategoryAndJob(incoming, jobById);
  }, [session, jobs, offers, highlightJobId]);

  if (!session) {
    return (
      <AuthGateNotice
        message="Gelen teklifleri görüntülemek için giriş yapmalısınız."
        loginRedirect="/panel/gelen-teklifler"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return (
      <AuthGateNotice message="Bu sayfa yalnızca Hizmet Alan kullanıcılar içindir." />
    );
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Henüz gelen teklif yok.
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
        DİNAMİK GRİD DÜZENİ: kategori kutuları sabit bir 2 sütunlu ızgaraya
        pinlenmez. Tam olarak TEK kategori kaldığında (`groups.length === 1`)
        tam genişliğe geçer — iki sütunun yalnızca solunda yarım kalmaz.
        2 ve üzeri kategoride mevcut `xl:grid-cols-2` deseni aynen sürer:
        standart CSS grid auto-flow, tek/çift kategori sayısı fark etmeksizin
        boş hücre/sütun bırakmaz (tek kalan bir kategori kendi satırının sol
        hücresinde durur, bu tasarım gereği ve görev örnekleriyle birebir
        aynı — masonry benzeri düzensiz bir yeniden diziliş İSTENMEDİ).
        `groups` zaten her render'da canlı veriden yeniden hesaplandığı için
        (yukarıdaki useMemo) bu sınıf da otomatik olarak güncel kalır.
      */}
      <div className={groups.length === 1 ? "grid grid-cols-1 gap-6" : "grid grid-cols-1 gap-6 xl:grid-cols-2"}>
        {groups.map((group) => (
          <IncomingOfferCategorySection
            key={group.categoryKey}
            group={group}
            session={session}
            highlightOfferId={highlightOfferId}
            onOfferCompleted={(offer) => setRatingModalOffer(offer)}
          />
        ))}
      </div>

      {justRated && (
        <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-success">
          Değerlendirmeniz için teşekkür ederiz.
        </p>
      )}

      {ratingModalOffer && (
        <JobRatingModal
          offer={ratingModalOffer}
          session={session}
          onClose={(submitted) => {
            setRatingModalOffer(null);
            if (submitted) setJustRated(true);
          }}
        />
      )}
    </>
  );
}
