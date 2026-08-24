import {
  COMPLETION_AUTO_APPROVE_DAYS,
  getCompletedOfferForJob,
  getEngagedOfferForJob,
  getOperationStatusBucket,
  getProviderOfferFilter,
  getSettledOfferForJob,
  isJobClosedToNewOffers,
  OFFER_PENDING_BLOCKED_MESSAGE,
  REOFFER_COOLDOWN_DAYS,
  isOfferPendingActionBlocked,
  isReofferCooldownStatus,
} from "./job-requests";
import { containsDirectContactInfo } from "./contact-leak-detection";
import { isJobListingExpired } from "./job-publish-window";
import { isJobManuallyClosed, JOB_ALREADY_CLOSED_MESSAGE, JOB_CLOSURE_BLOCKED_MESSAGE } from "./job-closure";
import { isJobModerationApproved } from "./job-moderation";
import { closeJob as closeJobRecord, deleteJob as deleteJobRecord, type DeleteJobResult } from "./job-store";
import { isProviderAuthorizedToOfferOnJob } from "./job-visibility";
import { findJobByIdWithRemoteFallback } from "./jobs-lookup";
import { isJobOpenForOffers } from "./jobs";
import { STORAGE_WRITE_ERROR_MESSAGE, writeJson } from "./local-storage";
import { isValidCurrency, MAX_OFFER_AMOUNT, hasAtMostTwoDecimals } from "./money";
import { isTransportationCategory } from "./product-catalog";
import { hasReachedActiveJobLimit } from "./provider-capacity";
import { isRecyclingCategory, isRecyclingCommercialDirection } from "./recycling-catalog";
import { closeJobOnSupabase, deleteJobOnSupabase } from "./supabase-job-lifecycle-sync";
import {
  acceptOfferOnSupabase,
  confirmCompletionOnSupabase,
  createOfferOnSupabase,
  disputeCompletionOnSupabase,
  recordAgreementFailureOnSupabase,
  rejectOfferOnSupabase,
  requestCompletionOnSupabase,
  requiresBackendOfferSync,
  resolveCompletionDisputeOnSupabase,
  startWorkOnSupabase,
  withdrawOfferOnSupabase,
} from "./supabase-offer-sync";
import { containsDangerousMarkup, normalizeFreeText } from "./text-sanitization";
import type { Currency, DisagreementReason, Job, JobClosureReason, Offer, OfferStatus, Session } from "./types";

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
    isValidCurrency(offer.currency) &&
    typeof offer.description === "string" &&
    (offer.estimatedDuration === undefined ||
      typeof offer.estimatedDuration === "string" ||
      typeof offer.estimatedDuration === "number") &&
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

/**
 * ÖNCEDEN bu fonksiyon `localStorage.setItem`i hiç try/catch İÇİNDE
 * ÇAĞIRMIYORDU — bir exception (kota dolu, gizli sekme vb.) doğrudan, KONTROLSÜZ
 * biçimde çağıran her teklif fonksiyonundan (createOffer/updateOfferStatus/...)
 * yukarı fırlıyordu. Artık merkezi `writeJson` (bkz. local-storage.ts) hatayı
 * yakalayıp loglar ve `false` döner; burada da (job-store.ts#writeUserCreatedJobs
 * ile AYNI desen) başarısızlıkta önbellek/notify hiç tetiklenmez — her çağıran
 * bu sonucu kendi `{ok,error}` sözleşmesine çevirir (bkz. CLAUDE.md B1 düzeltmesi).
 */
function writeAllOffers(offers: Offer[]): boolean {
  if (!writeJson(OFFERS_STORAGE_KEY, offers)) return false;
  cachedRaw = null;
  hasCached = false;
  notify();
  return true;
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
 * TEKLİF DURUMLARINI SUPABASE İLE UZLAŞTIRMA GÖREVİ — bu fonksiyon eskiden
 * (bkz. `hydrateMissingOffersFromRemote`, önceki adı) yalnızca YEREL depoda
 * hiç karşılığı olmayan teklifleri EKLERDİ; var olan bir yerel kaydın
 * durumunu ASLA güncellemezdi. Kanıtlanmış kök neden ("Canlıya Geçiş Öncesi
 * Son Durum Analizi" raporu, Konu 3/4): `close_job`/`delete_job` RPC'leri
 * (offers.ts#closeJobListing/deleteJobWithOffers) bekleyen kardeş
 * teklifleri Supabase'te ZATEN doğru/atomik şekilde `rejected` yapıyordu, ve
 * `sweep_completion_auto_approvals` (migration 0018, canlı/çalışan bir
 * pg_cron görevi) 7 gün sonra teklifi Supabase'te ZATEN `completed`
 * yapıyordu — ama bu tarayıcı o teklifi ZATEN yerel önbelleğinde
 * biliyorsa (ör. sağlayıcının kendi verdiği teklif), bu "yalnızca-ekle"
 * mantığı sunucudaki bu yeni durumu ASLA yerel depoya taşımıyordu; kullanıcı
 * ekranında süresiz eski durumu (`pending`/`completion_requested`) görmeye
 * devam ediyordu.
 *
 * Artık İKİ İŞ yapar: (1) hâlâ EKLEME (bu tarayıcının hiç bilmediği
 * teklifler) — DEĞİŞMEDİ; (2) UZLAŞTIRMA — zaten yerelde var olan bir
 * teklif için, sunucudaki satırın `updated_at`i bu tarayıcının kendi
 * `updatedAt`inden GERÇEKTEN daha yeniyse, sunucu satırı (durum + tüm
 * durum-bağımlı alanlar) yerel kaydın ÜZERİNE yazılır — yalnızca `id`
 * (yerel PK, `offers.ts#createOffer`'da `supabaseOfferId`den BAĞIMSIZ
 * üretilir, bkz. supabase-offer-reads.ts'in kendi notu) korunur. Eşit veya
 * daha eski bir `updated_at` ASLA uygulanmaz — bu, offers.ts'in HER teklif
 * yaşam döngüsü mutasyonunun (createOffer/updateOfferStatus/
 * requestCompletion/...) zaten Supabase'e BLOKLAYAN ve YEREL yazımdan ÖNCE
 * senkronlandığı gerçeğiyle birlikte, "eski bir sunucu cevabının daha yeni
 * bir yerel işlemi geri çevirmesini" yapısal olarak engeller (görev
 * tanımının §8 gerekliliği) — bu cihazdaki bir mutasyon zaten kendi
 * bloklayan yazımıyla sunucu `updated_at`ini KENDİSİ ilerletmiş olur.
 *
 * Tekliften TÜRETİLEN bildirimler (notifications.ts, "Notifications are
 * derived, not stored") bu fonksiyonun YAZDIĞI `Offer.status`ı doğrudan
 * okuduğu için, hiçbir ek değişiklik olmadan otomatik olarak doğru çalışır
 * (görev tanımının §7 gerekliliği).
 */
export function reconcileOffersFromRemote(remoteOffers: Offer[]): void {
  if (remoteOffers.length === 0) return;
  const local = readAllOffersSnapshot();
  const remoteBySupabaseId = new Map(
    remoteOffers
      .filter((offer): offer is Offer & { supabaseOfferId: string } => Boolean(offer.supabaseOfferId))
      .map((offer) => [offer.supabaseOfferId, offer]),
  );
  const localSupabaseIds = new Set(
    local.map((offer) => offer.supabaseOfferId).filter((id): id is string => Boolean(id)),
  );
  const missing = remoteOffers.filter(
    (offer) => offer.supabaseOfferId && !localSupabaseIds.has(offer.supabaseOfferId),
  );

  let changed = missing.length > 0;
  const reconciled = local.map((offer) => {
    if (!offer.supabaseOfferId) return offer;
    const remote = remoteBySupabaseId.get(offer.supabaseOfferId);
    if (!remote) return offer;
    if (new Date(remote.updatedAt).getTime() <= new Date(offer.updatedAt).getTime()) return offer;
    changed = true;
    return { ...remote, id: offer.id };
  });

  if (!changed) return;
  writeAllOffers([...reconciled, ...missing]);
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

/** "Tamamlanması Taahhüt Edilen Gün" alanının izin verilen aralığı — offer-form.tsx'in açılır listesi ve createOffer'ın doğrulaması AYNI bu iki sabiti kullanır, aralık iki yerde ayrı ayrı hardcode edilmez. */
export const MIN_COMMITTED_DAYS = 1;
export const MAX_COMMITTED_DAYS = 60;

/**
 * `offer.estimatedDuration`in gösterim biçimi — TEK doğruluk kaynağı, üç
 * gösterim yeri de (incoming-offer-card.tsx, offer-panel.tsx, my-offers-panel.tsx)
 * bunu çağırır; her üçü de bunu yalnızca Nakliye kategorisindeki ilanların
 * teklifleri için çağırır (bkz. product-catalog.ts#isTransportationCategory)
 * — bu yüzden `undefined` girdisi pratikte hiç oluşmaz, yine de savunma
 * amaçlı "-" döner (asla çökmez). Sayıysa doğrudan "N gün"; eski (bu
 * özellikten önce serbest metin olarak toplanmış) bir `string` kayıtsa VE
 * güvenle 1-60 aralığında bir tam sayıya çevrilebiliyorsa yine "N gün"
 * gösterilir, ÇEVRİLEMİYORSA (ör. "1 iş günü", "yaklaşık 2 hafta") ham metin
 * OLDUĞU GİBİ gösterilir — eski kayıt asla çökmez/kaybolmaz, yalnızca yeni
 * biçimle gösterilemez.
 */
export function formatCommittedDays(value: string | number | undefined): string {
  if (value === undefined) return "-";
  if (typeof value === "number") return `${value} gün`;
  const trimmed = value.trim();
  const asNumber = Number(trimmed);
  if (
    /^\d+$/.test(trimmed) &&
    Number.isInteger(asNumber) &&
    asNumber >= MIN_COMMITTED_DAYS &&
    asNumber <= MAX_COMMITTED_DAYS
  ) {
    return `${asNumber} gün`;
  }
  return value;
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

/**
 * Bir Hizmet Veren'in şu an bu ilana YENİ bir teklif verip veremeyeceğinin
 * TEK ortak doğruluk kaynağı — offer-panel.tsx (gerçek teklif formunun kapı
 * bekçisi) ve createOffer'ın (aşağıda, veri katmanı yetkilendirmesi) zaten
 * var olan kurallarını YENİDEN İCAT ETMEDEN birebir yansıtır: rol kontrolü,
 * ilanın teklife açık olması (isJobOpenForOffers), aynı (jobId, providerId)
 * için mevcut bir teklif olup olmadığı (getOfferForJob) — varsa yalnızca
 * REOFFER_COOLDOWN_OFFER_STATUSES'tan biri VE bekleme süresi
 * (REOFFER_COOLDOWN_MS) dolmuşsa görmezden gelinir, aksi halde (pending/
 * accepted/in_progress/completion_requested/completion_disputed/completed/
 * cancelled ya da süresi dolmamış withdrawn/rejected/agreement_failed)
 * engelleyicidir — ve son olarak aktif iş kapasitesi (hasReachedActiveJobLimit).
 *
 * `getOperationServiceCardStatus` (aşağıda — operasyon hizmet kartlarının
 * "Teklif Ver" aksiyonunun TEK kaynağı) bu fonksiyonu çağırır ki kartta
 * gösterilen buton her zaman gerçek teklif formuyla (`/ilanlar/[id]`
 * üzerindeki OfferPanel) birebir aynı sonuca varsın — KRİTİK BUTON
 * GÖRÜNÜRLÜĞÜ DÜZELTMESİ: bu fonksiyon eklenmeden önce operasyon kartı,
 * hedef ilanın durumuna/izleyicinin kendi teklifine/kapasitesine hiç
 * bakmadan `!isCurrent` olan HER satırda "Teklif Ver" gösteriyordu (bkz. o
 * dosyanın eski sürümü) — kendi kabul edilmiş/bekleyen/tamamlanmış teklifi
 * olan ya da ilan artık teklife kapalı olan bir kullanıcıya bile.
 *
 * "TEKLİF KABULÜ VE İŞE BAŞLAMA KİLİT KURALI" DÜZELTMESİ:
 * `isJobClosedToNewOffers` (job-requests.ts) çağrısı eklendi — KÖK NEDEN, bu
 * kontrolün önceden HİÇ var olmamasıydı: bir teklif "accepted" olduğunda
 * (doğru — bkz. KRİTİK MİMARİ AYRIM, o durum ilanı kapatmamalı, ön anlaşma/
 * görüşme aşamasıdır) DEĞİL, ama bir teklif fiilen İŞE BAŞLADIĞINDA
 * (in_progress) da BAŞKA hiçbir Hizmet Veren'in yeni teklif verememesi
 * gerekirken, bu fonksiyon (ve createOffer, aşağıda) yalnızca `job.status`a
 * bakıyordu — ki `Job.status` bir teklif geçişinde ASLA değişmez (bkz.
 * types.ts) — bu yüzden iş fiilen başlamış bir ilana bile üçüncü taraflar
 * sınırsızca teklif verebiliyordu.
 *
 * KAPSAM: yalnızca "şu an bir teklif eylemine (form/link) izin var mı"
 * sorusuna cevap verir — form alanı doğrulaması (fiyat/açıklama/süre) ya da
 * cooldown süresinin ekranda nasıl gösterileceği (bkz. offer-panel.tsx'in
 * kendi REOFFER_BLOCKED_MESSAGES/CompletionCountdown dalları) bu
 * fonksiyonun işi değildir.
 */
export function canProviderSubmitNewOffer(
  session: Session | null,
  job: Job,
  offers: Offer[],
): boolean {
  if (!session || session.role !== "hizmet-veren") return false;
  // Nakliye izolasyonu (bkz. job-visibility.ts) — Nakliye'ye kilitlenmiş bir
  // Hizmet Veren, Nakliye dışındaki hiçbir ilana teklif VEREMEZ; bu kontrol
  // yalnızca "Teklif Ver" butonunu gizlemekle kalmaz, veri katmanında da
  // (aşağıdaki createOffer'da tekrar) uygulanır — arayüz atlanabilir bir tek
  // nokta değildir.
  // HİZMET BAZLI PROVIDER YETKİLENDİRMESİ (bkz. job-visibility.ts, migration
  // 0038): bu kontrol artık YALNIZCA Nakliye/Gümrük Müşavirliği için değil,
  // HER hizmet kategorisi için admin-onaylı bir yetkilendirme arar — provider
  // bu ilanın kategorisi için yetkili değilse (hiç seçmemiş, seçmiş ama
  // belgesi onaylanmamış, ya da yetkisi sonradan kaldırılmış) `false` döner.
  // ESKİDEN burada AYRICA `customs-license.ts#canSubmitOffersAsCustomsBroker`
  // (yalnızca Gümrük Müşavirliği'ne özel, SİTE GENELİNDE teklif engelleyen
  // bir kapı) çağrılırdı — 0038 ile RETİRE edildi: aynı kural artık genel
  // hizmet yetkilendirmesinin doğal bir SONUCU (yalnızca yetkisiz olunan
  // hizmetin teklifini engeller, DİĞER yetkili hizmetleri ETKİLEMEZ — "her
  // hizmet bağımsız olmalı" ilkesiyle eski site-geneli davranıştan daha
  // doğru), ayrı/ikinci bir kapı olarak TUTULMASI gerekmiyordu.
  if (!isProviderAuthorizedToOfferOnJob(session, job)) return false;
  // İlan Onayı (bkz. job-moderation.ts) — admin henüz onaylamamış (ya da
  // reddetmiş) bir ilana kimse teklif veremez; job-visibility.ts'in hizmet
  // yetkilendirmesiyle AYNI seviyede, ondan bağımsız ikinci bir kapı.
  if (!isJobModerationApproved(job)) return false;
  if (!isJobOpenForOffers(job.status)) return false;
  if (isJobClosedToNewOffers(job.id, offers)) return false;
  // İlan Kapatma: Hizmet Alan bu ilanı manuel olarak kapattıysa (bkz.
  // job-closure.ts) — `isJobClosedToNewOffers`ten TAMAMEN bağımsız, ayrı bir
  // kapı (o yalnızca teklif ilerlemesine bakar, bu ise Hizmet Alan'ın kendi
  // kararına). Kapatma yalnızca hiçbir teklif işe başlamamışken/tamamlanma
  // sürecine girmemişken mümkündür (bkz. offers.ts#closeJobListing), bu
  // yüzden burada da çakışma riski yoktur.
  if (isJobManuallyClosed(job)) return false;
  // İlan Yayın Süresi Yönetimi: 14 günlük yayın süresi dolmuş bir ilan
  // (bkz. job-publish-window.ts, tek doğruluk kaynağı) yeni teklif alamaz —
  // bu, `isJobClosedToNewOffers`ten TAMAMEN ayrı, bağımsız bir kapı. Zaten
  // meşgul (kabul edilmiş/işe başlanmış/vb.) bir ilan `isJobListingExpired`e
  // göre hiçbir zaman "süresi dolmuş" sayılmaz (bkz. o fonksiyonun kendi
  // istisnası), bu yüzden burada çakışma/çelişki riski yoktur.
  if (isJobListingExpired(job, offers)) return false;

  const currentOffer = getOfferForJob(job.id, session.id);
  if (currentOffer) {
    if (!isReofferCooldownStatus(currentOffer.status)) return false;
    const cooldownEndsAt = new Date(currentOffer.updatedAt).getTime() + REOFFER_COOLDOWN_MS;
    if (Date.now() < cooldownEndsAt) return false;
  }

  return !hasReachedActiveJobLimit(session.id, offers);
}

/** `getOperationServiceCardStatus`'un dönüş tipi — bkz. o fonksiyonun dokümantasyonu. */
export type OperationServiceCardStatus =
  | { kind: "teklif-ver" }
  | { kind: "label"; label: string; tone: "success" | "warning" | "neutral" | "danger" };

/**
 * Bir Offer.status'u operasyon hizmet kartlarının TEK durum alanında
 * gösterilecek etikete çevirir — yeni bir durum sistemi İCAT ETMEZ, yalnızca
 * mevcut `getOfferStatusLabel`/`Tone`i (rejected/withdrawn/agreement_failed
 * için, "Teklifiniz: " öneki OLMADAN) ya da bu bağlamda daha isabetli sabit
 * bir metni (pending/accepted/in_progress/completion_requested/
 * completion_disputed/completed/cancelled için) döndürür.
 * `getOperationServiceCardStatus` bu eşlemeyi hem "bu Hizmet Veren'in kendi
 * teklifi" kolunda hem "ilanın job-geneli meşgul teklifi" kolunda (aşağıda)
 * ORTAK olarak kullanır — ikisi ayrı ayrı bir eşleme yazmaz.
 */
function offerStatusToCardLabel(
  status: OfferStatus,
): { label: string; tone: "success" | "warning" | "neutral" | "danger" } {
  switch (status) {
    case "pending":
      return { label: "Teklif Bekliyor", tone: "warning" };
    case "accepted":
      return { label: "Teklif Kabul Edildi", tone: "success" };
    case "in_progress":
      return { label: "Devam Ediyor", tone: "success" };
    case "completion_requested":
      return { label: "Tamamlama Onayı Bekleniyor", tone: "warning" };
    case "completion_disputed":
      return { label: "İtiraz Sürecinde", tone: "danger" };
    case "completed":
      return { label: "Tamamlandı", tone: "neutral" };
    case "cancelled":
      return { label: "İptal Edildi", tone: "danger" };
    case "rejected":
    case "withdrawn":
    case "agreement_failed":
      return { label: getOfferStatusLabel(status), tone: getOfferStatusTone(status) };
  }
}

/**
 * "Operasyon Durumu" kartının (operation-status-card.tsx — operasyon
 * hizmetlerinin gösterildiği artık TEK yer; eski operation-sibling-jobs-card.tsx/
 * operation-service-offers-card.tsx SİLİNDİ, bkz. o dosyanın doküman
 * yorumu) her satırdaki TEK durum/aksiyon alanı için tek ortak doğruluk
 * kaynağı. ÖNCEDEN (bu üç ayrı kart hâlâ var olduğu dönemde) GLOBAL ana rozeti
 * (`getPublicOperationStatusBucket`/Label/Tone) ve İZLEYENE ÖZEL kişisel notu
 * (eski `getViewerOfferStatusNote`, bu görevle birlikte SİLİNDİ) AYRI AYRI
 * render ediyordu — bu da aynı satırda iki (bazen çelişkili görünen, ör.
 * "Tamamlandı" rozeti + "Teklifiniz: Kabul Edildi" notu) durum göstermesine
 * yol açıyordu. Bu fonksiyon ikisini TEK bir değere birleştirir; yeni bir iş
 * kuralı İCAT ETMEZ, yalnızca mevcut merkezi fonksiyonları
 * (`canProviderSubmitNewOffer`, `getOfferForJob`, `getProviderOfferFilter`,
 * `getEngagedOfferForJob`, `getCompletedOfferForJob`, `getOperationStatusBucket`)
 * ÇAĞIRIR.
 *
 * DÖNÜŞ DEĞERİ iki türden biridir:
 *  - `{ kind: "teklif-ver" }`: bu izleyici (bir Hizmet Veren) şu an bu ilana
 *    gerçekten yeni teklif verebilir (`canProviderSubmitNewOffer` ile
 *    BİREBİR aynı kontrol — offer-panel.tsx'in kullandığı gerçek teklif
 *    formunun kapı bekçisiyle aynı fonksiyon). Çağıran taraf bu durumda
 *    "Teklif Ver" aksiyonunu (buton/link, kartın kendi tasarımına göre)
 *    gösterir.
 *  - `{ kind: "label"; label; tone }`: tek, çelişkisiz bir durum metni —
 *    aşağıdaki sıralamayla türetilir:
 *     1) Bu Hizmet Veren'in KENDİ teklifi varsa (`getOfferForJob`): "pending"
 *        ise ya `getProviderOfferFilter`in "kapanan-teklifler" dediği kardeş-
 *        kapanma durumunda "Başka Hizmet Verenle Anlaşıldı", ya da
 *        `offerStatusToCardLabel("pending")` ("Teklif Bekliyor"); diğer TÜM
 *        durumlarda yine `offerStatusToCardLabel`. Kendi teklifi yoksa ama
 *        ilan GERÇEKTEN (`isJobClosedToNewOffers`) başka biriyle ilerlemişse
 *        yine "Başka Hizmet Verenle Anlaşıldı" — aksi halde (kapasite/
 *        cooldown gibi BAŞKA bir nedenle teklif veremiyor ama ilan hâlâ
 *        açık) aşağıdaki job-geneli kola düşer.
 *     2) job-geneli: tamamlanmış teklif (`getCompletedOfferForJob`) ya da
 *        `job.status === "tamamlandi"` varsa "Tamamlandı"; yoksa meşgul
 *        teklif (`getEngagedOfferForJob` — accepted/in_progress/
 *        completion_requested/completion_disputed) varsa
 *        `offerStatusToCardLabel`; o da yoksa bucket "iptal" ise "İptal
 *        Edildi"; ilan sahibi içinse VE en az bir "pending" teklif varsa
 *        "İşe Başlama Onayı Bekleniyor" (kararın kendisinden beklendiği
 *        anlamına gelir — ayrı bir Kabul Et/Reddet aksiyonu bu kartların
 *        kapsamında YOKTUR, bkz. incoming-offer-card.tsx/"Gelen Teklifler",
 *        bu görevle DEĞİŞTİRİLMEDİ); son çare olarak "Teklife Açık".
 *
 * İZLEYEN İZOLASYONU: `session.id`/`session.role` yalnızca KENDİ teklifini
 * (`getOfferForJob(job.id, session.id)`) ve ilan sahipliğini
 * (`session.id === job.requesterId`) okur — başka bir Hizmet Veren'in
 * teklifi asla bu fonksiyona sızmaz; aynı operasyondaki her `job` kendi
 * `offers` listesiyle bağımsız değerlendirilir (aynı `session` ile art arda
 * çağrılan farklı `job`lar farklı sonuç üretebilir).
 *
 * `allowOfferAction` (varsayılan `true`): çağıran taraf, gösterilen satır şu
 * an görüntülenen ilanın KENDİSİYSE (`isCurrent`) `false` geçer — o ilanın
 * gerçek teklif formu zaten aynı sayfada (OfferPanel) görünür durumdadır, bu
 * yüzden kartta ayrıca bir "Teklif Ver" kısayoluna gerek yoktur; `false`
 * olduğunda bu fonksiyon hiçbir zaman `"teklif-ver"` döndürmez, bunun yerine
 * job-geneli/kendi-teklifi etiketine düşer (pratikte "Teklife Açık").
 */
export function getOperationServiceCardStatus(
  job: Job,
  offers: Offer[],
  session: Session | null,
  options?: { allowOfferAction?: boolean },
): OperationServiceCardStatus {
  const allowOfferAction = options?.allowOfferAction ?? true;

  if (allowOfferAction && canProviderSubmitNewOffer(session, job, offers)) {
    return { kind: "teklif-ver" };
  }

  // İlan Kapatma: kapatılmış bir ilan hiçbir zaman "meşgul" bir teklife
  // (kabul edilmiş/işe başlanmış/tamamlanma sürecinde) sahip olamaz (bkz.
  // offers.ts#closeJobListing'in bunu ön koşul olarak zorunlu kılması), bu
  // yüzden bu kontrol aşağıdaki "kendi teklifi"/"job-geneli" dallarından
  // ÖNCE, erken bir çıkışla yapılır — aksi halde ör. hâlâ "pending" kalıp
  // kapatma nedeniyle "rejected"e çevrilmiş kendi teklifi olan bir Hizmet
  // Veren için "Başka Hizmet Verenle Anlaşıldı" gibi YANLIŞ/alakasız bir
  // etiket üretilirdi.
  if (isJobManuallyClosed(job)) {
    return { kind: "label", label: "İlan Kapatıldı", tone: "neutral" };
  }

  if (session?.role === "hizmet-veren") {
    const ownOffer = getOfferForJob(job.id, session.id);
    if (ownOffer) {
      if (ownOffer.status === "pending" && getProviderOfferFilter(ownOffer, offers, job) === "kapanan-teklifler") {
        return { kind: "label", label: "Başka Hizmet Verenle Anlaşıldı", tone: "neutral" };
      }
      return { kind: "label", ...offerStatusToCardLabel(ownOffer.status) };
    }
    if (isJobClosedToNewOffers(job.id, offers)) {
      return { kind: "label", label: "Başka Hizmet Verenle Anlaşıldı", tone: "neutral" };
    }
    // İlan hâlâ gerçekten teklife açık ama bu Hizmet Veren (kapasite/cooldown
    // gibi kendine özel bir nedenle) teklif veremiyor — aşağıdaki job-geneli
    // kola düşer (pratikte "Teklife Açık").
  }

  const completedOffer = getCompletedOfferForJob(job.id, offers);
  if (completedOffer || job.status === "tamamlandi") {
    return { kind: "label", label: "Tamamlandı", tone: "neutral" };
  }

  const engagedOffer = getEngagedOfferForJob(job.id, offers);
  if (engagedOffer) {
    return { kind: "label", ...offerStatusToCardLabel(engagedOffer.status) };
  }

  if (getOperationStatusBucket(job, offers) === "iptal") {
    return { kind: "label", label: "İptal Edildi", tone: "danger" };
  }

  if (session?.id === job.requesterId) {
    const hasPendingOffer = offers.some((offer) => offer.jobId === job.id && offer.status === "pending");
    if (hasPendingOffer) {
      // İlan Yayın Süresi Yönetimi: bekleyen bir teklif varsa, ilanın yayın
      // süresi dolmuş olsa bile bu satır hâlâ ilan sahibinden bir karar
      // bekler — kabul edilirse iş akışı normal şekilde devam eder (bkz.
      // job-publish-window.ts'in "kabul edilmiş teklif yayın süresi
      // kuralından muaftır" istisnası). Bu yüzden "Süresi Doldu" yerine
      // BİLEREK bu daha spesifik durum gösterilir.
      return { kind: "label", label: "İşe Başlama Onayı Bekleniyor", tone: "warning" };
    }
  }

  // İlan Yayın Süresi Yönetimi: buraya kadar hiçbir dal eşleşmediyse (teklif
  // yok, ya da yalnızca reddedilmiş/geri çekilmiş/anlaşma sağlanamamış
  // teklifler var) ve ilanın 14 günlük yayın süresi dolmuşsa, "Teklife Açık"
  // göstermek YANLIŞ/yanıltıcı olurdu — bu satır artık gerçekten teklif
  // alamaz (bkz. canProviderSubmitNewOffer'daki AYNI kontrol, bu fonksiyonun
  // en başındaki "teklif-ver" dalını zaten engelliyor).
  if (isJobListingExpired(job, offers)) {
    return { kind: "label", label: "Süresi Doldu", tone: "neutral" };
  }

  return { kind: "label", label: "Teklife Açık", tone: "success" };
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
  /**
   * "Tamamlanması Taahhüt Edilen Gün" — yalnızca Nakliye kategorisindeki
   * ilanlar için: 1-60 arası tam sayı, `createOffer` doğrular ve zorunlu
   * kılar. Nakliye DIŞINDAKİ kategorilerde bu alan hiç gönderilmez
   * (undefined) — createOffer bu durumda hiç doğrulamaz, yazılan `Offer`
   * kaydında bu alan hiç olmaz (bkz. types.ts#Offer.estimatedDuration).
   */
  estimatedDuration?: number;
  /** "Teklifin Ticari Yönü" — yalnızca Geri Dönüşüm & Atık Tahliye kategorisi için: `createOffer` doğrular ve zorunlu kılar. Diğer kategorilerde bu alan hiç gönderilmez (undefined) — types.ts#Offer.commercialDirection'ın kendi dokümanı, estimatedDuration İLE AYNI "yalnızca ilgili kategoride toplanır" ilkesi. */
  commercialDirection?: "hizmet-bedeli" | "atik-satin-alma" | "ucretsiz-alim";
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
export async function createOffer(
  session: Session | null,
  input: CreateOfferInput,
): Promise<CreateOfferResult> {
  if (!session) {
    return { ok: false, error: "Teklif vermek için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-veren") {
    return { ok: false, error: "Yalnızca Hizmet Veren kullanıcılar teklif verebilir." };
  }

  // "localStorage Bağımlılığını Kaldır" görevi — bulunan gerçek kök neden:
  // düz `findJobById` yalnızca BU TARAYICININ localStorage'ına bakıyordu.
  // Bir ilan başka bir cihazda oluşturulup admin tarafından onaylandıysa,
  // o ilana hiç değmemiş (temiz oturum/farklı cihaz) bir Hizmet Veren
  // GERÇEK create_offer RPC'sine hiç ULAŞAMADAN "İlan bulunamadı" alıyordu
  // — RPC'nin kendisi teklife izin verecek olsa bile. `findJobByIdWithRemoteFallback`
  // yerel sonucu HER ZAMAN önce dener, yalnızca hiç bulunamazsa
  // (jobs-lookup.ts'in kendi dokümanına bkz.) get_visible_job RPC'siyle
  // sunucudan GERÇEKTEN sorar — localStorage burada asla tek doğruluk
  // kaynağı değildir, yalnızca bir hızlandırma katmanıdır.
  const job = await findJobByIdWithRemoteFallback(input.jobId);
  if (!job) {
    return { ok: false, error: "İlan bulunamadı veya artık yayında değil." };
  }

  // Nakliye izolasyonu (bkz. job-visibility.ts) — Nakliye'ye kilitlenmiş bir
  // Hizmet Veren'in görünürlük dışı bir ilana AYNI ("bulunamadı") mesajla
  // reddedilmesi bilerek gerçek bir "yok" durumundan AYIRT EDİLEMEZ hâle
  // getirilir — ilanın var olduğu ama erişilemediği bilgisi bile sızmaz.
  //
  // "Ortak İlan Görünürlüğü" görevi — bulunan gerçek açık: bu, önceden
  // isJobVisibleToSession'ı (artık İş Makinesi/Operatör GRUBUNU görünür
  // kılan fonksiyon) çağırıyordu; bu TEKLİF kapısı olduğu için grup-farkında
  // OLMAMALI — isProviderAuthorizedToOfferOnJob TAM kategori eşleşmesi arar
  // (bkz. o fonksiyonun kendi dokümanı), SQL'deki değişmeyen
  // provider_can_view_category (create_offer RPC'nin gerçek sınırı) İLE AYNI.
  if (!isProviderAuthorizedToOfferOnJob(session, job)) {
    return { ok: false, error: "İlan bulunamadı veya artık yayında değil." };
  }

  // İlan Onayı (bkz. job-moderation.ts) — arayüzden bağımsız, ASIL
  // yetkilendirme noktası; canProviderSubmitNewOffer'daki görsel engel
  // yalnızca bunun bir YANSIMASIDIR. Admin henüz onaylamamış (ya da
  // reddetmiş) bir ilan, "bulunamadı" ile AYNI mesajla reddedilir —
  // ilanın var olduğu ama henüz yayında olmadığı bilgisi bile sızmaz,
  // isJobVisibleToSession'ın kendi "sızdırmama" ilkesiyle AYNI.
  if (!isJobModerationApproved(job)) {
    return { ok: false, error: "İlan bulunamadı veya artık yayında değil." };
  }

  // NOT: `customs-license.ts#canSubmitOffersAsCustomsBroker`in eski, site-
  // geneli Gümrük Müşavirliği kapısı burada da RETİRE edildi (bkz.
  // canProviderSubmitNewOffer'daki AYNI notun gerekçesi) — yukarıdaki
  // isJobVisibleToSession kontrolü artık Gümrük Müşavirliği dahil HER
  // hizmet için aynı yetkilendirme kuralını uygular.

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

  // Bir ilana kabul edilmiş (ama işe HENÜZ başlanmamış — ön anlaşma/görüşme
  // aşaması) bir teklif olması YENİ teklif vermeyi engellemez (bkz.
  // job-requests.ts#isJobClosedToNewOffers dokümantasyonu, KRİTİK MİMARİ
  // AYRIM) — diğer Hizmet Verenler de bu ilana teklif verebilir; aynı anda
  // yalnızca TEK teklifin anlaşma sürecinin ilerleyebilmesi kuralı ayrıca
  // Kabul Et/Reddet aksiyonu üzerinde uygulanır (bkz.
  // updateOfferStatus#isOfferPendingActionBlocked). AMA iş fiilen
  // BAŞLADIĞINDA (in_progress) ya da ötesine geçtiğinde (tamamlama
  // süreçleri/completed) ilan KESİN olarak kapanır — "TEKLİF KABULÜ VE İŞE
  // BAŞLAMA KİLİT KURALI" düzeltmesi, kök neden: bu kontrol önceden hiç
  // yoktu.
  if (!isJobOpenForOffers(job.status)) {
    return { ok: false, error: "Bu ilan artık teklif almaya açık değil." };
  }
  if (isJobClosedToNewOffers(input.jobId, all)) {
    return { ok: false, error: "Bu ilan için bir hizmet verenle iş başlamış, yeni teklif alınmıyor." };
  }
  // İlan Kapatma: arayüzden bağımsız, ASIL yetkilendirme noktası —
  // offer-panel.tsx'teki görsel engel (canProviderSubmitNewOffer üzerinden)
  // yalnızca bunun bir YANSIMASIDIR (bkz. job-closure.ts, tek doğruluk
  // kaynağı). Hizmet Alan bu ilanı manuel olarak kapattıysa artık hiçbir
  // yeni teklif kabul edilmez.
  if (isJobManuallyClosed(job)) {
    return { ok: false, error: "Bu ilan, ilan sahibi tarafından kapatılmıştır ve artık teklif alamaz." };
  }
  // İlan Yayın Süresi Yönetimi: arayüzden bağımsız, ASIL yetkilendirme
  // noktası — offer-panel.tsx'teki görsel engel yalnızca bunun bir
  // YANSIMASIDIR (bkz. job-publish-window.ts, tek doğruluk kaynağı).
  // Kullanıcı arayüzü atlayıp bu fonksiyonu doğrudan çağırsa (ör. eski bir
  // bağlantı/istemci taraflı manipülasyon) bile süresi dolmuş bir ilana
  // teklif KESİN olarak oluşturulamaz.
  if (isJobListingExpired(job, all)) {
    return { ok: false, error: "Bu ilanın yayın süresi sona ermiştir ve artık teklif verilemez." };
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

  if (!isValidCurrency(input.currency)) {
    return { ok: false, error: "Geçersiz para birimi." };
  }

  // "Teklifin Ticari Yönü" — yalnızca Geri Dönüşüm & Atık Tahliye
  // kategorisinde toplanır/zorunludur (bkz. types.ts#Offer.commercialDirection'ın
  // kendi dokümanı). "Ücretsiz Alım" seçiliyse `amount` her zaman 0'dır —
  // aşağıdaki "sıfırdan büyük olmalı" kontrolü BİLEREK bu tek durumda atlanır.
  const requiresCommercialDirection = isRecyclingCategory(job.category);
  if (requiresCommercialDirection && !isRecyclingCommercialDirection(input.commercialDirection)) {
    return { ok: false, error: "Teklifin ticari yönünü seçiniz." };
  }
  const isFreePickup = requiresCommercialDirection && input.commercialDirection === "ucretsiz-alim";

  if (
    !Number.isFinite(input.amount) ||
    (!isFreePickup && input.amount <= 0) ||
    (isFreePickup && input.amount !== 0) ||
    input.amount > MAX_OFFER_AMOUNT ||
    !hasAtMostTwoDecimals(input.amount)
  ) {
    return { ok: false, error: "Geçerli bir teklif fiyatı giriniz." };
  }

  const description = normalizeFreeText(input.description);
  if (description.length < 20 || description.length > 1000) {
    return { ok: false, error: "Teklif açıklaması geçersiz." };
  }
  if (containsDangerousMarkup(description)) {
    return { ok: false, error: "Açıklama izin verilmeyen içerik barındırıyor." };
  }
  // Genel Güvenlik görevi §8 — arayüzden bağımsız ASIL kontrol noktası
  // (offer-form-validation.ts'in AYNI kontrolü yalnızca bir ön-uyarıdır);
  // supabase/migrations/0073'ün offers.description trigger'ı bu kontrolün
  // RPC'yi bypass eden bir isteğe karşı sunucu tarafı YEDEĞİdir.
  if (containsDirectContactInfo(description)) {
    return {
      ok: false,
      error: "Açıklamaya telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.",
    };
  }

  // "Tamamlanması Taahhüt Edilen Gün" artık yalnızca Nakliye kategorisindeki
  // ilanlar için toplanır/doğrulanır (bkz. types.ts#Offer.estimatedDuration'ın
  // dokümanı) — Nakliye dışı bir ilana verilen teklifte bu alan hiç yazılmaz.
  const requiresEstimatedDuration = isTransportationCategory(job.category);
  if (
    requiresEstimatedDuration &&
    (!Number.isInteger(input.estimatedDuration) ||
      (input.estimatedDuration as number) < MIN_COMMITTED_DAYS ||
      (input.estimatedDuration as number) > MAX_COMMITTED_DAYS)
  ) {
    return { ok: false, error: "Tamamlanması taahhüt edilen gün sayısı 1 ile 60 arasında olmalıdır." };
  }

  // MALSEVK genel ilan gizlilik kuralı — "best-effort" YOK: sunucu senkronu
  // (açıkken) yerel yazımdan ÖNCE, ve BLOKLAYAN olarak denenir. Başarısız
  // olursa yerel teklif hiç yazılmaz, kullanıcıya açık bir hata döner (bkz.
  // supabase-offer-sync.ts'in dosya başlığı) — konum/tesis/iletişim
  // gizliliğinin gerçek kaynağı public.offers olduğu için, sunucuda hiç var
  // olmayan bir teklif "gönderildi" gösterilirse teklif kabul edildiğinde
  // dahi adres asla açılamazdı.
  let supabaseOfferId: string | undefined;
  if (requiresBackendOfferSync()) {
    const syncResult = await createOfferOnSupabase(input.jobId, input);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
    supabaseOfferId = syncResult.supabaseOfferId;
  }

  const now = new Date().toISOString();
  const offer: Offer = {
    id: crypto.randomUUID(),
    jobId: input.jobId,
    providerId: session.id,
    amount: input.amount,
    currency: input.currency,
    description,
    estimatedDuration: requiresEstimatedDuration ? input.estimatedDuration : undefined,
    commercialDirection: requiresCommercialDirection ? input.commercialDirection : undefined,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    supabaseOfferId,
  };

  if (!writeAllOffers([...all, offer])) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
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
 * (bkz. contact-access.ts). İlan zaten diğer Hizmet Verenlere her zaman açık
 * kalır (bkz. job-requests.ts#getJobOfferAvailability), bu geri çekme
 * işlemiyle ayrıca bir ilişkisi yoktur. Ancak "withdrawn" bu Hizmet Veren'e
 * yeniden teklif hakkı VERMEZ: createOffer, (providerId, jobId) çifti için
 * status'tan bağımsız tek kayıt kuralını uygular.
 */
export async function withdrawOffer(session: Session | null, offerId: string): Promise<WithdrawOfferResult> {
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

  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await withdrawOfferOnSupabase(offer.supabaseOfferId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = { ...offer, status: "withdrawn", updatedAt: new Date().toISOString() };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, offer: updated };
}

export type UpdateOfferStatusResult =
  | { ok: true; offer: Offer }
  | { ok: false; error: string };

/**
 * Teklif kabul/ret işlemi de arayüzden bağımsız burada doğrulanır: yalnızca
 * teklifin verildiği ilanın sahibi olan Hizmet Alan işlem yapabilir, yalnızca
 * "pending" durumundaki bir teklif değiştirilebilir.
 *
 * TEK AKTİF KABUL KURALI (Aşama 5.2): bir ilana aynı anda en fazla bir
 * teklifin anlaşma süreci ilerleyebilir — job-requests.ts#
 * isOfferPendingActionBlocked (TEK ortak doğruluk kaynağı,
 * incoming-offer-card.tsx'teki buton görünürlüğüyle AYNI fonksiyon) bunu
 * mevcut Offer durumlarından CANLI türetir; ayrı bir kilit alanı/bayrağı
 * yazılmaz. Bu yüzden kardeş "pending" tekliflere hiç dokunulmaz — yalnızca
 * işlem yapılan TEK teklif güncellenir. Sonuç: "anlaşma sağlanamadı"
 * (agreement_failed) durumunda, diğer bekleyen teklifler hâlbihazırda
 * "pending" kaldıkları için (hiç "rejected" yapılmamışlardı) otomatik ve
 * anında yeniden aksiyon alınabilir hâle gelir — job-requests.ts#
 * getSettledOfferForJob artık onları döndürmediği için. "completed" de
 * settled sayıldığından (bkz. getSettledOfferForJob), iş tamamen bittikten
 * sonra da kardeş teklifler kalıcı olarak askıda kalır.
 */
export async function updateOfferStatus(
  session: Session | null,
  offerId: string,
  nextStatus: "accepted" | "rejected",
): Promise<UpdateOfferStatusResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B adımı) — bulunan gerçek
  // açık: ilan sahibinin (Hizmet Alan) kendi ilanını BAŞKA bir cihazda/temiz
  // oturumda hiç görmemiş olması (ör. ilanı ofis bilgisayarında oluşturdu,
  // teklifi telefonundan yönetiyor) bu sahiplik kontrolünü her zaman
  // "yetkiniz yok" ile reddediyordu — createOffer düzeltmesiyle AYNI
  // fetchJobByIdFromSupabase/get_visible_job yolunu kullanır, ikinci bir
  // yol İCAT EDİLMEDİ.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "pending") {
    return { ok: false, error: "Bu teklif zaten değerlendirilmiş." };
  }

  if (isOfferPendingActionBlocked(offer, all)) {
    return { ok: false, error: OFFER_PENDING_BLOCKED_MESSAGE };
  }

  // Aktif İş Kapasitesi: `createOffer`/`canProviderSubmitNewOffer`'ın teklif
  // OLUŞTURULURKEN uyguladığı aynı kural, KABUL anında da uygulanmalı —
  // aksi halde kapasitesi boşken bağımsız ilanlara verilmiş birden fazla
  // teklif, farklı ilan sahiplerince birbirinden habersiz kabul edildiğinde
  // MAX_ACTIVE_JOBS'ı aşabilir. `all` bu fonksiyonun başında taze okunmuş
  // liste olduğu için "eski/stale" bir duruma güvenilmez; teklifin kendisi
  // hâlâ "pending" olduğundan (henüz `updated` yazılmadı) kendi kendini
  // sayıma dahil etmez.
  if (nextStatus === "accepted" && hasReachedActiveJobLimit(offer.providerId, all)) {
    return {
      ok: false,
      error: "Bu hizmet veren aktif iş kapasitesine ulaştığı için teklif şu anda kabul edilemiyor.",
    };
  }

  // MALSEVK genel ilan gizlilik kuralı — bloklayan sunucu senkronu, yerel
  // yazımdan ÖNCE. Kabul için bu, adres/tesis görünürlüğünü AÇAN gerçek
  // sunucu olayıdır — başarısız olursa iş hiçbir zaman "kabul edilmiş"
  // gösterilmez. Ret için de senkron zorunludur (bkz. supabase-offer-sync.ts
  // dosya başlığı — sunucuda süresiz "pending" kalan bir teklif, bekleme
  // süresi sonrası meşru bir yeniden teklifi MLK63 ile spurious biçimde
  // reddederdi).
  if (requiresBackendOfferSync()) {
    // `offer.supabaseOfferId` eksikse bu teklif sunucuya HİÇ senkronlanmamış
    // (ör. senkron bayrağı teklif oluşturulurken kapalıydı, sonradan
    // açıldı) — sessizce yerelde "kabul edilmiş" göstermek yerine (bu,
    // adres/tesis görünürlüğünün gerçek kaynağı public.offers'ta hiç
    // karşılığı olmayan bir durum yaratırdı) açık bir hata döndürülür.
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult =
      nextStatus === "accepted"
        ? await acceptOfferOnSupabase(offer.supabaseOfferId)
        : await rejectOfferOnSupabase(offer.supabaseOfferId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = { ...offer, status: nextStatus, updatedAt: new Date().toISOString() };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
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
export async function startWorkForOffer(session: Session | null, offerId: string): Promise<StartWorkResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — updateOfferStatus'taki
  // AYNI gerekçe: ilan sahibi bu ilanı BAŞKA bir cihazda oluşturmuş olabilir.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }

  if (offer.status !== "accepted") {
    return { ok: false, error: "Bu işlem yalnızca kabul edilmiş bir teklif için yapılabilir." };
  }

  // "localStorage Bağımlılığını Kaldır" görevi (2B, Aşama 9) — bloklayan
  // sunucu senkronu, yerel yazımdan ÖNCE (bkz. updateOfferStatus'taki AYNI
  // desen). Bu geçiş eskiden BİLEREK senkronlanmıyordu (bkz.
  // supabase-offer-sync.ts dosya başlığı) — gerçek çapraz-cihaz testleri
  // karşı tarafın (Hizmet Veren) BAŞKA bir cihazdaki temiz oturumda bu
  // geçişi hiç göremediğini kanıtladığı için artık senkronlanıyor.
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await startWorkOnSupabase(offer.supabaseOfferId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = { ...offer, status: "in_progress", updatedAt: new Date().toISOString() };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, offer: updated };
}

export type RecordAgreementFailureResult = { ok: true; offer: Offer } | { ok: false; error: string };

/**
 * "Anlaşma Sağlanamadı": kabul edilmiş bir teklifi "agreement_failed"e
 * taşır ve nedeni kaydeder. Job.status'a hiç dokunmaz — ilan zaten hep
 * "yayinda" kalmıştı ve zaten hiç kapanmamıştı (bkz.
 * job-requests.ts#getJobOfferAvailability). Bu geçişin asıl etkisi, bu
 * teklifin artık ENGAGED_OFFER_STATUSES dışında kalması sayesinde
 * getSettledOfferForJob'ın onu bir daha döndürmemesidir — bu da AYNI ilana
 * verilmiş, hâlâ "pending" bekleyen diğer tekliflerin Kabul Et/Reddet
 * aksiyonlarını (bkz. isOfferPendingActionBlocked) otomatik olarak yeniden
 * aktif hale getirir. İlanın başlığı, fotoğrafı, açıklaması vb. hiçbir alanı
 * değişmez — zaten bunlara hiç dokunulmuyor.
 */
export async function recordAgreementFailure(
  session: Session | null,
  offerId: string,
  reason: DisagreementReason,
  note: string | undefined,
): Promise<RecordAgreementFailureResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — updateOfferStatus'taki AYNI gerekçe.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
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

  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await recordAgreementFailureOnSupabase(offer.supabaseOfferId, reason, trimmedNote);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = {
    ...offer,
    status: "agreement_failed",
    disagreementReason: reason,
    disagreementNote: reason === "diger" && trimmedNote ? trimmedNote : undefined,
    updatedAt: new Date().toISOString(),
  };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, offer: updated };
}

/**
 * İlan silme, kullanıcı arayüzünün çağırması gereken asıl (yetkilendirilmiş)
 * giriş noktasıdır — job-store.ts#deleteJob'ı doğrudan çağırmak yerine bunu
 * kullanın. job-store.ts kendi başına teklif deposunu bilmediği için (bkz. o
 * dosyadaki not), "kabul edilmiş/devam eden teklifi var mı" kontrolü burada
 * yapılır — offers.ts zaten jobs-lookup.ts üzerinden job-store.ts'e bağımlı
 * olduğundan (tersi mümkün değil, döngüsel import olurdu), hem ilan hem
 * teklif verisine erişebilen tek nokta burasıdır.
 *
 * OPERASYON HİZMET KALEMİ YAŞAM DÖNGÜSÜ DÜZELTMESİ: bu ilana bağlı hâlâ
 * "pending" olan teklifler artık SİLİNMEZ — `"rejected"`e (mevcut, yeni bir
 * durum İCAT EDİLMEDİ) çevrilir ve KORUNUR. Kök neden: bildirimler ayrı bir
 * tabloda tutulmaz, jobs+offers'tan CANLI türetilir (notifications.ts) — bir
 * Offer kaydı tamamen silinirse ondan artık HİÇBİR bildirim türetilemez, bu
 * yüzden "İlan sahibi ilgili hizmet talebini yayından kaldırdı" bildirimi
 * (bkz. notifications.ts#jobRemovedNotifications) teklif kaydının hayatta
 * kalmasına muhtaçtır. `"rejected"` seçildi çünkü mekanik olarak DOĞRU
 * (artık beklemede değil, aksiyon alınamaz, kapasiteyi serbest bırakır) ve
 * TAMAMEN mevcut bir durumdur; `getOfferStatusLabel`/`getProviderOfferFilter`
 * gibi hiçbir mevcut yardımcı fonksiyon değiştirilmez. Zaten terminal olan
 * teklifler (rejected/withdrawn/agreement_failed/cancelled/completed)
 * dokunulmadan aynen korunur — geçmiş/denetim izi kaybolmaz. Diğer tüm
 * ekranlar (Gelen Teklifler, Verdiğim Teklifler) bu ilanı zaten `jobById`
 * araması `undefined` döndüğü için mevcut "İlan artık mevcut değil"/"İlan
 * bilgisine ulaşılamadı" GÜVENLİ fallback'leriyle (bkz. incoming-offer-card.tsx,
 * my-offers-panel.tsx — hiçbiri değiştirilmedi) sorunsuz gösterir; Gelen
 * Teklifler'de ise bu ilan artık `myJobIds`de olmadığı için teklifleri o
 * ekrandan zaten otomatik düşer (bkz. incoming-offers-panel.tsx).
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

  // "İlan Kapatma ve Silme" görevi — offers.ts'in geri kalanındaki AYNI
  // gerekçe: ilan sahibi bu ilanı BAŞKA bir cihazda oluşturmuş olabilir.
  const job = await findJobByIdWithRemoteFallback(jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  const all = readAllOffersSnapshot();
  // DÜZELTME (K2): önceki hâli `jobHasAcceptedOffer`/ENGAGED_OFFER_STATUSES kullanıyordu,
  // ki bu küme kendi tanımı gereği "completed"i BİLEREK dışarıda bırakır (iş bittiği için
  // artık "meşgul" sayılmaz) — sonuçta tamamlanmış (ve puanlanmış) bir işin ilanı, hata
  // mesajının vaat ettiği korumanın aksine, hiçbir engelle karşılaşmadan silinebiliyordu.
  // `getSettledOfferForJob` (ENGAGED ∪ COMPLETED, "cancelled"/"rejected"/"withdrawn"/
  // "agreement_failed"/"pending" hariç) bu ilanın silinebilirliği için doğru eşiktir.
  if (job.status === "tamamlandi" || getSettledOfferForJob(jobId, all) !== null) {
    return {
      ok: false,
      error: "Bu ilana bağlı aktif veya tamamlanmış bir iş bulunduğu için ilan silinemez.",
    };
  }

  // "İlan Kapatma ve Silme" görevi — bloklayan sunucu senkronu, yerel
  // silmeden ÖNCE (bkz. offers.ts'teki requiresBackendOfferSync() bloklarıyla
  // AYNI ilke). `delete_job` RPC'si (migration 0014) zaten VARDI ama istemci
  // hiç çağırmıyordu — silinen bir ilan yalnızca BU cihazda kayboluyor,
  // başka bir cihaz/hesap onu hâlâ aktif görmeye devam ediyordu.
  if (requiresBackendOfferSync()) {
    const syncResult = await deleteJobOnSupabase(jobId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const jobDeleteResult = await deleteJobRecord(session, job);
  if (!jobDeleteResult.ok) {
    return jobDeleteResult;
  }

  // Ana yazım (ilan kaydının silinmesi) YUKARIDA zaten başarıyla tamamlandı —
  // bu, kullanıcının istediği asıl işlemdir. Bu ikinci yazım yalnızca ikincil
  // bir tutarlılık/bildirim adımıdır (bkz. fonksiyonun üstündeki dokümantasyon);
  // başarısız olursa büyük bir rollback (silinen ilanı geri getirmek) yerine
  // gerçek hata konsola loglanır ve ilan silme sonucu yine de başarı olarak
  // döner — zaten gerçekleşmiş olan silme işlemini burada geri almak, bu
  // görevin kapsamı dışındaki bir transaction sistemi gerektirirdi.
  const now = new Date().toISOString();
  if (
    !writeAllOffers(
      all.map((offer) =>
        offer.jobId === jobId && offer.status === "pending"
          ? { ...offer, status: "rejected" as const, updatedAt: now }
          : offer,
      ),
    )
  ) {
    console.error(
      "deleteJobWithOffers: ilan silindi ancak bekleyen tekliflerin durumu güncellenemedi.",
    );
  }
  return { ok: true };
}

export type CloseJobListingResult = { ok: true } | { ok: false; error: string };

/**
 * İlan kapatma, kullanıcı arayüzünün çağırması gereken asıl (yetkilendirilmiş)
 * giriş noktasıdır — job-store.ts#closeJob'ı doğrudan çağırmak yerine bunu
 * kullanın. `deleteJobWithOffers` ile AYNI bölünme gerekçesi: job-store.ts
 * kendi başına teklif deposunu bilmediği için, "MALSEVK üzerinden işe
 * başlanmış/tamamlanma sürecine girmiş bir teklif var mı" kontrolü (bkz.
 * job-closure.ts#JOB_CLOSURE_BLOCKED_MESSAGE) burada yapılır.
 *
 * Bu kontrol BİLEREK `isJobClosedToNewOffers`i (job-requests.ts, KRİTİK
 * MİMARİ AYRIM) kullanır — YENİ bir eşik İCAT EDİLMEZ: settled teklif hâlâ
 * yalnızca "accepted" (kabul edildi, işe HENÜZ başlanmadı — ön anlaşma/
 * görüşme aşaması) ise kapatmayı ENGELLEMEZ; yalnızca settled teklif
 * "accepted"ın ÖTESİNE geçtiğinde (in_progress/completion_requested/
 * completion_disputed/completed) kapatma reddedilir. Bu, görev
 * gereksiniminin "işe başlanmış VEYA tamamlanma sürecine girmiş" ifadesiyle
 * birebir örtüşür.
 *
 * OPERASYON HİZMET KALEMİ YAŞAM DÖNGÜSÜ İLE AYNI DESEN: bu ilana bağlı hâlâ
 * "pending" olan teklifler `deleteJobWithOffers`teki BİREBİR aynı mekanikle
 * "rejected"e çevrilir (yeni bir Offer.status İCAT EDİLMEZ) — kayıt SİLİNMEZ,
 * yalnızca artık aksiyon alınamaz/kapasiteyi serbest bırakır hale gelir.
 * `job-requests.ts#getProviderOfferFilter`in İlan Kapatma dalı, bu "rejected"i
 * job.closedAt doluluğuna bakarak "kapanan-teklifler"e (ve normal "aktif"
 * teklif listelerinin dışına) taşır; notifications.ts#jobClosedNotifications
 * ise aynı ayrımı kullanarak seçilen nedene uygun bilgilendirme bildirimini
 * üretir. Zaten terminal olan teklifler (rejected/withdrawn/agreement_failed/
 * cancelled/completed) dokunulmadan aynen korunur.
 *
 * Aynı operasyona bağlı KARDEŞ ilanlar (varsa) hiç etkilenmez — bu fonksiyon
 * yalnızca TEK bir `jobId` üzerinde çalışır, `Job.operationId` burada hiç
 * okunmaz/yazılmaz (bkz. CLAUDE.md "sibling jobs are fully independent").
 */
export async function closeJobListing(
  session: Session | null,
  jobId: string,
  reason: JobClosureReason,
): Promise<CloseJobListingResult> {
  if (!session) {
    return { ok: false, error: "İlanı kapatmak için giriş yapmalısınız." };
  }
  if (session.role !== "hizmet-alan") {
    return { ok: false, error: "Yalnızca Hizmet Alan kullanıcılar ilan kapatabilir." };
  }

  // "İlan Kapatma ve Silme" görevi — deleteJobWithOffers'taki AYNI gerekçe.
  const job = await findJobByIdWithRemoteFallback(jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu ilan üzerinde işlem yapma yetkiniz yok." };
  }

  if (isJobManuallyClosed(job)) {
    return { ok: false, error: JOB_ALREADY_CLOSED_MESSAGE };
  }

  const all = readAllOffersSnapshot();
  if (isJobClosedToNewOffers(jobId, all)) {
    return { ok: false, error: JOB_CLOSURE_BLOCKED_MESSAGE };
  }

  // "İlan Kapatma ve Silme" görevi — deleteJobWithOffers'taki AYNI ilke:
  // bloklayan sunucu senkronu, yerel kapatmadan ÖNCE. `close_job` RPC'si
  // (migration 0014) zaten VARDI ama istemci hiç çağırmıyordu — kapatılan
  // bir ilan yalnızca BU cihazda "kapalı" görünüyor, başka bir cihazdaki
  // hizmet veren onu hâlâ aktif ilan listesinde görmeye devam ediyordu.
  if (requiresBackendOfferSync()) {
    const syncResult = await closeJobOnSupabase(jobId, reason);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const closeResult = closeJobRecord(session, job, reason);
  if (!closeResult.ok) {
    return closeResult;
  }

  // Ana yazım (ilanın kapatılması) YUKARIDA zaten başarıyla tamamlandı — bu,
  // kullanıcının istediği asıl işlemdir. Bu ikinci yazım yalnızca ikincil bir
  // tutarlılık/bildirim adımıdır (deleteJobWithOffers'taki AYNI gerekçe);
  // başarısız olursa gerçek hata konsola loglanır ve ilan kapatma sonucu yine
  // de başarı olarak döner.
  const now = new Date().toISOString();
  if (
    !writeAllOffers(
      all.map((offer) =>
        offer.jobId === jobId && offer.status === "pending"
          ? { ...offer, status: "rejected" as const, updatedAt: now }
          : offer,
      ),
    )
  ) {
    console.error("closeJobListing: ilan kapatıldı ancak bekleyen tekliflerin durumu güncellenemedi.");
  }
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
export async function requestCompletion(session: Session | null, offerId: string): Promise<RequestCompletionResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B, Aşama 9) — bkz.
  // startWorkForOffer'daki AYNI gerekçe. Bu fonksiyon iş sahibini
  // (findJobByIdWithRemoteFallback) hiç kontrol etmez (yalnızca teklifin
  // KENDİ providerId'sine bakar), bu yüzden Aşama 9'un ele aldığı "job
  // lookup" boşluğuna hiç maruz kalmaz — ama senkron eksikliği AYRI bir
  // boşluktu, bkz. supabase-offer-sync.ts dosya başlığı.
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await requestCompletionOnSupabase(offer.supabaseOfferId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const now = new Date().toISOString();
  const updated: Offer = {
    ...offer,
    status: "completion_requested",
    completionRequestedByUserId: session.id,
    completionRequestedAt: now,
    updatedAt: now,
  };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
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
export async function confirmCompletion(session: Session | null, offerId: string): Promise<ConfirmCompletionResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — updateOfferStatus'taki AYNI gerekçe.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B, Aşama 9) — bkz.
  // startWorkForOffer'daki AYNI gerekçe.
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await confirmCompletionOnSupabase(offer.supabaseOfferId);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = { ...offer, status: "completed", updatedAt: new Date().toISOString() };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
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
export async function disputeCompletion(
  session: Session | null,
  offerId: string,
  note: string,
): Promise<DisputeCompletionResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — updateOfferStatus'taki AYNI gerekçe.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B, Aşama 9) — bkz.
  // startWorkForOffer'daki AYNI gerekçe.
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await disputeCompletionOnSupabase(offer.supabaseOfferId, trimmedNote);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = {
    ...offer,
    status: "completion_disputed",
    completionDisputeNote: trimmedNote,
    updatedAt: new Date().toISOString(),
  };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
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
export async function resolveCompletionDispute(
  session: Session | null,
  offerId: string,
  resolution: "completed" | "cancelled",
): Promise<ResolveCompletionDisputeResult> {
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

  // "localStorage Bağımlılığını Kaldır" görevi (2B) — updateOfferStatus'taki AYNI gerekçe.
  const job = await findJobByIdWithRemoteFallback(offer.jobId);
  if (!job || job.requesterId !== session.id) {
    return { ok: false, error: "Bu teklif üzerinde işlem yapma yetkiniz yok." };
  }
  if (offer.status !== "completion_disputed") {
    return { ok: false, error: "Bu işlem yalnızca itiraz edilmiş bir iş için yapılabilir." };
  }

  // "localStorage Bağımlılığını Kaldır" görevi (2B, Aşama 9) — artık HER İKİ
  // sonuç da (completed/cancelled) senkronlanır (bkz. supabase-offer-sync.ts
  // dosya başlığı — eskiden yalnızca "cancelled" senkronlanıyordu, gerekçe
  // "completed görünürlüğü değiştirmez"di; bu gerekçe görünürlük açısından
  // hâlâ doğru ama Hizmet Veren'in AYRI bir cihazdaki temiz oturumunun bu işi
  // "tamamlandı" olarak görebilmesi için sunucu durumunun da ilerlemesi
  // gerekiyor).
  if (requiresBackendOfferSync()) {
    if (!offer.supabaseOfferId) {
      return {
        ok: false,
        error: "Bu teklif sunucuya hiç kaydedilmemiş olduğu için işlem güvenli şekilde tamamlanamıyor.",
      };
    }
    const syncResult = await resolveCompletionDisputeOnSupabase(offer.supabaseOfferId, resolution);
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error };
    }
  }

  const updated: Offer = { ...offer, status: resolution, updatedAt: new Date().toISOString() };
  if (!writeAllOffers(all.map((item) => (item.id === offerId ? updated : item)))) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }
  return { ok: true, offer: updated };
}

/**
 * "completion_requested" durumundaki, Hizmet Alan'ın hiç işlem yapmadığı
 * teklifleri COMPLETION_AUTO_APPROVE_DAYS (7 gün) dolunca otomatik
 * "completed" yapar (`autoCompleted: true` işaretiyle — bkz. ratings.ts'teki
 * 30 günlük puanlama penceresi).
 *
 * DÜZELTME ("Canlıya Geçiş Öncesi Son Durum Analizi" raporu, Konu 4): bu
 * yorum eskiden "projede gerçek bir backend/zamanlayıcı yok" diyordu — bu
 * ARTIK DOĞRU DEĞİL. `public.sweep_completion_auto_approvals()` (migration
 * 0018) GERÇEK, çalışan bir `pg_cron` görevidir (saatlik, Development'ta
 * canlı doğrulandı) ve bu fonksiyonun BİREBİR SQL yansımasıdır — sunucu
 * tarafı, kullanıcı hiç geri dönmese BİLE 7 gün sonra teklifi zaten
 * `completed` yapar. Bu YEREL fonksiyon artık BİRİNCİL mekanizma DEĞİL,
 * ikinci/yedek bir yoldur: yalnızca bu tarayıcının kendi (henüz sunucudan
 * hiç çekilmemiş) yerel kopyasını da aynı sonuca getirir — sunucudaki
 * GERÇEK geçiş, bu tarayıcıya `use-offers.ts`nin `reconcileOffersFromRemote`
 * çağrısıyla (offers.ts, TEKLİF DURUMLARINI SUPABASE İLE UZLAŞTIRMA GÖREVİ)
 * ayrıca ve bağımsız olarak da ulaşır — böylece BAŞKA bir cihazdaki taraf da
 * (bu cihaz hiç ziyaret etmese bile) doğru "completed" durumunu görür. Bu
 * fonksiyonun kendisi hâlâ GECİKMELİ (lazy) çalışır: yalnızca bu fonksiyon
 * çağrıldığında (bkz. use-offers.ts) kontrol edilir. Hiç değişiklik yoksa
 * `writeAllOffers`/`notify()` hiç çağrılmaz (gereksiz re-render'dan
 * kaçınmak için).
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
