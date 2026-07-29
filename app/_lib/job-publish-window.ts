/**
 * İLAN YAYIN SÜRESİ YÖNETİMİ — tek doğruluk kaynağı.
 *
 * Her yeni ilan, oluşturulduğu andan itibaren en fazla `JOB_PUBLISH_WINDOW_DAYS`
 * (14) gün yayında kalır. Süre dolduğunda ilan VERİTABANINDAN/localStorage'dan
 * SİLİNMEZ — yalnızca "aktif" listelerden/aramalardan/teklif alma
 * kapasitesinden düşer ve "Süresi Dolan İlanlar" bölümünde yönetilebilir hale
 * gelir (bkz. job-requests-panel.tsx). Bu dosya SAF fonksiyonlardan oluşur —
 * hiçbir state/zamanlayıcı/yan etki içermez; `now` her fonksiyona parametre
 * olarak geçirilebilir (varsayılan `new Date()`), bu sayede hem test edilebilir
 * hem de ileride gerçek bir sunucu/zamanlanmış görev ortamına taşınabilir
 * (bkz. dosyanın en altındaki not).
 *
 * KRİTİK MİMARİ AYRIM — bu kural yalnızca HÂLÂ teklif toplamaya açık olan
 * ilanlar için geçerlidir: bir ilana ait teklif kabul edilmiş, işe
 * başlanmış, tamamlanma sürecinde, itirazlı veya tamamlanmışsa (bkz.
 * job-requests.ts#getSettledOfferForJob — accepted ∪ in_progress ∪
 * completion_requested ∪ completion_disputed ∪ completed) o ilan 14 gün
 * dolsa bile ASLA "süresi dolmuş" sayılmaz; iş akışı zaten mevcut,
 * kanıtlanmış kurallarla (job-requests.ts/offers.ts) yönetiliyor. Burada YENİ
 * bir durum/eşik İCAT EDİLMEZ — tam olarak `getSettledOfferForJob`ın
 * kapsadığı küme kullanılır. Bir ilan sonradan "agreement_failed"/"cancelled"
 * ile bu kümenin dışına çıkarsa (bkz. o dosyadaki dokümantasyon), yayın süresi
 * kuralına GERİ döner — tıpkı yeni teklif alabilirliğinin de aynı şekilde
 * geri dönmesi gibi (tutarlı, aynı istisna kümesi).
 */
import { getSettledOfferForJob } from "./job-requests";
import type { Job, Offer } from "./types";

/** Bir ilanın en fazla kaç gün yayında kalacağı — TEK sabit, başka hiçbir dosyada tekrar yazılmaz. */
export const JOB_PUBLISH_WINDOW_DAYS = 14;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** `new Date(value)`in geçerli bir tarih üretip üretmediğini güvenle kontrol eder — NaN/"Invalid Date" durumlarında güvenli biçimde `false` döner. */
function isValidIsoDate(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Bir ilanın yayın BAŞLANGIÇ zamanı — bugün için her zaman `Job.createdAt`
 * ile birebir aynıdır (ayrı bir "yayın başlangıcı" kavramı YOKTUR, ilan
 * oluşturulduğu an yayına girer). `createdAt` yoksa (bu alandan önce
 * oluşturulmuş eski bir kayıt) `null` döner — sahte bir tarih ASLA
 * uydurulmaz.
 */
export function getJobPublishStartAt(job: Job): string | null {
  return job.createdAt && isValidIsoDate(job.createdAt) ? job.createdAt : null;
}

/**
 * Bir yayın başlangıç zaman damgasından (ISO), yayın BİTİŞ zaman damgasını
 * üretir — `createJob`/`createJobsForOperation`/`republishJob` (job-store.ts)
 * ve bu dosyadaki `getJobPublishEndAt` DIŞINDA hiçbir yerde elle tekrar
 * hesaplanmaz. Milisaniye hassasiyetiyle (`Date.getTime()` + sabit gün
 * sayısı × 86.400.000 ms) hesaplanır — takvim günü ekleme/saat dilimi
 * dönüşümü YAPILMAZ, bu sayede DST (yaz saati) geçişleri veya görüntüleyenin
 * yerel saat dilimi ilanın bir gün erken/geç kapanmasına yol AÇAMAZ; iki
 * zaman damgası her zaman ham UTC milisaniye olarak karşılaştırılır.
 */
export function computePublishEndAt(publishStartAtIso: string): string {
  return new Date(new Date(publishStartAtIso).getTime() + JOB_PUBLISH_WINDOW_DAYS * ONE_DAY_MS).toISOString();
}

/**
 * Bir ilanın yayın BİTİŞ zamanı — `Job.publishEndAt` doluysa onu döner;
 * boşsa ama `createdAt` güvenilir şekilde varsa `computePublishEndAt`le
 * TÜRETİR (ör. `publishEndAt`in kendisi bozuk/eksik ama `createdAt` sağlamsa
 * — normalde bu ikisi job-store.ts'te her zaman birlikte yazılır, ama bu
 * fonksiyon tek başına da tutarlı kalsın diye türetme burada tutulur).
 * İkisi de yoksa/geçersizse `null` döner — bkz. `isJobPublishWindowExpired`in
 * bu durumda uyguladığı "süresi dolmuş SAYMA" güvenli varsayılanı.
 */
export function getJobPublishEndAt(job: Job): string | null {
  if (job.publishEndAt && isValidIsoDate(job.publishEndAt)) return job.publishEndAt;
  const start = getJobPublishStartAt(job);
  return start ? computePublishEndAt(start) : null;
}

/**
 * YALNIZCA tarih karşılaştırmasına bakar — teklif durumunu (iş akışı
 * başlamış mı) hiç dikkate almaz; "bu ilan gerçekten Süresi Dolan İlanlar'a
 * taşınmalı mı" sorusunun TEK doğruluk kaynağı `isJobListingExpired`dir
 * (aşağıda), bu fonksiyon onun yalnızca tarih bacağıdır.
 *
 * LEGACY GÜVENLİ VARSAYILAN: `getJobPublishEndAt` `null` dönerse (bu ilan
 * `createdAt`/`publishEndAt` alanlarından ÖNCE oluşturulmuş, güvenilir bir
 * yayın başlangıcı YOK) bu fonksiyon BİLEREK `false` döner — güvenilir bir
 * tarih verisi olmayan eski kayıtlar asla otomatik olarak süresi dolmuş
 * SAYILMAZ (bkz. görev gereksinimi: "Oluşturulma tarihi bulunmayan eski
 * kayıtları otomatik olarak süresi dolmuş sayma"). Bu, o kaydı BOZMAZ/SİLMEZ/
 * yanlış bölüme TAŞIMAZ — yalnızca bu YENİ kuraldan tamamen muaf tutar; kayıt
 * her zamanki gibi (bu özellikten önceki) davranışıyla görünmeye devam eder.
 */
export function isJobPublishWindowExpired(job: Job, now: Date = new Date()): boolean {
  const endAt = getJobPublishEndAt(job);
  if (!endAt) return false;
  const nowMs = now.getTime();
  const endMs = new Date(endAt).getTime();
  if (Number.isNaN(nowMs) || Number.isNaN(endMs)) return false;
  return nowMs >= endMs;
}

/**
 * Bir ilanın "Süresi Dolan İlanlar"a taşınıp taşınmayacağının TEK ortak
 * doğruluk kaynağı — hem TARİH (isJobPublishWindowExpired) hem İŞ AKIŞI
 * İSTİSNASINI (job-requests.ts#getSettledOfferForJob, dosyanın başındaki
 * "KRİTİK MİMARİ AYRIM" notuna bakın) birlikte değerlendirir. Bu fonksiyon,
 * offers.ts/job-listing-row.ts/job-requests-panel.tsx/panel-summary.ts/
 * notifications.ts dahil HER yerde "bu ilan aktif mi yoksa süresi dolmuş mu"
 * sorusunun cevaplandığı TEK noktadır — aynı karşılaştırma başka hiçbir
 * dosyada tekrar yazılmaz.
 */
export function isJobListingExpired(job: Job, offers: Offer[], now: Date = new Date()): boolean {
  if (getSettledOfferForJob(job.id, offers) !== null) return false;
  return isJobPublishWindowExpired(job, now);
}

/**
 * `isJobListingExpired`in tersi — "bu ilan şu an gerçekten yayında/teklif
 * alabilir mi" sorusunun kısa yoludur (özellikle offers.ts'teki teklif
 * verilebilirlik kontrollerinde okunabilirlik için). Yeni bir kural İCAT
 * ETMEZ, yalnızca `!isJobListingExpired`in adlandırılmış hâlidir.
 */
export function isJobListingActiveForOffers(job: Job, offers: Offer[], now: Date = new Date()): boolean {
  return !isJobListingExpired(job, offers, now);
}

/**
 * "Süresi Dolan İlanlar" ekranındaki bir kaydın hâlâ AKSİYON BEKLEYEN
 * (Yeniden Yayınla/Kalıcı Olarak Sil gösterilir) mi, yoksa zaten yeniden
 * yayınlanmış SALT GEÇMİŞ kaydı mı olduğunun TEK doğruluk kaynağı. Bir ilan
 * yeniden yayınlandığında (`job.republishedToJobId` dolu) eski kayıt hâlâ
 * `isJobListingExpired` anlamında "süresi dolmuş" kalır (bu bir GERÇEK,
 * değişmez) — ama artık kullanıcıdan yeni bir aksiyon beklenmez, bu yüzden
 * panel kartı sayacı (panel-summary.ts) ve "süresi doldu" bildirimi
 * (notifications.ts) bu İKİNCİ, dar koşulu kullanır; "Süresi Dolan İlanlar"
 * sekmesinin KENDİSİ ise (job-requests-panel.tsx) geçmişin izlenebilir
 * kalması için hâlâ `isJobListingExpired` olan HER kaydı listeler, yalnızca
 * bu fonksiyonla aksiyon butonlarını/bildirimi/sayacı gizler.
 */
export function isExpiredListingAwaitingAction(job: Job, offers: Offer[], now: Date = new Date()): boolean {
  return isJobListingExpired(job, offers, now) && !job.republishedToJobId;
}

/**
 * Yeni bir yayın döneminin (ilk oluşturma YA DA yeniden yayınlama — ikisi de
 * aynı "şu andan itibaren 14 gün" kuralına tabidir) `createdAt`/`publishEndAt`
 * çiftini üretir — `job-store.ts#createJob`/`createJobsForOperation`/
 * `republishJob` DIŞINDA hiçbir çağıran bu ikisini elle inşa ETMEMELİDİR.
 */
export function createPublishWindow(now: Date = new Date()): { createdAt: string; publishEndAt: string } {
  const createdAt = now.toISOString();
  return { createdAt, publishEndAt: computePublishEndAt(createdAt) };
}

/*
 * GELECEĞE HAZIRLIK NOTU: bu dosyadaki her fonksiyon saf (pure) ve `now`
 * parametresi açıkça geçirilebilir olduğu için, gerçek bir veritabanına
 * geçildiğinde bu mantık HİÇBİR DEĞİŞİKLİK gerektirmeden sunucu tarafında
 * (ör. bir API route handler'da) ya da zamanlanmış bir görevde (cron/queue
 * worker) aynen çalıştırılabilir — tarayıcı açıkken çalışan bir zamanlayıcıya
 * hiçbir şekilde bağımlı değildir; her okuma/listeleme/teklif işleminde
 * yeniden değerlendirilir (bkz. çağıranların hiçbiri bir sonucu "kalıcı"
 * olarak önbelleğe almaz).
 */
