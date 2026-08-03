import { getJobsByOperationId } from "./job-store";
import { getJobLocationSummary, type JobLocationSummary } from "./job-location";
import {
  getJobAvailabilityForProvider,
  getOperationStatusBucket,
  getOperationStatusSummary,
  isOfferVisibleInNormalLists,
  type ProviderClosedReason,
} from "./job-requests";
import { getNakliyeShortRoute, type NakliyeShortRouteSide } from "./nakliye-route";
import { formatJobProductInfoLine } from "./product-catalog";
import { getCategoryDisplayLabel, getServiceCategoryOrderIndex } from "./service-catalog";
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
  /** product-catalog.ts#formatJobProductInfoLine'ın AYNEN kullanımı — ürün bilgisi yoksa null (bkz. types.ts#Job.productQuantity/productTonnage/productType). */
  productInfoLine: string | null;
  /**
   * Nakliye Güzergâh Yönetimi — nakliye-route.ts#getNakliyeShortRoute'un
   * AYNEN kullanımı: Nakliye dışı bir ilanda ya da teslimat bilgisi eksikse
   * null. Tam açık adres KESİNLİKLE içermez (bkz. görev tanımı madde 11) —
   * her taraf kendi "İl / İlçe" + tesis-ya-da-manuel-ad çiftini taşır;
   * job-listing-table.tsx/job-listing-cards.tsx doluysa `location` yerine
   * bunu gösterir.
   */
  nakliyeRoute: { pickup: NakliyeShortRouteSide; delivery: NakliyeShortRouteSide } | null;
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
      productInfoLine: formatJobProductInfoLine(job),
      nakliyeRoute: getNakliyeShortRoute(job),
    };
  });
}

/**
 * Bir operasyon satırının/kartının "Operasyon · N Hizmet" rozetinin hemen
 * altında gösterilen, TEK bir hizmetin kompakt özeti — hizmet adını ve
 * yalnızca "tamamlandı mı" ikili durumunu taşır. Ayrıntılı durum (Teklife
 * Açık/İşe Başlandı/İtiraz Sürecinde vb.) BİLEREK BURADA YOKTUR: bu liste
 * yalnızca "bu operasyonda hangi hizmetler var ve hangileri bitti" sorusuna
 * özet bir cevap verir, ayrıntılı durumlar ilan detay sayfasında
 * (operation-status-card.tsx) kalır — iki ekran arasında bilgiyi tekrar
 * etmemek ve bu listeyi sade/kurumsal tutmak için kasıtlı bir tercih.
 */
export type OperationServiceSummary = {
  jobId: string;
  categoryLabel: string;
  /**
   * `job-requests.ts#getOperationStatusBucket(job, offers) === "tamamlandi"`nin
   * AYNEN kullanımı — bu hizmetin gerçek Job/Offer durumundan türetilen TEK
   * doğruluk kaynağı (ilerleme yüzdesi/ilan başlığı/operationId'den ASLA
   * tahmin edilmez). Global bir gerçektir, izleyen Hizmet Veren'e göre
   * DEĞİŞMEZ — `getOperationServiceCardStatus` (offers.ts, ilan detay
   * sayfasındaki izleyiciye-özel "Teklif Ver" durumu) ile KARIŞTIRILMAMALI,
   * bu yalnızca bir hizmetin tamamlanıp tamamlanmadığını söyler.
   */
  isCompleted: boolean;
};

/** Aynı operationId'ye bağlı 2+ ilanı tek "operasyon" satırında temsil eder — bkz. groupJobListingRowsByOperation. */
export type OperationListingItem = {
  kind: "operation";
  operationId: string;
  /**
   * Kartın başlık/fotoğraf/ilçe/tarihini bundan alır — GERÇEK oluşturulma
   * sırasına göre, o anki `visibleJobIds`i (filtreyi) GEÇEN İLK hizmet;
   * hiçbir üye filtreyi geçmiyorsa (teorik olarak imkânsız — bu fonksiyon zaten
   * `hasVisibleMember` doğruyken çağrılır) GERÇEK ilk hizmete düşer. KÖK NEDEN
   * DÜZELTMESİ: önceden HER ZAMAN operasyonun gerçek ilk hizmetiydi — bu,
   * örneğin bir operasyon Nakliye + Gözetim'den oluşup bir izleyici yalnızca
   * "Gözetim" kategorisiyle filtrelediğinde (ya da job-visibility.ts'in
   * izolasyon kuralı yüzünden yalnızca Gözetim'i görebildiğinde), kartın
   * başlığının/bağlantısının HER ZAMAN Nakliye'ye ait kalmasına, yani izleyicinin
   * kendi eşleştiği hizmetin adını hiç görememesine yol açıyordu. Filtre
   * uygulanmadığında (`visibleJobIds` operasyonun tüm üyelerini içeriyorsa)
   * davranış DEĞİŞMEZ — yine gerçek ilk hizmet seçilir.
   */
  primaryRow: JobListingRow;
  /** Operasyonun TÜM (filtreden bağımsız) hizmet sayısı — job-requests.ts#getOperationStatusSummary'nin `total`'ı. Bkz. Aşama 5.1: filtre yalnızca operasyonun GÖRÜNÜP GÖRÜNMEYECEĞİNİ belirler, kartın içeriğini KÜÇÜLTMEZ. */
  totalCount: number;
  completedCount: number;
  /** job-requests.ts#getOperationStatusSummary'nin AYNEN kullanımı, operasyonun TÜM hizmetleri üzerinden — yeni bir ilerleme hesabı icat edilmedi. */
  progressPercent: number;
  /** Operasyonun TÜM hizmetlerinin kendi visibleOfferCount'larının toplamı. */
  visibleOfferCount: number;
  /**
   * Operasyondaki HER hizmetin (filtreden bağımsız — operasyonun tamamı
   * üzerinden, `totalCount`/`progressPercent` ile AYNI ilke) kompakt özeti —
   * `service-catalog.ts#getServiceCategoryOrderIndex`e göre sabit sırayla
   * (rastgele DEĞİL). Her hizmet yalnızca bir kez görünür — bu, ayrı bir
   * dedup adımı GEREKTİRMEZ, çünkü `job-store.ts#createJobsForOperation` bir
   * operasyon içinde aynı kategorinin iki kez seçilmesini zaten veri
   * katmanında reddeder (bkz. "Aynı hizmet birden fazla kez seçilemez"
   * kontrolü) — bu dizide her zaman en fazla operasyonun kendi üye sayısı
   * kadar (`totalCount`) eleman bulunur, hepsi farklı kategoriden.
   */
  services: OperationServiceSummary[];
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
      items.push(buildOperationListingItem(operationId, fullGroupRows, offers, visibleJobIds));
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
  visibleJobIds: ReadonlySet<string>,
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
  const primaryRow =
    sortedGroupRows.find((groupRow) => visibleJobIds.has(groupRow.job.id)) ?? sortedGroupRows[0];

  // Hizmet Türü rozetinin hemen altındaki kompakt özet — service-catalog.ts
  // sırasına göre (creation/primary sırasından BAĞIMSIZ, ayrı bir sıralama).
  // Ekstra bir sorgu/okuma YOK: yalnızca zaten elde bulunan `job` üzerinde
  // saf hesaplama (bkz. OperationServiceSummary dokümantasyonu — durum
  // BİLEREK burada hesaplanmaz/taşınmaz).
  const services: OperationServiceSummary[] = sortedGroupRows
    .map((groupRow) => ({
      jobId: groupRow.job.id,
      categoryLabel: groupRow.categoryLabel,
      isCompleted: getOperationStatusBucket(groupRow.job, offers) === "tamamlandi",
      orderIndex: getServiceCategoryOrderIndex(groupRow.job.category),
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(({ jobId, categoryLabel, isCompleted }) => ({ jobId, categoryLabel, isCompleted }));

  return {
    kind: "operation",
    services,
    operationId,
    primaryRow,
    totalCount: summary.total,
    completedCount: summary.completedCount,
    progressPercent: summary.progressPercent,
    visibleOfferCount,
  };
}

/**
 * "Aktif İlanlar" tablosunun/kart listesinin "Hizmet Türü" ROZETİNİN (küçük
 * mavi hap — `bg-accent-soft`/`text-accent`) metnini üretir — HER RENDER'DA
 * yeniden hesaplanır. `job.title` (kullanıcının ilan oluştururken kendi
 * yazdığı serbest metin, "İlan Başlığı" sütunu/alanı) BU FONKSİYONDA HİÇ
 * KULLANILMAZ ve kesinlikle MUTASYONA UĞRAMAZ — "İlan Başlığı" alanı bu
 * ekranda da (job-listing-table.tsx/job-listing-cards.tsx) diğer TÜM
 * ekranlarda olduğu gibi kullanıcının kendi yazdığı metni, kendi mevcut
 * font/boyut/sırasıyla göstermeye devam eder; DEĞİŞEN TEK ŞEY rozetin
 * METNİDİR — rozetin kendi `className`i (renk/boyut/padding/hizalama)
 * çağıran taraf (job-listing-table.tsx/job-listing-cards.tsx) içinde AYNEN
 * kalır, bu fonksiyon yalnızca içindeki METNİ üretir. job-listing-table.tsx
 * (masaüstü) ve job-listing-cards.tsx (mobil) TARAFINDAN PAYLAŞILAN TEK
 * fonksiyon, aynı format iki yerde ayrı ayrı yazılmaz.
 *
 * Tekil ilan: `"{kategori} Hizmeti Arıyor"` — kategori adı `row.categoryLabel`
 * üzerinden (zaten `service-catalog.ts#getCategoryDisplayLabel`in AYNEN
 * kullanımı, bkz. buildJobListingRows) gelir; hiçbir hizmet adı bu fonksiyon
 * İÇİNDE hardcode edilmez. Önceki rozet metni yalnızca `{kategori}` idi (ör.
 * "Lashing") — bu format onun YERİNE geçer, eski hâli hiçbir yerde kalmaz.
 *
 * Operasyon ilanı: `"Operasyon • {kalan} Hizmet Arıyor"` — ayraç "•" (görev
 * gereksiniminin SON/geçerli talimatındaki BİREBİR karakter). `kalan =
 * totalCount - completedCount`, ikisi de `job-requests.ts#getOperationStatusSummary`
 * üzerinden (o da `getOperationStatusBucket`, yani gerçek job/offer durumu
 * üzerinden) türetilir; İLERLEME YÜZDESİNDEN, İLAN BAŞLIĞINDAN ya da yalnızca
 * `operationId`den ASLA tahmin edilmez. Tamamlanan hizmetler bu sayıya HİÇ
 * dahil edilmez (yalnızca henüz tamamlanmamışlar sayılır) — operasyondaki
 * TÜM hizmetler tamamlandığında `kalan` 0'a düşer, ama bu durumda operasyon
 * zaten `job-completion.ts#isJobFullyCompletedForListing` tarafından
 * `activeJobs`tan tamamen çıkarılmış olur (bkz. provider-job-listing.tsx),
 * yani bu fonksiyon o durumda hiç render edilmez — "0 Hizmet Arıyor" gibi
 * bir metin asla görünmez. Önceki rozet metni toplam sayıyı gösteriyordu
 * (ör. "Operasyon · 5 Hizmet", statik/hiç değişmeyen, "·" ayraçlı) — bu
 * format onun YERİNE geçer: sayı artık KALAN (dinamik), ayraç "•"ya döner,
 * sonuna " Arıyor" eklenir.
 */
export function getJobListingCategoryBadgeLabel(item: JobListingDisplayItem): string {
  if (item.kind === "operation") {
    const remainingCount = item.totalCount - item.completedCount;
    return `Operasyon • ${remainingCount} Hizmet Arıyor`;
  }
  return `${item.row.categoryLabel} Hizmeti Arıyor`;
}
