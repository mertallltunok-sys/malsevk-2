import { getJobLocationSummary, type JobLocationSummary } from "./job-location";
import { getJobAvailabilityForProvider, isOfferVisibleInNormalLists, type ProviderClosedReason } from "./job-requests";
import { getCategoryDisplayLabel } from "./service-catalog";
import type { Job, JobPhoto, Offer } from "./types";

export type JobListingRow = {
  job: Job;
  categoryLabel: string;
  /** İlk (order: 0) fotoğraf — yoksa null (bkz. job-thumbnail.tsx: bu durumda kategori ikonu gösterilir). */
  thumbnailPhoto: JobPhoto | null;
  photoCount: number;
  /** "withdrawn" hariç (bkz. isOfferVisibleInNormalLists) — Teklif Sayısı sütunu bunu kullanır. */
  visibleOfferCount: number;
  /** job-requests.ts#getJobAvailabilityForProvider'ın AYNEN kullanımı — bu ilanın bu sağlayıcı için hâlâ teklife açık olup olmadığı (ör. kendi agreement_failed bekleme süresi). */
  availability: { open: boolean; closedReason: ProviderClosedReason | null };
  /** job-location.ts#getJobLocationSummary'nin AYNEN kullanımı — firma/fabrika adı, bölge/tesis(+tür), ilçe/il. Açık adres BİLEREK dışarıda (bu ekran gizlilik gerekçesiyle hiçbir zaman adres göstermez). */
  location: JobLocationSummary;
};

/**
 * Masaüstü tablosu (job-listing-table.tsx) ve mobil kart listesinin
 * (job-listing-cards.tsx) İKİSİNİN de kullandığı TEK satır hesaplama
 * fonksiyonu — thumbnail/teklif sayısı/uygunluk/konum her ilan için yalnızca
 * BİR KEZ hesaplanır, iki render yolunda tekrarlanmaz.
 */
export function buildJobListingRows(jobs: Job[], offers: Offer[], providerId: string): JobListingRow[] {
  const offersByJobId = new Map<string, Offer[]>();
  for (const offer of offers) {
    const existing = offersByJobId.get(offer.jobId);
    if (existing) existing.push(offer);
    else offersByJobId.set(offer.jobId, [offer]);
  }

  return jobs.map((job) => {
    const jobOffers = offersByJobId.get(job.id) ?? [];
    const visibleOfferCount = jobOffers.filter(isOfferVisibleInNormalLists).length;
    const sortedPhotos = [...job.photos].sort((a, b) => a.order - b.order);

    return {
      job,
      categoryLabel: getCategoryDisplayLabel(job.category),
      thumbnailPhoto: sortedPhotos[0] ?? null,
      photoCount: job.photos.length,
      visibleOfferCount,
      availability: getJobAvailabilityForProvider(job, offers, providerId),
      location: getJobLocationSummary(job),
    };
  });
}
