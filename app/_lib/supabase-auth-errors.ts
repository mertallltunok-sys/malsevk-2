import type { AuthError } from "@supabase/supabase-js";

/**
 * Supabase Auth hata kodlarını (bkz. `error.code`, `AuthApiError`) kullanıcı
 * dostu Türkçe mesajlara çeviren TEK merkezi harita — login-form.tsx,
 * app/kayit-tamamla, app/sifre-sifirla, app/sifre-guncelle hepsi bunu
 * kullanır, hiçbiri kendi çevirisini icat etmez (bu kod tabanının zaten
 * kullandığı "TEK doğruluk kaynağı" ilkesiyle aynı). Eşleşmeyen bir kod için
 * `error.message`e (İngilizce) düşer — bu, hiç görülmemiş yeni bir Supabase
 * hata kodunun kullanıcıya boş/kırık bir mesaj yerine en azından ANLAŞILIR
 * bir İngilizce açıklama göstermesini sağlar.
 */
export function mapSupabaseAuthError(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      // login-form.tsx'in kendi verifyLogin mesajıyla (E-posta VEYA şifre
      // hatalı) BİLEREK aynı — hangisinin yanlış olduğunu açığa çıkarmaz.
      return "E-posta veya şifre hatalı.";
    case "email_not_confirmed":
      return "E-posta adresiniz henüz doğrulanmamış. Lütfen gelen kutunuzu kontrol edip doğrulama bağlantısına tıklayın.";
    case "user_already_exists":
    case "user_already_registered":
      return "Bu e-posta adresiyle bir hesap zaten mevcut olabilir. Giriş yapmayı ya da şifrenizi sıfırlamayı deneyin.";
    case "weak_password":
      return "Şifre güvenlik kurallarını karşılamıyor.";
    case "same_password":
      return "Yeni şifre eskisiyle aynı olamaz.";
    case "over_email_send_rate_limit":
      return "Çok kısa süre içinde çok fazla e-posta isteği gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.";
    case "over_request_rate_limit":
      return "Çok fazla deneme yapıldı. Lütfen bir süre sonra tekrar deneyin.";
    case "session_not_found":
    case "session_expired":
      return "Oturumunuzun süresi dolmuş. Lütfen bağlantıya tekrar tıklayın veya işlemi yeniden başlatın.";
    case "signup_disabled":
      return "Şu anda yeni kayıt alınamıyor. Lütfen daha sonra tekrar deneyin.";
    default:
      return error.message || "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.";
  }
}
