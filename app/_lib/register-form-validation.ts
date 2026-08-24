import { isCompanyType } from "./company-type";
import { isValidEmail } from "./login-form-validation";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";

export type RegisterFormErrors = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: string;
  companyName: string;
  companyType: string;
  province: string;
  district: string;
  /** MERSİS / İşletme Tekilliği görevi — yalnızca biçim hatası (16 hane değil); tekillik yalnızca sunucuda (complete_registration RPC'si, migration 0082) doğrulanabilir. */
  mersisNo: string;
  /**
   * Gizlilik Politikası/Kullanım Koşulları/KVKK Aydınlatma Metni'ni TEK
   * birleşik onay kutusu üzerinden kapsar (bkz. login-form.tsx) — önceden
   * ayrı `kvkk`/`terms` alanları vardı, kayıt formu tek bir "üçünü de
   * okudum, kabul ediyorum" kutusuna geçtiği için (bkz. görev gereksinimi)
   * TEK bir hata alanı yeterlidir. Her metin için ayrı kabul KAYDI hâlâ
   * tutulur (bkz. legal-consent.ts#recordConsentForAllLegalDocuments) —
   * yalnızca FORMDAKİ doğrulama/hata gösterimi birleştirildi.
   */
  legalConsent: string;
}>;

export type RegisterFormValidation = {
  errors: RegisterFormErrors;
  normalizedPhone: string | null;
};

export function validateRegisterFormFields(fields: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: string;
  companyName: string;
  companyType: string;
  province: string;
  district: string;
  mersisNo: string;
  legalConsentAccepted: boolean;
}): RegisterFormValidation {
  const errors: RegisterFormErrors = {};

  if (fields.firstName.trim().length === 0) {
    errors.firstName = "Ad zorunludur.";
  }

  if (fields.lastName.trim().length === 0) {
    errors.lastName = "Soyad zorunludur.";
  }

  const email = fields.email.trim();
  if (email.length === 0) {
    errors.email = "E-posta zorunludur.";
  } else if (!isValidEmail(email)) {
    errors.email = "Geçerli bir e-posta adresi giriniz.";
  }

  let normalizedPhone: string | null = null;
  const phoneResult = normalizePhoneNumber(fields.phone);
  if (!phoneResult.ok) {
    errors.phone = phoneResult.error;
  } else {
    normalizedPhone = phoneResult.value;
  }

  if (!isPasswordValid(fields.password)) {
    errors.password = "Şifre yukarıdaki tüm kuralları karşılamalıdır.";
  }

  if (fields.confirmPassword.length === 0 || fields.confirmPassword !== fields.password) {
    errors.confirmPassword = "Şifreler eşleşmiyor.";
  }

  const isValidRole = fields.role === "hizmet-alan" || fields.role === "hizmet-veren";
  if (!isValidRole) {
    errors.role = "Devam etmek için bir hesap türü seçin.";
  }

  // Firma adı/tip/il/ilçe yalnızca geçerli bir rol seçildiğinde arayüzde
  // görünür (bkz. login-form.tsx) — rol henüz seçilmemişse bu alanlar için
  // hata üretmek, ekranda hiç görünmeyen bir alanın altında hata göstermek
  // anlamına gelirdi.
  if (isValidRole) {
    if (fields.companyName.trim().length === 0) {
      errors.companyName = "Firma adı zorunludur.";
    }

    if (!isCompanyType(fields.companyType)) {
      errors.companyType =
        fields.role === "hizmet-veren" ? "Hizmet veren tipini seçiniz." : "Kullanıcı tipini seçiniz.";
    }

    if (fields.province.trim().length === 0) {
      errors.province = "İl zorunludur.";
    }

    if (fields.district.trim().length === 0) {
      errors.district = "İlçe zorunludur.";
    }

    // MERSİS / İşletme Tekilliği görevi — "Development Kapanış Turu"
    // görevi MERSİS'i "bireysel" DIŞINDAKİ firma tiplerinde ZORUNLU kıldı
    // (migration 0083 — 0082'nin ilk sürümünde bilerek opsiyonel bırakılmıştı,
    // bu görev bunu bilinçli olarak değiştirdi). Bireysel kullanıcı hâlâ
    // MERSİS'siz kayıt olabilir (o zaten hiç MERSİS'e sahip olamaz). Gerçek
    // tekillik yalnızca sunucuda (complete_registration RPC'si, ML176)
    // doğrulanabilir — burada TEKRARLANMAZ, yalnızca "boş bırakılmasın" ve
    // "biçim 16 hane olsun" istemci-taraflı erken geri bildirimdir.
    if (fields.companyType !== "bireysel") {
      const digitsOnly = fields.mersisNo.replace(/\D/g, "");
      if (digitsOnly.length === 0) {
        errors.mersisNo = "MERSİS numarası zorunludur.";
      } else if (digitsOnly.length !== 16) {
        errors.mersisNo = "MERSİS numarası 16 haneli bir sayı olmalıdır.";
      }
    }

    // HİZMET VEREN ONBOARDING SADELEŞTİRMESİ (bkz. proje raporu): kayıt
    // formu artık hizmet seçimi/belge yükleme TOPLAMAZ — bunlar hesap
    // oluşturulduktan sonra ayrı "Belge Yükleme" ekranından yapılır (bkz.
    // provider-document-upload-page.tsx). Bu yüzden burada eskiden var olan
    // "En az bir hizmet seçmelisiniz"/belge zorunluluğu kontrolleri
    // TAMAMEN KALDIRILDI — kayıt formunun kendisi bu alanları hiç
    // içermediği için doğrulayacak bir şey yok. Data katmanındaki AYNI
    // kuralın (complete-registration.ts) hâlâ "yalnızca hizmet seçiliyse
    // uygula" şeklinde korunduğuna bkz. — orada TAMAMEN kaldırılmadı,
    // yalnızca koşullu hâle getirildi (gelecekte başka bir çağıran
    // hizmetlerle birlikte çağırırsa aynı iş kuralı geçerli kalsın diye).
  }

  if (!fields.legalConsentAccepted) {
    errors.legalConsent = "Devam etmek için Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.";
  }

  return { errors, normalizedPhone };
}
