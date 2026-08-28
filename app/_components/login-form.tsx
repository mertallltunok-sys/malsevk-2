"use client";

import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState } from "react";
import { getCompanyTypeFieldLabel, getCompanyTypeOptions, isCompanyType, type CompanyType } from "../_lib/company-type";
import { finishSupabaseRegistration } from "../_lib/complete-registration";
import { getLegalDocumentMeta, type LegalDocumentId } from "../_lib/legal-documents";
import { validateLoginFields } from "../_lib/login-form-validation";
import { evaluatePasswordRules } from "../_lib/password-rules";
import { savePendingRegistrationDraft } from "../_lib/pending-registration-draft";
import { validateRegisterFormFields, type RegisterFormErrors } from "../_lib/register-form-validation";
import { type RegistrationMetadataFields } from "../_lib/registration-metadata";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import { mapSupabaseAuthError } from "../_lib/supabase-auth-errors";
import type { UserRole } from "../_lib/types";
import { getDistrictsByProvinceCode, getProvinces } from "../_lib/turkey-locations";
import { useSession } from "../_lib/use-session";
import { DemoAccountsPanel } from "./demo-accounts-panel";
import { LegalDocumentModal } from "./legal-document-modal";
import { handleLogout } from "./profile-menu";
import { SearchableSelect } from "./searchable-select";

type Mode = "giris" | "kayit";

/**
 * Kayıt formundaki TEK birleşik onay cümlesi içinde (bkz. bu dosyanın
 * altındaki checkbox bloğu) üç hukuki metin adının HER BİRİ ayrı ayrı
 * tıklanabilir olmalı ve kendi modalını açmalı (bkz. görev gereksinimi).
 * `event.stopPropagation()` KRİTİK: bu buton bir `<label>` İÇİNDE render
 * edildiği için, olayın kabarmasını engellemezsek tarayıcı tıklamayı
 * label'ın ilişkili checkbox'ına da yönlendirir — kullanıcı yalnızca
 * metni okumak isterken kutuyu da işaretlemiş/işaretini kaldırmış olur.
 */
function LegalDocumentInlineTrigger({
  documentId,
  onOpen,
}: {
  documentId: LegalDocumentId;
  onOpen: (documentId: LegalDocumentId) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(documentId);
      }}
      className="underline decoration-dotted underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
    >
      {getLegalDocumentMeta(documentId).title}
    </button>
  );
}

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
  confirmErrorMessage,
  passwordUpdated = false,
  emailJustConfirmed = false,
}: {
  redirectTo: string;
  initialMode?: Mode;
  /** app/auth/confirm/route.ts'in bir doğrulama bağlantısı reddedince yönlendirdiği anlaşılır hata mesajı — bkz. giris-yap/page.tsx. */
  confirmErrorMessage?: string;
  /** app/sifre-guncelle sonrası — "başarı sonrası giriş ekranına yönlendirme" gereksinimi. */
  passwordUpdated?: boolean;
  /**
   * app/auth/confirm/route.ts'in `pkce_code_verifier_not_found` dalından —
   * e-posta doğrulama linki, kaydı başlatandan FARKLI bir tarayıcı/cihazda
   * açıldığında (ör. masaüstünde kayıt olup telefondan linke tıklamak). E-posta
   * GERÇEKTEN doğrulanmıştır (GoTrue bunu code exchange'den bağımsız yapar);
   * yalnızca BU tarayıcının oturumu kurması mümkün değildir — bu yüzden genel
   * "süresi dolmuş/kullanılmış" hatası DEĞİL, bu net "doğrulandı, giriş yapın"
   * mesajı gösterilir.
   */
  emailJustConfirmed?: boolean;
}) {
  const router = useRouter();
  // "Kritik Oturum/Kimlik Karışması" görevi — kanıtlanmış kök neden: bu form
  // hâlâ aktif bir Supabase oturumu varken "Kayıt Ol" sekmesini engelsiz
  // çalıştırıyordu. `signUp()` girilen e-posta zaten kayıtlıysa (ör.
  // kullanıcının KENDİ mevcut hesabının e-postası) 422/`user_already_exists`
  // ile doğru şekilde reddediliyor, ama BU başarısız deneme eski oturuma
  // HİÇ dokunmuyordu — kullanıcı hata mesajını fark etmeden/okumadan başka
  // bir sayfaya (ör. ana sayfa) geçtiğinde, hâlâ tamamen geçerli olan ESKİ
  // oturumuyla karşılaşıyor, bu da "kayıt farklı biriymiş gibi tamamlandı ama
  // eski hesap görünüyor" izlenimi veriyordu — session/profile eşleşmesinin
  // KENDİSİ hiçbir zaman bozulmuyor, yalnızca aktif-oturum-varken-kayıt
  // akışı hiç engellenmiyordu. Aşağıdaki `session` bu engeli kurar.
  const session = useSession();
  const [signingOutForRegistration, setSigningOutForRegistration] = useState(false);
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
  const legalConsentId = useId();

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
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(false);
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);
  // SUPABASE AUTH GEÇİŞİ: e-posta doğrulaması gerektiğinden, signUp()
  // başarılı olduğunda (ve Supabase anında bir oturum döndürmediğinde —
  // bkz. handleSubmit) kayıt formu bu ekranla DEĞİŞTİRİLİR; formu tekrar
  // göstermenin bir anlamı yok, çünkü Supabase Auth hesabı zaten oluştu.
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState(false);
  const [openLegalDocumentId, setOpenLegalDocumentId] = useState<LegalDocumentId | null>(null);
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  // React state (submitting) yalnızca UI'yi (buton disabled/metin) sürer —
  // aynı JS event-loop turunda art arda iki tıklama/Enter, ikisi de state
  // commit edilmeden ÖNCE handleSubmit'in kayıt (kayit) yoluna ulaşabilir,
  // bu yüzden çift-gönderim koruması BUNA dayanamaz. `job-request-form.tsx#
  // handlePublish`teki `submitLockRef` ile AYNI desen: senkron, render'dan
  // bağımsız bir kilit — ilk geçerli çağrıda hemen kapanır, ikinci çağrı
  // state güncellemesini beklemeden bu kilidi görüp döner. Yalnızca kayıt
  // yoluna özeldir; giriş (giris) dalı bundan hiç etkilenmez.
  const registerSubmitLockRef = useRef(false);

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
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        setSubmitting(false);
        setFormError(error ? mapSupabaseAuthError(error) : "Giriş yapılamadı. Lütfen tekrar deneyin.");
        return;
      }

      // account_status kontrolü (bu katman istemci taraflı bir erken kapıdır;
      // gerçek zorlama artık ayrıca sunucu tarafında da var — bkz. migration
      // 0042/assert_active_user(), 41 mutation RPC'sinde çağrılıyor). Askıya
      // alınmış/kapalı bir hesap burada AÇIKÇA reddedilir ve oturum hemen kapatılır — sessizce
      // "oturum yokmuş" gibi davranan belirsiz bir duruma bırakılmaz.
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, account_status")
        .eq("id", data.user.id)
        .maybeSingle<{ role: UserRole | null; account_status: string | null }>();
      setSubmitting(false);

      if (!profile || profile.account_status !== "active") {
        await supabase.auth.signOut();
        setFormError(
          profile && (profile.account_status === "suspended" || profile.account_status === "banned")
            ? "Hesabınız askıya alınmış. Lütfen destek ekibimizle iletişime geçin."
            : "Hesabınıza erişilemiyor. Lütfen tekrar deneyin.",
        );
        return;
      }

      if (!profile.role) {
        // Kayıt tamamlanmamış (e-posta doğrulandı ama complete_registration
        // hiç çağrılmamış — ör. kullanıcı doğrulama linkine tıkladıktan
        // sonra kayıt tamamlama ekranını kapatıp daha sonra doğrudan giriş
        // yapmayı denedi). Kaybolmuş gibi görünmez — tamamlama ekranına
        // yönlendirilir.
        router.push("/kayit-tamamla");
        return;
      }

      // ADMİN OTOMATİK YÖNLENDİRME (Yönetim Paneli yeniden tasarımı): admin
      // giriş yaptığında elle "/admin" yazmak zorunda kalmasın. `redirectTo`
      // yalnızca hâlâ varsayılan ana sayfa ("/") İSE ezilir — proxy.ts bir
      // korumalı rotadan (ör. doğrudan /admin/firmalar'a girmeye çalışırken)
      // buraya `?redirect=` ile bounce ettiyse o GERÇEK hedef korunur.
      if (profile.role === "admin" && redirectTo === "/") {
        router.push("/admin");
        return;
      }

      router.push(redirectTo);
      return;
    }

    // İkinci, veri-katmanı güvencesi (görev gereksinimi madde 4) — aşağıdaki
    // JSX guard'ı (bkz. `session` üstündeki doküman) normal koşulda bu satıra
    // hiç ulaşılmasını zaten engeller; bu yalnızca bir savunma hattıdır (ör.
    // form açıkken arka planda bir oturum başlarsa) — `signUp()` aktif bir
    // oturum varken ASLA çağrılmaz.
    if (session) {
      setFormError("Yeni bir hesap oluşturmak için önce mevcut hesabınızdan çıkış yapmalısınız.");
      return;
    }

    // Senkron kilit: state (submitting) commit edilmeden önce gelebilecek
    // ikinci bir kayıt denemesini de hemen durdurur (bkz. registerSubmitLockRef
    // tanımı). `finally` sayesinde validasyon hatası, signUp/
    // finishSupabaseRegistration'ın `{ok:false}` sonucu ya da beklenmeyen bir
    // exception dahil HER çıkış yolunda kilit mutlaka açılır — takılı kalmaz.
    if (registerSubmitLockRef.current) return;
    registerSubmitLockRef.current = true;
    try {
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
        legalConsentAccepted,
      });
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;

      if (!isCompanyType(companyType)) {
        // Defansif — validateRegisterFormFields bunu zaten yukarıda
        // engellemiş olmalı (errors.companyType), buraya normal koşullarda
        // asla ulaşılmaz.
        setFormError("Firma tipi zorunludur.");
        return;
      }

      setSubmitting(true);

      // SUPABASE AUTH GEÇİŞİ: gerçek hesap artık burada, tek adımda
      // OLUŞMAZ — önce Supabase Auth'ta bir kullanıcı açılır (`signUp`),
      // ardından (e-posta doğrulaması genelde ZORUNLU olduğu için) formun
      // GERİ KALANI (rol/firma/hizmet/belge bilgileri) `complete_registration`
      // RPC'siyle e-posta doğrulandıktan SONRA tamamlanır — bkz.
      // complete-registration.ts'in kendi dokümantasyonu.
      //
      // `options.data` (registration-metadata.ts) — hassas OLMAYAN form
      // alanlarının (belgeler/şifre/e-posta HARİÇ) Supabase'in kendi
      // `user_metadata`sına da yazılması: doğrulama linki farklı bir
      // sekmede/cihazda açıldığında `pending-registration-draft.ts`in
      // sessionStorage taslağı bulunamaz (bkz. o dosyanın "bilinçli
      // sınırlama" notu) — bu, /kayit-tamamla'nın o durumda hâlâ formu
      // ÖN-DOLDURABİLMESİ için sunucu-taraflı bir yedek kaynaktır. `role` DA
      // dahildir ama SADECE ön-doldurma/görüntüleme amaçlıdır — bkz.
      // registration-metadata.ts'in kendi güvenlik notu: tek doğruluk kaynağı
      // hâlâ HER ZAMAN `complete_registration`in kendi `p_role` parametresi
      // (kullanıcının /kayit-tamamla'da gördüğü/onayladığı form state'i),
      // hiçbir kod yolu `user_metadata`daki `role`'ü doğrudan RPC'ye taşımaz.
      // NOT: providerServiceCategoryIds/documentDeclarationAccepted/
      // customsLicenseDeclarationAccepted artık BU formda hiç toplanmıyor
      // (bkz. HİZMET VEREN ONBOARDING SADELEŞTİRMESİ) — paylaşılan
      // RegistrationMetadataFields/PendingRegistrationDraft tip sözleşmesi
      // (registration-metadata.ts, complete-registration-form.tsx'in de
      // kullandığı) DEĞİŞTİRİLMEDİ, bu yüzden burada sabit/boş varsayılan
      // değerler gönderilir — complete-registration.ts (yukarıda güncellendi)
      // zaten providerServiceCategoryIds boşken tüm belge zorunluluğu
      // kontrollerini ATLAR.
      const registrationMetadata: RegistrationMetadataFields = {
        role: role as UserRole,
        firstName,
        lastName,
        phone,
        companyName,
        companyType,
        province: provinceName,
        district,
        // MERSİS artık kayıt sırasında hiç toplanmıyor (bkz. migration 0089) —
        // ileride ayrı bir kurumsal doğrulama akışında toplanabilir diye
        // paylaşılan tip sözleşmesi (mersisNo alanı) DEĞİŞTİRİLMEDİ, burada
        // sabit `undefined` gönderilir.
        mersisNo: undefined,
        providerServiceCategoryIds: [],
        documentDeclarationAccepted: false,
        customsLicenseDeclarationAccepted: false,
        legalConsentAccepted,
      };
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/kayit-tamamla")}`,
          data: registrationMetadata,
        },
      });

      if (signUpError) {
        setSubmitting(false);
        setFormError(mapSupabaseAuthError(signUpError));
        return;
      }
      if (!signUpData.user) {
        setSubmitting(false);
        setFormError("Hesap oluşturulamadı. Lütfen tekrar deneyin.");
        return;
      }
      // Supabase, e-posta doğrulaması etkinken bile aynı adresle DAHA ÖNCE
      // doğrulanmış bir hesap için "sahte" bir başarı döner (e-posta
      // numaralandırma saldırılarını önlemek için, `identities` boş dizi
      // olur, yeni bir doğrulama e-postası GÖNDERİLMEZ) — bu, ne olumlu ne
      // olumsuz bir mesajla (görev gereksinimi: var olan bir hesabı açığa
      // çıkarma) ele alınır.
      if (signUpData.user.identities && signUpData.user.identities.length === 0) {
        setSubmitting(false);
        setFormError(
          "Bu e-posta adresiyle bir hesap zaten mevcut olabilir. Giriş yapmayı ya da şifrenizi sıfırlamayı deneyin.",
        );
        return;
      }

      // NOT: aynı sadeleştirme burada da geçerli — kayıt anında hiç hizmet/
      // belge toplanmadığı için bunların tümü boş/varsayılan gönderilir.
      const completionInput = {
        role: role as UserRole,
        firstName,
        lastName,
        phone,
        companyName,
        companyType,
        province: provinceName,
        district,
        // MERSİS artık kayıt sırasında hiç toplanmıyor (bkz. migration 0089) —
        // ileride ayrı bir kurumsal doğrulama akışında toplanabilir diye
        // paylaşılan tip sözleşmesi (mersisNo alanı) DEĞİŞTİRİLMEDİ, burada
        // sabit `undefined` gönderilir.
        mersisNo: undefined,
        providerServiceCategoryIds: [] as string[],
        providerDocuments: [] as { indexedDbStorageKey: string; originalFileName: string; mimeType: string; extension: string; size: number }[],
        documentDeclarationAccepted: false,
        customsLicenseDocument: undefined,
        customsLicenseDeclarationAccepted: false,
        legalConsentAccepted,
      };

      if (signUpData.session) {
        // Bu development projesinde e-posta doğrulaması KAPALIYSA, signUp
        // anında zaten aktif bir Supabase oturumu döner — bu durumda
        // e-posta bekleme ekranı GÖSTERİLMEDEN kayıt doğrudan tamamlanır ve
        // kullanıcı doğrudan içeri alınır (zaten kimliği doğrulanmış bir
        // kullanıcıyı tekrar giriş yapmaya zorlamanın bir anlamı yok).
        const result = await finishSupabaseRegistration(completionInput);
        setSubmitting(false);
        if (!result.ok) {
          setFormError(result.error);
          return;
        }
        router.push(redirectTo);
        return;
      }

      // Normal akış: e-posta doğrulaması bekleniyor. Formun geri kalan
      // (hassas olmayan) bilgileri aynı sekme için sessionStorage'a
      // yazılır (bkz. pending-registration-draft.ts'in kendi
      // dokümantasyonu — bu yalnızca bir kolaylıktır, tek doğruluk kaynağı
      // DEĞİLDİR) ve kullanıcıya "e-postanızı kontrol edin" ekranı gösterilir.
      savePendingRegistrationDraft(completionInput);
      setSubmitting(false);
      setAwaitingEmailConfirmation(true);
    } finally {
      registerSubmitLockRef.current = false;
      setSubmitting(false);
    }
  }

  // SUPABASE AUTH GEÇİŞİ: signUp() e-posta doğrulaması bekleyen bir hesap
  // üretti — form/sekme yerine tek amaçlı bir "e-postanızı kontrol edin"
  // ekranı gösterilir (tekrar "Kayıt Ol"a basmanın bir anlamı yok, Supabase
  // Auth hesabı zaten oluştu). Kullanıcı dilerse "Giriş Yap" sekmesine geri
  // dönüp BAŞKA bir hesapla giriş yapabilsin diye erken çıkış butonu vardır.
  if (awaitingEmailConfirmation) {
    return (
      <div className="rounded-card border border-border bg-background p-6 text-center sm:p-8">
        <p className="text-base font-semibold text-foreground">E-postanızı Kontrol Edin</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">{email}</strong> adresine bir doğrulama bağlantısı gönderdik.
          Hesabınızı kullanmaya başlamak için bağlantıya tıklayın.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          E-postayı bulamıyorsanız gereksiz/spam klasörünü kontrol edin.
        </p>
        <button
          type="button"
          onClick={() => {
            setAwaitingEmailConfirmation(false);
            switchMode("giris");
          }}
          className="mt-6 text-sm font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          Giriş ekranına dön
        </button>
      </div>
    );
  }

  // "Kritik Oturum/Kimlik Karışması" görevi Faz 2 — kanıtlanmış kök nedenin
  // düzeltmesi: aktif bir Supabase oturumu varken "Kayıt Ol" sekmesi (tab
  // bar dahil) hiç render EDİLMEZ, `awaitingEmailConfirmation` bloğuyla AYNI
  // "formu tamamen değiştir" deseni. `signUp()` bu noktaya hiç ulaşamaz.
  if (mode === "kayit" && session) {
    return (
      <div className="rounded-card border border-warning/30 bg-warning-soft p-6 text-center sm:p-8">
        <p className="text-base font-semibold text-foreground">Zaten Bir Hesapla Giriş Yaptınız</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">{session.name}</strong> hesabıyla giriş yapmış durumdasınız. Yeni bir
          hesap oluşturmak için mevcut hesabınızdan çıkış yapmanız gerekiyor.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => router.push(redirectTo)}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Mevcut Hesaba Dön
          </button>
          <button
            type="button"
            disabled={signingOutForRegistration}
            onClick={() => {
              setSigningOutForRegistration(true);
              void handleLogout("/giris-yap?mode=kayit");
            }}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            {signingOutForRegistration ? "Çıkış yapılıyor..." : "Çıkış Yapıp Kayıt Ol"}
          </button>
        </div>
      </div>
    );
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

      {mode === "giris" && passwordUpdated && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.
        </div>
      )}

      {mode === "giris" && emailJustConfirmed && (
        <div
          role="status"
          aria-live="polite"
          className="mt-6 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success"
        >
          E-posta adresiniz doğrulandı. Devam etmek için giriş yapın.
        </div>
      )}

      {mode === "giris" && confirmErrorMessage && (
        <div role="alert" className="mt-6 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">
          {confirmErrorMessage}
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
          {mode === "giris" && (
            <a
              href="/sifre-sifirla"
              className="mt-2 inline-block text-sm text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
            >
              Şifremi unuttum
            </a>
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

            {/* HİZMET VEREN ONBOARDING SADELEŞTİRMESİ (bkz. proje raporu):
                "Verdiğiniz Hizmetler" seçimi + Faaliyet Belgesi/Gümrük
                Müşaviri İzin Belgesi yükleme bölümleri kayıt formundan
                TAMAMEN KALDIRILDI — hesap oluşturulduktan SONRA Hesap
                Ayarları > "Belge Yükleme" ekranından (provider-document-
                upload-page.tsx) yapılır. Kayıt artık yalnızca temel firma/
                profil bilgilerini toplar; hizmet/belge state'i (aşağıdaki
                useState'ler kaldırıldı) hiç TUTULMAZ. */}
          </>
        )}

        {mode === "kayit" && (
          <div>
            <label
              htmlFor={legalConsentId}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
            >
              <input
                id={legalConsentId}
                type="checkbox"
                checked={legalConsentAccepted}
                onChange={(event) => {
                  setLegalConsentAccepted(event.target.checked);
                  clearFieldError("legalConsent");
                }}
                aria-invalid={errors.legalConsent ? true : undefined}
                aria-describedby={errors.legalConsent ? `${legalConsentId}-error` : undefined}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
              />
              <span className="text-sm leading-relaxed text-foreground">
                <LegalDocumentInlineTrigger documentId="privacy_policy" onOpen={setOpenLegalDocumentId} />,{" "}
                <LegalDocumentInlineTrigger documentId="terms_of_service" onOpen={setOpenLegalDocumentId} /> ve{" "}
                <LegalDocumentInlineTrigger documentId="kvkk" onOpen={setOpenLegalDocumentId} />
                &apos;ni okudum, anladım ve kabul ediyorum.
              </span>
            </label>
            {errors.legalConsent && (
              <p id={`${legalConsentId}-error`} role="alert" className="mt-2 text-sm text-danger">
                {errors.legalConsent}
              </p>
            )}
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
      </form>

      {mode === "giris" && process.env.NODE_ENV === "development" && (
        <DemoAccountsPanel
          onSelectAccount={(accountEmail, accountPassword) => {
            setEmail(accountEmail);
            setPassword(accountPassword);
          }}
        />
      )}

      {openLegalDocumentId && (
        <LegalDocumentModal
          documentId={openLegalDocumentId}
          mode="consent"
          onClose={() => setOpenLegalDocumentId(null)}
        />
      )}
    </div>
  );
}
