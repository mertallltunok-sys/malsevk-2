/**
 * İLAN KAPATMA — tek doğruluk kaynağı.
 *
 * Bir Hizmet Alan, ilgili hizmeti MALSEVK üzerinden değil de dışarıdan
 * tamamlamış ya da artık ilana ihtiyaç duymuyor olabilir — bu durumda ilan
 * SİLİNMEDEN (bkz. offers.ts#deleteJobWithOffers, ayrı/değişmemiş bir yol)
 * uygun bir nedenle KAPATILABİLİR. job-publish-window.ts'in (süre dolumu)
 * kurduğu "ilan var olmaya devam eder ama artık aktif sayılmaz" ilkesiyle
 * BİREBİR aynı mimari — yalnızca tetikleyici otomatik/tarih tabanlı değil,
 * Hizmet Alan'ın kendi kararıdır ve bir NEDEN taşır. `Job.status`a hiç
 * dokunulmaz, saf fonksiyonlar hiçbir state/yan etki taşımaz.
 */
import type { Job, JobClosureReason } from "./types";

export const JOB_CLOSURE_REASON_OPTIONS: { value: JobClosureReason; label: string }[] = [
  { value: "baska-hizmet-verenle-anlasildi", label: "Başka bir hizmet verenle anlaşıldı" },
  { value: "hizmete-ihtiyac-kalmadi", label: "Hizmete artık ihtiyaç kalmadı" },
  { value: "yanlislikla-olusturuldu", label: "Yanlışlıkla oluşturuldu" },
  { value: "diger", label: "Diğer" },
];

export function isJobClosureReason(value: unknown): value is JobClosureReason {
  return (
    value === "baska-hizmet-verenle-anlasildi" ||
    value === "hizmete-ihtiyac-kalmadi" ||
    value === "yanlislikla-olusturuldu" ||
    value === "diger"
  );
}

export function getJobClosureReasonLabel(reason: JobClosureReason): string {
  return JOB_CLOSURE_REASON_OPTIONS.find((option) => option.value === reason)?.label ?? "Diğer";
}

/** `Job.closedAt` doluysa bu ilan manuel olarak kapatılmıştır — TEK ortak doğruluk kaynağı. */
export function isJobManuallyClosed(job: Job): boolean {
  return Boolean(job.closedAt);
}

/**
 * offers.ts#closeJobListing, MALSEVK üzerinden işe başlanmış (in_progress)
 * veya tamamlanma sürecine girmiş (completion_requested/completion_disputed)
 * bir teklif varsa kapatmayı reddeder (bkz. o fonksiyonun
 * job-requests.ts#isJobClosedToNewOffers kontrolü — kabul edilmiş ama işe
 * henüz başlanmamış "accepted" bir teklif BİLEREK bu kapsamın dışındadır,
 * KRİTİK MİMARİ AYRIM ile aynı eşik). job-requests-panel.tsx bu mesajı
 * dialog hatasında gösterir.
 */
export const JOB_CLOSURE_BLOCKED_MESSAGE =
  "Bu ilan için bir hizmet verenle iş başlamış veya tamamlanma sürecine girmiş. İlanı kapatabilmek için mevcut iş sürecinin tamamlanması gerekir.";

export const JOB_ALREADY_CLOSED_MESSAGE = "Bu ilan zaten kapatılmış.";

/**
 * Hizmet Veren'e gönderilecek, kapatma nedenine göre değişen bilgilendirme
 * metni — notifications.ts#getNotificationsForSession'ın tek çağıranı.
 * "baska-hizmet-verenle-anlasildi" görev gereksiniminde BİREBİR verilen
 * cümledir; diğer üç neden için bu bilgilendirme cümlesi merkezi olarak
 * burada tutulur, çağıran tarafta tekrar yazılmaz.
 */
export function getJobClosureNotificationMessage(reason: JobClosureReason | undefined): string {
  switch (reason) {
    case "baska-hizmet-verenle-anlasildi":
      return "Hizmet Alan başka bir hizmet verenle anlaştı.";
    case "hizmete-ihtiyac-kalmadi":
      return "İlan sahibi bu hizmete artık ihtiyaç duymadığı için ilanı kapattı.";
    case "yanlislikla-olusturuldu":
      return "İlan sahibi, ilanın yanlışlıkla oluşturulduğunu belirterek ilanı kapattı.";
    case "diger":
    default:
      return "İlan sahibi ilanı kapattı.";
  }
}
