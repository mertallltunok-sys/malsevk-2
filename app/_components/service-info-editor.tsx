"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import {
  EXPERIENCE_RANGE_OPTIONS,
  SERVICE_CATEGORY_GROUPS,
  SERVICE_FEATURE_OPTIONS,
  getProviderServiceInfoCompletion,
  isServiceCategoryId,
  isServiceFeature,
  migrateLegacyExpertiseToServiceCategoryIds,
} from "../_lib/service-catalog";
import { getProvinces } from "../_lib/turkey-locations";
import type { ExperienceRange, Session } from "../_lib/types";
import { updateProviderServiceInfo, type StoredUser } from "../_lib/users";
import { MultiSelectChips } from "./multi-select-chips";

const REGION_OPTIONS = getProvinces().map((province) => ({ value: province.name, label: province.name }));
const SERVICE_FEATURE_MULTISELECT_OPTIONS = SERVICE_FEATURE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

/**
 * Panel > Profilim'e eklenen, Hizmet Veren'e özel "Hizmet Bilgilerim"
 * bölümü — Hesap Ayarları > Firma Profili'nden (provider-profile-editor.tsx)
 * KASITLI OLARAK AYRIDIR: o form companyName/bio'yu zorunlu kılar, bu ise
 * bir tamamlama akışıdır (bkz. users.ts#updateProviderServiceInfo) —
 * kullanıcı Firma Profili'ni hiç doldurmamış olsa bile yalnızca
 * hizmet/bölge/deneyim bilgisini kaydedebilir. "Çalışma Bölgeleri" alanı,
 * Firma Profili'ndeki aynı `regions` alanını paylaşır (tek doğruluk
 * kaynağı, iki farklı ekrandan düzenlenir).
 *
 * MİGRASYON: `serviceCategories`in başlangıç değeri, kullanıcının eski
 * `expertise` (Uzmanlık Alanları, Hesap Ayarları) seçimlerinden mümkün
 * olanların yeni katalog id'lerine çevrilmiş hâliyle BİRLEŞTİRİLİR (bkz.
 * service-catalog.ts#migrateLegacyExpertiseToServiceCategoryIds) — bu
 * yüzden bu sayfayı ilk kez açan, daha önce yalnızca eski "Uzmanlık
 * Alanları"nı doldurmuş bir Hizmet Veren, uygulanabilir seçimlerinin
 * burada ZATEN işaretli geldiğini görür. Bu yalnızca OKUMA anındaki bir
 * birleştirmedir — orijinal `expertise` dizisi hiç değiştirilmez/silinmez,
 * yalnızca kullanıcı "Kaydet"e basarsa birleşik küme `serviceCategories`e
 * yazılır.
 */
export function ServiceInfoEditor({ session, user }: { session: Session; user: StoredUser }) {
  const existing = user.providerProfile;

  const [regions, setRegions] = useState<string[]>(existing?.regions ?? []);
  const [serviceCategories, setServiceCategories] = useState<string[]>(() =>
    Array.from(
      new Set([
        ...(existing?.serviceCategories ?? []).filter(isServiceCategoryId),
        ...migrateLegacyExpertiseToServiceCategoryIds(existing?.expertise ?? []),
      ]),
    ),
  );
  const [serviceFeatures, setServiceFeatures] = useState<string[]>(existing?.serviceFeatures ?? []);
  const [experienceRange, setExperienceRange] = useState<ExperienceRange | "">(existing?.experienceRange ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const experienceRangeId = useId();
  const regionsId = useId();
  const featuresId = useId();

  // Firma adı ya kayıt anında (StoredUser.companyName) ya da Hesap
  // Ayarları'ndan (providerProfile.companyName) girilmiş olabilir —
  // tamamlanma hesaplaması ikisinden hangisi doluysa onu sayar.
  const companyName = user.companyName ?? user.providerProfile?.companyName;

  const completion = useMemo(
    () =>
      getProviderServiceInfoCompletion({
        companyName,
        phone: user.phone,
        email: user.email,
        regions,
        serviceCategories,
        experienceRange: experienceRange || undefined,
      }),
    [companyName, user.phone, user.email, regions, serviceCategories, experienceRange],
  );
  const companyNameMissing = !completion.checklist.find((item) => item.label === "Firma Adı")?.met;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setJustSaved(false);

    const result = await updateProviderServiceInfo(session, {
      regions,
      serviceCategories,
      serviceFeatures: serviceFeatures.filter(isServiceFeature),
      experienceRange: experienceRange || null,
    });

    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setJustSaved(true);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-foreground">Hizmet Bilgilerim</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Verebileceğiniz hizmetleri, çalışma bölgelerinizi ve deneyiminizi belirtin — bu bilgiler ilan
        eşleştirme ve arama sonuçlarında kullanılacaktır.
      </p>

      <div className="mt-5 rounded-md border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Profil Tamamlanma</p>
          <p className="text-sm font-semibold text-primary">%{completion.percent}</p>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border" role="presentation">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${completion.percent}%` }}
          />
        </div>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {completion.checklist.map((item) => (
            <li
              key={item.label}
              className={`flex items-center gap-2 text-xs transition-colors ${
                item.met ? "text-success" : "text-muted-foreground"
              }`}
            >
              {item.met ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              {item.label}
            </li>
          ))}
        </ul>
        {companyNameMissing && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Firma adınızı{" "}
            <Link href="/panel/hesap-ayarlari" className="font-medium text-primary hover:underline">
              Hesap Ayarları
            </Link>{" "}
            sayfasından ekleyebilirsiniz.
          </p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6" noValidate>
        <fieldset>
          <legend className="text-sm font-medium text-foreground">Hizmet Seçimi</legend>
          <p className="mt-1 text-xs text-muted-foreground">Birden fazla hizmet seçebilirsiniz.</p>
          <div className="mt-3 flex flex-col gap-5">
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <MultiSelectChips
                key={group.id}
                id={`${group.id}-chips`}
                label={group.label}
                options={group.categories.map((category) => ({ value: category.id, label: category.label }))}
                selected={serviceCategories}
                onChange={setServiceCategories}
              />
            ))}
          </div>
        </fieldset>

        <MultiSelectChips
          id={featuresId}
          label="Hizmet Özellikleri"
          options={SERVICE_FEATURE_MULTISELECT_OPTIONS}
          selected={serviceFeatures}
          onChange={setServiceFeatures}
        />

        <div className="sm:max-w-xs">
          <label htmlFor={experienceRangeId} className="text-sm font-medium text-foreground">
            Deneyim
          </label>
          <select
            id={experienceRangeId}
            value={experienceRange}
            onChange={(event) => setExperienceRange(event.target.value as ExperienceRange | "")}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Seçiniz</option>
            {EXPERIENCE_RANGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <MultiSelectChips
          id={regionsId}
          label="Çalışma Bölgeleri"
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
            Hizmet bilgileriniz kaydedildi.
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Kaydediliyor..." : "Hizmet Bilgilerimi Kaydet"}
          </button>
        </div>
      </form>
    </div>
  );
}
