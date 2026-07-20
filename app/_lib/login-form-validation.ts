const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

export type LoginFormErrors = Partial<{ email: string; password: string }>;

export function validateLoginFields(fields: {
  email: string;
  password: string;
}): LoginFormErrors {
  const errors: LoginFormErrors = {};

  const email = fields.email.trim();
  if (email.length === 0) {
    errors.email = "E-posta zorunludur.";
  } else if (!isValidEmail(email)) {
    errors.email = "Geçerli bir e-posta adresi giriniz.";
  }

  if (fields.password.length === 0) {
    errors.password = "Şifre zorunludur.";
  }

  return errors;
}

export type RegisterFormErrors = LoginFormErrors & Partial<{ name: string; role: string }>;

export function validateRegisterFields(fields: {
  email: string;
  password: string;
  name: string;
  role: string;
}): RegisterFormErrors {
  const errors: RegisterFormErrors = validateLoginFields(fields);

  if (fields.password.length > 0 && fields.password.length < 3) {
    errors.password = "Şifre en az 3 karakter olmalıdır.";
  }

  const name = fields.name.trim();
  if (name.length < 2) {
    errors.name = "Ad soyad en az 2 karakter olmalıdır.";
  }

  if (fields.role !== "hizmet-alan" && fields.role !== "hizmet-veren") {
    errors.role = "Devam etmek için bir rol seçin.";
  }

  return errors;
}
