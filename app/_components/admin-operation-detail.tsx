"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { OPERATION_BUCKET_LABEL, OPERATION_BUCKET_TONE, getOperationDetailForAdmin, type AdminOperationDetail } from "../_lib/admin-operations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const OFFER_STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  accepted: "Kabul Edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri Çekildi",
  in_progress: "Devam Ediyor",
  agreement_failed: "Anlaşma Sağlanamadı",
  completion_requested: "Tamamlama Onayı Bekliyor",
  completion_disputed: "İtiraz Sürecinde",
  completed: "Tamamlandı",
  cancelled: "İptal Edildi",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function AdminOperationDetail({ offerId }: { offerId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState<AdminOperationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getOperationDetailForAdmin(offerId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result) {
        setNotFound(true);
        return;
      }
      setOperation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, offerId]);

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/operasyonlar/${offerId}`} />;
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
  if (notFound || !operation) {
    return <p className="text-sm text-muted-foreground">Operasyon bulunamadı.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">{operation.jobTitle}</h2>
            <p className="text-sm text-muted-foreground">{operation.categoryLabel}</p>
          </div>
          <StatusBadge label={OPERATION_BUCKET_LABEL[operation.bucket]} tone={OPERATION_BUCKET_TONE[operation.bucket]} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Teklif Durumu" value={OFFER_STATUS_LABEL[operation.status] ?? operation.status} />
          <InfoRow label="Teklif Tutarı" value={`${operation.amount.toLocaleString("tr-TR")} ${operation.currency}`} />
          <InfoRow label="Başlangıç" value={new Date(operation.startedAt).toLocaleString("tr-TR")} />
          <InfoRow label="Son Güncelleme" value={new Date(operation.updatedAt).toLocaleString("tr-TR")} />
          <InfoRow label="İlan" value={operation.jobTitle} />
          {operation.operationId && <InfoRow label="Operasyon Grubu" value={operation.operationId.slice(0, 8).toUpperCase()} />}
        </div>

        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Teklif Açıklaması</p>
          <p className="mt-1 text-sm text-foreground">{operation.description}</p>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Bu ekran salt görüntülemedir — durum geçişleri yalnızca ilgili taraflar (hizmet veren/hizmet alan) tarafından uygulama içinden
          yapılabilir, admin buradan durum değiştiremez.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-card border border-border bg-surface p-6">
          <h3 className="text-base font-bold tracking-heading text-foreground">Hizmet Veren</h3>
          <div className="mt-3 flex flex-col gap-2">
            <InfoRow label="Firma Adı" value={operation.providerCompanyName ?? "—"} />
            <InfoRow label="Yetkili Kişi" value={operation.providerFullName ?? "—"} />
            <InfoRow label="Telefon" value={operation.providerPhone ?? "—"} />
          </div>
        </div>
        <div className="rounded-card border border-border bg-surface p-6">
          <h3 className="text-base font-bold tracking-heading text-foreground">Hizmet Alan</h3>
          <div className="mt-3 flex flex-col gap-2">
            <InfoRow label="Firma Adı" value={operation.requesterCompanyName ?? "—"} />
            <InfoRow label="Yetkili Kişi" value={operation.requesterFullName ?? "—"} />
            <InfoRow label="Telefon" value={operation.requesterPhone ?? "—"} />
          </div>
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold tracking-heading text-foreground">İlan</h3>
          <Link href={`/admin/ilanlar/${operation.jobId}`} className="text-xs font-medium text-accent underline underline-offset-2">
            İlan Yönetimi&apos;nde Görüntüle
          </Link>
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Tarihçe</h3>
        {operation.history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Bu teklif için henüz bir durum geçmişi kaydı yok.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {operation.history.map((entry) => (
              <li key={entry.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {entry.previousStatus ? `${OFFER_STATUS_LABEL[entry.previousStatus] ?? entry.previousStatus} → ` : ""}
                    {OFFER_STATUS_LABEL[entry.newStatus] ?? entry.newStatus}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("tr-TR")}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.changedByName ? `${entry.changedByName} tarafından` : "Sistem tarafından"}</p>
                {entry.reason && <p className="mt-1 text-sm text-muted-foreground">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
