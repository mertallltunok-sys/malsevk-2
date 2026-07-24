"use client";

import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { getCompanyTypeFieldLabel, getCompanyTypeOptions, isCompanyType, type CompanyType } from "../_lib/company-type";
import { validateLoginFields } from "../_lib/login-form-validation";
import { evaluatePasswordRules } from "../_lib/password-rules";
import { validateRegisterFormFields, type RegisterFormErrors } from "../_lib/register-form-validation";
import { setSession } from "../_lib/session";
import type { UserRole } from "../_lib/types";
import { getDistrictsByProvinceCode, getProvinces } from "../_lib/turkey-locations";
import { registerUser, seedDevAccountsIfNeeded, verifyLogin } from "../_lib/users";
import { SearchableSelect } from "./searchable-select";

type Mode = "giris" | "kayit";

const isDev = process.env.NODE_ENV !== "production";

function PasswordRulesChecklist({
  password,
  confirmPassword,
}: {
  password: string;
  confirmPassword: string;
}) {
  const rules = evaluatePasswordRules(password, confirmPassword);
  return (
    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {rules.map((rule) => (
        <li
          key={rule.id}
          className={`flex items-center gap-2 text-xs transition-colors ${
            rule.met ? "text-success" : "text-muted-foreground"
          }`}
        >
          {rule.met ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

export function LoginForm({
  redirectTo,
  initialMode = "giris",
}: {
  redirectTo: string;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const firstNameId = useId();
  const lastNameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();
  const companyNameId = useId();
  const companyTypeId = useId();
  const provinceId = useId();
  const districtId = useId();
  const kvkkId = useId();
  const termsId = useId();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole | "">("");
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyType | "">("");
  const [provinceCode, setProvinceCode] = useState("");
  const [district, setDistrict] = useState("");
  const [kvkkAccepted, setKvkkAccepted] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);

  useEffect(() => {
    void seedDevAccountsIfNeeded();
  }, []);

  const passwordRules = evaluatePasswordRules(password, confirmPassword);
  const allPasswordRulesMet = mode === "kayit" && passwordRules.every((rule) => rule.met);

  const provinces = useMemo(() => getProvinces(), []);
  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  function clearFieldError(field: keyof RegisterFormErrors) {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setErrors({});
    setFormError(null);
    setJustRegistered(false);
  }

  function handleRoleChange(nextRole: UserRole) {
    setRole(nextRole);
    clearFieldError("role");
  }

  // İl değiştiğinde ilçe seçimi temizlenir — eski ilçe artık yeni ile ait
  // olmayabilir (bkz. job-request-form.tsx#handleProvinceChange, aynı desen).
  function handleProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setDistrict("");
    clearFieldError("province");
    clearFieldError("district");
  }

  function handleDistrictChange(nextDistrict: string) {
    setDistrict(nextDistrict);
    clearFieldError("district");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setJustRegistered(false);

    if (mode === "giris") {
      const fieldErrors = validateLoginFields({ email, password });
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;

      setSubmitting(true);
      await seedDevAccountsIfNeeded();
      const result = await verifyLogin(email, password);
      setSubmitting(false);
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      setSession({ id: result.user.id, name: result.user.name, role: result.user.role });
      router.push(redirectTo);
      return;
    }

    const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";
    const { errors: fieldErrors } = validateRegisterFormFields({
      firstName,
      lastName,
      email,
      phone,
      password,
      confirmPassword,
      role,
      companyName,
      companyType,
      province: provinceName,
      district,
      kvkkAccepted,
      termsAccepted,
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await registerUser({
      name: `${firstName.trim()} ${lastName.trim()}`.trim(),
      email,
      phone,
      password,
      role: role as UserRole,
      companyName,
      companyType: isCompanyType(companyType) ? companyType : undefined,
      province: provinceName,
      district,
    });
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    // Kayıt başarılı: kullanıcı otomatik oturum açmaz — giriş sekmesine
    // yönlendirilir ve orada başarı mesajı gösterilir. `email` bilerek
    // temizlenmez (giriş formunda önceden dolu gelsin diye); şifre ve diğer
    // kayıt alanları temizlenir.
    setFirstName("");
    setLastName("");
    setPhone("");
    setPassword("");
    setConfirmPassword("");
    setRole("");
    setCompanyName("");
    setCompanyType("");
    setProvinceCode("");
    setDistrict("");
    setKvkkAccepted(false);
    setTermsAccepted(false);
    setErrors({});
    setMode("giris");
    setJustRegistered(true);
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Giriş veya kayıt seçimi"
        className="grid grid-cols-2 gap-1 rounded-full border border-border bg-background p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "giris"}
          onClick={() => switchMode("giris")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            mode === "giris"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Giriş Yap
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "kayit"}
          onClick={() => switchMode("kayit")}
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            mode === "kayit"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Kayıt Ol
        </button>
      </div>

      {mode === "giris" && justRegistered && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          Kaydınız başarıyla oluşturuldu. Hesabınıza giriş yapabilirsiniz.
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-6">
        {mode === "kayit" && (
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Hesap Türü</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(
                [
                  { value: "hizmet-alan", label: "Hizmet Alan" },
                  { value: "hizmet-veren", label: "Hizmet Veren" },
                ] as const
              ).map((option) => (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-card border p-4 text-sm font-medium transition-colors ${
                    role === option.value
                      ? "border-primary bg-accent-soft text-primary"
                      : "border-border bg-surface text-foreground hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={role === option.value}
                    onChange={() => handleRoleChange(option.value)}
                    className="h-4 w-4 accent-primary focus-visible:outline-none"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {errors.role && <p className="mt-2 text-sm text-danger">{errors.role}</p>}
          </fieldset>
        )}

        {mode === "kayit" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor={firstNameId} className="text-sm font-medium text-foreground">
                Ad
              </label>
              <input
                id={firstNameId}
                type="text"
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  clearFieldError("firstName");
                }}
                aria-invalid={errors.firstName ? true : undefined}
                aria-describedby={errors.firstName ? `${firstNameId}-error` : undefined}
                className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                placeholder="Ör. Ahmet"
              />
              {errors.firstName && (
                <p id={`${firstNameId}-error`} className="mt-2 text-sm text-danger">
                  {errors.firstName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={lastNameId} className="text-sm font-medium text-foreground">
                Soyad
              </label>
              <input
                id={lastNameId}
                type="text"
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  clearFieldError("lastName");
                }}
                aria-invalid={errors.lastName ? true : undefined}
                aria-describedby={errors.lastName ? `${lastNameId}-error` : undefined}
                className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                placeholder="Ör. Yılmaz"
              />
              {errors.lastName && (
                <p id={`${lastNameId}-error`} className="mt-2 text-sm text-danger">
                  {errors.lastName}
                </p>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor={emailId} className="text-sm font-medium text-foreground">
            E-posta
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearFieldError("email");
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${emailId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            placeholder="ornek@sirket.com"
          />
          {errors.email && (
            <p id={`${emailId}-error`} className="mt-2 text-sm text-danger">
              {errors.email}
            </p>
          )}
        </div>

        {mode === "kayit" && (
          <div>
            <label htmlFor={phoneId} className="text-sm font-medium text-foreground">
              Telefon Numarası
            </label>
            <input
              id={phoneId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clearFieldError("phone");
              }}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? `${phoneId}-error` : undefined}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="05XX XXX XX XX"
            />
            {errors.phone && (
              <p id={`${phoneId}-error`} className="mt-2 text-sm text-danger">
                {errors.phone}
              </p>
            )}
          </div>
        )}

        <div>
          <label htmlFor={passwordId} className="text-sm font-medium text-foreground">
            Şifre
          </label>
          <div className="relative mt-2">
            <input
              id={passwordId}
              type={showPassword ? "text" : "password"}
              autoComplete={mode === "giris" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                clearFieldError("password");
              }}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? `${passwordId}-error` : undefined}
              className={`w-full rounded-md border bg-surface px-4 py-3 pr-11 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                allPasswordRulesMet ? "border-success" : "border-border"
              }`}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && (
            <p id={`${passwordId}-error`} className="mt-2 text-sm text-danger">
              {errors.password}
            </p>
          )}
          {mode === "kayit" && (
            <PasswordRulesChecklist password={password} confirmPassword={confirmPassword} />
          )}
        </div>

        {mode === "kayit" && (
          <div>
            <label htmlFor={confirmPasswordId} className="text-sm font-medium text-foreground">
              Şifre Tekrar
            </label>
            <div className="relative mt-2">
              <input
                id={confirmPasswordId}
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => {
                  setConfirmPassword(event.target.value);
                  clearFieldError("confirmPassword");
                }}
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={
                  errors.confirmPassword ? `${confirmPasswordId}-error` : undefined
                }
                className={`w-full rounded-md border bg-surface px-4 py-3 pr-11 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  allPasswordRulesMet ? "border-success" : "border-border"
                }`}
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {errors.confirmPassword && (
              <p id={`${confirmPasswordId}-error`} className="mt-2 text-sm text-danger">
                {errors.confirmPassword}
              </p>
            )}
          </div>
        )}

        {mode === "kayit" && role !== "" && (
          <>
            <div>
              <label htmlFor={companyNameId} className="text-sm font-medium text-foreground">
                Firma Adı
              </label>
              <input
                id={companyNameId}
                type="text"
                autoComplete="organization"
                value={companyName}
                onChange={(event) => {
                  setCompanyName(event.target.value);
                  clearFieldError("companyName");
                }}
                aria-invalid={errors.companyName ? true : undefined}
                aria-describedby={errors.companyName ? `${companyNameId}-error` : undefined}
                className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                placeholder="Ör. Yılmaz Lojistik Ltd. Şti."
              />
              {errors.companyName && (
                <p id={`${companyNameId}-error`} className="mt-2 text-sm text-danger">
                  {errors.companyName}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={companyTypeId} className="text-sm font-medium text-foreground">
                {getCompanyTypeFieldLabel(role)}
              </label>
              <select
                id={companyTypeId}
                value={companyType}
                onChange={(event) => {
                  setCompanyType(event.target.value as CompanyType);
                  clearFieldError("companyType");
                }}
                aria-invalid={errors.companyType ? true : undefined}
                aria-describedby={errors.companyType ? `${companyTypeId}-error` : undefined}
                className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  errors.companyType ? "border-danger" : "border-border"
                }`}
              >
                <option value="">Seçiniz</option>
                {getCompanyTypeOptions(role).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.companyType && (
                <p id={`${companyTypeId}-error`} className="mt-2 text-sm text-danger">
                  {errors.companyType}
                </p>
              )}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <SearchableSelect
                  id={provinceId}
                  label="İl"
                  options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                  value={provinceCode}
                  onChange={handleProvinceChange}
                  placeholder="İl seçiniz"
                  errorId={errors.province ? `${provinceId}-error` : undefined}
                />
                {errors.province && (
                  <p id={`${provinceId}-error`} className="mt-2 text-sm text-danger">
                    {errors.province}
                  </p>
                )}
              </div>

              <div>
                <SearchableSelect
                  id={districtId}
                  label="İlçe"
                  options={districtOptions}
                  value={district}
                  onChange={handleDistrictChange}
                  placeholder="İlçe seçiniz"
                  disabled={!provinceCode}
                  disabledHint="Önce il seçin"
                  errorId={errors.district ? `${districtId}-error` : undefined}
                />
                {errors.district && (
                  <p id={`${districtId}-error`} className="mt-2 text-sm text-danger">
                    {errors.district}
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {mode === "kayit" && (
          <div className="flex flex-col gap-3">
            <div>
              <label
                htmlFor={kvkkId}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
              >
                <input
                  id={kvkkId}
                  type="checkbox"
                  checked={kvkkAccepted}
                  onChange={(event) => {
                    setKvkkAccepted(event.target.checked);
                    clearFieldError("kvkk");
                  }}
                  aria-invalid={errors.kvkk ? true : undefined}
                  aria-describedby={errors.kvkk ? `${kvkkId}-error` : undefined}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
                />
                <span className="text-sm leading-relaxed text-foreground">
                  KVKK Aydınlatma Metni&apos;ni okudum ve kabul ediyorum.
                </span>
              </label>
              {errors.kvkk && (
                <p id={`${kvkkId}-error`} role="alert" className="mt-2 text-sm text-danger">
                  {errors.kvkk}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={termsId}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
              >
                <input
                  id={termsId}
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => {
                    setTermsAccepted(event.target.checked);
                    clearFieldError("terms");
                  }}
                  aria-invalid={errors.terms ? true : undefined}
                  aria-describedby={errors.terms ? `${termsId}-error` : undefined}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
                />
                <span className="text-sm leading-relaxed text-foreground">
                  Kullanım Koşulları&apos;nı kabul ediyorum.
                </span>
              </label>
              {errors.terms && (
                <p id={`${termsId}-error`} role="alert" className="mt-2 text-sm text-danger">
                  {errors.terms}
                </p>
              )}
            </div>
          </div>
        )}

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-disabled={submitting}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
          {mode === "giris"
            ? submitting
              ? "Giriş yapılıyor..."
              : "Giriş Yap"
            : submitting
              ? "Hesap oluşturuluyor..."
              : "Hesap Oluştur"}
        </button>

        {isDev && (
          <div className="rounded-md border border-dashed border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">
              Geliştirme ortamı test hesapları
            </p>
            <p className="mt-1">Hizmet Alan: zeynep@test.com / Zeynep1!</p>
            <p>Hizmet Veren: mert@test.com / Mert123!</p>
            <p>Hizmet Veren: mehmet.demir.demo@malsevk.com / Demo123!</p>
          </div>
        )}
      </form>
    </div>
  );
}
