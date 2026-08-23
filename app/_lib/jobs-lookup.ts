import { findUserCreatedJobById } from "./job-store";
import { getJobById as getSeedJobById } from "./jobs";
import { isSupabaseJobSyncEnabled } from "./supabase-job-sync";
import { fetchJobByIdFromSupabase } from "./supabase-job-reads";
import type { Job } from "./types";

/**
 * İlanlar iki kaynaktan gelir (sabit örnek ilanlar + kullanıcı tarafından
 * oluşturulanlar). Tek, paylaşılan arama noktası — offers.ts ve
 * contact-access.ts gibi birden fazla modül aynı mantığı tekrarlamaz.
 */
export function findJobById(id: string): Job | null {
  return findUserCreatedJobById(id) ?? getSeedJobById(id);
}

/**
 * "localStorage Bağımlılığını Kaldır" görevi — bulunan gerçek kök neden:
 * `findJobById` yalnızca BU TARAYICININ localStorage'ına bakar; bir ilan
 * BAŞKA bir cihazda oluşturulup admin tarafından onaylandıysa, o ilana hiç
 * "değmemiş" bir tarayıcıda (temiz oturum, farklı cihaz) `findJobById` her
 * zaman `null` döner — `offers.ts#createOffer` bu `null`ı "ilan yok" sayıp
 * GERÇEK `create_offer` RPC'sini hiç ÇAĞIRMADAN en baştan reddediyordu,
 * RPC'nin kendisi ilana erişime izin verecek olsa bile.
 *
 * Bu fonksiyon YEREL sonucu HER ZAMAN önce dener (mevcut "yerel varsa yerel
 * kazanır" ilkesi, bkz. supabase-job-reads.ts'in kendi dokümanı/
 * use-jobs.ts#remoteWinsOverLocal) — yalnızca yerelde HİÇ bulunamazsa
 * `fetchJobByIdFromSupabase` (get_visible_job RPC, zaten var olan/RLS'e
 * tabi/moderasyon+kategori-yetkisi kontrollü tek-ilan okuma yolu) ile
 * SUNUCUDAN GERÇEKTEN sorar. İkinci bir ilan sistemi/RPC İCAT EDİLMEDİ —
 * yalnızca zaten var olan iki okuma yolu (yerel + supabase-job-reads.ts)
 * burada birleştirildi. Sonuç localStorage'a YAZILMAZ (yalnızca bu çağrının
 * anlık kullanımı içindir) — localStorage bu akışta asla "tek doğruluk
 * kaynağı" hâline gelmez, yalnızca bir hızlandırma katmanı olarak kalır.
 *
 * `isSupabaseJobSyncEnabled()` (aynı `NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC`
 * bayrağı — `offers.ts#createOffer`'ın kendi `requiresBackendOfferSync()`u
 * İLE AYNI bayrak) kapalıyken bu geri dönüş hiç denenmez: bayrak kapalıyken
 * ilan zaten Supabase'e hiç yazılmıyor (job-request-form.tsx), bu yüzden
 * orada aramak anlamsız olurdu — fail-closed varsayılan, bayrağın "kapalıyken
 * eski localStorage-only davranışla birebir aynı kalsın" ilkesiyle tutarlı.
 *
 * BİLEREK yalnızca `offers.ts#createOffer` içinde kullanılır (görev kapsamı:
 * "teklif oluşturma akışı") — aynı localStorage-only kısıt `offers.ts`teki
 * diğer 8 `findJobById` çağrısında (kabul/red/geri çekme/tamamlama/itiraz)
 * da teorik olarak var, ama bu görev SADECE teklif OLUŞTURMA akışını
 * kapsıyor; o diğer akışlar kanıtlanmış, ayrı bir görev gerektirir (bkz.
 * görev raporu).
 */
export async function findJobByIdWithRemoteFallback(id: string): Promise<Job | null> {
  const local = findJobById(id);
  if (local) return local;
  if (!isSupabaseJobSyncEnabled()) return null;
  return fetchJobByIdFromSupabase(id);
}
