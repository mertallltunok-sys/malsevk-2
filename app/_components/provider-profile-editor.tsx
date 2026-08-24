"use client";

import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { detectImageFormat, MAX_PHOTO_SIZE_BYTES } from "../_lib/photo-validation";
import {
  PROVIDER_BIO_MAX_LENGTH,
  PROVIDER_BIO_MIN_LENGTH,
  MIN_FOUNDED_YEAR,
  getMaxFoundedYear,
  validateProviderProfileForm,
  type ProviderProfileFormErrors,
} from "../_lib/provider-profile";
import { upsertMyProviderProfileRemote } from "../_lib/supabase-provider-profile";
import { deleteMyProviderLogoRemote, uploadMyProviderLogoRemote } from "../_lib/supabase-provider-logo";
import type { Session } from "../_lib/types";
import { getProvinces } from "../_lib/turkey-locations";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { updateProviderProfile, type StoredUser } from "../_lib/users";
import { MultiSelectChips } from "./multi-select-chips";

const REGION_OPTIONS = getProvinces().map((province) => ({ value: province.name, label: province.name }));

/**
 * Hesap Ayarları'na eklenen, Hizmet Veren'e özel "Firma Profili" bölümü
 * (bkz. account-settings-content.tsx). Logo, ilan fotoğraflarının aksine
 * `/api/job-photos/process` sunucu adımından GEÇMEZ (o rota bilerek
 * yalnızca hizmet-alan rolüne açık, bkz. CLAUDE.md "Photo upload
 * pipeline") — bilinçli, dar kapsamlı bir sadeleştirme: yalnızca istemci
 * tarafında boyut/gerçek biçim (magic number) doğrulanır, HEIC kabul
 * edilmez (dönüştürme adımı yok), EXIF temizliği uygulanmaz. Logo blob'u
 * yine de ilan fotoğraflarıyla aynı IndexedDB deposunu (photo-blob-store.ts)
 * paylaşır — yalnızca `users.ts#updateProviderProfile` üzerinden yazılır.
 *
 * DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi): "Uzmanlık
 * Alanları" bölümü TAMAMEN KALDIRILDI (yalnız gizlenmedi) — "Hizmet Veren
 * kendi profilinden hizmet veya uzmanlık alanı seçemez" kuralı gereği.
 * "Hizmet Verilen Bölgeler" (`regions`) KASITLI OLARAK KORUNDU — görev
 * tanımı bunu açıkça istisna tutuyor, coğrafi çalışma alanı bir "hizmet/
 * uzmanlık" seçimi değildir. Eski `expertise` verisi (varsa) `StoredUser.
 * providerProfile.expertise`te DEĞİŞMEDEN kalır (bkz. users.ts#
 * updateProviderProfile'ın güncellenmiş dokümantasyonu) — yalnızca bu
 * formdan artık okunamaz/yazılamaz.
 */
export function ProviderProfileEditor({ session, user }: { session: Session; user: StoredUser }) {
  const existing = user.providerProfile;

  // DÜZELTME (uçtan uca doğrulama görevi): `providerProfile.companyName`in
  // (bu form) `provider_profiles`te hiçbir sütun karşılığı yok (bkz.
  // supabase-provider-profile.ts'in kendi notu) — bu yüzden `existing` GERÇEK
  // bir tarayıcıda (hydrate-provider-mirror.ts ile ilk kez doldurulmuş)
  // BOŞ gelir. Bu, canlı Supabase testinde GERÇEK bir blokaja yol açtığını
  // kanıtladı: kullanıcı yeni bir cihazda bu formdan yalnızca bio/kuruluş
  // yılını güncellemeye çalışsa bile "Firma adı zorunludur" hatasıyla
  // reddediliyordu (boş varsayılan zorunlu alanı geçersiz kılıyordu). `user.
  // companyName` (StoredUser'ın ÜST seviye alanı, kayıt formundan `profiles.
  // company_name`e yazılır ve HER ZAMAN güvenilir şekilde hidrate edilir) her
  // firmanın gerçekte TEK bir adı olduğu için makul ve zararsız bir yedek
  // değerdir — yalnızca provider-profile'a özgü bir isim hiç girilmemişse
  // devreye girer, var olan bir `providerProfile.companyName`i asla ezmez.
  const [companyName, setCompanyName] = useState(existing?.companyName ?? user.companyName ?? "");
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [foundedYear, setFoundedYear] = useState(existing?.foundedYear ? String(existing.foundedYear) : "");
  const [regions, setRegions] = useState<string[]>(existing?.regions ?? []);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  const [errors, setErrors] = useState<ProviderProfileFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const companyNameId = useId();
  const bioId = useId();
  const foundedYearId = useId();
  const logoInputId = useId();
  const regionsId = useId();

  const savedLogoUrl = useJobPhotoUrl(logoRemoved ? null : (existing?.logoStorageKey ?? null));

  // `logoFile` senkron olarak elde edilebilen bir File nesnesi (async bir
  // blob-store okuması değil) — bu yüzden URL, bir effect+setState yerine
  // doğrudan render sırasında (useMemo ile) üretilir; effect yalnızca
  // temizlik (revoke) yapar, hiç setState çağırmaz (react-hooks/set-state-in-effect).
  const newLogoPreviewUrl = useMemo(() => (logoFile ? URL.createObjectURL(logoFile) : null), [logoFile]);
  useEffect(() => {
    return () => {
      if (newLogoPreviewUrl) URL.revokeObjectURL(newLogoPreviewUrl);
    };
  }, [newLogoPreviewUrl]);

  const displayedLogoUrl = newLogoPreviewUrl ?? savedLogoUrl;

  async function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLogoError(null);
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      setLogoError(`Logo boyutu ${Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024))} MB'ı geçemez.`);
      return;
    }
    if (file.size === 0) {
      setLogoError("Dosya boş veya bozuk.");
      return;
    }
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const format = detectImageFormat(header);
    if (format !== "jpeg" && format !== "png" && format !== "webp") {
      setLogoError("Logo için yalnızca JPG, PNG veya WEBP yükleyebilirsiniz.");
      return;
    }

    setLogoFile(file);
    setLogoRemoved(false);
  }

  function handleRemoveLogo() {
    setLogoFile(null);
    setLogoRemoved(true);
    setLogoError(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedYear = foundedYear.trim();
    const foundedYearNum = trimmedYear === "" ? null : Number(trimmedYear);

    const fieldErrors = validateProviderProfileForm({ companyName, bio, foundedYear: foundedYearNum });
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    setJustSaved(false);

    // DÜZELTME ("Firma Profilini Supabase'e Tam Bağla" görevi) — sıra artık
    // TERS: Supabase yazımı önce, BLOKLAYAN olarak denenir; yalnızca O
    // BAŞARILIYSA yerel yazım (aşağıda) yapılır. Eskiden yerel yazım ÖNCE
    // yapılıyor, kullanıcıya HEMEN "kaydedildi" gösteriliyordu — Supabase
    // yazımı (bio/foundedYear/regions/logo) SONRADAN, en-iyi-çaba denenip
    // başarısız olsa bile yalnızca yumuşak bir "kaydedildi ama..." uyarısı
    // gösteriliyordu (görev gereksinimi #4'ün YASAKLADIĞI tam da bu — sahte
    // başarı). `companyName`in `provider_profiles`te hiç karşılığı
    // OLMADIĞI (types.ts'in kendi notu — ayrı bir kavram) DEĞİŞMEDİ; bu
    // alan hâlâ yalnızca aşağıdaki yerel yazımla kaydedilir.
    const remoteProfileResult = await upsertMyProviderProfileRemote({ bio, foundedYear: foundedYearNum, regions });
    if (!remoteProfileResult.ok) {
      setSubmitting(false);
      setSubmitError(`Firma profili merkezi veritabanına kaydedilemedi: ${remoteProfileResult.error}`);
      return;
    }

    if (logoRemoved) {
      const deleted = await deleteMyProviderLogoRemote();
      if (!deleted) {
        setSubmitting(false);
        setSubmitError("Logo merkezi depodan kaldırılamadı. Lütfen tekrar deneyin.");
        return;
      }
    } else if (logoFile) {
      const uploadResult = await uploadMyProviderLogoRemote(logoFile);
      if (!uploadResult.ok) {
        setSubmitting(false);
        setSubmitError(`Logo merkezi depoya yüklenemedi: ${uploadResult.error}`);
        return;
      }
    }

    // Supabase yazımı (bio/foundedYear/regions/logo) ZATEN başarıyla
    // tamamlandı — bu andan sonra yerel yazım yalnızca bir önbellek adımıdır
    // (`companyName`/`expertise` hariç, ikisinin de yalnızca yerel karşılığı
    // var, bkz. yukarıdaki not). Bu yazım yine de başarısız olabilir (ör.
    // localStorage kotası) — bu durumda kullanıcıya AÇIK bir hata gösterilir
    // (companyName/logo'nun görünen yerel kopyası güncellenemediği için sahte
    // başarı YİNE gösterilmez), ama Supabase'e ZATEN yazılmış olan
    // bio/foundedYear/regions/logo geri ALINMAZ (silme/rollback RPC'si yok,
    // ve bu veri kaybı değil — bir sonraki başarılı yerel yazımda yine aynı
    // değerlerle üzerine yazılacaktır).
    const result = await updateProviderProfile(session, {
      companyName,
      bio,
      foundedYear: foundedYearNum,
      regions,
      logo: logoRemoved ? null : (logoFile ?? undefined),
    });

    if (!result.ok) {
      setSubmitting(false);
      setSubmitError(result.error);
      return;
    }

    setSubmitting(false);
    setLogoFile(null);
    setLogoRemoved(false);
    setJustSaved(true);
  }

  const bioLength = bio.trim().length;
  const bioInvalid = Boolean(errors.bio);

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Firma Profili</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Hizmet Alan&apos;ların gelen teklifler ekranında göreceği firma bilgilerinizi düzenleyin.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6" noValidate>
        <div>
          <span className="text-sm font-medium text-foreground">Firma Logosu</span>
          <div className="mt-2 flex items-center gap-4">
            <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
              {displayedLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- IndexedDB blob object URL, next/image optimize edemez
                <img src={displayedLogoUrl} alt="Firma logosu" className="h-full w-full object-cover" />
              ) : (
                <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label
                htmlFor={logoInputId}
                className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent"
              >
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                Logo Seç
              </label>
              <input
                id={logoInputId}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                onChange={handleLogoChange}
                className="sr-only"
              />
              {displayedLogoUrl && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-danger/40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Kaldır
                </button>
              )}
            </div>
          </div>
          {logoError && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {logoError}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            JPG, PNG veya WEBP · en fazla {Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024))} MB · opsiyonel
          </p>
        </div>

        <div>
          <label htmlFor={companyNameId} className="text-sm font-medium text-foreground">
            Firma Adı
          </label>
          <input
            id={companyNameId}
            type="text"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            aria-invalid={Boolean(errors.companyName)}
            aria-describedby={errors.companyName ? `${companyNameId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.companyName ? "border-danger" : "border-border"
            }`}
          />
          {errors.companyName && (
            <p id={`${companyNameId}-error`} role="alert" className="mt-1.5 text-sm text-danger">
              {errors.companyName}
            </p>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={bioId} className="text-sm font-medium text-foreground">
              Kısa Firma Tanıtımı
            </label>
            <span className={`text-xs ${bioInvalid ? "text-danger" : "text-muted-foreground"}`}>
              {bioLength} / {PROVIDER_BIO_MAX_LENGTH}
            </span>
          </div>
          <textarea
            id={bioId}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            aria-invalid={bioInvalid}
            aria-describedby={errors.bio ? `${bioId}-error` : undefined}
            placeholder={`Firmanızı ve uzmanlığınızı en az ${PROVIDER_BIO_MIN_LENGTH} karakterle tanıtın.`}
            className={`mt-2 w-full resize-none rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              bioInvalid ? "border-danger" : "border-border"
            }`}
          />
          {errors.bio && (
            <p id={`${bioId}-error`} role="alert" className="mt-1.5 text-sm text-danger">
              {errors.bio}
            </p>
          )}
        </div>

        <div className="sm:max-w-xs">
          <label htmlFor={foundedYearId} className="text-sm font-medium text-foreground">
            Kuruluş Yılı
          </label>
          <input
            id={foundedYearId}
            type="number"
            inputMode="numeric"
            min={MIN_FOUNDED_YEAR}
            max={getMaxFoundedYear()}
            value={foundedYear}
            onChange={(event) => setFoundedYear(event.target.value)}
            placeholder={`${MIN_FOUNDED_YEAR}–${getMaxFoundedYear()}`}
            aria-invalid={Boolean(errors.foundedYear)}
            aria-describedby={errors.foundedYear ? `${foundedYearId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.foundedYear ? "border-danger" : "border-border"
            }`}
          />
          {errors.foundedYear && (
            <p id={`${foundedYearId}-error`} role="alert" className="mt-1.5 text-sm text-danger">
              {errors.foundedYear}
            </p>
          )}
        </div>

        <MultiSelectChips
          id={regionsId}
          label="Hizmet Verilen Bölgeler"
          options={REGION_OPTIONS}
          selected={regions}
          onChange={setRegions}
          searchable
          searchPlaceholder="İl ara..."
        />

        {submitError && (
          <p role="alert" className="text-sm text-danger">
            {submitError}
          </p>
        )}
        {justSaved && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            Firma profiliniz kaydedildi.
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Kaydediliyor..." : "Firma Profilini Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
