"use client";

import { AlertTriangle, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AUDIT_ENTITY_TYPE_FILTER_OPTIONS,
  getAuditEntityTypeLabel,
  listHumanizedAdminAuditLog,
  type HumanizedAuditEntry,
} from "../_lib/admin-audit-log";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";

/**
 * İŞLEM GEÇMİŞİ (görev bölüm 19) — `admin-audit-log.ts`nin ürettiği
 * humanize edilmiş cümleleri listeler. Ham `action`/`entity_type` yalnızca
 * bir satır genişletildiğinde ("Teknik Detay") görünür, ana listede ASLA.
 */
export function AdminAuditLogContent() {
  const session = useSession();
  const isAdmin = session?.role === "admin";
  const [entries, setEntries] = useState<HumanizedAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // `setLoading(true)` BİLEREK burada değil, gerçek kullanıcı olaylarında
  // (filtre değişimi/"Yenile" butonu) tetiklenir — bu proje
  // `react-hooks/set-state-in-effect` kuralını zorunlu kılar (bkz.
  // admin-jobs-list.tsx'in AYNI deseni).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listHumanizedAdminAuditLog({ entityType: entityTypeFilter || undefined })
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("İşlem geçmişi yüklenemedi. Lütfen tekrar deneyin.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, entityTypeFilter, refreshKey]);

  function handleRefresh() {
    setLoading(true);
    setError(null);
    setRefreshKey((key) => key + 1);
  }

  function handleEntityTypeFilterChange(value: string) {
    setLoading(true);
    setError(null);
    setEntityTypeFilter(value);
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/islem-gecmisi" />;
  }
  if (!isAdmin) {
    return <AuthGateNotice message="Bu sayfa yalnızca yöneticiler içindir." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={entityTypeFilter}
          onChange={(event) => handleEntityTypeFilterChange(event.target.value)}
          className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">Tüm Kayıt Türleri</option>
          {AUDIT_ENTITY_TYPE_FILTER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRefresh}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Yenile
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor...
        </div>
      )}
      {!loading && (error || !entries) && (
        <div className="flex items-center gap-2 rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error ?? "İşlem geçmişi yüklenemedi."}
        </div>
      )}
      {!loading && entries && entries.length === 0 && (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted-foreground">Henüz kayıtlı bir yönetici işlemi yok.</p>
        </div>
      )}
      {!loading && entries && entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <li key={entry.id} className="rounded-card border border-border bg-surface p-4">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  className="flex w-full items-start justify-between gap-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{entry.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.actorName ?? "Bilinmeyen yönetici"} · {new Date(entry.createdAtIso).toLocaleString("tr-TR")}
                    </p>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {expanded && (
                  <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    <p>
                      Teknik işlem: <span className="font-mono">{entry.action}</span>
                    </p>
                    <p>
                      Kayıt türü: {getAuditEntityTypeLabel(entry.entityType)}
                      {entry.entityId ? ` (${entry.entityId})` : ""}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
