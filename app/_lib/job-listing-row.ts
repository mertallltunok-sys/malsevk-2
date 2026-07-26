import { getJobsByOperationId } from "./job-store";
import { getJobLocationSummary, type JobLocationSummary } from "./job-location";
import {
  getJobAvailabilityForProvider,
  getOperationStatusSummary,
  isOfferVisibleInNormalLists,
  type ProviderClosedReason,
} from "./job-requests";
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

/** Aynı operationId'ye bağlı 2+ ilanı tek "operasyon" satırında temsil eder — bkz. groupJobListingRowsByOperation. */
export type OperationListingItem = {
  kind: "operation";
  operationId: string;
  /** Operasyonun GERÇEK oluşturulma sırasına göre İLK hizmeti (filtreden bağımsız — operasyonun tamamı üzerinden) — kartın başlık/fotoğraf/ilçe/tarihini bundan alır (bkz. "ilk hizmet ilanının başlığı" kuralı). */
  primaryRow: JobListingRow;
  /** Operasyonun TÜM (filtreden bağımsız) hizmet sayısı — job-requests.ts#getOperationStatusSummary'nin `total`'ı. Bkz. Aşama 5.1: filtre yalnızca operasyonun GÖRÜNÜP GÖRÜNMEYECEĞİNİ belirler, kartın içeriğini KÜÇÜLTMEZ. */
  totalCount: number;
  completedCount: number;
  /** job-requests.ts#getOperationStatusSummary'nin AYNEN kullanımı, operasyonun TÜM hizmetleri üzerinden — yeni bir ilerleme hesabı icat edilmedi. */
  progressPercent: number;
  /** Operasyonun TÜM hizmetlerinin kendi visibleOfferCount'larının toplamı. */
  visibleOfferCount: number;
};

export type JobListingDisplayItem = { kind: "single"; row: JobListingRow } | OperationListingItem;

/**
 * Çoklu Hizmet Operasyonu — Aşama 5.1 (Aşama 5'teki bir hatanın düzeltmesi):
 * "Aktif İlanlar" listesini sadeleştirmek için, aynı operationId'ye bağlı 2+
 * ilanı TEK bir görüntü öğesine (bkz. OperationListingItem) birleştirir.
 * İkinci bir operasyon sorgulama/cache sistemi YOK — `job-store.ts#
 * getJobsByOperationId` (Aşama 1/3) grubun GERÇEK oluşturulma sırasını
 * çözmek için, `job-requests.ts#getOperationStatusSummary` (Aşama 4) toplam/
 * tamamlanan/ilerleme sayılarını hesaplamak için AYNEN yeniden kullanılır.
 *
 * KÖK NEDEN (Aşama 5'te): bu fonksiyon yalnızca filtre SONRASI (`visibleRows`)
 * satırlarla çağrılıyordu — bu yüzden bir operasyonun filtreye uymayan
 * hizmetleri grup toplamına/ilerlemesine HİÇ girmiyordu, ve filtreye tek bir
 * hizmet uyduğunda grup 1 üyeye düşüp tamamen "single" bir ilana dönüşüyordu.
 *
 * Aşama 5.1 DÜZELTMESİ: filtre artık yalnızca "bu operasyon listede görünsün
 * mü" sorusuna cevap verir — kartın İÇERİĞİNİ (toplam/tamamlanan/ilerleme/
 * teklif sayısı/birincil hizmet) ASLA küçültmez:
 *  - `rows`: filtrelenmemiş, TÜM ("yayinda") ilanlar — bir operasyonun GERÇEK
 *    tüm üyelerini bulmak için kullanılır (`rowsByOperationId`).
 *  - `visibleJobIds`: hangi ilanların ŞU ANKİ filtreyi GEÇTİĞİ (çağıran
 *    tarafın zaten hesapladığı filtre sonucundan, bkz. provider-job-listing.tsx).
 * Bir operasyon, üyelerinden EN AZ BİRİ `visibleJobIds` içindeyse listede
 * görünür — göründüğünde totalCount/completedCount/progressPercent/
 * visibleOfferCount HER ZAMAN operasyonun TÜM üyelerinden hesaplanır, filtreyi
 * geçen alt kümeden DEĞİL. Operasyonun HİÇBİR üyesi filtreyi geçmiyorsa
 * operasyon listede hiç görünmez (ne grup ne de tekil bir kalıntı olarak).
 *
 * `rows`'un MEVCUT sırası (çağıran taraftan gelir — bkz. provider-job-listing.tsx,
 * bugün `useAllJobs()`'un ters çevrilmiş/en-yeni-önde sırası) hiç değiştirilmez:
 * bir operasyon grubu, o sırada İLK KARŞILAŞILAN üyesinin konumunda TEK bir
 * öğe olarak yayınlanır (bkz. CLAUDE.md/rapor: "mevcut ilan sıralamasını
 * bozmayacak"), sonraki üyeleri atlanır. Grup içindeki "birincil" (temsilci)
 * satır ise bu iterasyon sırasından BAĞIMSIZ olarak gerçek oluşturulma
 * sırasına göre seçilir — aksi halde `rows` ters çevrilmiş olduğu için "ilk
 * hizmet ilanı" yanlışlıkla EN SON oluşturulan hizmet olurdu.
 *
 * Bir operasyonun GERÇEK toplam üye sayısı 2'den azsa (savunma amaçlı — normal
 * akışta `createJobsForOperation` her zaman 2+ ilan yazar, ama bir kardeş
 * silinmiş olabilir) grup OLUŞTURULMAZ; tek kalan üye, filtreyi geçiyorsa
 * sıradan bir "single" öğe olarak (bugünkü gibi) render edilir.
 */
export function groupJobListingRowsByOperation(
  rows: JobListingRow[],
  visibleJobIds: ReadonlySet<string>,
  offers: Offer[],
): JobListingDisplayItem[] {
  const rowsByOperationId = new Map<string, JobListingRow[]>();
  for (const row of rows) {
    const operationId = row.job.operationId;
    if (!operationId) continue;
    const existing = rowsByOperationId.get(operationId);
    if (existing) existing.push(row);
    else rowsByOperationId.set(operationId, [row]);
  }

  const emittedOperationIds = new Set<string>();
  const items: JobListingDisplayItem[] = [];

  for (const row of rows) {
    const operationId = row.job.operationId;
    const fullGroupRows = operationId ? rowsByOperationId.get(operationId) : undefined;

    if (operationId && fullGroupRows && fullGroupRows.length >= 2) {
      if (emittedOperationIds.has(operationId)) continue;
      emittedOperationIds.add(operationId);
      const hasVisibleMember = fullGroupRows.some((groupRow) => visibleJobIds.has(groupRow.job.id));
      if (!hasVisibleMember) continue;
      items.push(buildOperationListingItem(operationId, fullGroupRows, offers));
      continue;
    }

    if (visibleJobIds.has(row.job.id)) {
      items.push({ kind: "single", row });
    }
  }

  return items;
}

function buildOperationListingItem(
  operationId: string,
  groupRows: JobListingRow[],
  offers: Offer[],
): OperationListingItem {
  const creationOrderJobIds = getJobsByOperationId(operationId).map((job) => job.id);
  const rankById = new Map(creationOrderJobIds.map((jobId, index) => [jobId, index]));
  const sortedGroupRows = [...groupRows].sort(
    (a, b) => (rankById.get(a.job.id) ?? 0) - (rankById.get(b.job.id) ?? 0),
  );

  const summary = getOperationStatusSummary(
    sortedGroupRows.map((groupRow) => groupRow.job),
    offers,
  );
  const visibleOfferCount = sortedGroupRows.reduce((sum, groupRow) => sum + groupRow.visibleOfferCount, 0);

  return {
    kind: "operation",
    operationId,
    primaryRow: sortedGroupRows[0],
    totalCount: summary.total,
    completedCount: summary.completedCount,
    progressPercent: summary.progressPercent,
    visibleOfferCount,
  };
}
