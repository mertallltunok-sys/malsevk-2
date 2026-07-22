/**
 * Yalnızca demo/seed hesaplara (bkz. users.ts#DEV_ACCOUNT_EMAILS) ait
 * işlem verilerini (ilan, teklif, bildirim okunma durumu, ilan
 * fotoğrafları) temizleyen, dev-only bir yardımcı modül. Demo hesap
 * kayıtlarının kendisine (kullanıcı/giriş bilgileri) HİÇ dokunmaz.
 *
 * İki kullanım şekli vardır:
 *  1. Manuel, tekrar tekrar çalıştırılabilir: `planDemoDataReset()` +
 *     `executeDemoDataReset()` — `app/gelistirme/demo-veri-sifirla` sayfası
 *     bunu kullanır (dry-run raporu + "Uygula" butonu).
 *  2. Otomatik ama TEK SEFERLİK: `runDemoDataResetMigrationIfNeeded()` —
 *     bir localStorage versiyon bayrağıyla korunur, aynı tarayıcıda ikinci
 *     kez hiçbir şey yapmaz. "Uygulama her açıldığında otomatik temizleme"
 *     DEĞİLDİR — yalnızca bu bir kerelik geçiş için vardır (bkz. aşağıda).
 *
 * Kullanıcı tespiti isim üzerinden DEĞİL, DEV_ACCOUNT_EMAILS üzerinden
 * (yani gerçek seed kaynağı users.ts'ten) yapılır.
 */
import { getAllUserCreatedJobs, removeUserCreatedJobsByIds } from "./job-store";
import { getAllOffers, removeOffersByIds } from "./offers";
import { clearDismissedNotifications } from "./notification-dismissals";
import { clearReadNotifications } from "./notification-reads";
import { DEV_ACCOUNT_EMAILS, findUserByEmail, getAllUsers } from "./users";
import type { Offer } from "./types";

export type DemoDataCounts = {
  totalUsers: number;
  demoUsers: number;
  totalJobs: number;
  demoJobs: number;
  totalOffers: number;
  demoOffers: number;
  demoPhotoCount: number;
};

export type DuplicateOfferPair = {
  providerId: string;
  jobId: string;
  count: number;
  /** true ise demo bir Hizmet Veren'e ait — normal temizlikle zaten kalkar. */
  isDemo: boolean;
};

export type DemoDataPlan = {
  demoUserIds: string[];
  demoUserEmails: string[];
  jobIdsToRemove: string[];
  offerIdsToRemove: string[];
  photoStorageKeysToRemove: string[];
  before: DemoDataCounts;
  duplicateOfferPairs: DuplicateOfferPair[];
};

function resolveDemoAccounts(): { id: string; email: string }[] {
  return DEV_ACCOUNT_EMAILS.map((email) => {
    const user = findUserByEmail(email);
    return user ? { id: user.id, email } : null;
  }).filter((value): value is { id: string; email: string } => value !== null);
}

function computeCounts(demoUserIdSet: Set<string>): DemoDataCounts {
  const users = getAllUsers();
  const jobs = getAllUserCreatedJobs();
  const offers = getAllOffers();

  const demoJobIdSet = new Set(
    jobs.filter((job) => job.requesterId !== null && demoUserIdSet.has(job.requesterId)).map((job) => job.id),
  );
  const demoOffers = offers.filter(
    (offer) => demoUserIdSet.has(offer.providerId) || demoJobIdSet.has(offer.jobId),
  ).length;
  const demoPhotoCount = jobs
    .filter((job) => demoJobIdSet.has(job.id))
    .reduce((sum, job) => sum + job.photos.length, 0);

  return {
    totalUsers: users.length,
    demoUsers: users.filter((user) => demoUserIdSet.has(user.id)).length,
    totalJobs: jobs.length,
    demoJobs: demoJobIdSet.size,
    totalOffers: offers.length,
    demoOffers,
    demoPhotoCount,
  };
}

/**
 * Aynı (providerId, jobId) çifti için birden fazla Offer kaydı olan
 * durumları tespit eder — normalde createOffer bunu engeller (bkz. orada),
 * ama önceki geliştirme sürümlerinde oluşmuş olabilecek eski demo
 * kayıtlarını (ya da gerçek kullanıcıda varsa, DOKUNMADAN yalnızca
 * raporlamak için) bulmak amacıyla vardır.
 */
function findDuplicateOfferPairs(offers: Offer[], demoUserIdSet: Set<string>): DuplicateOfferPair[] {
  const groups = new Map<string, Offer[]>();
  for (const offer of offers) {
    const key = `${offer.providerId}::${offer.jobId}`;
    const list = groups.get(key);
    if (list) list.push(offer);
    else groups.set(key, [offer]);
  }
  const duplicates: DuplicateOfferPair[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const [providerId, jobId] = key.split("::");
    duplicates.push({ providerId, jobId, count: group.length, isDemo: demoUserIdSet.has(providerId) });
  }
  return duplicates;
}

/** Şu anki kayıt sayılarını döndürür (öncesi/sonrası raporu için, işlem yapmaz). */
export function getDemoDataCounts(): DemoDataCounts {
  const demoUserIdSet = new Set(resolveDemoAccounts().map((account) => account.id));
  return computeCounts(demoUserIdSet);
}

/**
 * Neyin silineceğini hesaplar — HİÇBİR VERİYİ DEĞİŞTİRMEZ (dry-run).
 * Silinecek teklifler iki kaynaktan birleştirilir: demo bir Hizmet
 * Alan'ın ilanına bağlı TÜM teklifler (sahibi kim olursa olsun — ilan
 * silinince orphan kalmasınlar diye) VE demo bir Hizmet Veren'in verdiği
 * TÜM teklifler (ilan gerçek bir kullanıcıya ait olsa bile — ilan ve
 * ilanın diğer teklifleri KORUNUR, yalnızca bu tek teklif kaydı silinir).
 */
export function planDemoDataReset(): DemoDataPlan {
  const demoAccounts = resolveDemoAccounts();
  const demoUserIds = demoAccounts.map((account) => account.id);
  const demoUserIdSet = new Set(demoUserIds);

  const jobs = getAllUserCreatedJobs();
  const offers = getAllOffers();

  const demoJobs = jobs.filter((job) => job.requesterId !== null && demoUserIdSet.has(job.requesterId));
  const demoJobIdSet = new Set(demoJobs.map((job) => job.id));

  const offersToRemove = offers.filter(
    (offer) => demoJobIdSet.has(offer.jobId) || demoUserIdSet.has(offer.providerId),
  );

  const photoStorageKeysToRemove = demoJobs.flatMap((job) => job.photos.map((photo) => photo.storageKey));

  return {
    demoUserIds,
    demoUserEmails: demoAccounts.map((account) => account.email),
    jobIdsToRemove: demoJobs.map((job) => job.id),
    offerIdsToRemove: offersToRemove.map((offer) => offer.id),
    photoStorageKeysToRemove,
    before: computeCounts(demoUserIdSet),
    duplicateOfferPairs: findDuplicateOfferPairs(offers, demoUserIdSet),
  };
}

/**
 * `planDemoDataReset()`'in ürettiği planı UYGULAR. Gerçek kullanıcı
 * verilerine hiçbir şekilde dokunmaz: yalnızca `plan` içindeki id'ler
 * silinir (bunlar zaten yalnızca demo hesaplarla ilişkili kayıtlardır).
 * Demo hesapların kendisi (users.ts kaydı, giriş bilgileri) hiç
 * değiştirilmez. Uygulama sonrası güncel sayıları döndürür.
 */
export async function executeDemoDataReset(plan: DemoDataPlan): Promise<DemoDataCounts> {
  await removeUserCreatedJobsByIds(plan.jobIdsToRemove);
  removeOffersByIds(plan.offerIdsToRemove);
  for (const userId of plan.demoUserIds) {
    clearReadNotifications(userId);
    clearDismissedNotifications(userId);
  }

  const demoUserIdSet = new Set(plan.demoUserIds);
  return computeCounts(demoUserIdSet);
}

const DEMO_DATA_RESET_MIGRATION_KEY = "malsevk.demo_data_reset_version";
/**
 * Bu değeri değiştirmek (ör. "demo-data-reset-v3"), önceki sürümde bu
 * migration'ı zaten çalıştırmış tarayıcılarda da yeniden bir kez daha
 * çalıştırır — eski bir anahtar/versiyon varsa tarayıcı "zaten çalıştı"
 * sanıp temizliği atlamasın diye.
 */
const DEMO_DATA_RESET_VERSION = "demo-data-reset-v2";

/**
 * Demo hesaplara ait eski ilan/teklif/bildirim-okunma/fotoğraf verilerini
 * OTOMATİK ama yalnızca BİR KEZ (bu tarayıcıda, bu versiyon için) temizler.
 * `DEMO_DATA_RESET_MIGRATION_KEY` altında saklanan bayrak
 * `DEMO_DATA_RESET_VERSION`'a eşitse hiçbir şey yapmadan hemen döner —
 * "uygulama her açıldığında temizlenir" DEĞİLDİR, tek seferlik bir geçiştir.
 * Yalnızca `NODE_ENV==="development"` iken çalışır — `seedDevAccountsIfNeeded`
 * ile aynı kesin kapı; demo hesaplar zaten yalnızca o ortamda var olabilir.
 * `writeUserCreatedJobs`/`writeAllOffers`/`clearReadNotifications`'ın
 * kendi `notify()` çağrıları sayesinde açık sekmelerdeki
 * `useSyncExternalStore` tabanlı hook'lar (useAllJobs/useAllOffers/
 * useReadNotificationIds) otomatik olarak güncel veriyle yeniden render
 * olur — ayrı bir event/refresh mekanizması gerekmez.
 */
export async function runDemoDataResetMigrationIfNeeded(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;
  if (typeof window === "undefined") return;

  let completedVersion: string | null;
  try {
    completedVersion = window.localStorage.getItem(DEMO_DATA_RESET_MIGRATION_KEY);
  } catch {
    return;
  }
  if (completedVersion === DEMO_DATA_RESET_VERSION) return;

  const plan = planDemoDataReset();
  if (plan.demoUserIds.length > 0) {
    await executeDemoDataReset(plan);
  }

  try {
    window.localStorage.setItem(DEMO_DATA_RESET_MIGRATION_KEY, DEMO_DATA_RESET_VERSION);
  } catch {
    // localStorage kullanılamıyorsa migration bayrağı kaydedilemez; bir
    // sonraki yüklemede tekrar denenir — zararsız (idempotent).
  }
}
