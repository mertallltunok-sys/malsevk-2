import { getCategoryDisplayLabel } from "./service-catalog";
import type { Job, Offer } from "./types";

export type IncomingOfferJobGroup = {
  jobId: string;
  /** Silinmiş/eksik ilan için `undefined` — kart bu durumu zaten güvenle işler (bkz. incoming-offer-card.tsx). */
  job: Job | undefined;
  /** `job` varsa service-catalog.ts#getCategoryDisplayLabel(job.category), yoksa MISSING_JOB_CATEGORY_LABEL — yalnızca görünen başlık chip'i içindir. */
  categoryLabel: string;
  offers: Offer[];
};

const MISSING_JOB_CATEGORY_LABEL = "İlan Bilgisine Ulaşılamayan Teklifler";

/**
 * "Gelen Teklifler" ekranının üst kısmındaki, HER bağımsız ilan için ayrı bir
 * seçilebilir başlık (chip) oluşturan ilan-bazlı gruplama — salt görünüm
 * katmanı, hiçbir Offer/Job kaydını değiştirmez, yeni bir teklif durumu icat
 * etmez. Bu, önceki "Hizmet Türü -> İlan -> Teklifler" iki seviyeli
 * gruplamanın (bkz. eski `groupIncomingOffersByCategoryAndJob`) YERİNE geçer
 * — kök gereksinim "yalnızca hizmet türüne göre gruplama yapma, aynı hizmet
 * türünde iki farklı ilan varsa iki ayrı başlık olarak görünmeli" artık bu
 * fonksiyonun kendisi tarafından garanti edilir (kategori seviyesi hiç yok,
 * her ilan zaten kendi grubu).
 *
 * Girdi (`offers`) ZATEN filtrelenmiş VE `job-requests.ts#
 * sortIncomingOffersForDisplay` ile sıralanmış OLMALIDIR — bu fonksiyon o
 * sırayı bir daha SIRALAMAZ, yalnızca TEK GEÇİŞLİ (insertion-order) gruplar:
 * bir ilan grubunun listedeki KONUMU, o gruba giren İLK (yani `offers`
 * içinde en önce görünen — en öncelikli/en güncel) teklifin konumuyla
 * belirlenir. Böylece grup sırası da girdi kadar deterministiktir; burada
 * ayrıca bir sıralama kararı verilmez — çağıran taraf (incoming-offers-panel.tsx)
 * bu yüzden "en güncel teklif bulunan ilan"ı güvenle `jobGroups[0]` olarak
 * varsayılan seçebilir.
 *
 * `jobById.get(offer.jobId)` bulunamazsa (silinmiş/eksik ilan) teklif asla
 * atlanmaz/kaybolmaz — kendi `jobId`sine göre AYRI bir grup olarak (sabit
 * "İlan Bilgisine Ulaşılamayan Teklifler" başlığıyla) gösterilir; iki farklı
 * eksik `jobId` birbirine karışmaz (her biri kendi chip'i).
 */
export function groupIncomingOffersByJob(offers: Offer[], jobById: Map<string, Job>): IncomingOfferJobGroup[] {
  const groups: IncomingOfferJobGroup[] = [];
  const groupByJobId = new Map<string, IncomingOfferJobGroup>();

  for (const offer of offers) {
    let group = groupByJobId.get(offer.jobId);
    if (!group) {
      const job = jobById.get(offer.jobId);
      group = {
        jobId: offer.jobId,
        job,
        categoryLabel: job ? getCategoryDisplayLabel(job.category) : MISSING_JOB_CATEGORY_LABEL,
        offers: [],
      };
      groupByJobId.set(offer.jobId, group);
      groups.push(group);
    }
    group.offers.push(offer);
  }

  return groups;
}
