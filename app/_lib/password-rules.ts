const SPECIAL_CHAR_REGEX = /[!@#$%^&*.,?_-]/;
const UPPERCASE_REGEX = /[A-ZÇĞİÖŞÜ]/;
const LOWERCASE_REGEX = /[a-zçğıöşü]/;
const DIGIT_REGEX = /\d/;

export type PasswordRuleId =
  | "length"
  | "uppercase"
  | "lowercase"
  | "digit"
  | "special"
  | "match";

export type PasswordRuleResult = { id: PasswordRuleId; label: string; met: boolean };

export function evaluatePasswordRules(
  password: string,
  confirmPassword: string,
): PasswordRuleResult[] {
  return [
    { id: "length", label: "En az 8 karakter", met: password.length >= 8 },
    { id: "uppercase", label: "En az 1 büyük harf", met: UPPERCASE_REGEX.test(password) },
    { id: "lowercase", label: "En az 1 küçük harf", met: LOWERCASE_REGEX.test(password) },
    { id: "digit", label: "En az 1 rakam", met: DIGIT_REGEX.test(password) },
    { id: "special", label: "En az 1 özel karakter", met: SPECIAL_CHAR_REGEX.test(password) },
    {
      id: "match",
      label: "Şifreler eşleşiyor",
      met: password.length > 0 && password === confirmPassword,
    },
  ];
}

export function isPasswordValid(password: string): boolean {
  return (
    password.length >= 8 &&
    UPPERCASE_REGEX.test(password) &&
    LOWERCASE_REGEX.test(password) &&
    DIGIT_REGEX.test(password) &&
    SPECIAL_CHAR_REGEX.test(password)
  );
}
