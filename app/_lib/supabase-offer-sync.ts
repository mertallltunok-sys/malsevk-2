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
 * KAPSAM (yalnızca görünürlüğü etkileyen VE gelecekteki yeniden-teklif
 * doğruluğunu etkileyen geçişler — tam teklif yaşam döngüsü sunucuya
 * YANSITILMAZ, bkz. proje raporu "teknik borç"): create/accept/reject/
 * withdraw birebir kendi RPC'lerine gider (reject/withdraw senkronu
 * GÖRÜNÜRLÜK için değil, create_offer'ın kendi MLK63 "zaten var" kontrolünün
 * sunucuda YANLIŞLIKLA süresiz "pending" görmesini önlemek için gereklidir —
 * aksi halde bir reddedilmiş/geri çekilmiş teklifin bekleme süresi sonrası
 * meşru yeniden teklifi sunucuda spurious biçimde reddedilirdi). "İşe
 * başlama", "tamamlama talebi", "tamamlama itirazı" YEREL kalır (görünürlük
 * sonucunu değiştirmezler — accepted zaten ENGAGED_OFFER_STATUSES içinde, bu
 * ara geçişlerin hiçbiri onu kümenin dışına çıkarmaz). Anlaşma başarısız
 * olduğunda VE tamamlama itirazı "iptal" ile sonuçlandığında ikisi de AYNI
 * sunucu etkisine ihtiyaç duyar (offer'ı ENGAGED kümesinin dışına çıkarmak)
 * — ikisi için de mevcut `record_agreement_failure` RPC'si yeniden kullanılır
 * (ikinci bir "iptal" RPC'si İCAT EDİLMEDİ); `resolve_completion_dispute`
 * kullanılmadı çünkü o RPC sunucu tarafında `status = 'completion_disputed'`
 * ön koşulu arıyor — ve bu modül ara geçişleri hiç senkronlamadığından
 * sunucudaki teklif her zaman `accepted`te kalır, `record_agreement_failure`
 * in TAM DA beklediği durum.
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

/**
 * `resolveCompletionDispute(cancelled)` içinde, YEREL yazımdan ÖNCE çağrılır
 * — bkz. dosya başlığı, `resolve_completion_dispute` yerine BİLEREK
 * `record_agreement_failure` yeniden kullanılır. Yalnızca resolution
 * "cancelled" iken çağrılır — "completed" çözümü görünürlüğü DEĞİŞTİRMEZ
 * (accepted zaten ENGAGED kümesinde), bu yüzden senkronlanmaz.
 */
export async function recordCompletionDisputeCancelledOnSupabase(supabaseOfferId: string): Promise<OfferSyncVoidResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("record_agreement_failure", {
    p_offer_id: supabaseOfferId,
    p_reason: "diger",
    p_note: "Tamamlama uyuşmazlığı sonucunda iş iptal edildi.",
  });
  if (!error) return { ok: true };

  if (isErrorCode(error, ALREADY_DECIDED_CODE)) {
    const { data: current } = await supabase.from("offers").select("status").eq("id", supabaseOfferId).maybeSingle();
    if (current?.status === "agreement_failed") return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}
