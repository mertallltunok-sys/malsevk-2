/**
 * İLAN ONAYI (admin moderasyonu) — tek doğruluk kaynağı.
 *
 * Hizmet Alan tarafından oluşturulan her yeni ilan, bir admin onaylayana
 * kadar Hizmet Veren'e (ve diğer Hizmet Alan kullanıcılarına) görünmez —
 * bkz. `Job.moderationStatus` (types.ts). Bu, `Job.status`ın (operasyonel
 * yaşam döngüsü: yayinda/tamamlandi/iptal, bkz. jobs.ts) KASITLI OLARAK AYRI
 * bir kavramdır — job-closure.ts/job-publish-window.ts'in kendi ayrı
 * alanlarıyla (closedAt/publishEndAt) aynı "yeni bir Job.status değeri icat
 * etme, ayrı bir alan tut" ilkesi.
 *
 * `getJobModerationStatus`, eksik (`undefined`) değeri `"approved"` sayar —
 * bu alan eklenmeden önce oluşturulmuş her ilan (ve tüm statik jobs.ts seed
 * ilanları) geriye dönük olarak onaylı davranır, hiçbir mevcut ilan bu
 * migration ile yanlışlıkla gizlenmez (bkz. job-store.ts#createJob'un yeni
 * ilanlar için `"pending_review"`yi AÇIKÇA yazması — varsayılan yalnızca
 * "alan hiç yoksa" durumunu kapsar).
 *
 * ÖNEMLİ MİMARİ NOT (bkz. proje raporu): bu dosyadaki görünürlük kontrolü,
 * job-visibility.ts'in kendi dokümantasyonunda zaten açıkça belirtilen aynı
 * sınırı taşır — "bu bir UI-surface garantisidir, sunucu tarafı bir
 * yetkilendirme sınırı DEĞİLDİR" (bkz. o dosya). Gerçek sunucu tarafı
 * yetkilendirme sınırı, Supabase migration 0035'in RLS politikası ve
 * `create_offer`/`approve_job_as_admin`/`reject_job_as_admin` RPC'leridir —
 * ama bugünkü canlı Hizmet Veren/Hizmet Alan akışının TAMAMI (bkz.
 * provider-job-listing.tsx, job-detail-content.tsx, offers.ts#createOffer)
 * yalnızca localStorage okur, Supabase'e hiç dokunmaz (bkz. CLAUDE.md "No
 * real backend") — bu yüzden bu dosyadaki kontroller, canlı uygulamanın
 * GERÇEKTEN sahip olduğu TEK enforcement noktasıdır, salt ek bir "güzel
 * olsun" katmanı değildir.
 */
import type { Job, JobModerationStatus, Session } from "./types";

/** Eksik değeri `"approved"` sayan TEK ortak doğruluk kaynağı — hiçbir çağıran `job.moderationStatus`u doğrudan okumamalı. */
export function getJobModerationStatus(job: Job): JobModerationStatus {
  return job.moderationStatus ?? "approved";
}

export function isJobModerationApproved(job: Job): boolean {
  return getJobModerationStatus(job) === "approved";
}

export function isJobModerationPending(job: Job): boolean {
  return getJobModerationStatus(job) === "pending_review";
}

/**
 * "Development Kapanış Turu" görevi — İlan sahibi kendi ilanını yalnızca
 * hâlâ "pending_review" iken düzenleyebilir. Bu, önceki (uncommitted, hiç
 * gerçek bir Supabase karşılığı olmayan) "kritik alan değişince yeniden
 * incelemeye al" yerel-only geri düşüşünün YERİNE geçer — `update_job_as_
 * requester` RPC'si (migration 0051) zaten YALNIZCA sunucudaki satır hâlâ
 * "pending_review" iken bir güncellemeyi kabul ediyor (aksi halde ML131),
 * bu yüzden onaylanmış/reddedilmiş bir ilanı "yeniden incelemeye alacak
 * şekilde" düzenlemenin sunucuya ulaşan GERÇEK bir yolu hiç yoktu — eski
 * davranış yalnızca localStorage'ı sessizce güncelleyip kullanıcıya sahte
 * bir başarı gösteriyordu. Burada YENİ bir "yeniden inceleme talebi" RPC/
 * akışı İCAT EDİLMEDİ (görev talimatı) — onaylanmış/reddedilmiş bir ilan
 * artık sahibi tarafından hiç düzenlenemez, üç katmanda da (job-requests-
 * panel.tsx'in "Düzenle" linki, job-edit-form.tsx'in route koruması,
 * job-store.ts#buildJobUpdate'in veri katmanı koruması) AYNI bu fonksiyon
 * kontrol edilir.
 */
export const JOB_NOT_EDITABLE_MODERATION_MESSAGE = "Bu ilan mevcut durumundayken düzenlenemez.";

export function isJobModerationRejected(job: Job): boolean {
  return getJobModerationStatus(job) === "rejected";
}

/**
 * Bir ilanın moderasyon durumundan BAĞIMSIZ olarak kimlere görünür olduğu:
 * onaylıysa herkese; değilse yalnızca ilan sahibine ("kendi hesabında
 * görebilmeli") veya bir admine ("admin tüm ilanları görebilir"). Diğer TÜM
 * Hizmet Alan/Hizmet Veren/misafir kullanıcılar için `false` — job-visibility.ts#
 * isJobVisibleToSession (Nakliye/Gümrük izolasyonu) ile AYNI seviyede,
 * ondan BAĞIMSIZ ikinci bir kapı; job-detail-content.tsx ikisini birlikte
 * (`&&`) uygular.
 */
export function isJobVisibleForModeration(session: Session | null, job: Job): boolean {
  if (isJobModerationApproved(job)) return true;
  if (!session) return false;
  return session.role === "admin" || session.id === job.requesterId;
}

/** `isJobVisibleForModeration`in dizi üzerindeki hâli — provider-job-listing.tsx/job-list.tsx/operation-status-card.tsx'in ortak çağırma noktası. */
export function filterModerationVisibleJobs(session: Session | null, jobs: Job[]): Job[] {
  return jobs.filter((job) => isJobVisibleForModeration(session, job));
}

export function getJobModerationStatusLabel(status: JobModerationStatus): string {
  switch (status) {
    case "pending_review":
      return "Admin Onayı Bekleniyor";
    case "approved":
      return "Onaylandı";
    case "rejected":
      return "Admin Tarafından Reddedildi";
  }
}

export function getJobModerationStatusTone(status: JobModerationStatus): "success" | "warning" | "danger" {
  switch (status) {
    case "pending_review":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

/**
 * Bir ilanın içeriğini etkileyen (hizmet türü/başlık/açıklama/ürün
 * bilgileri/lokasyon/tarih/nakliye rotası) alanlardan biri değişip
 * değişmediğini söyler. ARTIK HİÇBİR ÇAĞIRANI YOK ("Development Kapanış
 * Turu" görevi) — job-store.ts#buildJobUpdate eskiden bunu, önceden
 * onaylanmış/reddedilmiş bir ilanı YALNIZCA YEREL olarak yeniden
 * "pending_review"ye almak için kullanıyordu; bu davranış sunucuya hiç
 * ulaşmadığından (update_job_as_requester zaten yalnızca pending_review'ı
 * kabul eder) kullanıcıya sahte bir yerel başarı gösteriyordu ve kaldırıldı
 * — artık onaylanmış/reddedilmiş bir ilan sahibi tarafından hiç
 * düzenlenemez (bkz. isJobModerationPending). Fonksiyonun kendisi,
 * `jobHasAcceptedOffer`/`fetchJobByIdFromSupabase` ile AYNI "belgelenmiş
 * ama artık çağrılmayan" ilkeyle burada bırakıldı.
 */
export function didCriticalJobContentChange(before: Job, after: Job): boolean {
  const CRITICAL_SCALAR_KEYS = [
    "category",
    "title",
    "description",
    "province",
    "district",
    "workLocationType",
    "facilityId",
    "addressText",
    "locationMode",
    "workDate",
    "workEndDate",
    "productQuantity",
    "productTonnage",
    "productTonnageUnit",
    "productType",
    "customsTransactionType",
    "customsProductType",
    "deliveryProvince",
    "deliveryDistrict",
    "deliveryLocationType",
    "deliveryFacilityId",
    "deliveryFacilityName",
    "deliveryAddressText",
  ] as const satisfies readonly (keyof Job)[];

  for (const key of CRITICAL_SCALAR_KEYS) {
    if (before[key] !== after[key]) return true;
  }

  const beforeServices = JSON.stringify([...(before.customsRequestedServices ?? [])].sort());
  const afterServices = JSON.stringify([...(after.customsRequestedServices ?? [])].sort());
  return beforeServices !== afterServices;
}
