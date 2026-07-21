import { isJobOpenForOffers } from "./jobs";
import type { Job, Offer, OfferStatus } from "./types";

export type JobRequestFilter = "aktif" | "kabul-edildi" | "devam-eden" | "tamamlandi";

/**
 * Bir teklifin "meşgul / henüz sonuçlanmamış" sayılan durumları — TEK ortak
 * doğruluk kaynağı, iki bağımsız kuralın ikisi de bunu kullanır:
 *  - "Bu ilana artık yeni teklif verilemez" (jobHasAcceptedOffer, aşağıda)
 *  - "Bu Hizmet Veren'in aktif iş kapasitesi doluyor mu"
 *    (provider-capacity.ts#getActiveJobCount)
 * İkisi kavramsal olarak aynı şeyi ifade eder: bir teklif bu durumlardan
 * birindeyse taraflar arasındaki iş henüz kapanmamıştır. Ayrıca
 * contact-access.ts, iletişim bilgisinin ne zaman açığa çıkacağını da bu
 * kümeyle belirler — iş süren tarafların birbirinin iletişim bilgisini
 * kaybetmemesi için. "agreement_failed" bilerek DAHİL DEĞİL — anlaşma
 * sağlanamadığında ilan bu küme sayesinde otomatik olarak yeniden teklife
 * açık hale gelir, Job.status'a hiç dokunulmadan. "completed"/"cancelled"
 * de DAHİL DEĞİL — bunlar işin sonuçlandığı, artık meşgul olmayan
 * durumlardır.
 */
export const ENGAGED_OFFER_STATUSES: OfferStatus[] = [
  "accepted",
  "in_progress",
  "completion_requested",
  "completion_disputed",
];

/**
 * Bir ilana kilitli (bkz. ENGAGED_OFFER_STATUSES) bir teklif olup olmadığını
 * söyler. Job.status'ta bunun karşılığı yok (bkz. types.ts: JobStatus
 * yalnızca "yayinda" | "tamamlandi" | "iptal") — kabul/iş başlama kararı
 * yalnızca Offer kayıtlarında tutuluyor. Bu, "teklif kabul edildikten sonra
 * ilana başka teklif verilemesin" kuralının tek doğruluk kaynağıdır; hem
 * teklif oluşturma yetkilendirmesinde (offers.ts#createOffer) hem arayüz
 * etiketlerinde aynı fonksiyon kullanılır.
 */
export function jobHasAcceptedOffer(jobId: string, offers: Offer[]): boolean {
  return offers.some(
    (offer) => offer.jobId === jobId && ENGAGED_OFFER_STATUSES.includes(offer.status),
  );
}

/**
 * "Kabul edildi" (karar bekleniyor) ve "devam eden" (iş fiilen başladı)
 * ayrı Job.status değerleri değil — ilgili Offer'ın "accepted" mı
 * "in_progress" mi olduğuna göre ayrışır. Var olmayan bir alan icat
 * edilmiyor; yalnızca mevcut Job.status ve Offer.status birleştirilerek
 * türetiliyor. "iptal" durumundaki ilanlar hiçbir filtreye girmez (null
 * döner).
 */
export function getJobRequestFilter(job: Job, offers: Offer[]): JobRequestFilter | null {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status !== "yayinda") return null;

  const jobOffers = offers.filter((offer) => offer.jobId === job.id);
  if (jobOffers.some((offer) => offer.status === "in_progress")) return "devam-eden";
  if (jobOffers.some((offer) => offer.status === "accepted")) return "kabul-edildi";
  return "aktif";
}

export type JobOfferAvailability = "acik" | "kapali" | "tamamlandi" | "iptal";

/**
 * İlan listelerinde/detayında Hizmet Veren'e gösterilen "teklife açık mı"
 * durumu. `getJobStatusLabel`/`getJobStatusTone` (jobs.ts) genel ilan
 * yaşam döngüsünü anlatır ve başka yerlerde de kullanıldığı için
 * değiştirilmedi; bu, yalnızca "yeni teklif verilebilir mi" sorusuna
 * odaklanan ayrı (ama tutarlı) bir etiketleme katmanıdır.
 */
export function getJobOfferAvailability(job: Job, offers: Offer[]): JobOfferAvailability {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status === "iptal") return "iptal";
  return jobHasAcceptedOffer(job.id, offers) ? "kapali" : "acik";
}

export function getJobOfferAvailabilityLabel(availability: JobOfferAvailability): string {
  switch (availability) {
    case "acik":
      return "Teklife Açık";
    case "kapali":
      return "Teklife Kapalı";
    case "tamamlandi":
      return "Tamamlandı";
    case "iptal":
      return "İptal Edildi";
  }
}

export function getJobOfferAvailabilityTone(
  availability: JobOfferAvailability,
): "success" | "neutral" | "danger" {
  switch (availability) {
    case "acik":
      return "success";
    case "kapali":
      return "neutral";
    case "tamamlandi":
      return "neutral";
    case "iptal":
      return "danger";
  }
}

/** Bir ilanın şu anda yeni bir teklifi kabul edip edemeyeceğinin tek, birleşik kontrolü. */
export function isJobAcceptingNewOffers(job: Job, offers: Offer[]): boolean {
  return isJobOpenForOffers(job.status) && !jobHasAcceptedOffer(job.id, offers);
}

export type ProviderClosedReason = "gorusme-bekleniyor" | "is-devam-ediyor" | "tekrar-teklif-veremez";

/**
 * "Teklife Açık"/"Teklife Kapalı" ayrımının Hizmet Veren'in oturumuna özel
 * hali (İş İlanları ekranındaki iki bölümlü listeleme için). Aynı ilan,
 * anlaşma sağlanamamış bir firma için "kapalı", daha önce hiç teklif
 * vermemiş başka bir firma için "açık" olabilir — bu yüzden yalnızca
 * `getJobOfferAvailability` (ilan-geneli) yetmez; burada üzerine tek bir ek
 * kural (bu sağlayıcının kendi "agreement_failed" geçmişi) eklenir. Genel
 * durum zaten "kapalı" ise (kabul edilmiş/iş başlamış), bunun nedeni de
 * herkes için aynıdır ve döndürülür. Bu fonksiyon `getJobOfferAvailability`
 * ve `jobHasAcceptedOffer`'ı tekrar yazmaz, üzerine inşa eder.
 */
export function getJobAvailabilityForProvider(
  job: Job,
  offers: Offer[],
  providerId: string,
): { open: boolean; closedReason: ProviderClosedReason | null } {
  const generalAvailability = getJobOfferAvailability(job, offers);

  if (generalAvailability === "kapali") {
    const jobOffers = offers.filter((offer) => offer.jobId === job.id);
    if (jobOffers.some((offer) => offer.status === "in_progress")) {
      return { open: false, closedReason: "is-devam-ediyor" };
    }
    if (jobOffers.some((offer) => offer.status === "accepted")) {
      return { open: false, closedReason: "gorusme-bekleniyor" };
    }
    // Güvenli türetilemeyen bir "kapalı" durumu (teorik olarak ulaşılmaz,
    // ama tip güvenliği ve "yanlış/uydurma durum yazma" kuralı için).
    return { open: false, closedReason: null };
  }

  if (generalAvailability === "acik") {
    const hasFailedAgreementAsThisProvider = offers.some(
      (offer) =>
        offer.jobId === job.id && offer.providerId === providerId && offer.status === "agreement_failed",
    );
    if (hasFailedAgreementAsThisProvider) {
      return { open: false, closedReason: "tekrar-teklif-veremez" };
    }
    return { open: true, closedReason: null };
  }

  // "tamamlandi" | "iptal": bu fonksiyon yalnızca aktif ilan ekranı için
  // kullanılmalı — çağıran taraf zaten status === "yayinda" filtresi
  // uygulamış olmalı (bkz. job-listing-screen.tsx). Buraya düşerse güvenli
  // bir varsayılan döner.
  return { open: false, closedReason: null };
}

export function getProviderClosedReasonLabel(reason: ProviderClosedReason): string {
  switch (reason) {
    case "gorusme-bekleniyor":
      return "Görüşme Sonucu Bekleniyor";
    case "is-devam-ediyor":
      return "İş Devam Ediyor";
    case "tekrar-teklif-veremez":
      return "Bu ilana yeniden teklif veremezsiniz";
  }
}

export function getJobRequestFilterLabel(filter: JobRequestFilter): string {
  switch (filter) {
    case "aktif":
      return "Aktif";
    case "kabul-edildi":
      return "Teklif Kabul Edildi";
    case "devam-eden":
      return "Devam Ediyor";
    case "tamamlandi":
      return "Tamamlandı";
  }
}

export function getJobRequestFilterTone(
  filter: JobRequestFilter,
): "success" | "warning" | "neutral" {
  switch (filter) {
    case "aktif":
      return "success";
    case "kabul-edildi":
    case "devam-eden":
      return "warning";
    case "tamamlandi":
      return "neutral";
  }
}
