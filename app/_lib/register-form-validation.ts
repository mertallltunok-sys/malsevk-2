import { isValidEmail } from "./login-form-validation";
import { isPasswordValid } from "./password-rules";
import { normalizePhoneNumber } from "./phone";

export type RegisterFormErrors = Partial<{
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: string;
}>;

export type RegisterFormValidation = {
  errors: RegisterFormErrors;
  normalizedPhone: string | null;
};

export function validateRegisterFormFields(fields: {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  role: string;
}): RegisterFormValidation {
  const errors: RegisterFormErrors = {};

  const name = fields.name.trim();
  if (name.length < 2) {
    errors.name = "Ad soyad en az 2 karakter olmalıdır.";
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

  if (fields.role !== "hizmet-alan" && fields.role !== "hizmet-veren") {
    errors.role = "Devam etmek için bir rol seçin.";
  }

  return { errors, normalizedPhone };
}
