"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { EXPERIENCE_RANGE_OPTIONS, getProviderServiceInfoCompletion } from "../_lib/service-catalog";
import { upsertMyProviderProfileRemote } from "../_lib/supabase-provider-profile";
import { getProvinces } from "../_lib/turkey-locations";
import type { ExperienceRange, Session } from "../_lib/types";
import { updateProviderServiceInfo, type StoredUser } from "../_lib/users";
import { MultiSelectChips } from "./multi-select-chips";

const REGION_OPTIONS = getProvinces().map((province) => ({ value: province.name, label: province.name }));

/**
 * Panel > Profilim'e eklenen, Hizmet Veren'e özel "Hizmet Bilgilerim"
 * bölümü — Hesap Ayarları > Firma Profili'nden (provider-profile-editor.tsx)
 * KASITLI OLARAK AYRIDIR: o form companyName/bio'yu zorunlu kılar, bu ise
 * bir tamamlama akışıdır (bkz. users.ts#updateProviderServiceInfo) —
 * kullanıcı Firma Profili'ni hiç doldurmamış olsa bile yalnızca
 * bölge/deneyim bilgisini kaydedebilir. "Çalışma Bölgeleri" alanı, Firma
 * Profili'ndeki aynı `regions` alanını paylaşır (tek doğruluk kaynağı, iki
 * farklı ekrandan düzenlenir).
 *
 * DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi — çekirdek
 * kural: "Hizmet Veren kendi profilinden hizmet veya uzmanlık alanı
 * seçemez. Profilde yalnız admin tarafından onaylanmış ve aktif
 * durumdaki hizmet yetkileri gösterilir."): bu bileşen eskiden "Hizmet
 * Seçimi" (SERVICE_CATEGORY_GROUPS chip'leri), "Hizmet Özellikleri" ve
 * "Geri Dönüşüm Uzmanlık Alanları" bölümlerini de içeriyordu — üçü de
 * TAMAMEN KALDIRILDI (yalnız gizlenmedi): ilgili React state'leri, kayıt
 * payload alanları, ve `provider-services.ts`/uzak `provider_services`e
 * yazım çağrıları hiç yok. Hizmet Veren artık HANGİ kategoride teklif
 * verebileceğini yalnızca `provider-service-status-card.tsx`'in salt
 * okunur "Hizmet Yetkileri" kartından (admin onaylı `provider_service_
 * authorizations`) görür — bu form o veriye asla dokunmaz/yazmaz. Kaldırılan
 * alanların ESKİ verisi (varsa) `StoredUser.providerProfile`/`provider-
 * services.ts`te DEĞİŞMEDEN kalır (bkz. users.ts#updateProviderServiceInfo'nun
 * kendi güncellenmiş dokümantasyonu) — yalnızca bu formdan artık
 * okunamaz/yazılamaz, başka hiçbir yerde silinmedi.
 */
export function ServiceInfoEditor({ session, user }: { session: Session; user: StoredUser }) {
  const existing = user.providerProfile;

  const [regions, setRegions] = useState<string[]>(existing?.regions ?? []);
  const [experienceRange, setExperienceRange] = useState<ExperienceRange | "">(existing?.experienceRange ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [remoteSyncWarning, setRemoteSyncWarning] = useState<string | null>(null);

  const experienceRangeId = useId();
  const regionsId = useId();

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
        experienceRange: experienceRange || undefined,
      }),
    [companyName, user.phone, user.email, regions, experienceRange],
  );
  const companyNameMissing = !completion.checklist.find((item) => item.label === "Firma Adı")?.met;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setJustSaved(false);
    setRemoteSyncWarning(null);

    const result = await updateProviderServiceInfo(session, {
      regions,
      experienceRange: experienceRange || null,
    });

    if (!result.ok) {
      setSubmitting(false);
      setSubmitError(result.error);
      return;
    }

    // PROFİL/PROVIDER GEÇİŞİ: `regions`/`experienceRange` (tur 3) GERÇEK
    // `provider_profiles`e de yazılır — yerel yazımın YANINDA, en iyi çaba
    // (bkz. supabase-provider-profile.ts'in "kısmi güncelleme"
    // dokümantasyonu: yalnızca bu iki alan gönderilir — `serviceFeatures`
    // anahtarı BİLEREK hiç geçirilmez, böylece var olan uzak değeri
    // dokunulmadan korunur, `bio`/`foundedYear` de aynı şekilde
    // ProviderProfileEditor'ın kendi satırından korunur). Yerel yazım
    // zaten başarılı olduğu için bu adımın başarısızlığı genel
    // "kaydedildi" sonucunu ENGELLEMEZ.
    const remoteProfileResult = await upsertMyProviderProfileRemote({
      regions,
      experienceRange: experienceRange || null,
    });

    setSubmitting(false);
    if (!remoteProfileResult.ok) {
      setRemoteSyncWarning("Hizmet bilgileriniz kaydedildi ama bölge/deneyim bilgileriniz merkezi veritabanına yansıtılamadı. Lütfen daha sonra tekrar deneyin.");
    }
    setJustSaved(true);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Hizmet Bilgilerim</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Çalışma bölgelerinizi ve deneyiminizi belirtin. Hangi hizmetlere teklif verebileceğiniz, admin
        tarafından onaylanan hizmet yetkilerinize göre belirlenir — aşağıdaki &quot;Hizmet Yetkileri&quot;
        bölümünden görüntüleyebilirsiniz.
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
        {remoteSyncWarning && (
          <p role="alert" className="text-sm text-danger">
            {remoteSyncWarning}
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
