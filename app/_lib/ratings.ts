import { findJobByIdWithRemoteFallback } from "./jobs-lookup";
import { STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { getAllOffers } from "./offers";
import { submitRatingOnSupabase } from "./supabase-rating-sync";
import { requiresBackendOfferSync } from "./supabase-offer-sync";
import type { Offer, Rating, Session } from "./types";

const RATINGS_STORAGE_KEY = "malsevk.ratings.v1";

/**
 * Otomatik tamamlanan (bkz. Offer.autoCompleted) bir işte Hizmet Alan'ın
 * puan verebileceği azami gün sayısı (bkz. Bölüm 10). Manuel onaylanan
 * işlerde (Hizmet Alan bizzat "Onayla" dediğinde) süre sınırı yoktur.
 */
export const AUTO_COMPLETED_RATING_WINDOW_DAYS = 30;
const AUTO_COMPLETED_RATING_WINDOW_MS = AUTO_COMPLETED_RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedRatings: Rating[] = [];
let hasCached = false;

function isRating(value: unknown): value is Rating {
  if (typeof value !== "object" || value === null) return false;
  const rating = value as Record<string, unknown>;
  return (
    typeof rating.id === "string" &&
    typeof rating.offerId === "string" &&
    typeof rating.jobId === "string" &&
    typeof rating.providerId === "string" &&
    typeof rating.raterId === "string" &&
    typeof rating.stars === "number" &&
    Number.isInteger(rating.stars) &&
    rating.stars >= 1 &&
    rating.stars <= 5 &&
    typeof rating.createdAt === "string"
  );
}

function readAllRatingsSnapshot(): Rating[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(RATINGS_STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (hasCached && raw === cachedRaw) return cachedRatings;

  let parsed: Rating[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter(isRating);
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedRatings = parsed;
  hasCached = true;
  return parsed;
}

const EMPTY_RATINGS: Rating[] = [];

function getServerRatingsSnapshot(): Rating[] {
  return EMPTY_RATINGS;
}

function subscribeToRatings(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * DÜZELTME (K3, veritabanı geçişi öncesi denetim): eskiden `window.localStorage.
 * setItem` doğrudan çağrılıyordu (try/catch yok, `void` dönüyordu) — kod
 * tabanındaki TEK bu şekilde kalan tablo. Kota aşımı/kısıtlı gizlilik modu
 * gibi nedenlerle `setItem` fırlatırsa hata `submitRating`'i çağıran
 * `job-rating-modal.tsx`nin tıklama işleyicisinden yakalanmadan dışarı
 * çıkıyor, `submitting` state hiç `false`'a dönmüyor ve kullanıcı kapatılamayan
 * bir modalda kilitli kalıyordu. Artık diğer TÜM tablolarla (job-store.ts,
 * offers.ts, users.ts, ...) AYNI `local-storage.ts#writeJson` (catch + boolean
 * dönüş) deseni kullanılıyor.
 */
function writeAllRatings(ratings: Rating[]): boolean {
  if (!writeJson(RATINGS_STORAGE_KEY, ratings)) return false;
  cachedRaw = null;
  hasCached = false;
  notify();
  return true;
}

export const ratingsStore = {
  subscribe: subscribeToRatings,
  getSnapshot: readAllRatingsSnapshot,
  getServerSnapshot: getServerRatingsSnapshot,
};

export function getAllRatings(): Rating[] {
  return readAllRatingsSnapshot();
}

export function getRatingForOffer(offerId: string): Rating | null {
  return readAllRatingsSnapshot().find((rating) => rating.offerId === offerId) ?? null;
}

/**
 * "Puanlamanın Sunucuya Kaydı" görevi — `offers.ts#hydrateMissingOffersFromRemote`
 * ile AYNI desen: bu tarayıcının hiç bilmediği (başka bir cihazda/hesapta
 * gönderilmiş) puanları depoya ekler. Eşleştirme `offerId` üzerinden yapılır
 * (bir teklif yalnızca 1 kez puanlanabilir, bkz. submit_rating RPC'sinin
 * kendi MLK74 kontrolü) — yerel `Rating.id` sunucununkiyle hiç eşleşmesi
 * gerekmez (offers.ts#Offer.supabaseOfferId'nin aksine, puanlar için ayrı
 * bir "yerel/uzak kimlik" ayrımı yoktur, kayıt bir kez oluşturulur ve asla
 * güncellenmez).
 */
export function hydrateMissingRatingsFromRemote(remoteRatings: Rating[]): void {
  if (remoteRatings.length === 0) return;
  const local = readAllRatingsSnapshot();
  const localOfferIds = new Set(local.map((rating) => rating.offerId));
  const missing = remoteRatings.filter((rating) => !localOfferIds.has(rating.offerId));
  if (missing.length === 0) return;
  writeAllRatings([...local, ...missing]);
}

/**
 * Verilen id'lere sahip değerlendirme kayıtlarını doğrudan kaldırır — normal
 * kullanıcı akışlarındaki hiçbir yetkilendirme/geçiş kontrolü uygulanmaz.
 * Yalnızca dev-only demo veri sıfırlama aracı (bkz. reset-demo-data.ts,
 * offers.ts#removeOffersByIds ile AYNI desen) için vardır; gerçek kullanıcı
 * akışları hâlâ submitRating gibi yetkilendirilmiş fonksiyonları kullanmalıdır.
 */
export function removeRatingsByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const all = readAllRatingsSnapshot();
  const next = all.filter((rating) => !idSet.has(rating.id));
  if (next.length === all.length) return;
  writeAllRatings(next);
}

export type ProviderRatingSummary = {
  /** null = hiç değerlendirme yok ("Henüz değerlendirme bulunmuyor."). Aritmetik ortalama, 1 ondalık basamağa yuvarlanmış. */
  averageStars: number | null;
  ratingCount: number;
  completedJobCount: number;
};

/**
 * Bir Hizmet Veren'in ortalama puanını hesaplar — her tamamlanan iş = 1 oy,
 * aritmetik ortalama (bkz. Bölüm 9). `offers`/`ratings` çağıran taraftan
 * alınır (saf fonksiyon, kendi okuma fonksiyonlarını tekrar yazmaz).
 */
export function getProviderRatingSummary(
  providerId: string,
  offers: Offer[],
  ratings: Rating[],
): ProviderRatingSummary {
  const providerRatings = ratings.filter((rating) => rating.providerId === providerId);
  const completedJobCount = offers.filter(
    (offer) => offer.providerId === providerId && offer.status === "completed",
  ).length;

  if (providerRatings.length === 0) {
    return { averageStars: null, ratingCount: 0, completedJobCount };
  }

  const sum = providerRatings.reduce((total, rating) => total + rating.stars, 0);
  const averageStars = Math.round((sum / providerRatings.length) * 10) / 10;
  return { averageStars, ratingCount: providerRatings.length, completedJobCount };
}

export type SubmitRatingResult = { ok: true; rating: Rating } | { ok: false; error: string };

/**
 * Hizmet Alan, tamamlanmış bir işi 1-5 yıldızla puanlar. Arayüzden bağımsız
 * kurallar (bkz. Bölüm 7/11):
 *  - Yalnızca Hizmet Alan, yalnızca kendi ilanının sahibi olduğu iş için.
 *  - Teklif kesinlikle "completed" olmalı — completion_disputed/cancelled/
 *    diğer tüm tamamlanmamış durumlar tek bir kontrolle (`status !==
 *    "completed"`) reddedilir.
 *  - Her tamamlanan iş yalnızca 1 kez puanlanabilir (offerId başına tek kayıt).
 *  - Otomatik tamamlanan (`autoCompleted`) işlerde puanlama penceresi
 *    AUTO_COMPLETED_RATING_WINDOW_DAYS (30 gün) ile sınırlıdır; manuel
 *    onaylanan işlerde süre sınırı yoktur. İş bu fonksiyonla asla yeniden
 *    açılmaz — yalnızca bir Rating kaydı oluşturulur, Offer/Job'a dokunulmaz.
 */
export async function submitRating(
  session: Session | null,
  offerId: string,
  stars: number,
): Promise<SubmitRatingResult> {
  if (!session) {
    return { ok: false, error: "Puan vermek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar puan verebilir." };
  }
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { ok: false, error: "Geçerli bir puan seçiniz (1-5 yıldız)." };
  }

  const offer = getAllOffers().find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — offers.ts#updateOfferStatus'taki
  // AYNI gerekçe: ilan sahibi tamamlanan işi BAŞKA bir cihazdan puanlıyor olabilir.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu iş üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "completed") {
    return { ok: false, error: "Yalnızca tamamlanmış işler puanlanabilir." };
  }

  if (getRatingForOffer(offerId)) {
    return { ok: false, error: "Bu iş için zaten bir değerlendirme yaptınız." };
  }

  if (offer.autoCompleted) {
    const windowEndsAt = new Date(offer.updatedAt).getTime() + AUTO_COMPLETED_RATING_WINDOW_MS;
    if (Date.now() > windowEndsAt) {
      return {
        ok: false,
        error: `Bu iş otomatik tamamlandığı için değerlendirme süresi (${AUTO_COMPLETED_RATING_WINDOW_DAYS} gün) dolmuştur.`,
      };
    }
  }

  // "Puanlamanın Sunucuya Kaydı" görevi — offers.ts'teki
  // requiresBackendOfferSync() ile AYNI ilke: bloklayan sunucu senkronu,
  // yerel yazımdan ÖNCE. submit_rating RPC'si kendi yetki/durum/mükerrer
  // kontrollerini KENDİSİ yapar (bkz. supabase-rating-sync.ts) — burada
  // TEKRARLANMAZ, yalnızca sonucu yerel yazımı bloke etmek için kullanılır.
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için puan verilemiyor.",
      };
    }
    const syncResult = await submitRatingOnSupabase(offer.supabaseOfferId, stars);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const all = readAllRatingsSnapshot();
  const rating: Rating = {
    id: crypto.randomUUID(),
    offerId: offer.id,
    jobId: offer.jobId,
    providerId: offer.providerId,
    raterId: session.id,
    stars,
    createdAt: new Date().toISOString(),
  };
  if (!writeAllRatings([...all, rating])) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, rating };
}
