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
 * "Devam Eden İşler" olarak sayılan teklif durumları — TEK ortak doğruluk
 * kaynağı. İş fiilen başlamış ("in_progress") ama henüz iki tarafça da
 * kapatılmamış tüm durumları kapsar: tamamlandı bildirimi Hizmet Veren
 * tarafından gönderilmiş ama Hizmet Alan tarafından henüz onaylanmamış
 * ("completion_requested") ya da itiraz edilmiş ("completion_disputed")
 * olsa bile iş hâlâ "devam ediyor" sayılır. "accepted" bilerek DAHİL
 * DEĞİL — kabul edilmiş ama işe henüz başlanmamış teklifler ayrı bir
 * durumdur (bkz. getJobRequestFilter: "kabul-edildi").
 */
export const IN_PROGRESS_OFFER_STATUSES: OfferStatus[] = [
  "in_progress",
  "completion_requested",
  "completion_disputed",
];

/** "Tamamlanan İşler" olarak sayılan teklif durumları — TEK ortak doğruluk kaynağı. */
export const COMPLETED_OFFER_STATUSES: OfferStatus[] = ["completed"];

/**
 * Bir teklif bu durumlardan birine geçtiğinde, aynı Hizmet Veren'in aynı
 * ilana yeniden teklif verebilmesi süreli olarak (bkz. REOFFER_COOLDOWN_DAYS)
 * engellenir — kalıcı değil. "accepted"/"in_progress"/"completion_requested"/
 * "completion_disputed"/"completed"/"cancelled" bilerek DAHİL DEĞİL — bu
 * durumlardan sonra aynı ilana asla yeniden teklif verilemez (bkz.
 * offers.ts#createOffer). TEK ortak doğruluk kaynağıdır.
 */
export type ReofferCooldownStatus = "withdrawn" | "rejected" | "agreement_failed";

export const REOFFER_COOLDOWN_OFFER_STATUSES: ReofferCooldownStatus[] = [
  "withdrawn",
  "rejected",
  "agreement_failed",
];

/** REOFFER_COOLDOWN_OFFER_STATUSES'tan birine geçtikten sonra yeniden teklif verilebilmesi için beklenmesi gereken gün sayısı. */
export const REOFFER_COOLDOWN_DAYS = 3;

/** Tip daraltıcı: `Array.prototype.includes` TypeScript'te otomatik daraltma yapmadığı için (bkz. offer-panel.tsx). */
export function isReofferCooldownStatus(status: OfferStatus): status is ReofferCooldownStatus {
  return status === "withdrawn" || status === "rejected" || status === "agreement_failed";
}

/** "completion_requested" durumundaki bir teklifin, Hizmet Alan hiç işlem yapmazsa kaç gün sonra otomatik "completed" olacağı. */
export const COMPLETION_AUTO_APPROVE_DAYS = 7;

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
 * Bir ilana kilitli (bkz. ENGAGED_OFFER_STATUSES) tekli teklifi döndürür —
 * `jobHasAcceptedOffer`'ın boolean değil, asıl kaydı döndüren hâli. Bir
 * ilanın aynı anda en fazla bir "meşgul" teklifi olabilir (createOffer bunu
 * zorunlu kılar), bu yüzden `.find()` güvenlidir. Hizmet Alan'ın kendi
 * ilanları listesinde (job-requests-panel.tsx), ilgili teklifin tam
 * durumuna (ör. "completion_requested") göre aksiyon kutusu göstermek için
 * kullanılır — aynı filtreleme mantığı tekrar yazılmaz.
 */
export function getEngagedOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return offers.find((offer) => offer.jobId === jobId && ENGAGED_OFFER_STATUSES.includes(offer.status)) ?? null;
}

/**
 * Bir ilanın tamamlanmış (bkz. COMPLETED_OFFER_STATUSES) tekli teklifini
 * döndürür — `getEngagedOfferForJob`'ın "completed" karşılığı. Puanlama
 * ekranının (Hizmet Taleplerim > Tamamlanan) ilgili teklifi bulması için
 * kullanılır.
 */
export function getCompletedOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return (
    offers.find((offer) => offer.jobId === jobId && COMPLETED_OFFER_STATUSES.includes(offer.status)) ?? null
  );
}

/**
 * "Kabul edildi" (karar bekleniyor), "devam eden" (iş fiilen başladı,
 * tamamlandı onayı bekliyor ya da itiraz edilmiş) ve "tamamlandı" ayrı
 * Job.status değerleri değil — ilgili Offer'ın durumuna göre ayrışır
 * (bkz. IN_PROGRESS_OFFER_STATUSES / COMPLETED_OFFER_STATUSES, tek ortak
 * doğruluk kaynağı). Var olmayan bir alan icat edilmiyor; yalnızca mevcut
 * Job.status ve Offer.status birleştirilerek türetiliyor. "iptal"
 * durumundaki ilanlar hiçbir filtreye girmez (null döner). "tamamlandi"
 * kontrolü hem Job.status hem Offer.status üzerinden yapılır: bugünkü
 * akışta yalnızca ikincisi gerçekleşir (Job.status hiçbir teklif
 * geçişinde değişmez, bkz. types.ts), ama Job.status'un ileride bir gün
 * gerçekten "tamamlandi" olabileceği ihtimaline karşı ilk kontrol de
 * korunur.
 */
export function getJobRequestFilter(job: Job, offers: Offer[]): JobRequestFilter | null {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status !== "yayinda") return null;

  const jobOffers = offers.filter((offer) => offer.jobId === job.id);
  if (jobOffers.some((offer) => COMPLETED_OFFER_STATUSES.includes(offer.status))) return "tamamlandi";
  if (jobOffers.some((offer) => IN_PROGRESS_OFFER_STATUSES.includes(offer.status))) return "devam-eden";
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

export type ProviderOfferFilter = "aktif" | "devam-eden" | "tamamlandi";

/**
 * Hizmet Veren'in "Verdiğim Teklifler" sayfasındaki sekme filtrelemesinin tek
 * ortak doğruluk kaynağı — yukarıdaki `getJobRequestFilter`in Job-seviyesi
 * (birden fazla teklifi birleştiren) muadili değil, TEK bir teklifin kendi
 * durumuna bakan Offer-seviyesi hali. IN_PROGRESS_OFFER_STATUSES/
 * COMPLETED_OFFER_STATUSES'ı (yukarıda tanımlı, tek doğruluk kaynağı)
 * doğrudan kullanır, yeni bir status kümesi icat etmez.
 *
 * "accepted" (kabul edildi ama iş henüz başlamadı) burada `getJobRequestFilter`
 * ile aynı şekilde kendi başına bir sekme değildir — ayrı bir "Kabul Edilen"
 * sekmesi kaldırıldığı için "aktif"e düşer (bkz. my-offers-panel.tsx).
 * "pending"/"rejected"/"withdrawn"/"agreement_failed"/"cancelled" (henüz
 * kabul edilmemiş ya da olumsuz sonuçlanmış teklifler) de aynı şekilde
 * "aktif" sekmesine düşer — kesin bir sonuca varmamış ya da kabul dışında
 * sonuçlanmış her şeyin toplandığı sekme.
 */
export function getProviderOfferFilter(offer: Offer): ProviderOfferFilter {
  if (IN_PROGRESS_OFFER_STATUSES.includes(offer.status)) return "devam-eden";
  if (COMPLETED_OFFER_STATUSES.includes(offer.status)) return "tamamlandi";
  return "aktif";
}
