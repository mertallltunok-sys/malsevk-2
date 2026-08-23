"use client";

import type { CreateOfferInput } from "./offers";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import { isSupabaseJobSyncEnabled } from "./supabase-job-sync";
import type { DisagreementReason } from "./types";

/**
 * MALSEVK genel ilan gizlilik kuralı — kullanıcı talimatı: "Teklif sistemi
 * bütün hizmetlerde backend'e bağlanacak." Nakliye adres/tesis görünürlüğü
 * bir önceki taslakta yalnızca Nakliye'ye özeldi; bu artık HER aktif hizmet
 * kategorisi için geçerli genel bir kural olduğundan, bu modül de artık
 * kategoriden BAĞIMSIZDIR — tek koşul `isSupabaseJobSyncEnabled()` (bkz.
 * requiresBackendOfferSync). Gerçek kaynak `public.offers`tır (bkz.
 * supabase/migrations/0052 — job_route_reveals gibi ikinci bir yetki tablosu
 * İCAT EDİLMEDİ); bu modül, o kaynağı GERÇEKTEN doğru tutmak için gereken RPC
 * çağrılarını sarmalar. `offers.ts`, bu modülün fonksiyonlarını yalnızca
 * `requiresBackendOfferSync()` true iken çağırır ve sonucu (başarı/hata)
 * YEREL yazımın kendisini BLOKE ETMEK için kullanır — hiçbir "best-effort"
 * yol YOKTUR, backend başarısız olursa yerel işlem de başarısız sayılır.
 *
 * KAPSAM — GÜNCELLENDİ ("localStorage Bağımlılığını Kaldır" görevi, Aşama 9,
 * canlıya hazırlık): bu dosya eskiden yalnızca "görünürlüğü etkileyen VE
 * gelecekteki yeniden-teklif doğruluğunu etkileyen geçişler"i senkronluyordu
 * (create/accept/reject/withdraw/anlaşma-sağlanamadı) ve "işe başlama"/
 * "tamamlama talebi"/"tamamlama onayı"/"tamamlama itirazı"nı BİLEREK
 * senkronlamıyordu — gerekçe "bu ara geçişlerin hiçbiri iş görünürlüğünü
 * değiştirmez" idi (accepted zaten ENGAGED_OFFER_STATUSES içinde). Bu
 * gerekçe GÖRÜNÜRLÜK açısından hâlâ doğru, ama Aşama 9'un gerçek çapraz-cihaz
 * testleri (SENARYO 5/6/7) BAŞKA, daha ciddi bir sonucu ortaya çıkardı: bir
 * cihazda "işe başlandı" işaretlenen bir teklif, TAMAMEN AYRI/temiz bir
 * oturumdaki (farklı cihaz/tarayıcı) karşı taraf için hâlâ "accepted"
 * görünüyordu — çünkü o temiz oturum, hydrateMissingOffersFromRemote
 * üzerinden sunucudaki (hiç ilerlememiş) donmuş "accepted" satırını
 * hidratlıyordu. Bu, teklifin durumunu göstermenin ötesinde, karşı tarafın
 * GERÇEK bir sonraki adımı (Tamamlandı Olarak İşaretle/Tamamlandığını Onayla/
 * İtiraz Et) hiç GÖREMEMESİ anlamına geliyordu — yani akışın kendisi farklı
 * cihazda fiilen KIRIKTI, yalnızca "teknik borç" değil. Sunucu tarafında bu
 * beş geçiş için gereken RPC'ler (start_work/request_completion/
 * confirm_completion/dispute_completion/resolve_completion_dispute) migration
 * 0015/0022'den beri zaten VARDI — yalnızca bu istemci modülü hiç
 * çağırmıyordu. Artık HEPSİ çağrılıyor; yeni bir RPC/migration İCAT EDİLMEDİ.
 * create/accept/reject/withdraw/anlaşma-sağlanamadı senkronu değişmedi
 * (reject/withdraw senkronu GÖRÜNÜRLÜK için değil, create_offer'ın kendi
 * MLK63 "zaten var" kontrolünün sunucuda YANLIŞLIKLA süresiz "pending"
 * görmesini önlemek için gereklidir). `resolveCompletionDispute` artık HER
 * İKİ sonuç (completed/cancelled) için de gerçek `resolve_completion_dispute`
 * RPC'sini çağırır — eskiden yalnızca "cancelled" için `record_agreement_failure`
 * RPC'si ödünç alınıyordu (çünkü sunucudaki teklif hiç `completion_disputed`e
 * ulaşamıyordu); artık dispute_completion de senkronlandığı için sunucu
 * durumu gerçekten `completion_disputed`e ulaşıyor ve doğru RPC kullanılabiliyor.
 *
 * İDEMPOTENT/TEKRAR-DENEME GÜVENLİĞİ: her fonksiyon, "istek sunucuda
 * BAŞARILI oldu ama yanıt tarayıcıya hiç ulaşmadı" senaryosunu, RPC'nin
 * kendi "zaten var/zaten karara bağlanmış" hata kodunu (MLK63/MLK68)
 * yakalayıp GERÇEK durumu tekrar okuyarak ayırt eder — bu durumda ikinci bir
 * teklif/aksiyon asla İNŞA EDİLMEZ, yalnızca zaten var olan sonucu doğrular.
 * `supabaseOfferId` eşleşmesi kalıcıdır (types.ts#Offer.supabaseOfferId,
 * yerel offer kaydına bir kez yazılır, asla değişmez) ve kullanıcıya
 * özeldir (RLS `offers_select_parties_or_admin`in `provider_id = auth.uid()`
 * dalı — bu id'yi BAŞKA bir kullanıcının tarayıcısı hiç okuyamaz/kullanamaz,
 * her sorgu kendi oturumunun auth.uid()'ine göre süzülür).
 */

export type OfferSyncResult = { ok: true; supabaseOfferId: string } | { ok: false; error: string };
export type OfferSyncVoidResult = { ok: true } | { ok: false; error: string };

/**
 * Backend'e bağlı (bloklayan) teklif senkronu gerekli mi — artık TEK koşul
 * `isSupabaseJobSyncEnabled()`tir (kategori ayrımı YOK, MALSEVK genel
 * gizlilik kuralı her kategoriye uygulanır). Kapalıyken (varsayılan) bu
 * modülün hiçbir fonksiyonu çağrılmaz, çağıran taraf (offers.ts) mevcut
 * (senkronsuz) yerel akışa devam eder — Faz 2'nin "opt-in, localStorage her
 * koşulda yetkili kalır" ilkesiyle tutarlı.
 */
export function requiresBackendOfferSync(): boolean {
  return isSupabaseJobSyncEnabled();
}

const ALREADY_DECIDED_CODE = "MLK68";
const DUPLICATE_OFFER_CODE = "MLK63";

function isErrorCode(error: { message?: string; code?: string } | null, code: string): boolean {
  if (!error) return false;
  return error.code === code || Boolean(error.message?.includes(code));
}

function friendlyError(error: { message?: string } | null): string {
  const raw = error?.message ?? "";
  if (raw.includes("MLK50")) return "Yalnızca Hizmet Veren hesapları teklif verebilir.";
  if (raw.includes("MLK56")) return "Bu işlem üzerinde yetkiniz yok.";
  if (raw.includes("MLK60")) return "İlan bulunamadı veya artık teklife açık değil.";
  if (raw.includes("MLK61")) return "Gümrük Müşaviri lisans belgeniz henüz onaylanmadı.";
  if (raw.includes("MLK62")) return "Bu ilana yeniden teklif verebilmek için bekleme süresi devam ediyor.";
  if (raw.includes("MLK63")) return "Bu ilana zaten bir teklifiniz var.";
  if (raw.includes("MLK64")) return "Bu ilan artık yeni teklife açık değil.";
  if (raw.includes("MLK65")) return "Aktif iş kapasitenize ulaştınız.";
  if (raw.includes("MLK66")) return "Tamamlanması taahhüt edilen gün 1-60 arasında olmalıdır.";
  if (raw.includes("MLK67")) return "Bu ilan için başka bir teklif zaten anlaşma sürecinde.";
  if (raw.includes("MLK68")) return "Bu teklif zaten karara bağlanmış.";
  if (raw.includes("MLK69")) return "Kendi gönderdiğiniz tamamlanma talebi üzerinde bu işlemi yapamazsınız.";
  if (raw.includes("MLK70")) return "İtiraz açıklaması 10-1000 karakter arasında olmalıdır.";
  if (raw.includes("MLK78")) return "Geçersiz sonuç seçimi.";
  if (raw.includes("MLK87")) return "Bu teklifin hizmet uygunluğu artık geçerli değil.";
  if (raw.includes("ML125") || raw.includes("ML126")) return "Oturumunuz doğrulanamadı, lütfen tekrar giriş yapın.";
  if (raw.includes("ML127")) return "Hesabınız askıya alınmış.";
  if (raw.includes("ML161")) return "Kısa sürede çok fazla teklif işlemi yaptınız. Lütfen biraz bekleyip tekrar deneyin.";
  if (raw.includes("ML163") || raw.includes("ML164"))
    return "Açıklamaya telefon numarası veya e-posta adresi yazmayın — bu bilgiler yalnızca teklif kabul edildikten sonra paylaşılabilir.";
  return "Sunucu ile senkronizasyon başarısız oldu. Lütfen tekrar deneyin.";
}

/**
 * `createOffer` içinde, YEREL yazımdan ÖNCE çağrılır — başarısız dönerse
 * `offers.ts` yerel teklifi hiç yazmaz. Döndürdüğü `supabaseOfferId`,
 * yazılacak yerel `Offer` kaydına işlenir.
 */
export async function createOfferOnSupabase(
  jobId: string,
  input: CreateOfferInput,
): Promise<OfferSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .rpc("create_offer", {
      p_job_id: jobId,
      p_amount: input.amount,
      p_currency: input.currency,
      p_description: input.description,
      p_estimated_duration: input.estimatedDuration ?? null,
      p_commercial_direction: input.commercialDirection ?? null,
    })
    .single();

  if (!error && data) return { ok: true, supabaseOfferId: (data as { id: string }).id };

  if (isErrorCode(error, DUPLICATE_OFFER_CODE)) {
    // RLS (offers_select_parties_or_admin) bu sorguyu zaten çağıranın KENDİ
    // tekliflerine süzer — provider_id'yi burada ayrıca filtrelemeye gerek
    // yok. Yalnızca hâlâ "pending" ise (gerçekten bu çağrının başarılı ilk
    // denemesiyse) idempotent kurtarma yapılır; başka bir sonuçsa (gerçekten
    // farklı bir teklif zaten var) hata olarak bırakılır.
    const { data: existing } = await supabase
      .from("offers")
      .select("id, status, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing && existing.status === "pending") {
      return { ok: true, supabaseOfferId: existing.id };
    }
  }

  return { ok: false, error: friendlyError(error) };
}

/** `updateOfferStatus(accepted)` içinde, YEREL kabulden ÖNCE çağrılır. */
export async function acceptOfferOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("accept_offer", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "accepted") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `updateOfferStatus(rejected)` içinde, YEREL retten ÖNCE çağrılır. */
export async function rejectOfferOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("reject_offer", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "rejected") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `withdrawOffer` içinde, YEREL geri çekmeden ÖNCE çağrılır. */
export async function withdrawOfferOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("withdraw_offer", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "withdrawn") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/**
 * `recordAgreementFailure` içinde, YEREL yazımdan ÖNCE çağrılır — sunucudaki
 * teklifi ENGAGED_OFFER_STATUSES kümesinin dışına çıkarır (accepted ->
 * agreement_failed), bu da get_visible_job(s)'un maskeleme koşulunu bir
 * SONRAKİ okumada otomatik olarak yeniden devreye sokar.
 */
export async function recordAgreementFailureOnSupabase(
  supabaseOfferId: string,
  reason: DisagreementReason,
  note: string | undefined,
): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("record_agreement_failure", {
    p_offer_id: supabaseOfferId,
    p_reason: reason,
    p_note: note ?? null,
  });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "agreement_failed") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `startWorkForOffer` içinde, YEREL yazımdan ÖNCE çağrılır. */
export async function startWorkOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("start_work", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "in_progress") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `requestCompletion` içinde, YEREL yazımdan ÖNCE çağrılır. */
export async function requestCompletionOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("request_completion", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "completion_requested") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `confirmCompletion` içinde, YEREL yazımdan ÖNCE çağrılır. */
export async function confirmCompletionOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("confirm_completion", { p_offer_id: supabaseOfferId });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "completed") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `disputeCompletion` içinde, YEREL yazımdan ÖNCE çağrılır. */
export async function disputeCompletionOnSupabase(supabaseOfferId: string, note: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("dispute_completion", { p_offer_id: supabaseOfferId, p_note: note });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "completion_disputed") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/**
 * `resolveCompletionDispute` içinde, YEREL yazımdan ÖNCE çağrılır — artık HER
 * İKİ sonuç (completed/cancelled) için de gerçek `resolve_completion_dispute`
 * RPC'sini kullanır (bkz. dosya başlığı — eskiden yalnızca "cancelled" için
 * `record_agreement_failure` ödünç alınıyordu).
 */
export async function resolveCompletionDisputeOnSupabase(
  supabaseOfferId: string,
  resolution: "completed" | "cancelled",
): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("resolve_completion_dispute", {
    p_offer_id: supabaseOfferId,
    p_resolution: resolution,
  });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === resolution) return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}
