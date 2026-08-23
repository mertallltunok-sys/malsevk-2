"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getProviderDocumentTypeLabel } from "../_lib/provider-documents";
import { getProviderAuthorizationGroupByDocumentType, getServiceCategoryLabel } from "../_lib/service-catalog";
import {
  listAllProviderDocumentsForAdminRemote,
  type AdminProviderDocumentEntry,
  type RemoteProviderDocumentReviewStatus,
} from "../_lib/supabase-provider-document-review";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

type TabKey = "pending" | "approved" | "rejected" | "revision_requested" | "all";

const TABS: { key: TabKey; label: string }[] = [
  { key: "pending", label: "Bekleyen" },
  { key: "approved", label: "Onaylanan" },
  { key: "rejected", label: "Reddedilen" },
  { key: "revision_requested", label: "Revizyon Bekleyen" },
  { key: "all", label: "Tümü" },
];

const STATUS_LABEL: Record<RemoteProviderDocumentReviewStatus, string> = {
  pending: "Bekliyor",
  approved: "Onaylandı",
  rejected: "Reddedildi",
  revision_requested: "Revizyon Bekliyor",
  superseded: "Yenisiyle Değiştirildi",
};
const STATUS_TONE: Record<RemoteProviderDocumentReviewStatus, "success" | "warning" | "neutral" | "danger"> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  revision_requested: "neutral",
  superseded: "neutral",
};

export function AdminCompanyDocumentsPanel() {
  const session = useSession();
  const isAdmin = session?.role === "admin";
  const searchParams = useSearchParams();
  const companyFilterId = searchParams.get("firma");

  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<AdminProviderDocumentEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("pending");

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listAllProviderDocumentsForAdminRemote().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setDocuments(result.documents);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const filtered = useMemo(() => {
    return documents.filter((doc) => {
      if (companyFilterId && doc.providerId !== companyFilterId) return false;
      if (tab === "all") return true;
      return doc.currentReviewStatus === tab;
    });
  }, [documents, tab, companyFilterId]);

  const tabCounts = useMemo(() => {
    const scoped = companyFilterId ? documents.filter((doc) => doc.providerId === companyFilterId) : documents;
    return {
      pending: scoped.filter((doc) => doc.currentReviewStatus === "pending").length,
      approved: scoped.filter((doc) => doc.currentReviewStatus === "approved").length,
      rejected: scoped.filter((doc) => doc.currentReviewStatus === "rejected").length,
      revision_requested: scoped.filter((doc) => doc.currentReviewStatus === "revision_requested").length,
      all: scoped.length,
    } satisfies Record<TabKey, number>;
  }, [documents, companyFilterId]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/firma-belgeleri" />;
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
  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {companyFilterId && (
        <div className="rounded-md border border-accent/30 bg-accent-soft px-4 py-2 text-sm text-accent">
          Yalnızca seçili firmanın belgeleri gösteriliyor.{" "}
          <Link href="/admin/firma-belgeleri" className="font-medium underline underline-offset-2">
            Tüm firmaları göster
          </Link>
        </div>
      )}

      <nav aria-label="Belge durumu sekmeleri" className="flex flex-wrap gap-2 border-b border-border pb-3">
        {TABS.map((tabItem) => {
          const active = tab === tabItem.key;
          return (
            <button
              key={tabItem.key}
              type="button"
              onClick={() => setTab(tabItem.key)}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"
              }`}
            >
              {tabItem.label}
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1 text-[11px] font-semibold text-muted-foreground">
                {tabCounts[tabItem.key]}
              </span>
            </button>
          );
        })}
      </nav>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Bu sekmede belge bulunmuyor.</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Firma Adı</th>
                <th className="px-4 py-3">Belge Türü</th>
                <th className="px-4 py-3">Hizmet</th>
                <th className="px-4 py-3">Dosya Adı</th>
                <th className="px-4 py-3">Yüklenme Tarihi</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((doc) => (
                <tr key={doc.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium text-foreground">{doc.providerCompanyName ?? doc.providerName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{getProviderDocumentTypeLabel(doc.documentType)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {doc.serviceCategoryId
                      ? (getServiceCategoryLabel(doc.serviceCategoryId) ?? doc.serviceCategoryId)
                      : (getProviderAuthorizationGroupByDocumentType(doc.documentType)?.label ?? "—")}
                  </td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={doc.originalFileName}>
                    {doc.originalFileName}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(doc.uploadedAt).toLocaleDateString("tr-TR")}</td>
                  <td className="px-4 py-3">
                    <StatusBadge label={STATUS_LABEL[doc.currentReviewStatus]} tone={STATUS_TONE[doc.currentReviewStatus]} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/firma-belgeleri/${doc.id}`}
                      className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      İncele
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
