import { getCategoryDisplayLabel } from "./service-catalog";
import type { Job, Offer } from "./types";

export type IncomingOfferJobGroup = {
  jobId: string;
  /** Silinmiş/eksik ilan için `undefined` — kart bu durumu zaten güvenle işler (bkz. incoming-offer-card.tsx). */
  job: Job | undefined;
  offers: Offer[];
};

export type IncomingOfferCategoryGroup = {
  /** React `key` ve dahili gruplama anahtarı — job.category (ham, id ya da eski serbest metin) ya da eksik-ilan sentineli. Görünen etiketle KARIŞTIRILMAMALI. */
  categoryKey: string;
  categoryLabel: string;
  jobGroups: IncomingOfferJobGroup[];
  offerCount: number;
};

const MISSING_JOB_CATEGORY_KEY = "__missing-job__";
const MISSING_JOB_CATEGORY_LABEL = "İlan Bilgisine Ulaşılamayan Teklifler";

/**
 * "Gelen Teklifler" ekranının Hizmet Türü -> İlan -> Teklifler hiyerarşisini
 * kurar — salt görünüm katmanı, hiçbir Offer/Job kaydını değiştirmez, yeni
 * bir teklif durumu icat etmez.
 *
 * Girdi (`offers`) ZATEN filtrelenmiş VE `job-requests.ts#
 * sortIncomingOffersForDisplay` ile sıralanmış OLMALIDIR — bu fonksiyon o
 * sırayı bir daha SIRALAMAZ, yalnızca TEK GEÇİŞLİ (insertion-order) gruplar:
 * bir kategorinin/ilan grubunun listedeki KONUMU, o gruba giren İLK (yani
 * `offers` içinde en önce görünen — en öncelikli/en güncel) teklifin
 * konumuyla belirlenir. Böylece grup sırası da girdi kadar deterministiktir;
 * burada ayrıca bir sıralama kararı verilmez.
 *
 * `jobById.get(offer.jobId)` bulunamazsa (silinmiş/eksik ilan) teklif asla
 * atlanmaz/kaybolmaz — sabit bir "İlan Bilgisine Ulaşılamayan Teklifler"
 * kategorisinde, yine kendi `jobId`sine göre gruplanarak gösterilir (iki
 * farklı eksik `jobId` birbirine karışmaz). Kategori gruplama anahtarı
 * BİLEREK görünen etiket değil `job.category`nin HAM değeridir
 * (`getCategoryDisplayLabel` yalnızca ETİKET için çağrılır) — iki farklı ham
 * değerin görünüşte aynı etikete düşmesi gruplamayı yanlışlıkla
 * birleştirmesin diye.
 */
export function groupIncomingOffersByCategoryAndJob(
  offers: Offer[],
  jobById: Map<string, Job>,
): IncomingOfferCategoryGroup[] {
  const categories: IncomingOfferCategoryGroup[] = [];
  const categoryByKey = new Map<string, IncomingOfferCategoryGroup>();
  // Bir jobId her zaman TEK bir kategoriye düşer (o ilanın kendi kategorisi
  // sabittir), bu yüzden kategoriden bağımsız, tek bir global jobId->grup
  // eşlemesi yeterlidir.
  const jobGroupByJobId = new Map<string, IncomingOfferJobGroup>();

  for (const offer of offers) {
    const job = jobById.get(offer.jobId);
    const categoryKey = job ? job.category : MISSING_JOB_CATEGORY_KEY;

    let category = categoryByKey.get(categoryKey);
    if (!category) {
      category = {
        categoryKey,
        categoryLabel: job ? getCategoryDisplayLabel(job.category) : MISSING_JOB_CATEGORY_LABEL,
        jobGroups: [],
        offerCount: 0,
      };
      categoryByKey.set(categoryKey, category);
      categories.push(category);
    }
    category.offerCount += 1;

    let jobGroup = jobGroupByJobId.get(offer.jobId);
    if (!jobGroup) {
      jobGroup = { jobId: offer.jobId, job, offers: [] };
      jobGroupByJobId.set(offer.jobId, jobGroup);
      category.jobGroups.push(jobGroup);
    }
    jobGroup.offers.push(offer);
  }

  return categories;
}
