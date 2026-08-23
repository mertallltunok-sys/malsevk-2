"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getApprovalCenterItems, type ApprovalCenterItem } from "../_lib/admin-approval-center";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

type FilterKey = "tumu" | "belge" | "ilan" | "ek-belge" | "oncelikli";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "tumu", label: "Tümü" },
  { key: "belge", label: "Belgeler" },
  { key: "ilan", label: "İlanlar" },
  { key: "ek-belge", label: "Ek Belge" },
  { key: "oncelikli", label: "Öncelikli" },
];

function matchesFilter(item: ApprovalCenterItem, filter: FilterKey): boolean {
  switch (filter) {
    case "tumu":
      return true;
    case "belge":
      return item.kind === "belge";
    case "ilan":
      return item.kind === "ilan";
    case "ek-belge":
      return item.isAdditionalDocumentFollowUp;
    case "oncelikli":
      return item.isPriority;
  }
}

function formatWaitingSince(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "az önce";
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  return `${days} gün`;
}

/**
 * ONAY MERKEZİ — görev bölüm 8: "Bu ekran yeni bir onay kaydı sistemi
 * ÜRETMESİN." Bu ekran salt-okunur bir birleştirilmiş görünümdür; her satırın
 * "İncele" bağlantısı mevcut belge/ilan admin detay ekranına gider, karar
 * (onayla/reddet/ek belge iste) HER ZAMAN o ekranlarda, mevcut RPC'ler
 * üzerinden verilir.
 */
export function AdminApprovalCenterContent() {
  const session = useSession();
  const isAdmin = session?.role === "admin";
  const [filter, setFilter] = useState<FilterKey>("tumu");
  const [items, setItems] = useState<ApprovalCenterItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    // `loading` başlangıç değeri zaten `true` — bu effect yalnızca mount'ta
    // ([isAdmin] bağımlılığı) çalışır, bu yüzden burada senkron bir
    // `setLoading(true)` çağrısına gerek yoktur (bkz. admin-jobs-list.tsx'in
    // AYNI `react-hooks/set-state-in-effect` kısıtına uyan deseni).
    void getApprovalCenterItems()
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Onay kuyruğu yüklenemedi. Lütfen tekrar deneyin.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/onay-merkezi" />;
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
  if (error || !items) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error ?? "Onay kuyruğu yüklenemedi."}
      </div>
    );
  }

  const visibleItems = items.filter((item) => matchesFilter(item, filter));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const count = items.filter((item) => matchesFilter(item, option.key)).length;
          const active = filter === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setFilter(option.key)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                active ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"
              }`}
            >
              {option.label}
              <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold ${active ? "bg-white/20" : "bg-accent-soft text-accent"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {items.length === 0 ? "Bekleyen hiçbir onay işlemi yok." : "Bu filtreye uyan bekleyen işlem yok."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {visibleItems.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="rounded-card border border-border bg-surface p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{item.title}</p>
                    {item.isPriority && <StatusBadge label="Öncelikli" tone="danger" />}
                    {item.isAdditionalDocumentFollowUp && <StatusBadge label="Ek Belge" tone="neutral" />}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.subjectName}
                    {item.categoryLabel && ` · ${item.categoryLabel}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Bekleme süresi</p>
                    <p className="text-sm font-medium text-foreground">{formatWaitingSince(item.waitingSinceIso)}</p>
                  </div>
                  <StatusBadge label={item.kind === "belge" ? "Belge" : "İlan"} tone={item.kind === "belge" ? "neutral" : "warning"} />
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    İncele
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
