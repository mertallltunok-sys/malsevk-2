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
  kvkk: string;
  terms: string;
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
  kvkkAccepted: boolean;
  termsAccepted: boolean;
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
  }

  if (!fields.kvkkAccepted) {
    errors.kvkk = "KVKK Aydınlatma Metni'ni kabul etmelisiniz.";
  }

  if (!fields.termsAccepted) {
    errors.terms = "Kullanım Koşulları'nı kabul etmelisiniz.";
  }

  return { errors, normalizedPhone };
}
