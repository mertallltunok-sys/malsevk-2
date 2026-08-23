"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

/**
 * Admin Profil Düzenleme — `admin-company-detail.tsx` ("Firmalar") ve
 * `admin-requester-detail.tsx` ("Hizmet Alanlar") tarafından PAYLAŞILAN TEK
 * form. İkisi de `update_profile_as_admin` (0036) RPC'sinin AYNI 6 alanını
 * (full_name/phone/company_name/company_type/province/district) düzenler —
 * form/doğrulama/düzen (layout) birebir aynı olduğu için iki ayrı kopya
 * yerine tek, paylaşılan bir bileşen olarak tutulur (ikinci bir "admin ilan
 * formu" yerine `AdminJobEditForm`in tek başına kalması gibi AYNI ilke).
 * Kaydetme fonksiyonu (`onSave`) prop olarak alınır — `admin-companies.ts#
 * updateCompanyProfileAsAdmin` ile `admin-requesters.ts#
 * updateRequesterProfileAsAdmin`in ikisi de AYNI imzayı (userId, input) =>
 * Promise<ActionResult> taşıdığı için burada tek bir tip tekrar İCAT
 * EDİLMEZ, çağıran modülün kendi tipi kullanılır.
 */
export type AdminProfileEditFormValues = {
  fullName: string;
  phone: string;
  companyName: string;
  companyType: string;
  province: string;
  district: string;
};

const COMPANY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "bireysel", label: "Bireysel" },
  { value: "sahis-isletmesi", label: "Şahıs İşletmesi" },
  { value: "limited-sirket", label: "Limited Şirket" },
  { value: "anonim-sirket", label: "Anonim Şirket" },
  { value: "diger", label: "Diğer" },
];

export function AdminProfileEditForm({
  userId,
  initial,
  onSave,
  onSaved,
  onCancel,
}: {
  userId: string;
  initial: AdminProfileEditFormValues;
  onSave: (userId: string, input: AdminProfileEditFormValues) => Promise<{ ok: true } | { ok: false; error: string }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [companyType, setCompanyType] = useState(initial.companyType || "bireysel");
  const [province, setProvince] = useState(initial.province);
  const [district, setDistrict] = useState(initial.district);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid = fullName.trim().length > 0 && companyName.trim().length > 0 && province.trim().length > 0 && district.trim().length > 0;

  async function handleSubmit() {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    const result = await onSave(userId, { fullName, phone, companyName, companyType, province, district });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-md border border-border bg-background p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          Ad Soyad
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          Telefon
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="05XX XXX XX XX"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          Firma Adı
          <input
            type="text"
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          Firma Türü
          <select
            value={companyType}
            onChange={(event) => setCompanyType(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {COMPANY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          İl
          <input
            type="text"
            value={province}
            onChange={(event) => setProvince(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
          İlçe
          <input
            type="text"
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !isValid}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Değişiklikleri Kaydet
        </button>
        <button type="button" onClick={onCancel} className="text-sm font-medium text-muted-foreground hover:text-foreground">
          İptal
        </button>
      </div>
    </div>
  );
}
