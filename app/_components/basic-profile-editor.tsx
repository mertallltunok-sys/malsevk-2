"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { getCompanyTypeFieldLabel, getCompanyTypeOptions, isCompanyType, type CompanyType } from "../_lib/company-type";
import type { SessionProfileDetails } from "../_lib/session";
import { updateMyProfileRemote } from "../_lib/supabase-profile-update";
import type { UserRole } from "../_lib/types";
import { getDistrictsByProvinceCode, getProvinces } from "../_lib/turkey-locations";
import { SearchableSelect } from "./searchable-select";

/**
 * PROFİL/PROVIDER GEÇİŞİ — kayıt formunun ("full_name, phone, company_name,
 * company_type, province, district") kendi 6 alanını GERÇEK `profiles`
 * tablosuna yazan tek düzenleme yüzeyi (bkz. supabase-profile-update.ts'in
 * kendi dokümantasyonu — bu 6 alan, şemanın gerçekten sütun-seviyeli UPDATE
 * yetkisi verdiği TEK alan kümesidir). Bilerek Hesap Ayarları'na eklendi
 * (Profilim/`ProfileInfoCard` salt-okunur bir özet olarak KALIR) —
 * `ProviderProfileEditor`/`ContactVisibilitySettings` zaten AYNI sayfada
 * yaşayan düzenleme yüzeyleri, bu üçüncüsü aynı yerleşim/desenle eklendi
 * (görev gereksinimi: "mevcut tasarımı mümkün olduğunca koru").
 */
export function BasicProfileEditor({
  profileDetails,
  role,
}: {
  profileDetails: SessionProfileDetails;
  role: UserRole;
}) {
  const provinces = getProvinces();
  const initialProvinceCode = provinces.find((item) => item.name === profileDetails.province)?.code ?? "";

  const [fullName, setFullName] = useState(profileDetails.fullName);
  const [phone, setPhone] = useState(profileDetails.phone ?? "");
  const [companyName, setCompanyName] = useState(profileDetails.companyName ?? "");
  const [companyType, setCompanyType] = useState<CompanyType | "">(
    isCompanyType(profileDetails.companyType) ? profileDetails.companyType : "",
  );
  const [provinceCode, setProvinceCode] = useState(initialProvinceCode);
  const [district, setDistrict] = useState(profileDetails.district ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const fullNameId = useId();
  const phoneId = useId();
  const companyNameId = useId();
  const companyTypeId = useId();
  const provinceId = useId();
  const districtId = useId();

  const districtOptions = provinceCode
    ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
    : [];

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setJustSaved(false);

    if (!isCompanyType(companyType)) {
      setFormError(getCompanyTypeFieldLabel(role) + " zorunludur.");
      return;
    }
    const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";

    setSubmitting(true);
    const result = await updateMyProfileRemote({
      fullName,
      phone,
      companyName,
      companyType,
      province: provinceName,
      district,
      currentRole: role,
    });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setJustSaved(true);
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Temel Bilgiler</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Ad Soyad, telefon ve firma bilgilerinizi güncelleyin.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6" noValidate>
        <div>
          <label htmlFor={fullNameId} className="text-sm font-medium text-foreground">
            Ad Soyad
          </label>
          <input
            id={fullNameId}
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div>
          <label htmlFor={phoneId} className="text-sm font-medium text-foreground">
            Telefon Numarası
          </label>
          <input
            id={phoneId}
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="05XX XXX XX XX"
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
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
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div>
          <label htmlFor={companyTypeId} className="text-sm font-medium text-foreground">
            {getCompanyTypeFieldLabel(role)}
          </label>
          <select
            id={companyTypeId}
            value={companyType}
            onChange={(event) => setCompanyType(event.target.value as CompanyType)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Seçiniz</option>
            {getCompanyTypeOptions(role).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <SearchableSelect
            id={provinceId}
            label="İl"
            options={provinces.map((item) => ({ value: item.code, label: item.name }))}
            value={provinceCode}
            onChange={(nextCode) => {
              setProvinceCode(nextCode);
              setDistrict("");
            }}
            placeholder="İl seçiniz"
          />
          <SearchableSelect
            id={districtId}
            label="İlçe"
            options={districtOptions}
            value={district}
            onChange={setDistrict}
            placeholder="İlçe seçiniz"
            disabled={!provinceCode}
            disabledHint="Önce il seçin"
          />
        </div>

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
        {justSaved && (
          <p role="status" aria-live="polite" className="text-sm font-medium text-success">
            Bilgileriniz güncellendi.
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? "Kaydediliyor..." : "Bilgilerimi Güncelle"}
          </button>
        </div>
      </form>
    </div>
  );
}
