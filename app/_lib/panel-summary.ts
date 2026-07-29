import {
  COMPLETED_OFFER_STATUSES,
  IN_PROGRESS_OFFER_STATUSES,
  getJobRequestFilter,
  isOfferVisibleInNormalLists,
} from "./job-requests";
import { isExpiredListingAwaitingAction, isJobListingExpired } from "./job-publish-window";
import { isJobManuallyClosed } from "./job-closure";
import { isJobOpenForOffers } from "./jobs";
import type { Job, Offer, OfferStatus, Session } from "./types";

/**
 * `title`, sunum katmanında kalın gösterilecek ilan başlığıdır — mesaj
 * metnine tırnakla gömülmez (başlığın kendisi zaten bir kesme işareti
 * içerebiliyor, ör. "40'lık"; iç içe tırnak karışıklığı olmasın diye
 * başlık ile geri kalan cümle ayrı alanlarda tutulur).
 * `status`/`dateIso`, yalnızca gerçekten mevcutsa doldurulur — ilan oluşturma
 * hareketlerinde (bkz. jobActivity, aşağıda) İlan Yayın Süresi Yönetimi'nden
 * ÖNCE oluşturulmuş ilanlarda `Job.createdAt` hâlâ yok, bu yüzden `dateIso`
 * o kayıtlar için bilinçli olarak boş kalır (sahte bir tarih ASLA üretilmez);
 * bu alandan SONRA oluşturulan ilanlarda artık gerçek tarihiyle doldurulur.
 */
export type PanelActivityItem = {
  id: string;
  title: string;
  suffix: string;
  status?: OfferStatus;
  dateIso?: string;
};

export type HizmetAlanPanelSummary = {
  activeRequestCount: number;
  incomingOfferCount: number;
  inProgressCount: number;
  completedCount: number;
  /**
   * İlan Yayın Süresi Yönetimi: 14 günlük yayın süresi dolmuş VE henüz
   * yeniden yayınlanmamış (bkz. job-publish-window.ts#
   * isExpiredListingAwaitingAction, tek doğruluk kaynağı) kendi ilanlarının
   * sayısı. `activeRequestCount`ten AYRI, birbirini dışlayan bir kovadır —
   * bir ilan aynı anda ikisine birden sayılamaz (bkz. aşağıdaki döngü).
   */
  expiredListingCount: number;
  recentActivity: PanelActivityItem[];
};

export type HizmetVerenPanelSummary = {
  availableListingCount: number;
  myOfferCount: number;
  acceptedOfferCount: number;
  inProgressCount: number;
  completedCount: number;
  recentActivity: PanelActivityItem[];
};

const MAX_RECENT_ACTIVITY = 5;

/**
 * Hizmet Alan panel özeti, yalnızca oturumdaki kullanıcıya ait ilan/teklif
 * verisinden hesaplanır (job-store.ts/offers.ts'teki okuma fonksiyonlarını
 * tekrar yazmaz — çağıran taraf zaten okunmuş `jobs`/`offers` listelerini
 * geçer). Saf bir fonksiyondur, hiçbir yan etkisi yoktur.
 *
 * "Aktif", "Devam Eden" ve "Tamamlanan" birbirini dışlayan üç kova olacak
 * şekilde `getJobRequestFilter` (job-requests.ts) üzerinden hesaplanır: bir
 * ilan kabul edilmiş teklifi olduğu an "aktif" kovasından çıkıp "devam
 * eden" kovasına geçer. Bu yüzden `activeRequestCount` artık yalnızca
 * "yayinda" olmayı değil, henüz kabul edilmiş teklifi olmamayı da şart
 * koşar (bkz. job-requests.ts).
 *
 * `getJobRequestFilter`'ın döndürebileceği dördüncü değer olan
 * "kabul-edildi" (teklif kabul edildi, iş henüz başlamadı, Hizmet Alan'ın
 * "Görüşme Sonucu" kararı bekleniyor) BİLEREK hiçbir sayaca dahil edilmez —
 * bu durumdaki ilan zaten "Gelen Teklifler" sayısına dahildir ve asıl
 * eylem alanı orasıdır, panel kartlarına yeni bir kart eklenmedi.
 */
export function getHizmetAlanPanelSummary(
  session: Session,
  jobs: Job[],
  offers: Offer[],
): HizmetAlanPanelSummary {
  const myJobs = jobs.filter((job) => job.requesterId === session.id);
  const myJobIds = new Set(myJobs.map((job) => job.id));
  const myJobTitleById = new Map(myJobs.map((job) => [job.id, job.title] as const));

  let activeRequestCount = 0;
  let inProgressCount = 0;
  let completedCount = 0;
  let expiredListingCount = 0;
  for (const job of myJobs) {
    const filter = getJobRequestFilter(job, offers);
    if (filter === "aktif") {
      // İlan Kapatma: manuel olarak kapatılmış (bkz. job-closure.ts) bir ilan
      // da "Aktif Hizmet Talepleri" sayısına dahil edilmez — süresi dolmuş
      // ilanlarla AYNI ilke, yalnızca kendi (kendi sekmesi olan, "Kapatılan
      // İlanlar") ayrı bir sayaç TUTULMAZ; bu ilan yalnızca üç kovadan
      // (aktif/devam-eden/tamamlandi) hiçbirine dahil edilmeyerek dışlanır.
      if (isJobManuallyClosed(job)) {
        continue;
      }
      // İlan Yayın Süresi Yönetimi: "aktif" kovası artık yalnızca `getJobRequestFilter`e
      // değil, AYRICA 14 günlük yayın süresinin dolmamış olmasına da bağlıdır
      // (bkz. job-publish-window.ts#isJobListingExpired, tek doğruluk kaynağı) —
      // süresi dolmuş bir ilan "Aktif Hizmet Talepleri" sayısına ASLA dahil
      // edilmez. `isExpiredListingAwaitingAction` (daha dar — zaten yeniden
      // yayınlanmışları hariç tutar) yalnızca bu YENİ sayaç için kullanılır;
      // zaten yeniden yayınlanmış eski bir kayıt ne "aktif" ne de "aksiyon
      // bekleyen süresi dolmuş" sayılır (salt geçmiş kaydıdır).
      if (isJobListingExpired(job, offers)) {
        if (isExpiredListingAwaitingAction(job, offers)) expiredListingCount++;
      } else {
        activeRequestCount++;
      }
    } else if (filter === "devam-eden") inProgressCount++;
    else if (filter === "tamamlandi") completedCount++;
  }

  // Geri çekilmiş ("withdrawn") teklifler burada BİLEREK hariç tutulur (bkz.
  // isOfferVisibleInNormalLists) — "Gelen Teklifler" sayacına dahil edilmez
  // ve "yeni teklif geldi" olarak Son Hareketler'de yanıltıcı şekilde
  // görünmez; Hizmet Alan bunun yerine ayrı bir "teklif geri çekildi"
  // bildirimi alır (bkz. notifications.ts).
  const incomingOffers = offers
    .filter((offer) => myJobIds.has(offer.jobId))
    .filter(isOfferVisibleInNormalLists);

  const offerActivity: PanelActivityItem[] = incomingOffers
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((offer) => ({
      id: `offer-${offer.id}`,
      title: myJobTitleById.get(offer.jobId) ?? "İlanınız",
      suffix: "ilanınıza yeni bir teklif geldi.",
      status: offer.status,
      dateIso: offer.createdAt,
    }));

  // Aynı gerekçeyle (İlan Yayın Süresi Yönetimi'nden önce oluşturulmuş
  // ilanlarda `Job.createdAt` yok) iki kaynak HÂLÂ birebir kronolojik olarak
  // harmanlanmıyor: önce kesin olarak en yeni olduğu bilinen teklif
  // hareketleri, ardından (yer kalırsa) en yeni ilan oluşturma hareketleri
  // (mevcut kayıt sırasına göre — useAllJobs() zaten kullanıcı ilanlarını en
  // yeni önde döner) gösterilir; yalnızca `dateIso` artık (varsa) gerçek
  // `job.createdAt`i taşıdığı için PanelActivityList bu satırlarda da bir
  // tarih gösterebiliyor.
  const jobActivity: PanelActivityItem[] = myJobs.map((job) => ({
    id: `job-${job.id}`,
    title: job.title,
    suffix: "talebiniz oluşturuldu.",
    dateIso: job.createdAt,
  }));

  const recentActivity = [...offerActivity, ...jobActivity].slice(0, MAX_RECENT_ACTIVITY);

  return {
    activeRequestCount,
    incomingOfferCount: incomingOffers.length,
    inProgressCount,
    completedCount,
    expiredListingCount,
    recentActivity,
  };
}

/**
 * Hizmet Veren panel özeti. "Devam Eden İşler" ve "Tamamlanan İşler",
 * Hizmet Alan tarafındakiyle aynı merkezi sabitlerden (IN_PROGRESS_OFFER_STATUSES /
 * COMPLETED_OFFER_STATUSES, job-requests.ts) hesaplanır — status listesi
 * burada ayrıca elle tekrar yazılmaz.
 */
export function getHizmetVerenPanelSummary(
  session: Session,
  jobs: Job[],
  offers: Offer[],
): HizmetVerenPanelSummary {
  const jobById = new Map(jobs.map((job) => [job.id, job] as const));
  // `myOffers` (withdrawn DAHİL) yalnızca `myOfferedJobIds`/`availableListingCount`
  // için kullanılır: bir ilana geri çekilmiş bir teklif REOFFER_COOLDOWN_DAYS
  // dolana kadar yeniden teklif vermeyi engellediği için (bkz. offers.ts
  // #createOffer), o ilanın "Uygun İlanlar"da gösterilmemesi hâlâ doğrudur.
  // Sayaç/Son Hareketler gibi kullanıcıya görünen her şey `visibleMyOffers`
  // (withdrawn hariç, bkz. isOfferVisibleInNormalLists) üzerinden hesaplanır.
  const myOffers = offers.filter((offer) => offer.providerId === session.id);
  const myOfferedJobIds = new Set(myOffers.map((offer) => offer.jobId));
  const visibleMyOffers = myOffers.filter(isOfferVisibleInNormalLists);

  // Bir ilana kabul edilmiş/devam eden bir teklif olması artık bu sayaçtan
  // düşürmez — o ilan diğer Hizmet Verenlere hâlâ teklife açıktır (bkz.
  // job-requests.ts#getJobOfferAvailability).
  const availableListingCount = jobs.filter(
    (job) => isJobOpenForOffers(job.status) && !myOfferedJobIds.has(job.id),
  ).length;

  const acceptedOffers = visibleMyOffers.filter((offer) => offer.status === "accepted");
  const inProgressCount = visibleMyOffers.filter((offer) =>
    IN_PROGRESS_OFFER_STATUSES.includes(offer.status),
  ).length;
  const completedCount = visibleMyOffers.filter((offer) =>
    COMPLETED_OFFER_STATUSES.includes(offer.status),
  ).length;

  const recentActivity: PanelActivityItem[] = visibleMyOffers
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_RECENT_ACTIVITY)
    .map((offer) => {
      const suffix =
        offer.status === "accepted"
          ? "ilanına verdiğiniz teklif kabul edildi."
          : offer.status === "rejected"
            ? "ilanına verdiğiniz teklif reddedildi."
            : "ilanına teklif verdiniz.";
      return {
        id: `offer-${offer.id}`,
        title: jobById.get(offer.jobId)?.title ?? "İlan",
        suffix,
        status: offer.status,
        dateIso: offer.updatedAt,
      };
    });

  return {
    availableListingCount,
    myOfferCount: visibleMyOffers.length,
    acceptedOfferCount: acceptedOffers.length,
    inProgressCount,
    completedCount,
    recentActivity,
  };
}
