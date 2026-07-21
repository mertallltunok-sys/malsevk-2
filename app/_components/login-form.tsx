"use client";

import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { validateLoginFields } from "../_lib/login-form-validation";
import { evaluatePasswordRules } from "../_lib/password-rules";
import { validateRegisterFormFields, type RegisterFormErrors } from "../_lib/register-form-validation";
import { setSession } from "../_lib/session";
import type { UserRole } from "../_lib/types";
import { registerUser, seedDevAccountsIfNeeded, verifyLogin } from "../_lib/users";

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
  const nameId = useId();
  const emailId = useId();
  const phoneId = useId();
  const passwordId = useId();
  const confirmPasswordId = useId();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole | "">("");
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void seedDevAccountsIfNeeded();
  }, []);

  const passwordRules = evaluatePasswordRules(password, confirmPassword);
  const allPasswordRulesMet = mode === "kayit" && passwordRules.every((rule) => rule.met);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setErrors({});
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

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

    const { errors: fieldErrors } = validateRegisterFormFields({
      name,
      email,
      phone,
      password,
      confirmPassword,
      role,
    });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await registerUser({
      name,
      email,
      phone,
      password,
      role: role as UserRole,
    });
    setSubmitting(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setSession({ id: result.user.id, name: result.user.name, role: result.user.role });
    router.push(redirectTo);
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

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-6">
        {mode === "kayit" && (
          <div>
            <label htmlFor={nameId} className="text-sm font-medium text-foreground">
              Ad Soyad
            </label>
            <input
              id={nameId}
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Ör. Ahmet Yılmaz"
            />
            {errors.name && (
              <p id={`${nameId}-error`} className="mt-2 text-sm text-danger">
                {errors.name}
              </p>
            )}
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
            onChange={(event) => setEmail(event.target.value)}
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
              onChange={(event) => setPhone(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
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
            <input
              id={confirmPasswordId}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={errors.confirmPassword ? true : undefined}
              aria-describedby={
                errors.confirmPassword ? `${confirmPasswordId}-error` : undefined
              }
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                allPasswordRulesMet ? "border-success" : "border-border"
              }`}
              placeholder="••••••••"
            />
            {errors.confirmPassword && (
              <p id={`${confirmPasswordId}-error`} className="mt-2 text-sm text-danger">
                {errors.confirmPassword}
              </p>
            )}
          </div>
        )}

        {mode === "kayit" && (
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Kullanıcı Rolü</legend>
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
                    onChange={() => setRole(option.value)}
                    className="h-4 w-4 accent-primary focus-visible:outline-none"
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {errors.role && <p className="mt-2 text-sm text-danger">{errors.role}</p>}
          </fieldset>
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
