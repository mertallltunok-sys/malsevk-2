import {
  computeGeneralJobBadges,
  getProviderBadgeForJob,
  isFeaturedJob,
  NEW_JOB_WINDOW_SIZE,
  type JobBadge,
} from "./job-listing-badges";
import { getJobAvailabilityForProvider, isOfferVisibleInNormalLists, type ProviderClosedReason } from "./job-requests";
import { getCategoryDisplayLabel } from "./service-catalog";
import type { Job, JobPhoto, Offer } from "./types";

export type JobListingRow = {
  job: Job;
  categoryLabel: string;
  /** İlk (order: 0) fotoğraf — yoksa null (bkz. job-thumbnail.tsx: bu durumda kategori ikonu gösterilir). */
  thumbnailPhoto: JobPhoto | null;
  photoCount: number;
  /** "withdrawn" hariç (bkz. isOfferVisibleInNormalLists) — Teklif Sayısı sütunu ve Teklif Bekliyor/Yoğun İlgi rozetleri bunu kullanır. */
  visibleOfferCount: number;
  generalBadges: JobBadge[];
  /** Oturumdaki Hizmet Veren'in KENDİ teklifine göre rozet — başka bir Hizmet Veren'e hiç gösterilmez. */
  providerBadge: JobBadge | null;
  isFeatured: boolean;
  isFavorited: boolean;
  /** job-requests.ts#getJobAvailabilityForProvider'ın AYNEN kullanımı — bu ilanın bu sağlayıcı için hâlâ teklife açık olup olmadığı (ör. kendi agreement_failed bekleme süresi). */
  availability: { open: boolean; closedReason: ProviderClosedReason | null };
  /** Rozetler filtresinin eşleştiği düz anahtar listesi (genel + kullanıcıya özel). */
  badgeKinds: string[];
};

/**
 * Masaüstü tablosu (job-listing-table.tsx) ve mobil kart listesinin
 * (job-listing-cards.tsx) İKİSİNİN de kullandığı TEK satır hesaplama
 * fonksiyonu — thumbnail/teklif sayısı/rozetler/favori/uygunluk her ilan
 * için yalnızca BİR KEZ hesaplanır, iki render yolunda tekrarlanmaz.
 */
export function buildJobListingRows(
  jobs: Job[],
  offers: Offer[],
  providerId: string,
  favoriteJobIds: string[],
): JobListingRow[] {
  const offersByJobId = new Map<string, Offer[]>();
  for (const offer of offers) {
    const existing = offersByJobId.get(offer.jobId);
    if (existing) existing.push(offer);
    else offersByJobId.set(offer.jobId, [offer]);
  }

  // "Yeni" rozeti: Job'da bir oluşturulma tarihi yok, bu yüzden useAllJobs()'un
  // zaten döndürdüğü "en yeni önde" sırası kullanılır (bkz. job-listing-badges.ts
  // NEW_JOB_WINDOW_SIZE dokümantasyonu) — yeni bir alan/şema eklenmez.
  const newestJobIds = new Set(
    jobs
      .filter((job) => job.requesterId !== null)
      .slice(0, NEW_JOB_WINDOW_SIZE)
      .map((job) => job.id),
  );

  const favoriteIdSet = new Set(favoriteJobIds);

  return jobs.map((job) => {
    const jobOffers = offersByJobId.get(job.id) ?? [];
    const visibleOfferCount = jobOffers.filter(isOfferVisibleInNormalLists).length;
    const sortedPhotos = [...job.photos].sort((a, b) => a.order - b.order);

    const generalBadges = computeGeneralJobBadges(job, newestJobIds.has(job.id), visibleOfferCount);
    const providerBadge = getProviderBadgeForJob(job.id, providerId);

    return {
      job,
      categoryLabel: getCategoryDisplayLabel(job.category),
      thumbnailPhoto: sortedPhotos[0] ?? null,
      photoCount: job.photos.length,
      visibleOfferCount,
      generalBadges,
      providerBadge,
      isFeatured: isFeaturedJob(job.id),
      isFavorited: favoriteIdSet.has(job.id),
      availability: getJobAvailabilityForProvider(job, offers, providerId),
      badgeKinds: [...generalBadges.map((badge) => badge.kind), providerBadge?.kind].filter(
        (kind): kind is string => kind !== undefined,
      ),
    };
  });
}
