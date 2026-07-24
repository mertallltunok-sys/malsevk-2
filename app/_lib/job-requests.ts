import { isJobOpenForOffers } from "./jobs";
import type { Job, Offer, OfferStatus } from "./types";

export type JobRequestFilter = "aktif" | "kabul-edildi" | "devam-eden" | "tamamlandi";

/**
 * Bir teklifin "meşgul / henüz sonuçlanmamış" sayılan durumları — TEK ortak
 * doğruluk kaynağı, birden fazla bağımsız kuralın kullandığı:
 *  - "Bu ilan silinebilir mi" (jobHasAcceptedOffer, aşağıda — yalnızca
 *    offers.ts#deleteJobWithOffers'ın koruması; YENİ teklif verilebilirliğini
 *    ARTIK belirlemez, bkz. getJobOfferAvailability)
 *  - "Bu Hizmet Veren'in aktif iş kapasitesi doluyor mu"
 *    (provider-capacity.ts#getActiveJobCount)
 * İkisi kavramsal olarak aynı şeyi ifade eder: bir teklif bu durumlardan
 * birindeyse taraflar arasındaki iş henüz kapanmamıştır. Ayrıca
 * contact-access.ts, iletişim bilgisinin ne zaman açığa çıkacağını da bu
 * kümeyle belirler — iş süren tarafların birbirinin iletişim bilgisini
 * kaybetmemesi için. "agreement_failed" bilerek DAHİL DEĞİL — anlaşma
 * sağlanamadığında bu teklif artık "meşgul" sayılmaz (ilan silinebilir hale
 * gelir), Job.status'a hiç dokunulmadan. "completed"/"cancelled" de DAHİL
 * DEĞİL — bunlar işin sonuçlandığı, artık meşgul olmayan durumlardır.
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
 * Bir ilanın artık düzenlenemeyeceği teklif durumları — ENGAGED_OFFER_STATUSES
 * (iş hâlâ süren teklifler) + COMPLETED_OFFER_STATUSES (tamamlanmış) +
 * "cancelled" (bir tamamlanma anlaşmazlığının iptalle sonuçlanması, bkz.
 * offers.ts#resolveCompletionDispute) birleşimi. "cancelled" BİLEREK
 * ENGAGED_OFFER_STATUSES'a dahil değil (orası yalnızca "iş hâlâ sürüyor"
 * anlamına gelir, provider-capacity.ts onu bir kapasite serbest bırakma
 * sinyali olarak kullanır) — ama fiilen yaşanmış ve iptalle kapanmış bir
 * işin ilanı da artık düzenlenebilir olmamalı, bu yüzden burada AYRICA
 * ekleniyor. "pending"/"rejected"/"withdrawn"/"agreement_failed" bilerek
 * dışarıda — bunlar ilanın hâlâ düzenlenebilir kaldığı durumlardır (iş hiç
 * başlamadı ya da agreement_failed'da olduğu gibi ilan otomatik olarak
 * yeniden teklife açıldı). Modül dışına açılmıyor; tek erişim noktası
 * aşağıdaki `isJobEditable`'dır — durum listesi başka hiçbir dosyada
 * tekrar yazılmamalı.
 */
const JOB_LOCKING_OFFER_STATUSES: OfferStatus[] = [
  ...ENGAGED_OFFER_STATUSES,
  ...COMPLETED_OFFER_STATUSES,
  "cancelled",
];

/** job-edit-form.tsx (route koruması) ve job-store.ts#updateJob (veri katmanı) aynı mesajı kullanır. */
export const JOB_NOT_EDITABLE_MESSAGE = "Bu ilan, teklif süreci başladığı için artık düzenlenemez.";

/**
 * Bir ilanın (mevcut tekliflerine göre) hâlâ düzenlenebilir olup olmadığını
 * söyler — TEK ortak doğruluk kaynağı. job-requests-panel.tsx ("Düzenle"
 * linkinin görünürlüğü), job-edit-form.tsx (route koruması) ve
 * job-store.ts#updateJob (veri katmanı koruması) HEPSİ bu fonksiyonu
 * çağırır; aynı kural üç yerde ayrı ayrı yazılmaz.
 */
export function isJobEditable(jobId: string, offers: Offer[]): boolean {
  return !offers.some(
    (offer) => offer.jobId === jobId && JOB_LOCKING_OFFER_STATUSES.includes(offer.status),
  );
}

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

/**
 * Bir teklifin normal kullanıcı listelerinde/sayaçlarında görünüp
 * görünmeyeceğinin TEK ortak doğruluk kaynağı — bugün yalnızca "withdrawn"
 * hariç tutulur. Kayıt SİLİNMEZ (bkz. offers.ts#withdrawOffer): audit amaçlı
 * saklanır, yeniden-teklif-bekleme-süresi hesabında (REOFFER_COOLDOWN_*,
 * createOffer) ve kapasite/kabul geçmişi türetmelerinde (provider-profile.ts
 * #wasEverAccepted) hâlâ okunur — yalnızca "normal" listelerden/sayaçlardan
 * (Verdiğim Teklifler, Gelen Teklifler, panel özetleri) çıkarılır. Filtre
 * mantığı burada TEK yerde tutulur; her ekran kendi `!== "withdrawn"`
 * kontrolünü tekrar yazmaz.
 */
export function isOfferVisibleInNormalLists(offer: Offer): boolean {
  return offer.status !== "withdrawn";
}

/** "completion_requested" durumundaki bir teklifin, Hizmet Alan hiç işlem yapmazsa kaç gün sonra otomatik "completed" olacağı. */
export const COMPLETION_AUTO_APPROVE_DAYS = 7;

/**
 * Bir ilana kilitli (bkz. ENGAGED_OFFER_STATUSES) bir teklif olup olmadığını
 * söyler. Job.status'ta bunun karşılığı yok (bkz. types.ts: JobStatus
 * yalnızca "yayinda" | "tamamlandi" | "iptal") — kabul/iş başlama kararı
 * yalnızca Offer kayıtlarında tutuluyor. TEK KULLANIM YERİ artık
 * offers.ts#deleteJobWithOffers'ın "aktif/tamamlanmış bir işi olan ilan
 * silinemez" korumasıdır. Kasıtlı olarak YENİ teklif verilebilirliği
 * belirlemek için KULLANILMAZ — bir ilana teklif kabul edilmiş olması artık
 * o ilanı diğer Hizmet Verenlere kapatmıyor (bkz. getJobOfferAvailability,
 * offers.ts#createOffer); aynı anda yalnızca TEK bir teklifin anlaşma
 * sürecinin ilerleyebilmesi kuralı artık yalnızca isOfferPendingActionBlocked
 * ile (Kabul Et/Reddet aksiyonları üzerinde) uygulanır.
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
 * Bir ilana ait, taraflar arasında anlaşma süreci ilerlemiş (hâlâ meşgul —
 * bkz. getEngagedOfferForJob — YA DA başarıyla tamamlanmış — bkz.
 * getCompletedOfferForJob) tekli teklifi döndürür. Yeni bir durum listesi
 * icat etmez, yalnızca bu iki mevcut merkezi yardımcının birleşimidir.
 * "agreement_failed"/"cancelled"/"rejected"/"withdrawn"/"pending" BİLEREK
 * dışarıda — bunlar "bu teklifle iş yürümüyor" anlamına gelir ve ilanı
 * diğer bekleyen tekliflere yeniden açar (bkz. isOfferPendingActionBlocked).
 */
export function getSettledOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return getEngagedOfferForJob(jobId, offers) ?? getCompletedOfferForJob(jobId, offers);
}

/** incoming-offer-card.tsx (buton yerine gösterilir) ve offers.ts#updateOfferStatus (veri katmanı hata mesajı) AYNI metni paylaşır. */
export const OFFER_PENDING_BLOCKED_MESSAGE = "Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.";

/**
 * Bir "pending" teklifin Kabul Et/Reddet eylemlerinin, AYNI ilana ait BAŞKA
 * bir teklifin anlaşma süreci ilerlediği için geçici (teklif "completed"
 * ise kalıcı) olarak askıya alınıp alınmadığını söyler — TEK ortak doğruluk
 * kaynağı. Hem incoming-offer-card.tsx (buton görünürlüğü) hem
 * offers.ts#updateOfferStatus (veri katmanında zorunlu kılma) bu fonksiyonu
 * çağırır; aynı kural iki yerde ayrı ayrı yazılmaz. Bir teklif yalnızca
 * BAŞKA bir teklif yüzünden engellenebilir — kendi durumu asla kendini
 * engellemez (bu yüzden `settled.id !== offer.id` kontrolü var).
 */
export function isOfferPendingActionBlocked(offer: Offer, offers: Offer[]): boolean {
  const settled = getSettledOfferForJob(offer.jobId, offers);
  return settled !== null && settled.id !== offer.id;
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
 *
 * Bir ilana kabul edilmiş/devam eden bir teklif olması (bkz.
 * jobHasAcceptedOffer/ENGAGED_OFFER_STATUSES) BİLEREK burada "kapali"
 * üretmez — bu ilan, "yayinda" kaldığı sürece daima "acik" döner. Aynı anda
 * yalnızca TEK bir teklifin anlaşma sürecinin ilerleyebilmesi kuralı
 * (Hizmet Alan'ın Kabul Et/Reddet aksiyonları) artık ilanın kendisini
 * kapatarak değil, yalnızca o aksiyonların üzerinde uygulanır — bkz.
 * isOfferPendingActionBlocked (incoming-offer-card.tsx,
 * offers.ts#updateOfferStatus). `offers` parametresi imza uyumluluğu için
 * korunur (çağıranlar değişmedi) ama bu fonksiyonun gövdesinde artık
 * kullanılmaz. "kapali" değeri hâlâ `JobOfferAvailability` tipinde ve
 * getJobAvailabilityForProvider'da (aşağıda) bir dal olarak durur — o dal
 * bugünkü akışta bu fonksiyon tarafından hiç tetiklenmez, ama tip/etiket
 * altyapısını bozmamak için kaldırılmadı.
 */
export function getJobOfferAvailability(job: Job, offers: Offer[]): JobOfferAvailability {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status === "iptal") return "iptal";
  return "acik";
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

/**
 * Bir ilanın şu anda yeni bir teklifi kabul edip edemeyeceğinin tek,
 * birleşik kontrolü. Kabul edilmiş/devam eden bir teklifin varlığı BİLEREK
 * artık bunu false yapmaz (bkz. getJobOfferAvailability) — yalnızca ilanın
 * kendi durumu (job.status) belirleyicidir. `offers` parametresi imza
 * uyumluluğu için korunur, gövdede kullanılmaz.
 */
export function isJobAcceptingNewOffers(job: Job, offers: Offer[]): boolean {
  return isJobOpenForOffers(job.status);
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

export type ProviderOfferFilter = "aktif" | "devam-eden" | "tamamlandi" | "kapanan-teklifler";

/**
 * Bir "pending" kardeş teklifin (aynı ilana verilmiş, kabul edilmemiş başka
 * bir teklif), ilanın kabul edilmiş teklifi fiilen İŞE BAŞLADIĞI için artık
 * anlamsız kaldığını söyler — TEK ortak doğruluk kaynağı, yeni bir
 * Offer.status İCAT ETMEZ. getSettledOfferForJob'ı (üstteki, tek doğruluk
 * kaynağı) tekrar yazmaz, üzerine tek bir ek koşulla inşa eder: settled
 * teklif hâlâ yalnızca "accepted" ise (kabul edildi ama işe henüz
 * başlanmadı) bu BİLEREK false döner — kardeş teklif "aktif" kalmaya devam
 * eder, tıpkı işe başlamadan önceki mevcut davranışta olduğu gibi. Settled
 * teklif "in_progress"/"completion_requested"/"completion_disputed"/
 * "completed" olduğunda true döner. Settled teklif sonradan "cancelled"
 * sonucuyla biterse (bkz. offers.ts#resolveCompletionDispute)
 * getSettledOfferForJob onu artık döndürmez, bu da kardeş teklifi otomatik
 * olarak yeniden "aktif"e döndürür — isOfferPendingActionBlocked'daki aynı
 * yeniden-açılma deseniyle (Hizmet Alan tarafında Kabul Et/Reddet
 * butonlarının yeniden görünmesiyle) tutarlıdır.
 */
function isOfferClosedByJobProgress(offer: Offer, offers: Offer[]): boolean {
  const settled = getSettledOfferForJob(offer.jobId, offers);
  return settled !== null && settled.id !== offer.id && settled.status !== "accepted";
}

/**
 * Hizmet Veren'in "Verdiğim Teklifler" sayfasındaki sekme filtrelemesinin tek
 * ortak doğruluk kaynağı — yukarıdaki `getJobRequestFilter`in Job-seviyesi
 * (birden fazla teklifi birleştiren) muadili değil, TEK bir teklifin kendi
 * durumuna bakan Offer-seviyesi hali. IN_PROGRESS_OFFER_STATUSES/
 * COMPLETED_OFFER_STATUSES'ı (yukarıda tanımlı, tek doğruluk kaynağı)
 * doğrudan kullanır, yeni bir status kümesi icat etmez. İkinci parametre
 * (`offers`, ilana ait TÜM teklifler — yalnızca çağıranın kendi teklifleri
 * değil) `isOfferClosedByJobProgress` için gereklidir; tek bir Offer'ın
 * kendi durumuna bakmak yetmez, kardeş tekliflerin durumuna da bakılmalıdır.
 *
 * "accepted" (kabul edildi ama iş henüz başlamadı) burada `getJobRequestFilter`
 * ile aynı şekilde kendi başına bir sekme değildir — ayrı bir "Kabul Edilen"
 * sekmesi kaldırıldığı için "aktif"e düşer (bkz. my-offers-panel.tsx).
 * "rejected" (henüz kesin bir sonuca varmamış/kabul dışında sonuçlanmış her
 * şeyin toplandığı "aktif" sekmesinde kalır) DIŞINDA, kalıcı/olumsuz
 * sonuçlanan ÜÇ durum "kapanan-teklifler"e düşer: "agreement_failed" (kendi
 * kabulü sonradan bozulmuş), "cancelled" (kabul edilip iş başlamış, itiraz
 * edilmiş ve Hizmet Alan'ın "İptal Olarak Sonuçlandır" kararıyla kapanmış —
 * bkz. offers.ts#resolveCompletionDispute) ve "pending" bir kardeş teklif
 * (aynı ilandaki başka bir teklif fiilen işe başladıysa, bkz.
 * isOfferClosedByJobProgress — henüz kabul aşamasında ya da hiç kabul
 * yokken "aktif" kalır). Üçünde de kullanıcının üzerinde yapabileceği
 * hiçbir işlem kalmamıştır (bkz. my-offers-panel.tsx — bu durumlarda zaten
 * hiçbir aksiyon butonu render edilmez). Bu üç "kapanan-teklifler" durumu
 * ayrı gösterilir — my-offers-panel.tsx yalnızca "pending" olanı "Başka Bir
 * Hizmet Verenle Anlaşıldı" ile geçersiz kılar; "agreement_failed" ve
 * "cancelled" kendi getOfferStatusLabel'ını ("Anlaşma Sağlanamadı"/"İptal
 * Edildi") korur, "cancelled" ayrıca kartta "İtiraz sonrası iş iptal
 * edildi." bilgi satırını gösterir. "withdrawn" ise (bkz.
 * isOfferVisibleInNormalLists) `null` döner — `getJobRequestFilter`in
 * "iptal" ilan için null dönmesiyle aynı desen: hiçbir sekmede görünmesin
 * diye BİLEREK herhangi bir TabKey ile eşleşmez (my-offers-panel.tsx'teki
 * `=== activeTab` karşılaştırması bu yüzden ek bir filtre satırına gerek
 * duymadan withdrawn'ı otomatik eler).
 */
export function getProviderOfferFilter(offer: Offer, offers: Offer[]): ProviderOfferFilter | null {
  if (!isOfferVisibleInNormalLists(offer)) return null;
  if (IN_PROGRESS_OFFER_STATUSES.includes(offer.status)) return "devam-eden";
  if (COMPLETED_OFFER_STATUSES.includes(offer.status)) return "tamamlandi";
  if (offer.status === "agreement_failed" || offer.status === "cancelled") return "kapanan-teklifler";
  if (offer.status === "pending" && isOfferClosedByJobProgress(offer, offers)) return "kapanan-teklifler";
  return "aktif";
}

/**
 * Bir `ProviderOfferFilter` sekmesinin "Verdiğim Teklifler" route'unu
 * üretir — sekme bağlantıları (my-offers-panel.tsx#tabHref) ve bildirim
 * hedefleri (notifications.ts) bu TEK fonksiyonu paylaşır, route string'ini
 * iki ayrı yerde elle tekrar yazmazlar. "aktif" query param'sız temel
 * route'tur (bkz. my-offers-panel.tsx: bilinmeyen/eksik `durum` değeri de
 * güvenli varsayılan olarak buraya düşer).
 */
export function getProviderOffersTabHref(filter: ProviderOfferFilter): string {
  return filter === "aktif" ? "/panel/tekliflerim" : `/panel/tekliflerim?durum=${filter}`;
}

/**
 * Bir teklifin, Hizmet Veren'in "Verdiğim Teklifler" sayfasında hangi
 * sekmede göründüğünün route'unu doğrudan Offer'dan üretir —
 * `getProviderOfferFilter` + `getProviderOffersTabHref`'in birleşimi.
 * Bildirim hedefleri (notifications.ts) bunu kullanır, böylece bir
 * bildirimin yönlendirdiği sekme her zaman aynı teklifin GERÇEKTEN
 * göründüğü sekmeyle birebir eşleşir. `offers` (ilana ait TÜM teklifler)
 * `getProviderOfferFilter`e aktarmak için vardır — bu fonksiyonu çağıran
 * bildirim türlerinden ("kabul/ret/işe başlama/anlaşma sağlanamadı/
 * tamamlanma/itiraz/iptal") hiçbiri "pending" bir teklif için üretilmez, o
 * yüzden "kapanan-teklifler" dalının "pending" (kardeş teklif) kolu buradan
 * hiç tetiklenmez; ANCAK "anlasma_saglanamadi" bildirimi "agreement_failed",
 * "is_iptal_edildi" bildirimi ise "cancelled" durumundaki teklif için
 * üretilir ve bu iki durum da "kapanan-teklifler"e eşlenir (bkz.
 * getProviderOfferFilter) — yani bu dal GERÇEKTEN tetiklenir, yalnızca
 * "pending" kolundan değil "agreement_failed"/"cancelled" kollarından da.
 * `?? "aktif"` yalnızca tip güvenliği içindir — bu fonksiyonu çağıran hiçbir
 * bildirim türü "withdrawn" bir teklif için üretilmez (bkz. notifications.ts),
 * o yüzden pratikte hiç tetiklenmez.
 */
export function getProviderOfferNotificationHref(offer: Offer, offers: Offer[]): string {
  return getProviderOffersTabHref(getProviderOfferFilter(offer, offers) ?? "aktif");
}

/**
 * Bir ilanın, Hizmet Alan'ın "Hizmet Taleplerim" sayfasındaki route'unu
 * üretir — ilan hâlâ mevcutsa `getJobRequestFilter` ile doğru sekmeye (+
 * `ilanId` ile ilgili kartın vurgulanması/odaklanması için, bkz.
 * job-requests-panel.tsx) yönlendirir; ilan bulunamıyorsa (`job` null,
 * silinmiş) ya da hiçbir sekmeyle eşleşmiyorsa (`filter` null, ör. "iptal"
 * durumundaki ilan) güvenli şekilde ana görünüme (Aktif, vurgusuz) düşer.
 * "Bir teklif geri çekildi" bildirimi (notifications.ts) bunu kullanır.
 */
export function getJobRequestNotificationHref(job: Job | null, offers: Offer[]): string {
  if (!job) return "/panel/hizmet-taleplerim";
  const filter = getJobRequestFilter(job, offers);
  const base = filter && filter !== "aktif" ? `/panel/hizmet-taleplerim?durum=${filter}` : "/panel/hizmet-taleplerim";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}ilanId=${job.id}`;
}
