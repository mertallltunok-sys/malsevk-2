import { getOperationStatusBucket } from "./job-requests";
import { getJobsByOperationId } from "./job-store";
import type { Job, Offer } from "./types";

/**
 * Bir ilanın (tekil ya da bir operasyona bağlı) "Aktif İlanlar" beslemesinden
 * TAMAMEN kaldırılmasını gerektirecek kadar tamamlanmış olup olmadığının TEK
 * doğruluk kaynağı — provider-job-listing.tsx#activeJobs'un (aktif ilan
 * listesini/aramayı/filtreleri besleyen tek merkezi hesaplama) dördüncü,
 * bağımsız kapısı; job-publish-window.ts#isJobListingExpired (süre dolumu) ve
 * job-closure.ts#isJobManuallyClosed (Hizmet Alan'ın manuel kapatması) ile
 * BİREBİR aynı mimari: ilan hiçbir zaman SİLİNMEZ, `Job.status`a hiç
 * dokunulmaz, yalnızca "artık aktif ilan listesinde/aramada/filtrede
 * görünmesin" sinyali üretir.
 *
 * KRİTİK SINIR: bu fonksiyon YALNIZCA "Aktif İlanlar" keşif/listeleme
 * yüzeyini besleyen yerlerde (bugün: provider-job-listing.tsx) kullanılmalıdır
 * — my-offers-panel.tsx/job-requests-panel.tsx'in "Tamamlandı"/"Devam Eden"
 * sekmeleri, panel-summary.ts'nin sayaçları ve operation-status-card.tsx
 * (ilan detay sayfasındaki "Operasyon Durumu" — operasyonun TÜM hizmetlerini,
 * tamamlananlar dahil, göstermeye devam etmesi gerekir) kendi (offer-durumu
 * türetilmiş) yollarından görünmeye devam eder ve bu fonksiyonu HİÇ
 * çağırmaz — aksi halde tamamlanan bir işin geçmiş kaydı/bildirimi/durumu
 * yanlışlıkla kaybolurdu.
 *
 * Yeni teklif alma engeli AYRI ve zaten mevcut bir kapıdır
 * (`job-requests.ts#isJobClosedToNewOffers`, `offers.ts#canProviderSubmitNewOffer`/
 * `createOffer` üzerinden) — bu fonksiyon onu TEKRARLAMAZ/değiştirmez, yalnızca
 * "listede görünsün mü" sorusuna cevap verir. İkisi aynı temel veriden
 * (Offer.status) türediği için pratikte tutarlıdır: tamamlanmış bir ilanın
 * settled teklifi zaten "accepted"ın ötesindedir, bu da `isJobClosedToNewOffers`i
 * de bağımsız olarak `true` yapar — doğrudan URL ile erişimde bile yeni
 * teklif formu zaten hiç görünmez.
 *
 * Tekil ilan (operationId yok): `job-requests.ts#getOperationStatusBucket`
 * (TEK doğruluk kaynağı — gerçek Job/Offer durumundan türetilir, ilerleme
 * yüzdesi/başlık/operationId'den ASLA tahmin edilmez) `"tamamlandi"` dönerse
 * tamamlanmış sayılır.
 *
 * Operasyon ilanı: `job-store.ts#getJobsByOperationId` ile operasyonun
 * GERÇEK/tam (filtreden bağımsız) kardeş kümesi çözülür — job-listing-row.ts#
 * buildOperationListingItem'ın toplam/tamamlanan sayılarını hesaplarken
 * kullandığı AYNI kaynak — ve yalnızca kardeşlerin HEPSİ "tamamlandi"
 * bucket'ındaysa operasyon tamamlanmış sayılır. Kapatılmış (job-closure.ts)
 * ya da süresi dolmuş (job-publish-window.ts) ama HENÜZ tamamlanmamış bir
 * kardeş bu bucket'a hiç girmez (`getOperationStatusBucket` bu iki durumu
 * bilmez, kendi bucket'ında — genellikle "aktif" — kalır) — bu da onu doğal
 * olarak "tamamlanmamış" sayar ve operasyonu aktif listede tutar, ayrı bir
 * özel durum kodu GEREKMEZ.
 */
export function isJobFullyCompletedForListing(job: Job, offers: Offer[]): boolean {
  if (!job.operationId) {
    return getOperationStatusBucket(job, offers) === "tamamlandi";
  }

  const siblings = getJobsByOperationId(job.operationId);
  if (siblings.length < 2) {
    // Savunma amaçlı — job-listing-row.ts#buildOperationListingItem'ın AYNI
    // eşiği: bir kardeş silinmiş olabilir, tek kalan üyeyi tekil gibi ele al.
    return getOperationStatusBucket(job, offers) === "tamamlandi";
  }

  return siblings.every((sibling) => getOperationStatusBucket(sibling, offers) === "tamamlandi");
}
