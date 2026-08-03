import { isJobManuallyClosed } from "./job-closure";
import { isJobListingExpired } from "./job-publish-window";
import { getOperationStatusBucket } from "./job-requests";
import { getJobsByOperationId } from "./job-store";
import type { Job, Offer } from "./types";

/**
 * Bir operasyon KARDEŞİNİN, "Aktif İlanlar" beslemesi açısından kendi başına
 * artık "bitmiş" sayılıp sayılmadığı — TEK doğruluk kaynağı, aşağıdaki
 * `isJobFullyCompletedForListing`'in operasyon dalının ihtiyaç duyduğu tek
 * yardımcı. Bir kardeş üç BAĞIMSIZ yoldan "bitmiş" sayılabilir: gerçekten
 * tamamlanmış (`getOperationStatusBucket === "tamamlandi"`), Hizmet Alan
 * tarafından manuel kapatılmış (`job-closure.ts#isJobManuallyClosed`) ya da
 * yayın süresi dolmuş (`job-publish-window.ts#isJobListingExpired`) — HANGİ
 * yoldan olursa olsun, o kardeş artık teklif aramıyor/beklemiyor demektir.
 * BUG DÜZELTMESİ: eskiden yalnızca "tamamlandi" bucket'ı sayılıyordu — bu
 * yüzden tamamı tamamlanmış+kapatılmış (hiçbiri gerçekten "tamamlandi"
 * olmayan) bir operasyon hiçbir zaman "hepsi bitti" sayılmıyor, tek bir
 * gerçekten tamamlanmış kardeşi "hayalet" bir tekil ilan gibi Aktif
 * İlanlar'da bırakıyordu (bkz. isJobFullyCompletedForListing'in kendi
 * dokümantasyonu).
 */
function isOperationSiblingResolvedForListing(job: Job, offers: Offer[]): boolean {
  return (
    getOperationStatusBucket(job, offers) === "tamamlandi" ||
    isJobManuallyClosed(job) ||
    isJobListingExpired(job, offers)
  );
}

/**
 * Bir ilanın (tekil ya da bir operasyona bağlı) "Aktif İlanlar" beslemesinden
 * TAMAMEN kaldırılmasını gerektirecek kadar tamamlanmış olup olmadığının TEK
 * doğruluk kaynağı — provider-job-listing.tsx#activeJobs'un (aktif ilan
 * listesini/aramayı/filtreleri besleyen tek merkezi hesaplama) dördüncü,
 * bağımsız kapısı; job-publish-window.ts#isJobListingExpired (süre dolumu) ve
 * job-closure.ts#isJobManuallyClosed (Hizmet Alan'ın manuel kapatması) ile
 * BİREBİR aynı mimari: ilan hiçbir zaman SİLİNMEZ, `Job.status`a hiç
 * dokunulmaz, yalnızca "artık aktif ilan listesinde/aramada/filtrede
 * görünmesin" sinyali üretir. Bu fonksiyon, TEKİL bir ilan için, süre
 * dolumu/manuel kapatma kontrolleriyle AYNI seviyede (provider-job-
 * listing.tsx#activeJobs'ta yan yana) çağrılan BAĞIMSIZ bir kapıdır — o iki
 * kontrol her zaman THIS JOB'ın kendi durumuna bakar, bu fonksiyonun
 * operasyon dalı ise kardeşlerin durumuna bakar; ikisi birbirini
 * TEKRARLAMAZ.
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
 * tamamlanmış sayılır. Bu dal BİLEREK yalnızca gerçek tamamlanmayı kontrol
 * eder — bu ilanın kendi kapatma/süre-dolumu durumu zaten provider-job-
 * listing.tsx#activeJobs'ta AYRICA (ve bu ilan operasyona bağlı olsa da
 * olmasa da AYNI şekilde) kontrol edilir.
 *
 * Operasyon ilanı: `job-store.ts#getJobsByOperationId` ile operasyonun
 * GERÇEK/tam (filtreden bağımsız) kardeş kümesi çözülür — job-listing-row.ts#
 * buildOperationListingItem'ın toplam/tamamlanan sayılarını hesaplarken
 * kullandığı AYNI kaynak — ve yalnızca kardeşlerin HEPSİ (yukarıdaki
 * `isOperationSiblingResolvedForListing`e göre) "bitmiş" sayılırsa operasyon
 * tamamlanmış sayılır. "Bitmiş" burada gerçekten tamamlanmış OLMASI kadar,
 * manuel kapatılmış ya da süresi dolmuş olmasını da kapsar — üç hizmetten
 * biri tamamlanıp diğer ikisi (hiçbiri tamamlanmadan) kapatılmış bir
 * operasyon da BU YÜZDEN artık "tamamlanmış" sayılır ve tek kalan (zaten
 * tamamlanmış) kardeş, kalan kardeşleri kapatılmış diye "hayalet" bir tekil
 * ilan gibi Aktif İlanlar'da kalmaz — TÜM operasyon birlikte kalkar.
 * Kardeşlerden EN AZ BİRİ gerçekten hâlâ açık/yayında/tamamlanmamışsa (bkz.
 * `isOperationSiblingResolvedForListing`in `false` döndüğü tek durum) bu
 * fonksiyon `false` döner ve operasyon (o tek açık kardeş sayesinde) aktif
 * listede kalmaya devam eder — bu, o açık kardeşin kendi
 * `!isJobManuallyClosed`/`!isJobListingExpired` kontrollerinden zaten geçmiş
 * olması gerektiği anlamına gelir, aksi halde zaten kendi başına listeden
 * düşerdi.
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

  return siblings.every((sibling) => isOperationSiblingResolvedForListing(sibling, offers));
}
