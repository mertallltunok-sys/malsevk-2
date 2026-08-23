/**
 * GENEL GÜVENLİK, VERİ DOĞRULAMA VE KÖTÜYE KULLANIM KORUMASI — merkezi
 * iletişim-bilgisi-sızıntısı tespiti (görev bölüm 8). Bu iki kalıp
 * ("yüksek güvenilirlikli e-posta" + "açıkça telefon-şekilli 10-14 haneli
 * rakam dizisi") ÖNCEDEN yalnızca `job-form-validation.ts`'te ve
 * `supabase/migrations/0052`'nin `ensure_job_content_has_no_direct_
 * contact_info()` trigger'ında BİREBİR AYNI şekilde iki kez yazılıydı — bu
 * dosya istemci tarafındaki TEK kopyayı burada toplar (`job-form-
 * validation.ts` geriye dönük uyumluluk için kendi adlarıyla buradan
 * re-export eder, hiçbir mevcut çağıran değişmez) ve `offer-form-
 * validation.ts`in de aynı fonksiyonu YENİDEN YAZMADAN kullanmasını sağlar
 * (görev gereksinimi: "Teklif açıklaması" da bu kontrolün kapsamına girmeli
 * — bkz. `supabase/migrations/0073`'ün offers.description üzerindeki AYNI
 * sunucu tarafı trigger'ı).
 *
 * BİLEREK muhafazakâr: meşru bir açıklamadaki ürün kodu/tarih/miktar gibi
 * kısa rakam dizilerini yanlışlıkla reddetmemek için agresif bir "herhangi
 * bir rakam dizisi" kuralı kullanılmaz (tabela/fotoğraf içeriği kapsam
 * DIŞIDIR).
 */

const DIRECT_EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const DIRECT_PHONE_PATTERN = /(\+?\d[\s.-]?){10,13}\d/;

export function containsDirectContactInfo(text: string): boolean {
  return DIRECT_EMAIL_PATTERN.test(text) || DIRECT_PHONE_PATTERN.test(text);
}

export const CONTACT_INFO_SHARED_NOTICE = "İletişim bilgileri teklif kabulünden sonra paylaşılır.";
