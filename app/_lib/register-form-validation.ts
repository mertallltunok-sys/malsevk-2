import { isCompanyType } from "./company-type";
import { isCustomsBrokerProvider, isGeneralDocumentRequired } from "./customs-license";
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
  /** Yalnızca role "hizmet-veren" iken doğrulanır — bkz. "Verdiğiniz Hizmetler". */
  providerServices: string;
  /** Yalnızca role "hizmet-veren" iken doğrulanır — bkz. "Faaliyet Belgesi/Raporu Yükle". */
  providerDocuments: string;
  /** Yalnızca role "hizmet-veren" iken doğrulanır — bkz. "Belge Doğruluk Beyanı". */
  documentDeclaration: string;
  /** Yalnızca Gümrük Müşavirliği seçiliyken doğrulanır — bkz. "Gümrük Müşaviri İzin Belgesi". */
  customsLicenseDocument: string;
  /** Yalnızca Gümrük Müşavirliği seçiliyken doğrulanır — bkz. "Yüklediğim belge bana aittir ve günceldir." */
  customsLicenseDeclaration: string;
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
  legalConsentAccepted: boolean;
  /** Yalnızca role "hizmet-veren" iken anlamlıdır. */
  providerServiceCategoryIds: string[];
  /** Yalnızca role "hizmet-veren" iken anlamlıdır — henüz yükleme/doğrulama sürecinde olanlar SAYILMAZ, yalnızca hazır (ready) belgeler. */
  providerDocumentCount: number;
  /** Yalnızca role "hizmet-veren" iken anlamlıdır. */
  documentDeclarationAccepted: boolean;
  /** Yalnızca role "hizmet-veren" VE Gümrük Müşavirliği seçiliyken anlamlıdır. */
  hasCustomsLicenseDocument: boolean;
  /** Yalnızca role "hizmet-veren" VE Gümrük Müşavirliği seçiliyken anlamlıdır. */
  customsLicenseDeclarationAccepted: boolean;
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

    // Hizmet seçimi yalnızca Hizmet Veren için zorunludur (görev
    // gereksinimi) — Hizmet Alan akışı bu alanı hiç görmez/hiç doğrulanmaz.
    if (fields.role === "hizmet-veren") {
      if (fields.providerServiceCategoryIds.length === 0) {
        errors.providerServices = "En az bir hizmet seçmelisiniz.";
      }

      // Genel Faaliyet Belgesi/Raporu zorunluluğu — yalnızca seçilen hizmet
      // kümesi TAMAMEN Gümrük Müşavirliği'nden ibaretse atlanır (bkz.
      // customs-license.ts#isGeneralDocumentRequired, TEK doğruluk kaynağı,
      // provider-registration.ts'in veri katmanı doğrulamasıyla AYNI kural).
      // Başka bir kategori de seçiliyse (ör. Gümrük + Lashing) bu kural
      // diğer kategoriler için aynen geçerli kalır.
      if (isGeneralDocumentRequired(fields.providerServiceCategoryIds)) {
        if (fields.providerDocumentCount === 0) {
          errors.providerDocuments = "En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.";
        }
        if (!fields.documentDeclarationAccepted) {
          errors.documentDeclaration = "Belge doğruluk beyanını kabul etmelisiniz.";
        }
      }

      // Gümrük Müşavirliği ek KYC gereksinimi (bkz. customs-license.ts) —
      // Gümrük Müşavirliği seçili olduğu sürece (tek başına veya başka
      // kategorilerle birlikte) her zaman zorunludur.
      if (isCustomsBrokerProvider(fields.providerServiceCategoryIds)) {
        if (!fields.hasCustomsLicenseDocument) {
          errors.customsLicenseDocument = "Gümrük Müşaviri İzin Belgesi yüklemelisiniz.";
        }
        if (!fields.customsLicenseDeclarationAccepted) {
          errors.customsLicenseDeclaration = "Yüklediğiniz belgenin size ait ve güncel olduğunu onaylamalısınız.";
        }
      }
    }
  }

  if (!fields.legalConsentAccepted) {
    errors.legalConsent = "Devam etmek için Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.";
  }

  return { errors, normalizedPhone };
}
