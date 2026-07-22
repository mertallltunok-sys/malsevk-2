import {
  COMPLETION_AUTO_APPROVE_DAYS,
  REOFFER_COOLDOWN_DAYS,
  isReofferCooldownStatus,
  jobHasAcceptedOffer,
} from "./job-requests";
import { deleteJob as deleteJobRecord, type DeleteJobResult } from "./job-store";
import { findJobById } from "./jobs-lookup";
import { isJobOpenForOffers } from "./jobs";
import { MAX_OFFER_AMOUNT, hasAtMostTwoDecimals } from "./money";
import { hasReachedActiveJobLimit } from "./provider-capacity";
import type { Currency, DisagreementReason, Offer, Session } from "./types";

const OFFERS_STORAGE_KEY = "malsevk.offers.v1";
const REOFFER_COOLDOWN_MS = REOFFER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const COMPLETION_AUTO_APPROVE_MS = COMPLETION_AUTO_APPROVE_DAYS * 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedOffers: Offer[] = [];
let hasCached = false;

const DISAGREEMENT_REASON_VALUES: DisagreementReason[] = [
  "telefona_ulasilamadi",
  "epostaya_donus_olmadi",
  "fiyatta_anlasilamadi",
  "tarih_planinda_anlasilamadi",
  "hizmet_veren_yapamayacagini_bildirdi",
  "hizmet_alan_vazgecti",
  "diger",
];

/** `disagreementReason`/`disagreementNote` bu özellikten önce oluşturulmuş kayıtlarda hiç yoktur — ikisi de opsiyonel, eksikse geçerli sayılır. */
function isOffer(value: unknown): value is Offer {
  if (typeof value !== "object" || value === null) return false;
  const offer = value as Record<string, unknown>;
  return (
    typeof offer.id === "string" &&
    typeof offer.jobId === "string" &&
    typeof offer.providerId === "string" &&
    typeof offer.amount === "number" &&
    (offer.currency === "TRY" || offer.currency === "USD") &&
    typeof offer.description === "string" &&
    typeof offer.estimatedDuration === "string" &&
    (offer.status === "pending" ||
      offer.status === "accepted" ||
      offer.status === "rejected" ||
      offer.status === "in_progress" ||
      offer.status === "agreement_failed" ||
      offer.status === "completion_requested" ||
      offer.status === "completion_disputed" ||
      offer.status === "completed" ||
      offer.status === "cancelled" ||
      offer.status === "withdrawn") &&
    typeof offer.createdAt === "string" &&
    typeof offer.updatedAt === "string" &&
    (offer.disagreementReason === undefined ||
      DISAGREEMENT_REASON_VALUES.includes(offer.disagreementReason as DisagreementReason)) &&
    (offer.disagreementNote === undefined || typeof offer.disagreementNote === "string") &&
    (offer.completionDisputeNote === undefined || typeof offer.completionDisputeNote === "string") &&
    (offer.completionRequestedByUserId === undefined ||
      typeof offer.completionRequestedByUserId === "string") &&
    (offer.completionRequestedAt === undefined || typeof offer.completionRequestedAt === "string") &&
    (offer.autoCompleted === undefined || typeof offer.autoCompleted === "boolean")
  );
}

function readAllOffersSnapshot(): Offer[] {
  if (typeof window === "undefined") return [];

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(OFFERS_STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (hasCached && raw === cachedRaw) return cachedOffers;

  let parsed: Offer[] = [];
  if (raw) {
    try {
      const value: unknown = JSON.parse(raw);
      if (Array.isArray(value)) parsed = value.filter(isOffer);
    } catch {
      parsed = [];
    }
  }

  cachedRaw = raw;
  cachedOffers = parsed;
  hasCached = true;
  return parsed;
}

const EMPTY_OFFERS: Offer[] = [];

function getServerOffersSnapshot(): Offer[] {
  return EMPTY_OFFERS;
}

function subscribeToOffers(onStoreChange: () => void): () => void {
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

function writeAllOffers(offers: Offer[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OFFERS_STORAGE_KEY, JSON.stringify(offers));
  cachedRaw = null;
  hasCached = false;
  notify();
}

export const offersStore = {
  subscribe: subscribeToOffers,
  getSnapshot: readAllOffersSnapshot,
  getServerSnapshot: getServerOffersSnapshot,
};

export function getAllOffers(): Offer[] {
  return readAllOffersSnapshot();
}

/**
 * Verilen id'lere sahip teklif kayıtlarını doğrudan kaldırır — normal
 * kullanıcı akışlarındaki hiçbir yetkilendirme/geçiş kontrolü uygulanmaz.
 * Yalnızca dev-only demo veri sıfırlama aracı (bkz. reset-demo-data.ts)
 * için vardır; gerçek kullanıcı akışları hâlâ withdrawOffer/
 * updateOfferStatus/deleteJobWithOffers gibi yetkilendirilmiş
 * fonksiyonları kullanmalıdır.
 */
export function removeOffersByIds(ids: string[]): void {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const all = readAllOffersSnapshot();
  const next = all.filter((offer) => !idSet.has(offer.id));
  if (next.length === all.length) return;
  writeAllOffers(next);
}

export function getOffersByProvider(providerId: string): Offer[] {
  return readAllOffersSnapshot()
    .filter((offer) => offer.providerId === providerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Bir (jobId, providerId) çifti için normalde tek bir Offer kaydı vardır —
 * ama withdrawn/rejected/agreement_failed sonrası REOFFER_COOLDOWN_DAYS
 * dolunca aynı Hizmet Veren yeniden teklif verebildiği için (bkz.
 * createOffer) bu durumda İKİ (eski + yeni) kayıt aynı anda var olabilir.
 * Yeni teklif her zaman dizinin sonuna eklendiği için (writeAllOffers)
 * `findLast` her zaman "şu anki gerçek teklifi" döndürür.
 */
export function getOfferForJob(jobId: string, providerId: string): Offer | null {
  return (
    readAllOffersSnapshot().findLast(
      (offer) => offer.jobId === jobId && offer.providerId === providerId,
    ) ?? null
  );
}

export function getOfferStatusLabel(status: Offer["status"]): string {
  switch (status) {
    case "pending":
      return "Beklemede";
    case "accepted":
      return "Kabul Edildi";
    case "rejected":
      return "Reddedildi";
    case "in_progress":
      return "İşe Başlandı";
    case "agreement_failed":
      return "Anlaşma Sağlanamadı";
    case "completion_requested":
      return "Tamamlandı Onayı Bekleniyor";
    case "completion_disputed":
      return "İtiraz Edildi";
    case "completed":
      return "Tamamlandı";
    case "cancelled":
      return "İptal Edildi";
    case "withdrawn":
      return "Geri Çekildi";
  }
}

export function getOfferStatusTone(
  status: Offer["status"],
): "warning" | "success" | "danger" {
  switch (status) {
    case "pending":
    case "completion_requested":
      return "warning";
    case "accepted":
    case "in_progress":
    case "completed":
      return "success";
    case "rejected":
    case "agreement_failed":
    case "completion_disputed":
    case "cancelled":
    case "withdrawn":
      return "danger";
  }
}

export const DISAGREEMENT_REASON_OPTIONS: { value: DisagreementReason; label: string }[] = [
  { value: "telefona_ulasilamadi", label: "Telefona ulaşamadım" },
  { value: "epostaya_donus_olmadi", label: "E-postaya dönüş olmadı" },
  { value: "fiyatta_anlasilamadi", label: "Fiyatta anlaşamadık" },
  { value: "tarih_planinda_anlasilamadi", label: "Tarih veya çalışma planında anlaşamadık" },
  { value: "hizmet_veren_yapamayacagini_bildirdi", label: "Hizmet Veren işi yapamayacağını bildirdi" },
  { value: "hizmet_alan_vazgecti", label: "Hizmet Alan olarak vazgeçtim" },
  { value: "diger", label: "Diğer" },
];

export type CreateOfferInput = {
  jobId: string;
  amount: number;
  currency: Currency;
  description: string;
  estimatedDuration: string;
};

export type CreateOfferResult =
  | { ok: true; offer: Offer }
  | { ok: false; error: string };

/**
 * Teklif oluşturma iş kurallarının tamamı burada, arayüzden bağımsız
 * olarak uygulanır: rol kontrolü, ilan durumu, para birimi, fiyat ve
 * mükerrer teklif kontrolü. Arayüz yalnızca bu sonucu gösterir; kuralları
 * tekrar yazmaz. `status` alanı bilerek CreateOfferInput'ta yok — teklif
 * durumu her zaman bu fonksiyon tarafından "pending" olarak atanır.
 *
 * KONTROL SIRASI kasıtlıdır: önce "aynı providerId+jobId için daha önce
 * teklif var mı" (status'tan bağımsız — pending/withdrawn/rejected/
 * agreement_failed/accepted/in_progress/completion_requested/
 * completion_disputed/completed/cancelled FARK ETMEZ, tek bir Offer kaydı
 * bile varsa ikinci teklif engellenir), SONRA aktif iş kapasitesi kontrol
 * edilir. Böylece kullanıcı daha önce teklif verdiği bir ilana bakarken
 * aktif kapasitesi de dolu olsa bile doğru (daha spesifik) hata mesajını
 * görür — kapasite mesajı yalnızca gerçekten YENİ bir teklif denemesinde
 * anlamlıdır.
 */
export function createOffer(
  session: Session | null,
  input: CreateOfferInput,
): CreateOfferResult {
  if (!session) {
    return { ok: false, error: "Teklif vermek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar teklif verebilir." };
  }

  const job = findJobById(input.jobId);
  if (!job) {
    return { ok: false, error: "İlan bulunamadı veya artık yayında değil." };
  }

  // Teklif oluşturmanın tek yetkilendirme noktası burasıdır — arayüz bu
  // kontrolü tekrar yazmaz, yalnızca sonucu gösterir (bkz. CLAUDE.md "No
  // real backend"). Bu proje istemci-tarafı çalıştığı için gerçek bir HTTP
  // API'si yok; bu fonksiyon, o katmanın (sunucu tarafı doğrulamanın)
  // eşdeğeridir — arayüzden bağımsız, atlanamaz.
  const all = readAllOffersSnapshot();

  // 1) Aynı ilana daha önce teklif verilmiş mi — EN GÜNCEL kaydına bakılır
  // (bir (providerId, jobId) çifti için birden fazla kayıt olabilir, bkz.
  // getOfferForJob). withdrawn/rejected/agreement_failed sonrası
  // REOFFER_COOLDOWN_DAYS (3 gün) dolana kadar yeniden teklif engellenir;
  // dolduktan sonra tamamen normal şekilde yeni bir teklif oluşturulabilir.
  // accepted/in_progress/completion_requested/completion_disputed/
  // completed/cancelled ise KALICI olarak engeller — bu durumlardan sonra
  // aynı ilana asla yeniden teklif verilemez.
  const latestOwnOffer = all.findLast(
    (offer) => offer.jobId === input.jobId && offer.providerId === session.id,
  );
  if (latestOwnOffer) {
    if (isReofferCooldownStatus(latestOwnOffer.status)) {
      const cooldownEndsAt = new Date(latestOwnOffer.updatedAt).getTime() + REOFFER_COOLDOWN_MS;
      if (Date.now() < cooldownEndsAt) {
        if (latestOwnOffer.status === "agreement_failed") {
          return {
            ok: false,
            error:
              "Bu ilan için daha önce teklifiniz kabul edilmiş ancak anlaşma sağlanamamıştır. Bekleme süresi dolana kadar yeniden teklif veremezsiniz.",
          };
        }
        return {
          ok: false,
          error: `Bu ilana yeniden teklif verebilmek için ${REOFFER_COOLDOWN_DAYS} günlük bekleme süresi devam ediyor.`,
        };
      }
      // Bekleme süresi doldu — normal akışa (kapasite/alan doğrulamaları) devam edilir.
    } else {
      return { ok: false, error: "Bu hizmet talebine daha önce teklif verdiniz." };
    }
  }

  if (jobHasAcceptedOffer(job.id, all)) {
    return { ok: false, error: "Bu ilan için artık teklif kabul edilmemektedir." };
  }
  if (!isJobOpenForOffers(job.status)) {
    return { ok: false, error: "Bu ilan artık teklif almaya açık değil." };
  }

  // 2) Aktif iş kapasitesi kontrolü — yalnızca daha önce teklif verilmemişse
  // anlamlıdır (bkz. yukarıdaki sıralama notu). Arayüzdeki pasif "Teklif
  // Ver" butonunun (offer-panel.tsx) eşdeğeri, arayüzden bağımsız zorunlu
  // kılınan hali — kullanıcı HTML/JS değiştirerek bu kontrolü atlayamaz.
  if (hasReachedActiveJobLimit(session.id, all)) {
    return {
      ok: false,
      error: "Aktif hizmet verme sınırına ulaştınız.",
    };
  }

  if (input.currency !== "TRY" && input.currency !== "USD") {
    return { ok: false, error: "Geçersiz para birimi." };
  }

  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_OFFER_AMOUNT ||
    !hasAtMostTwoDecimals(input.amount)
  ) {
    return { ok: false, error: "Geçerli bir teklif fiyatı giriniz." };
  }

  const description = input.description.trim();
  if (description.length < 20 || description.length > 1000) {
    return { ok: false, error: "Teklif açıklaması geçersiz." };
  }

  const estimatedDuration = input.estimatedDuration.trim();
  if (estimatedDuration.length < 2 || estimatedDuration.length > 100) {
    return { ok: false, error: "Tahmini hizmet süresi geçersiz." };
  }

  const now = new Date().toISOString();
  const offer: Offer = {
    id: crypto.randomUUID(),
    jobId: input.jobId,
    providerId: session.id,
    amount: input.amount,
    currency: input.currency,
    description,
    estimatedDuration,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  writeAllOffers([...all, offer]);
  return { ok: true, offer };
}

export type WithdrawOfferResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * Hizmet Veren, Hizmet Alan henüz karar vermeden (teklif hâlâ "pending"
 * iken) verdiği teklifi geri çeker. Yalnızca teklifin sahibi olan Hizmet
 * Veren çağırabilir, yalnızca "pending" durumundaki bir teklif için — bu
 * son koşul aynı zamanda "teklif başka sekmede zaten kabul/reddedilmiş mi"
 * yarış durumu korumasıdır (bkz. updateOfferStatus'taki aynı desen).
 * Kayıt silinmez, yalnızca status "withdrawn" olur — geçmiş korunur.
 * "withdrawn" ENGAGED_OFFER_STATUSES dışında olduğu için aktif iş
 * kapasitesine hiç girmemiş sayılır, iletişim bilgisi zaten hiç açılmamıştı
 * (bkz. contact-access.ts), ilanı da kilitlemez (bkz. jobHasAcceptedOffer) —
 * ilan diğer Hizmet Verenlere açık kalır. Ancak "withdrawn" bu Hizmet
 * Veren'e yeniden teklif hakkı VERMEZ: createOffer, (providerId, jobId)
 * çifti için status'tan bağımsız tek kayıt kuralını uygular.
 */
export function withdrawOffer(session: Session | null, offerId: string): WithdrawOfferResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar teklifini geri çekebilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }
  if (offer.providerId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "pending") {
    return { ok: false, error: "Bu işlem yalnızca beklemede olan bir teklif için yapılabilir." };
  }

  const updated: Offer = { ...offer, status: "withdrawn", updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type UpdateOfferStatusResult =
  | { ok: true; offer: Offer }
  | { ok: false; error: string };

/**
 * Teklif kabul/ret işlemi de arayüzden bağımsız burada doğrulanır: yalnızca
 * teklifin verildiği ilanın sahibi olan Hizmet Alan işlem yapabilir, yalnızca
 * "pending" durumundaki bir teklif değiştirilebilir.
 */
export function updateOfferStatus(
  session: Session | null,
  offerId: string,
  nextStatus: "accepted" | "rejected",
): UpdateOfferStatusResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar teklif durumunu değiştirebilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "pending") {
    return { ok: false, error: "Bu teklif zaten değerlendirilmiş." };
  }

  const updated: Offer = { ...offer, status: nextStatus, updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type StartWorkResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * "İşe Başlandı": kabul edilmiş bir teklifi "in_progress"a taşır. Yalnızca
 * ilanın sahibi Hizmet Alan, yalnızca hâlâ "accepted" durumundaki bir teklif
 * için çalışır — bu son koşul aynı zamanda çift tıklama/ikinci kez
 * çalıştırma korumasıdır: birinci çağrı durumu değiştirdikten sonra ikinci
 * bir çağrı "accepted" bulamayıp reddedilir.
 */
export function startWorkForOffer(session: Session | null, offerId: string): StartWorkResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "accepted") {
    return { ok: false, error: "Bu işlem yalnızca kabul edilmiş bir teklif için yapılabilir." };
  }

  const updated: Offer = { ...offer, status: "in_progress", updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type RecordAgreementFailureResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * "Anlaşma Sağlanamadı": kabul edilmiş bir teklifi "agreement_failed"e
 * taşır ve nedeni kaydeder. Job.status'a hiç dokunmaz — ilan zaten hep
 * "yayinda" kalmıştı; bu teklif artık "accepted"/"in_progress" olmadığı
 * için `jobHasAcceptedOffer` otomatik olarak false döner ve ilan, mevcut
 * yetkilendirme/etiket fonksiyonları üzerinden kendiliğinden yeniden
 * teklife açık hale gelir (bkz. job-requests.ts). İlanın başlığı, fotoğrafı,
 * açıklaması vb. hiçbir alanı değişmez — zaten bunlara hiç dokunulmuyor.
 */
export function recordAgreementFailure(
  session: Session | null,
  offerId: string,
  reason: DisagreementReason,
  note: string | undefined,
): RecordAgreementFailureResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "accepted") {
    return { ok: false, error: "Bu işlem yalnızca kabul edilmiş bir teklif için yapılabilir." };
  }

  if (!DISAGREEMENT_REASON_VALUES.includes(reason)) {
    return { ok: false, error: "Geçerli bir anlaşmama nedeni seçiniz." };
  }

  const trimmedNote = note?.trim();
  const updated: Offer = {
    ...offer,
    status: "agreement_failed",
    disagreementReason: reason,
    disagreementNote: reason === "diger" && trimmedNote ? trimmedNote : undefined,
    updatedAt: new Date().toISOString(),
  };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

/**
 * İlan silme, kullanıcı arayüzünün çağırması gereken asıl (yetkilendirilmiş)
 * giriş noktasıdır — job-store.ts#deleteJob'ı doğrudan çağırmak yerine bunu
 * kullanın. İlan kaydı ve ona bağlı TÜM teklifler (durumu bekleyen,
 * reddedilen ya da anlaşma sağlanamayan fark etmez) birlikte silinir.
 * job-store.ts kendi başına teklif deposunu bilmediği için (bkz. o
 * dosyadaki not), "kabul edilmiş/devam eden teklifi var mı" kontrolü burada
 * yapılır — offers.ts zaten jobs-lookup.ts üzerinden job-store.ts'e bağımlı
 * olduğundan (tersi mümkün değil, döngüsel import olurdu), hem ilan hem
 * teklif verisine erişebilen tek nokta burasıdır. Bildirimler ayrı bir
 * tabloda tutulmadığı, jobs+offers'tan türetildiği için (notifications.ts)
 * teklifler silinince bu ilana bağlı tüm bildirimler de kendiliğinden
 * ortadan kalkar — ayrı bir "bildirim temizleme" adımına gerek yoktur.
 */
export async function deleteJobWithOffers(
  session: Session | null,
  jobId: string,
): Promise<DeleteJobResult> {
  if (!session) {
    return { ok: false, error: "İlanı silmek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan silebilir." };
  }

  const job = findJobById(jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  const all = readAllOffersSnapshot();
  if (job.status === "tamamlandi" || jobHasAcceptedOffer(jobId, all)) {
    return {
      ok: false,
      error: "Bu ilana bağlı aktif veya tamamlanmış bir iş bulunduğu için ilan silinemez.",
    };
  }

  const jobDeleteResult = await deleteJobRecord(session, jobId);
  if (!jobDeleteResult.ok) {
    return jobDeleteResult;
  }

  writeAllOffers(all.filter((offer) => offer.jobId !== jobId));
  return { ok: true };
}

export type RequestCompletionResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * Hizmet Veren, üzerinde çalıştığı işi tamamladığını bildirir. Yalnızca
 * teklifin sahibi olan Hizmet Veren çağırabilir, yalnızca "in_progress"
 * durumundaki bir teklif için. Bu adım tek başına işi "completed" yapmaz —
 * Hizmet Alan onayına tabidir (bkz. confirmCompletion/disputeCompletion).
 * "completion_requested" durumu aktif iş kapasitesinden düşmez (bkz.
 * job-requests.ts#ENGAGED_OFFER_STATUSES) — onay bekleyen iş hâlâ meşgul
 * sayılır. `completionRequestedByUserId` talebi başlatan kullanıcıyı
 * kaydeder — talep tekrar gönderilemez (bu fonksiyon yalnızca "in_progress"
 * durumundan çalışır, "completion_requested" artık bu koşulu sağlamaz).
 */
export function requestCompletion(session: Session | null, offerId: string): RequestCompletionResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }
  if (offer.providerId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "in_progress") {
    return { ok: false, error: "Bu işlem yalnızca devam eden bir iş için yapılabilir." };
  }

  const now = new Date().toISOString();
  const updated: Offer = {
    ...offer,
    status: "completion_requested",
    completionRequestedByUserId: session.id,
    completionRequestedAt: now,
    updatedAt: now,
  };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type ConfirmCompletionResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * Hizmet Alan, Hizmet Veren'in tamamlandı bildirimini onaylar. Yalnızca
 * ilanın sahibi olan Hizmet Alan çağırabilir, yalnızca "completion_requested"
 * durumundaki bir teklif için. Onaydan sonra iş "completed" olur ve
 * ENGAGED_OFFER_STATUSES dışında kaldığı için Hizmet Veren'in aktif iş
 * kapasitesinden otomatik düşer.
 */
export function confirmCompletion(session: Session | null, offerId: string): ConfirmCompletionResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "completion_requested") {
    return { ok: false, error: "Bu işlem yalnızca onay bekleyen bir iş için yapılabilir." };
  }
  // Savunma amaçlı: talebi başlatan kullanıcı kendi talebini onaylayamaz.
  // Bugünkü tek yönlü akışta (yalnızca Hizmet Veren başlatabilir, yalnızca
  // Hizmet Alan onaylayabilir) rol ayrımı nedeniyle zaten imkânsızdır, ama
  // veri katmanında da açıkça reddedilir.
  if (offer.completionRequestedByUserId === session.id) {
    return { ok: false, error: "Kendi gönderdiğiniz tamamlanma talebini onaylayamazsınız." };
  }

  const updated: Offer = { ...offer, status: "completed", updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type DisputeCompletionResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * Hizmet Alan, Hizmet Veren'in tamamlandı bildirimine itiraz eder — iş
 * aslında bitmediğini düşünüyorsa. Yalnızca ilanın sahibi olan Hizmet Alan
 * çağırabilir, yalnızca "completion_requested" durumundaki bir teklif için.
 * İtiraz sonrası iş "completion_disputed" durumuna geçer; bu durum
 * ENGAGED_OFFER_STATUSES içinde olduğu için aktif iş kapasitesinden
 * DÜŞMEZ (sorun çözülene kadar Hizmet Veren'i meşgul sayar) — çözüm için
 * bkz. resolveCompletionDispute.
 */
export function disputeCompletion(
  session: Session | null,
  offerId: string,
  note: string,
): DisputeCompletionResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "completion_requested") {
    return { ok: false, error: "Bu işlem yalnızca onay bekleyen bir iş için yapılabilir." };
  }
  // Savunma amaçlı: bkz. confirmCompletion'daki aynı kontrol.
  if (offer.completionRequestedByUserId === session.id) {
    return { ok: false, error: "Kendi gönderdiğiniz tamamlanma talebine itiraz edemezsiniz." };
  }

  const trimmedNote = note.trim();
  if (trimmedNote.length < 10 || trimmedNote.length > 1000) {
    return { ok: false, error: "İtiraz açıklaması 10-1000 karakter arasında olmalıdır." };
  }

  const updated: Offer = {
    ...offer,
    status: "completion_disputed",
    completionDisputeNote: trimmedNote,
    updatedAt: new Date().toISOString(),
  };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

export type ResolveCompletionDisputeResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * Hizmet Alan, itiraz edilmiş bir işi sonuçlandırır: ya sonuçta işin
 * tamamlandığını kabul eder ("completed") ya da işi iptal eder
 * ("cancelled"). Yalnızca ilanın sahibi olan Hizmet Alan çağırabilir,
 * yalnızca "completion_disputed" durumundaki bir teklif için. Her iki
 * sonuç da ENGAGED_OFFER_STATUSES dışında kaldığı için Hizmet Veren'in
 * aktif iş kapasitesinden düşer.
 */
export function resolveCompletionDispute(
  session: Session | null,
  offerId: string,
  resolution: "completed" | "cancelled",
): ResolveCompletionDisputeResult {
  if (!session) {
    return { ok: false, error: "Bu işlem için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar bu işlemi yapabilir." };
  }

  const all = readAllOffersSnapshot();
  const offer = all.find((item) => item.id === offerId);
  if (!offer) {
    return { ok: false, error: "Teklif bulunamadı." };
  }

  const job = findJobById(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "completion_disputed") {
    return { ok: false, error: "Bu işlem yalnızca itiraz edilmiş bir iş için yapılabilir." };
  }

  const updated: Offer = { ...offer, status: resolution, updatedAt: new Date().toISOString() };
  writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)));
  return { ok: true, offer: updated };
}

/**
 * "completion_requested" durumundaki, Hizmet Alan'ın hiç işlem yapmadığı
 * teklifleri COMPLETION_AUTO_APPROVE_DAYS (7 gün) dolunca otomatik
 * "completed" yapar (`autoCompleted: true` işaretiyle — bkz. ratings.ts'teki
 * 30 günlük puanlama penceresi). Projede gerçek bir backend/zamanlayıcı
 * olmadığı için (bkz. CLAUDE.md) bu GECİKMELİ (lazy) çalışır: yalnızca bu
 * fonksiyon çağrıldığında (bkz. use-offers.ts) kontrol edilir — "7 gün
 * doldu" anında değil, taraflardan biri sonraki ziyaretinde tetiklenir.
 * Hiç değişiklik yoksa `writeAllOffers`/`notify()` hiç çağrılmaz (gereksiz
 * re-render'dan kaçınmak için).
 */
export function applyExpiredCompletionAutoApprovals(): void {
  const all = readAllOffersSnapshot();
  const now = Date.now();
  let changed = false;

  const next = all.map((offer) => {
    if (offer.status !== "completion_requested" || !offer.completionRequestedAt) return offer;
    const deadline = new Date(offer.completionRequestedAt).getTime() + COMPLETION_AUTO_APPROVE_MS;
    if (now < deadline) return offer;

    changed = true;
    const updated: Offer = {
      ...offer,
      status: "completed",
      autoCompleted: true,
      updatedAt: new Date(now).toISOString(),
    };
    return updated;
  });

  if (changed) {
    writeAllOffers(next);
  }
}
