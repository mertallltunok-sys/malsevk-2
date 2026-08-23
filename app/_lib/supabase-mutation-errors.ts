/**
 * Migration 0042 (assert_active_user) — tek, merkezi kaynak for ML125/ML126/
 * ML127'nin Türkçe mesajları. Bu kodlar artık 41 farklı mutation RPC'sinden
 * dönebilir (bkz. 0042'nin kendi dosya başlığı), ama her çağrı sitesinin
 * kendi `mapXRpcError` switch'i zaten var (supabase-provider-documents.ts,
 * supabase-provider-document-review.ts, admin-companies.ts, admin-requesters.ts,
 * ...) — üç mesajı her switch'te TEKRAR YAZMAK yerine, her switch'in kendi
 * `default` dalından ÖNCE bu fonksiyona delege etmesi yeterli: bir kod bu
 * üçünden biri değilse `null` döner, çağıran kendi mevcut fallback'ine düşer.
 *
 * GENEL GÜVENLİK GÖREVİ §11 (migration 0073) — `ML161` (rate limit aşımı,
 * `check_rate_limit()`'in fırlattığı TEK kod, hangi RPC/trigger'dan geldiğine
 * bakılmaksızın AYNI anlam) da AYNI mantıkla buraya eklendi — mevcut her
 * çağrı sitesi hiçbir değişiklik yapmadan bu yeni kodu da otomatik olarak
 * anlaşılır bir Türkçe mesaja çevirir.
 */
export function getAccountStatusErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "ML125":
      return "Bu işlemi gerçekleştirmek için giriş yapmalısınız.";
    case "ML126":
      return "Hesap bilgileriniz bulunamadı. Lütfen tekrar giriş yapmayı deneyin.";
    case "ML127":
      return "Hesabınız askıya alındığı için bu işlemi gerçekleştiremezsiniz.";
    case "ML161":
      return "Kısa sürede çok fazla işlem yaptınız. Lütfen biraz bekleyip tekrar deneyin.";
    default:
      return null;
  }
}
