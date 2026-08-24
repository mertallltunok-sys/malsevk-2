"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { groupIncomingOffersByJob } from "../_lib/incoming-offer-grouping";
import { formatShortJobDate } from "../_lib/jobs";
import {
  getJobRequestFilter,
  isOfferShownInIncomingOffersScreen,
  isOfferVisibleInNormalLists,
  sortIncomingOffersForDisplay,
} from "../_lib/job-requests";
import { markNotificationsRead } from "../_lib/notification-reads";
import { newOfferNotificationId } from "../_lib/notifications";
import type { Offer } from "../_lib/types";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useHydrateOfferContacts } from "../_lib/use-hydrate-offer-contacts";
import { useReadNotificationIds } from "../_lib/use-notification-reads";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { IncomingOfferJobSection } from "./incoming-offer-job-section";
import { JobRatingModal } from "./job-rating-modal";

export function IncomingOffersPanel() {
  const session = useSession();
  const jobs = useAllJobs();
  const offers = useAllOffers();
  // "İletişim Bilgilerinin Görünürlüğü" görevi — bkz. use-hydrate-offer-contacts.ts
  // dosya başlığı. contact-access.ts#getRevealedContactForOffer'ı hiç
  // değiştirmez, yalnızca karşı tarafın profilini arka planda yerel aynaya
  // hidratlar.
  useHydrateOfferContacts(offers, jobs, session);
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

  // İlan seçici (bkz. görev tanımı — "Gelen Teklifler ilan başlıklarına göre
  // ayrılsın"): yalnızca kullanıcının EN SON tıkladığı chip'i tutar, "hangi
  // ilan varsayılan olarak seçili" durumunu KENDİSİ hesaplamaz — bu, aşağıda
  // `effectiveSelectedJobId` olarak, render sırasında SAF bir türetme ile
  // yapılır (bkz. o değişkenin dokümanı). Bu tasarım BİLEREK `useEffect` +
  // `setState` kullanmaz (CLAUDE.md/proje ESLint kuralı bunu yasaklar) — bir
  // useEffect'in "veri değişti, varsayılanı yeniden hesapla" işini üstlenmesi
  // yerine, varsayılan zaten HER render'da doğrudan hesaplanır.
  const [manuallySelectedJobId, setManuallySelectedJobId] = useState<string | null>(null);

  // Store'daki HERHANGİ bir değişiklikte (bu ilanlarla ilgisiz olsa bile,
  // useSyncExternalStore tabanlı hook'ların doğası gereği) bu component
  // yeniden render olur — filtre+sıralama+gruplama zinciri her seferinde
  // tekrar hesaplanmasın diye `useMemo`ya alınır. Hesaplamanın KENDİSİ
  // (filtreler/sıralama) DEĞİŞMEDİ — yalnızca son adım, eski "Hizmet Türü ->
  // İlan" iki seviyeli gruplamanın (bkz. eski `groupIncomingOffersByCategoryAndJob`)
  // yerine düz, İLAN BAŞINA bir gruplamaya (bkz. incoming-offer-grouping.ts#
  // groupIncomingOffersByJob) geçti — "yalnızca hizmet türüne göre gruplama
  // yapma" gereksinimi budur.
  const jobGroups = useMemo(() => {
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
    // ilanı ayrıca "boşaltmaz": aşağıdaki gruplama (`groupIncomingOffersByJob`)
    // yalnızca GERÇEKTEN mevcut olan tekliflerden grup kurduğu için, bir
    // ilanın gösterilecek son teklifi de burada elenirse o ilanın chip'i
    // kendiliğinden hiç oluşmaz — boşluk bırakmadan, elle "chip kaldırma"
    // adımına gerek kalmadan. Aynı ilana daha sonra yeni bir teklif
    // geldiğinde chip, aynı canlı hesaplamayla (useMemo) otomatik olarak
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
    return groupIncomingOffersByJob(incoming, jobById);
  }, [session, jobs, offers, highlightJobId]);

  // Etkin seçim: kullanıcının en son tıkladığı ilan HÂLÂ listede varsa onu
  // kullan; yoksa (ilk açılış, seçili ilanın son teklifi de ekrandan
  // düştüğü, ya da `?ilanId=` filtresi listeyi daralttığı için artık mevcut
  // değilse) `jobGroups[0]`e düş — bu, `groupIncomingOffersByJob`in girdi
  // sırasını (en güncel teklif ÖNCE) koruduğu için otomatik olarak "en güncel
  // teklif bulunan ilan" anlamına gelir (bkz. görev tanımı — "İlk açılışta en
  // güncel teklif bulunan ilan ... seçili olabilir").
  const effectiveSelectedJobId =
    manuallySelectedJobId && jobGroups.some((group) => group.jobId === manuallySelectedJobId)
      ? manuallySelectedJobId
      : (jobGroups[0]?.jobId ?? null);
  const selectedGroup = jobGroups.find((group) => group.jobId === effectiveSelectedJobId) ?? null;

  // Okunmamış "yeni teklif" rozeti (bkz. aşağıdaki ilan seçici) merkezi
  // okunma-durumu altyapısını (notification-reads.ts) doğrudan kullanır —
  // notifications.ts'in kendi türettiği "yeni_teklif" bildirimleriyle AYNI
  // id şeması (bkz. newOfferNotificationId). Bilinçli olarak
  // notification-dismissals.ts'ten (bildirim panelinden "silme") TAMAMEN
  // bağımsızdır: bir bildirim panelden silinmiş olsa bile, o teklif bu
  // ekranda henüz "açılıp görülmediyse" rozet saymaya devam eder — silme ve
  // okuma iki ayrı kavramdır (bkz. görev tanımı).
  const readNotificationIds = useReadNotificationIds(session?.id ?? "");
  const readNotificationIdSet = useMemo(() => new Set(readNotificationIds), [readNotificationIds]);

  // Seçili ilanın teklifleri GERÇEK bir kullanıcı etkileşimiyle
  // görüntülendiğinde (bkz. görev tanımı: "gerçek kullanıcı etkileşimiyle
  // ilgili ilan teklifleri açıldığında okunmuş sayılmalı") o ilana ait TÜM
  // "yeni teklif" bildirimleri TEK seferde okunmuş işaretlenir (bkz.
  // markNotificationsRead). BİLEREK yalnızca iki durumda "gerçek etkileşim"
  // sayılır: (1) kullanıcı chip'e TIKLADI (`manuallySelectedJobId` bu
  // ilanın id'sine eşit), (2) bir bildirime tıklanarak `?ilanId=`/`?offerId=`
  // ile bu ilana doğrudan gelindi. Sayfa ilk açıldığında hiçbir tıklama/deep
  // link olmadan yalnızca `jobGroups[0]`e düşülen VARSAYILAN seçim BİLEREK
  // bunun DIŞINDA tutulur — aksi hâlde, bu ilana TAM O ANDA yeni bir teklif
  // geldiği için `jobGroups[0]` olduğu bir senaryoda (bkz. görev tanımı
  // kabul kriterleri: "İlgili Nakliye kartına tıkla VE teklifleri aç")
  // rozet kullanıcı hiç görmeden aynı render'da sönerdi — kartın yalnızca
  // "seçili görünmesi" (varsayılan/pasif) sayacı yanlışlıkla söndürmemeli.
  useEffect(() => {
    if (!session || session.role !== "hizmet-alan" || !selectedGroup) return;
    const openedByClick = manuallySelectedJobId === selectedGroup.jobId;
    const openedByNotificationLink =
      highlightJobId === selectedGroup.jobId ||
      (highlightOfferId != null && selectedGroup.offers.some((offer) => offer.id === highlightOfferId));
    if (!openedByClick && !openedByNotificationLink) return;
    const idsToMark = selectedGroup.offers.map((offer) => newOfferNotificationId(offer.id));
    markNotificationsRead(session.id, idsToMark);
  }, [session, selectedGroup, manuallySelectedJobId, highlightJobId, highlightOfferId]);

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
  // (bkz. yukarıdaki useMemo filtre zinciri) `jobGroups` de AYNI render'da
  // boş hâle gelir — eğer boş-durum dalı erken `return` ederse (aşağıdaki
  // eski hâliyle olduğu gibi), değerlendirme modalının render bloğuna hiç
  // ulaşılmaz ve modal SESSİZCE hiç açılmaz. Birden fazla teklif/ilan
  // varken (yalnızca biri kalkarken) bu hata gizli kalır — `jobGroups` o
  // zaman hâlâ boş olmadığı için ana `return` zaten çalışır ve modal
  // görünür; yalnızca "son kalan teklif tamamlandı" özel durumunda ortaya
  // çıkar.
  return (
    <>
      {jobGroups.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Henüz gelen teklif yok.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/*
            İlan seçici — her bağımsız ilan için TEK bir chip, hizmet türüne
            göre gruplama YAPILMAZ (bkz. görev tanımı: aynı hizmet türünde iki
            farklı ilan varsa iki ayrı başlık görünmeli). `flex-wrap` bilerek
            yatay kaydırma/`overflow-x-auto` yerine tercih edildi — mobilde
            chip'ler yeni satıra sarar, hiçbir zaman ekran dışına taşmaz ya da
            kullanılamaz bir sekme dizisi oluşturmaz.
          */}
          <div className="flex flex-wrap gap-2">
            {jobGroups.map((group) => {
              const isSelected = group.jobId === effectiveSelectedJobId;
              // Toplam teklif sayısından (aşağıdaki "N Teklif") BİLEREK
              // bağımsız — bu, o ilana ait tekliflerden henüz OKUNMAMIŞ
              // olanların sayısıdır (bkz. yukarıdaki readNotificationIdSet
              // dokümanı). `group.offers` zaten bu ekranda GERÇEKTEN
              // gösterilen tekliflerle (görünürlük filtreleri uygulanmış)
              // birebir aynı küme olduğu için burada ayrıca bir filtre
              // tekrarlanmaz.
              const unreadCount = group.offers.filter(
                (offer) => !readNotificationIdSet.has(newOfferNotificationId(offer.id)),
              ).length;
              // Uzun ilan başlığı artık kartta GÖSTERİLMEZ (bkz. görev
              // tanımı) — aynı hizmet türünde birden fazla bağımsız ilan
              // olduğunda kullanıcının yine de ayırt edebilmesi için kısa
              // (taşmayan) bir tarih ayracı ve tam başlık `title` (hover)
              // özniteliği olarak korunur.
              const shortDateLabel = group.job ? formatShortJobDate(group.job.workDate) : null;
              return (
                <button
                  key={group.jobId}
                  type="button"
                  onClick={() => setManuallySelectedJobId(group.jobId)}
                  aria-pressed={isSelected}
                  title={group.job?.title}
                  // `flex flex-col` + her satırın (başlık/teklif sayısı/tarih)
                  // SABİT bir satır yüksekliği taşıması (tarih satırı, ilan
                  // bilgisine ulaşılamayan gruplarda olduğu gibi boş kalsa
                  // bile bir ` ` ile render edilir, hiç KALDIRILMAZ) —
                  // bu sayede kartlar farklı `flex-wrap` satırlarına
                  // düşseler bile (CSS'in aynı-satır `stretch` davranışına
                  // güvenmeden) TÜMÜ birebir aynı yüksekliğe sahip olur; bkz.
                  // görev tanımı ("Bütün kartların yüksekliği aynı olsun").
                  // Başlık `truncate` (tek satır + ellipsis) olduğu için
                  // uzun bir hizmet adı da bu satırın yüksekliğini asla
                  // artırmaz.
                  // `min-w-40` (10rem): kartlar yalnızca içerik uzunluğuna
                  // göre rastgele daralıp genişlemesin, "Nakliye" gibi kısa
                  // bir başlık da "Kapalı Depolama" gibi uzun bir başlık da
                  // aynı düzenli asgari genişlikte görünsün (bkz. görev
                  // tanımı) — `max-w-full` mobilde konteynerden taşmayı,
                  // başlıktaki `truncate` de bu asgari genişliği aşan çok
                  // uzun etiketleri güvenle keser.
                  className={`flex min-w-40 max-w-full flex-col gap-1 rounded-md border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isSelected
                      ? "border-primary bg-accent-soft"
                      : "border-border bg-surface hover:border-primary/40"
                  }`}
                >
                  {/* 1. Hizmet adı — kartın asıl/en belirgin başlığı: koyu, kalın, siyaha yakın lacivert (bkz. globals.css#--fg, uygulamadaki genel başlık deseniyle AYNI: font-bold tracking-heading leading-tight text-foreground). */}
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-bold tracking-heading leading-tight text-foreground">
                      {group.categoryLabel}
                    </span>
                    {unreadCount > 0 && (
                      <span
                        aria-label={`${unreadCount} okunmamış yeni teklif`}
                        className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white"
                      >
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </span>
                  {/* 2. Teklif sayısı — hizmet adından KÜÇÜK, kalın olabilir ama onunla yarışmaz. */}
                  <span className="text-xs font-semibold text-foreground">
                    {group.offers.length} Teklif
                  </span>
                  {/* 3. Tarih — en küçük ve en soluk metin, en altta. İlan bilgisine ulaşılamayan gruplarda (shortDateLabel yok) satır BOŞ İÇERİKLE de render edilir (kaldırılmaz) — yalnızca bu kartın kısa kalıp diğerlerinin hizasını bozmasını önlemek için, bkz. yukarıdaki className dokümanı. */}
                  <span className="block text-[11px] text-muted-foreground/70">{shortDateLabel || " "}</span>
                </button>
              );
            })}
          </div>

          {selectedGroup && (
            <IncomingOfferJobSection
              group={selectedGroup}
              session={session}
              highlightOfferId={highlightOfferId}
              onOfferCompleted={(offer) => setRatingModalOffer(offer)}
            />
          )}
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
