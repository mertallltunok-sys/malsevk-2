import {
  COMPLETED_OFFER_STATUSES,
  IN_PROGRESS_OFFER_STATUSES,
  getJobRequestFilter,
  isOfferVisibleInNormalLists,
  jobHasAcceptedOffer,
} from "./job-requests";
import { isJobOpenForOffers } from "./jobs";
import type { Job, Offer, OfferStatus, Session } from "./types";

/**
 * `title`, sunum katmanında kalın gösterilecek ilan başlığıdır — mesaj
 * metnine tırnakla gömülmez (başlığın kendisi zaten bir kesme işareti
 * içerebiliyor, ör. "40'lık"; iç içe tırnak karışıklığı olmasın diye
 * başlık ile geri kalan cümle ayrı alanlarda tutulur).
 * `status`/`dateIso`, yalnızca gerçekten mevcutsa doldurulur (Job tipinde
 * oluşturulma tarihi yok, bu yüzden ilan oluşturma hareketlerinde
 * `dateIso` bilinçli olarak boş bırakılır — sahte bir tarih üretilmez).
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
  for (const job of myJobs) {
    const filter = getJobRequestFilter(job, offers);
    if (filter === "aktif") activeRequestCount++;
    else if (filter === "devam-eden") inProgressCount++;
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

  // Yalnızca tekliflerin gerçek bir oluşturulma zaman damgası (createdAt)
  // var; Job tipinde henüz bir oluşturulma tarihi alanı yok (bkz. types.ts).
  // Bu yüzden iki kaynak birebir kronolojik olarak harmanlanamıyor: önce
  // kesin olarak en yeni olduğu bilinen teklif hareketleri, ardından (yer
  // kalırsa) en yeni ilan oluşturma hareketleri (mevcut kayıt sırasına
  // göre — useAllJobs() zaten kullanıcı ilanlarını en yeni önde döner)
  // gösterilir.
  const jobActivity: PanelActivityItem[] = myJobs.map((job) => ({
    id: `job-${job.id}`,
    title: job.title,
    suffix: "talebiniz oluşturuldu.",
  }));

  const recentActivity = [...offerActivity, ...jobActivity].slice(0, MAX_RECENT_ACTIVITY);

  return {
    activeRequestCount,
    incomingOfferCount: incomingOffers.length,
    inProgressCount,
    completedCount,
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

  const availableListingCount = jobs.filter(
    (job) =>
      isJobOpenForOffers(job.status) &&
      !myOfferedJobIds.has(job.id) &&
      !jobHasAcceptedOffer(job.id, offers),
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
