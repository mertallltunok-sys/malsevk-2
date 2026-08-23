"use client";

import { HelpCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listCompaniesForAdmin, type AdminCompanyListItem } from "../_lib/admin-companies";
import { getProviderAccessDiagnosis, type ProviderAccessDiagnosis, type ProviderCategoryAccessStatus } from "../_lib/admin-authorization-diagnostics";
import { SearchableSelect } from "./searchable-select";
import { StatusBadge } from "./status-badge";

const STATUS_LABEL: Record<ProviderCategoryAccessStatus, string> = {
  "hesap-askida": "Hesap Askıda",
  onayli: "Onaylı",
  "onay-bekliyor": "Onay Bekliyor",
  "ek-belge-gerekli": "Ek Belge Gerekli",
  reddedildi: "Reddedildi",
  "belge-yok": "Belge Yüklenmedi",
  "senkron-hatasi": "Senkron Hatası",
  yetkisiz: "Yetkisiz",
};

const STATUS_TONE: Record<ProviderCategoryAccessStatus, "success" | "warning" | "neutral" | "danger"> = {
  "hesap-askida": "danger",
  onayli: "success",
  "onay-bekliyor": "warning",
  "ek-belge-gerekli": "warning",
  reddedildi: "danger",
  "belge-yok": "neutral",
  "senkron-hatasi": "danger",
  yetkisiz: "neutral",
};

/**
 * FİRMA YETKİ KONTROLÜ (görev bölüm 10) — Yönetim Özeti'nde referans
 * görseldeki karta karşılık gelir. Firma listesi `listCompaniesForAdmin()`
 * (zaten var, `/admin/firmalar`in kendi veri kaynağı) ile bir kez çekilip
 * `SearchableSelect` (mevcut, Türkçe-duyarlı arama) ile filtrelenir — ikinci
 * bir canlı arama sorgusu AÇILMAZ. Seçim değiştiğinde gerçek tanı
 * `admin-authorization-diagnostics.ts`ten çekilir.
 */
export function AdminCompanyAuthorizationCheckCard() {
  const [companies, setCompanies] = useState<AdminCompanyListItem[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [diagnosis, setDiagnosis] = useState<ProviderAccessDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listCompaniesForAdmin().then((result) => {
      if (cancelled) return;
      setCompanies(result);
      setCompaniesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // `setDiagnosis(null)`/`setDiagnosisLoading(true)` BİLEREK burada değil,
  // `handleSelectProvider` (gerçek bir kullanıcı olayı — SearchableSelect
  // seçimi) içinde yapılır; bu proje `react-hooks/set-state-in-effect`
  // kuralını zorunlu kılar (bkz. admin-jobs-list.tsx'in AYNI deseni).
  useEffect(() => {
    if (!selectedProviderId) return;
    let cancelled = false;
    void getProviderAccessDiagnosis(selectedProviderId).then((result) => {
      if (cancelled) return;
      setDiagnosis(result);
      setDiagnosisLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProviderId]);

  function handleSelectProvider(providerId: string) {
    setSelectedProviderId(providerId);
    if (!providerId) {
      setDiagnosis(null);
      setDiagnosisLoading(false);
    } else {
      setDiagnosis(null);
      setDiagnosisLoading(true);
    }
  }

  const options = companies.map((company) => ({
    value: company.id,
    label: company.companyName ?? company.fullName ?? "İsimsiz Firma",
    hint: company.province ?? undefined,
  }));

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-base font-bold tracking-heading text-foreground">Firma Yetki Kontrolü</h2>
      <div className="mt-4">
        <SearchableSelect
          id="admin-authorization-check-company"
          label="Firma Ara"
          options={options}
          value={selectedProviderId}
          onChange={handleSelectProvider}
          placeholder={companiesLoading ? "Firmalar yükleniyor..." : "Firma seçin..."}
          disabled={companiesLoading}
        />
      </div>

      {selectedProviderId && diagnosisLoading && <p className="mt-4 text-sm text-muted-foreground">Yükleniyor...</p>}

      {selectedProviderId && !diagnosisLoading && diagnosis && (
        <div className="mt-5 flex flex-col gap-4">
          {diagnosis.accountStatus !== "active" && (
            <StatusBadge label="Hesap Askıda" tone="danger" />
          )}

          {diagnosis.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bu firma henüz hiçbir hizmet kategorisi seçmemiş.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {diagnosis.categories.map((category) => (
                <li key={category.serviceCategoryId} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-sm text-foreground" title={category.reasonText}>
                    {category.serviceCategoryLabel}
                  </span>
                  <StatusBadge label={STATUS_LABEL[category.status]} tone={STATUS_TONE[category.status]} />
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-start gap-2.5 rounded-md border border-accent/30 bg-accent-soft p-3.5">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-accent">Bu firma neden ilgili ilanları göremiyor?</p>
              <p className="mt-1 text-sm text-foreground">{diagnosis.summaryText}</p>
            </div>
          </div>

          <Link
            href={`/admin/firmalar/${selectedProviderId}`}
            className="text-sm font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent"
          >
            Firma Yetkilerini İncele →
          </Link>
        </div>
      )}
    </div>
  );
}
