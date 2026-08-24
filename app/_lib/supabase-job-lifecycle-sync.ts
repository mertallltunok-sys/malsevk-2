"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { JobClosureReason } from "./types";

/**
 * "İlan Kapatma ve Silme" görevi — `offers.ts#closeJobListing`/
 * `deleteJobWithOffers`in kendi `close_job(p_job_id, p_reason)`/
 * `delete_job(p_job_id)` RPC'lerini (migration 0014, requester-facing —
 * `close_job_as_admin`/`delete_job_as_admin`in (0016) ADMIN OLMAYAN
 * karşılığı) sarmalar. Bu iki RPC zaten VARDI ama istemciden hiç
 * çağrılmıyordu — offers.ts kadar Job.id ile Job'un Supabase satırının
 * birincil anahtarı aynı olduğundan (bkz. supabase-job-sync.ts dosya
 * başlığı — `p_client_id` deseni), offer senkronundan FARKLI OLARAK ayrı
 * bir `supabaseJobId` alanına ihtiyaç YOKTUR; `jobId` doğrudan kullanılır.
 *
 * `supabase-offer-sync.ts` ile AYNI ilke: çağıran (offers.ts), YEREL
 * yazımdan ÖNCE bunu çağırır ve sonucu yerel yazımı BLOKE ETMEK için
 * kullanır — best-effort/sessiz bir yol YOKTUR. Her iki RPC de kendi
 * yetki (`requester_id = auth.uid()`) ve iş-kuralı (aktif/tamamlanmış
 * teklif var mı) kontrollerini KENDİSİ yapar; bu modül onları TEKRARLAMAZ.
 */

export type JobLifecycleSyncResult = { ok: true } | { ok: false; error: string };

function friendlyError(error: { message?: string; code?: string } | null): string {
  const raw = error?.message ?? "";
  if (raw.includes("MLK55"))
    return "Bu ilan zaten kapalı ya da işe başlanmış/tamamlanma sürecine girmiş bir teklifi olduğu için kapatılamıyor.";
  if (raw.includes("MLK56")) return "Bu ilan üzerinde işlem yapma yetkiniz yok ya da ilan sunucuda bulunamadı.";
  if (raw.includes("MLK92"))
    return "Bu ilana bağlı aktif veya tamamlanmış bir iş bulunduğu için ilan silinemez.";
  if (raw.includes("ML125") || raw.includes("ML126")) return "Oturumunuz doğrulanamadı, lütfen tekrar giriş yapın.";
  if (raw.includes("ML127")) return "Hesabınız askıya alınmış.";
  return "Sunucu ile senkronizasyon başarısız oldu. Lütfen tekrar deneyin.";
}

/** `closeJobListing` içinde, YEREL kapatmadan ÖNCE çağrılır. */
export async function closeJobOnSupabase(jobId: string, reason: JobClosureReason): Promise<JobLifecycleSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("close_job", { p_job_id: jobId, p_reason: reason });
  if (!error) return { ok: true };

  // Zaten kapalıysa (MLK55, `closed_at is not null` dalı) — bu, "istek
  // sunucuda BAŞARILI oldu ama yanıt tarayıcıya hiç ulaşmadı" senaryosunun
  // gerçek karşılığıdır; sunucudaki mevcut kapatma nedenini okuyup çağıranın
  // istediğiyle eşleşiyorsa idempotent olarak başarı say.
  if (error.code === "MLK55" || error.message?.includes("MLK55")) {
    const { data: current } = await supabase
      .from("jobs")
      .select("closed_at, closure_reason")
      .eq("id", jobId)
      .maybeSingle();
    if (current?.closed_at && current.closure_reason === reason) return { ok: true };
  }
  return { ok: false, error: friendlyError(error) };
}

/** `deleteJobWithOffers` içinde, YEREL silmeden ÖNCE çağrılır. */
export async function deleteJobOnSupabase(jobId: string): Promise<JobLifecycleSyncResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("delete_job", { p_job_id: jobId });
  if (!error) return { ok: true };

  const { data: current } = await supabase.from("jobs").select("deleted_at").eq("id", jobId).maybeSingle();
  if (current?.deleted_at) return { ok: true };
  return { ok: false, error: friendlyError(error) };
}
