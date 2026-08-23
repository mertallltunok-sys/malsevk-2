"use client";

import { Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  listCompaniesForAdmin,
  listServiceCategoryOptions,
  type AdminCompanyListItem,
  type ServiceCategoryOption,
} from "../_lib/admin-companies";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const DOCUMENT_STATUS_OPTIONS = [
  { value: "pending", label: "Bekleyen belgesi var" },
  { value: "approved", label: "Onaylı belgesi var" },
  { value: "rejected", label: "Reddedilmiş belgesi var" },
  { value: "revisionRequested", label: "Revizyon bekleyen belgesi var" },
] as const;

function accountStatusLabel(status: AdminCompanyListItem["accountStatus"]): string {
  return status === "active" ? "Aktif" : status === "suspended" ? "Askıya Alınmış" : "Yasaklı";
}

function documentSummaryDominantBadge(summary: AdminCompanyListItem["documentSummary"]) {
  if (summary.pending > 0) return { label: `${summary.pending} Bekliyor`, tone: "warning" as const };
  if (summary.revisionRequested > 0) return { label: `${summary.revisionRequested} Revizyon`, tone: "neutral" as const };
  if (summary.approved > 0) return { label: `${summary.approved} Onaylı`, tone: "success" as const };
  if (summary.rejected > 0) return { label: `${summary.rejected} Reddedildi`, tone: "danger" as const };
  return { label: "Belge yok", tone: "neutral" as const };
}

export function AdminCompaniesList() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<AdminCompanyListItem[]>([]);
  const [serviceCategories, setServiceCategories] = useState<ServiceCategoryOption[]>([]);

  const [search, setSearch] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [documentStatusFilter, setDocumentStatusFilter] = useState("");
  const [accountStatusFilter, setAccountStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void Promise.all([listCompaniesForAdmin(), listServiceCategoryOptions()]).then(([companiesResult, categoriesResult]) => {
      if (cancelled) return;
      setCompanies(companiesResult);
      setServiceCategories(categoriesResult);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
    return companies.filter((company) => {
      if (normalizedSearch) {
        const haystack = `${company.companyName ?? ""} ${company.fullName ?? ""}`.toLocaleLowerCase("tr-TR");
        if (!haystack.includes(normalizedSearch)) return false;
      }
      if (serviceFilter && !company.serviceCategoryLabels.includes(serviceFilter)) return false;
      if (documentStatusFilter) {
        const key = documentStatusFilter as keyof AdminCompanyListItem["documentSummary"];
        if (company.documentSummary[key] <= 0) return false;
      }
      if (accountStatusFilter === "active" && company.accountStatus !== "active") return false;
      if (accountStatusFilter === "inactive" && company.accountStatus === "active") return false;
      if (fromDate && company.createdAt < fromDate) return false;
      if (toDate && company.createdAt > `${toDate}T23:59:59`) return false;
      return true;
    });
  }, [companies, search, serviceFilter, documentStatusFilter, accountStatusFilter, fromDate, toDate]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/firmalar" />;
  }
  if (!isAdmin) {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Yükleniyor...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Firma adı veya yetkili kişi ara..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm hizmet türleri</option>
            {serviceCategories.map((category) => (
              <option key={category.id} value={category.name}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            value={documentStatusFilter}
            onChange={(event) => setDocumentStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Tüm belge durumları</option>
            {DOCUMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={accountStatusFilter}
            onChange={(event) => setAccountStatusFilter(event.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Aktif / Pasif (tümü)</option>
            <option value="active">Yalnız aktif</option>
            <option value="inactive">Yalnız pasif</option>
          </select>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label="Kayıt tarihi (başlangıç)"
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <span className="text-xs text-muted-foreground">–</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              aria-label="Kayıt tarihi (bitiş)"
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} firma bulundu.</p>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Firma Adı</th>
              <th className="px-4 py-3">Yetkili Kişi</th>
              <th className="px-4 py-3">Hizmet Türleri</th>
              <th className="px-4 py-3">Kayıt Tarihi</th>
              <th className="px-4 py-3">Belge Durumu</th>
              <th className="px-4 py-3">Hesap Durumu</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((company) => {
              const documentBadge = documentSummaryDominantBadge(company.documentSummary);
              return (
                <tr key={company.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium text-foreground">{company.companyName ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground">{company.fullName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {company.serviceCategoryLabels.length > 0 ? company.serviceCategoryLabels.join(", ") : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(company.createdAt).toLocaleDateString("tr-TR")}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={documentBadge.label} tone={documentBadge.tone} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={accountStatusLabel(company.accountStatus)}
                      tone={company.accountStatus === "active" ? "success" : "danger"}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/firmalar/${company.id}`}
                      className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Detay
                    </Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Arama/filtre kriterlerine uyan firma bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
