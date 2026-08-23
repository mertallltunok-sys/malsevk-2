"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  OPERATION_BUCKET_LABEL,
  OPERATION_BUCKET_TONE,
  listOperationsForAdmin,
  type AdminOperationBucket,
  type AdminOperationListItem,
} from "../_lib/admin-operations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const TABS: { key: AdminOperationBucket | "tumu"; label: string }[] = [
  { key: "tumu", label: "Tümü" },
  { key: "bekleyen", label: "Bekleyen" },
  { key: "devam_eden", label: "Devam Eden" },
  { key: "tamamlanan", label: "Tamamlanan" },
  { key: "iptal", label: "İptal" },
  { key: "anlasmazlik", label: "Anlaşmazlık" },
];

function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

export function AdminOperationsList() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [operations, setOperations] = useState<AdminOperationListItem[]>([]);
  const [tab, setTab] = useState<AdminOperationBucket | "tumu">("tumu");

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listOperationsForAdmin().then((result) => {
      if (cancelled) return;
      setOperations(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { tumu: operations.length };
    for (const bucket of Object.keys(OPERATION_BUCKET_LABEL)) counts[bucket] = 0;
    for (const operation of operations) counts[operation.bucket] += 1;
    return counts;
  }, [operations]);

  const filtered = useMemo(() => (tab === "tumu" ? operations : operations.filter((operation) => operation.bucket === tab)), [operations, tab]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/operasyonlar" />;
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
      <nav aria-label="Operasyon durumu sekmeleri" className="flex flex-wrap gap-2 border-b border-border pb-3">
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
                {tabCounts[tabItem.key] ?? 0}
              </span>
            </button>
          );
        })}
      </nav>

      <p className="text-sm text-muted-foreground">{filtered.length} operasyon bulundu.</p>

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Operasyon No</th>
              <th className="px-4 py-3">Firma</th>
              <th className="px-4 py-3">Hizmet</th>
              <th className="px-4 py-3">Başlangıç</th>
              <th className="px-4 py-3">Durum</th>
              <th className="px-4 py-3">Son Güncelleme</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((operation) => (
              <tr key={operation.offerId} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-mono text-xs font-medium text-foreground">{shortId(operation.offerId)}</td>
                <td className="px-4 py-3 text-muted-foreground">{operation.providerCompanyName ?? operation.providerFullName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{operation.categoryLabel}</td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(operation.startedAt).toLocaleDateString("tr-TR")}</td>
                <td className="px-4 py-3">
                  <StatusBadge label={OPERATION_BUCKET_LABEL[operation.bucket]} tone={OPERATION_BUCKET_TONE[operation.bucket]} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{new Date(operation.updatedAt).toLocaleString("tr-TR")}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/operasyonlar/${operation.offerId}`}
                    className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Detay
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Bu sekmede görüntülenecek operasyon bulunamadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
