"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { groupIncomingOffersByCategoryAndJob } from "../_lib/incoming-offer-grouping";
import {
  getJobRequestFilter,
  isOfferShownInIncomingOffersScreen,
  isOfferVisibleInNormalLists,
  sortIncomingOffersForDisplay,
} from "../_lib/job-requests";
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
    // SADECE İŞLEM BEKLEYEN TEKLİFLER: "rejected" (zaten reddedilmiş) ve
    // "agreement_failed" (anlaşma sağlanamadı) BİLEREK bu ekrandan çıkarılır
    // — bkz. job-requests.ts#isOfferShownInIncomingOffersScreen (tek ortak
    // doğruluk kaynağı). Teklif SİLİNMEZ: durumu, bildirimi, geçmişi ve diğer
    // ekranlardaki (Verdiğim Teklifler > Kapanan Teklifler) görünürlüğü
    // korunur — yalnızca bu ekranın render listesinden çıkar. Bu filtre bir
    // JOB'u/kategoriyi ayrıca "boşaltmaz": aşağıdaki gruplama
    // (`groupIncomingOffersByCategoryAndJob`) yalnızca GERÇEKTEN mevcut olan
    // tekliflerden grup kurduğu için, bir ilanın gösterilecek son teklifi de
    // burada elenirse o ilan grubu (ve gerekirse tüm hizmet türü kutusu)
    // kendiliğinden hiç oluşmaz — boşluk bırakmadan, elle "grup kaldırma"
    // adımına gerek kalmadan. Aynı hizmet türüne daha sonra yeni bir teklif
    // geldiğinde grup, aynı canlı hesaplamayla (useMemo) otomatik olarak
    // yeniden belirir.
    const incoming = sortIncomingOffersForDisplay(
      offers
        .filter((offer) => myJobIds.has(offer.jobId))
        .filter(isOfferVisibleInNormalLists)
        .filter(isOfferShownInIncomingOffersScreen)
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

  // KRİTİK: `ratingModalOffer`/`justRated` render'ı (en altta) BİLEREK bu
  // `if` bloğunun (ve aşağıdaki boş-durum erken `return`ünün) DIŞINDA,
  // ortak bir üst gövdede tutulur. KÖK NEDEN (önceden mevcut bir hataydı):
  // bir teklif tam olarak Gelen Teklifler'deki SON/TEK görünür teklifken
  // tamamlanma onaylanırsa, `onCompleted` -> `setRatingModalOffer` state'i
  // AYNI render'da ayarlansa bile, o teklif artık "tamamlandi" olduğu için
  // (bkz. yukarıdaki useMemo filtre zinciri) `groups` de AYNI render'da boş
  // hâle gelir — eğer boş-durum dalı erken `return` ederse (aşağıdaki eski
  // hâliyle olduğu gibi), değerlendirme modalının render bloğuna hiç
  // ulaşılmaz ve modal SESSİZCE hiç açılmaz. Birden fazla teklif/şablon
  // varken (yalnızca biri kalkarken) bu hata gizli kalır — `groups` o zaman
  // hâlâ boş olmadığı için ana `return` zaten çalışır ve modal görünür;
  // yalnızca "son kalan teklif tamamlandı" özel durumunda ortaya çıkar.
  return (
    <>
      {groups.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Henüz gelen teklif yok.
          </p>
        </div>
      ) : (
        // MASONRY DÜZENİ (CSS multi-column) — bir standart `grid-cols-2` İLE
        // DEĞİL: standart CSS grid'de her "satır"ın yüksekliği o satırdaki EN
        // UZUN hücreye göre belirlenir; kategori kutuları içerik bazlı (farklı
        // sayıda ilan grubu/teklif kartı) FARKLI yüksekliklerde olduğu için, kısa
        // bir kutunun altındaki hücre kendi kısa komşusunun hemen altında değil,
        // o SATIRIN tamamı bitince başlar — bu da tam olarak bildirilen "büyük
        // boşluk" hatasıydı (bir şablon kaldırılınca kalanlar YER DEĞİŞTİRİR
        // ama satır-yükseklik eşleşmesi eski boşluğu doldurmaz). `columns-2`
        // (native CSS multi-column) bunun yerine kutuları TEK sürekli bir akışa
        // yerleştirir: her kutu, mevcut GERÇEK render yüksekliğine göre hangi
        // sütunda yer varsa oraya akar (satıra kilitlenmez) — bir kutu
        // kaldırıldığında/yeniden göründüğünde (yukarıdaki filtre zincirinden,
        // `groups` her render'da canlı veriden yeniden hesaplandığı için) kalan
        // TÜM kutular bu akışa göre otomatik yeniden dağılır, DOM'da gizli
        // hücre/placeholder/sabit yükseklik bırakmadan (kaldırılan kategori zaten
        // `groups` dizisinde hiç yok — aşağıdaki `.map` onun için hiçbir şey
        // render etmez). Her kutu kendi `break-inside-avoid-column` sarmalayıcısı
        // İÇİNDE tek/bölünmez birim olarak taşınır (yoksa tarayıcı bir kutuyu
        // sütun sınırında ortadan kesebilir). `gap-6` burada yalnızca sütunlar
        // ARASI (column-gap) boşluğu verir — multi-column'da "satır" kavramı
        // olmadığından `row-gap`in bir karşılığı yok; DİKEY boşluk bu yüzden
        // `space-y-6` (kardeşler arası margin-top) ile sağlanır, bu da görsel
        // sütun yerleşiminden bağımsız olarak HER kutu çiftinin arasında aynı
        // 24px boşluğu garanti eder. Tam olarak TEK kategori kaldığında
        // (`groups.length === 1`) hâlâ tam genişliğe geçer — iki sütunun
        // yalnızca birinde yarım genişlikte durmaz; bu dal `columns-2`
        // kullanmadığı için ayrıca korunmuştur.
        <div
          className={
            groups.length === 1 ? "grid grid-cols-1 gap-6" : "columns-1 gap-6 xl:columns-2 space-y-6"
          }
        >
          {groups.map((group) => (
            <div key={group.categoryKey} className="break-inside-avoid-column">
              <IncomingOfferCategorySection
                group={group}
                session={session}
                highlightOfferId={highlightOfferId}
                onOfferCompleted={(offer) => setRatingModalOffer(offer)}
              />
            </div>
          ))}
        </div>
      )}

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
