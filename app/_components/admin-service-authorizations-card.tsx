"use client";

import { AlertTriangle, Loader2, MailPlus, ShieldCheck, ShieldOff } from "lucide-react";
import { useState } from "react";
import {
  authorizeProviderServiceAsAdmin,
  requestProviderDocumentAsAdmin,
  revokeProviderServiceAuthorizationAsAdmin,
  type ServiceAuthorizationRow,
} from "../_lib/admin-companies";
import { StatusBadge } from "./status-badge";

/**
 * "Hizmet Yetkileri" kartı — HİZMET BAZLI PROVIDER YETKİLENDİRMESİ (migration
 * 0038) admin panelinin tek yazma yüzeyi. `admin-company-detail.tsx`'in eski
 * "Rozet Durumu" satırının YERİNE geçer (bkz. o dosyadaki değişiklik) —
 * Mavi/Altın Tik dekoratif bir göstergeydi, bu kart ise GERÇEK bir
 * yetkilendirme eylemidir (authorize_provider_service/revoke_provider_
 * service_authorization RPC'leri).
 *
 * Her satır görev bölüm 26'nın istediği görünümü tek yerde taşır: hizmet adı,
 * kullanıcı seçti mi, belge durumu, yetki durumu, aksiyon. Belge durumu
 * `admin-companies.ts#getServiceAuthorizationsForAdmin`in ZATEN çözdüğü
 * "hangi belge bu hizmeti destekliyor" eşlemesinden gelir — burada ikinci
 * bir eşleme mantığı YAZILMAZ.
 */

const DOCUMENT_STATUS_LABEL: Record<ServiceAuthorizationRow["documentStatus"], string> = {
  approved: "Onaylandı",
  pending: "İnceleniyor",
  rejected: "Reddedildi",
  revision_requested: "Revizyon İstendi",
  none: "Belge Yok",
};

const DOCUMENT_STATUS_TONE: Record<ServiceAuthorizationRow["documentStatus"], "success" | "warning" | "danger" | "neutral"> = {
  approved: "success",
  pending: "warning",
  rejected: "danger",
  revision_requested: "warning",
  none: "neutral",
};

function ServiceAuthorizationRowItem({
  providerId,
  row,
  onChanged,
}: {
  providerId: string;
  row: ServiceAuthorizationRow;
  onChanged: () => void;
}) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  async function handleRequestDocument() {
    setSubmitting(true);
    setError(null);
    const result = await requestProviderDocumentAsAdmin(providerId, row.serviceCategoryId);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRequestSent(true);
  }

  async function handleAuthorize() {
    setSubmitting(true);
    setError(null);
    const result = await authorizeProviderServiceAsAdmin(providerId, row.serviceCategoryId, row.documentId ?? undefined);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  }

  async function handleRevoke() {
    if (revokeReason.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    const result = await revokeProviderServiceAuthorizationAsAdmin(providerId, row.serviceCategoryId, revokeReason);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRevokeOpen(false);
    setRevokeReason("");
    onChanged();
  }

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{row.serviceCategoryLabel}</p>
          <p className="text-xs text-muted-foreground">{row.selected ? "Kullanıcı seçti" : "Kullanıcı seçmedi"}</p>
        </div>
        <StatusBadge label={DOCUMENT_STATUS_LABEL[row.documentStatus]} tone={DOCUMENT_STATUS_TONE[row.documentStatus]} />
        <StatusBadge label={row.authorized ? "Yetkili" : "Yetkisiz"} tone={row.authorized ? "success" : "neutral"} />
        <div className="flex items-center gap-2 justify-self-end">
          {!row.authorized && row.documentStatus === "none" && (
            <button
              type="button"
              onClick={() => void handleRequestDocument()}
              disabled={submitting || requestSent}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <MailPlus className="h-3.5 w-3.5" aria-hidden="true" />
              {requestSent ? "Talep Gönderildi" : "Belge Talep Et"}
            </button>
          )}
          {!row.authorized ? (
            <button
              type="button"
              onClick={() => void handleAuthorize()}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              Yetkilendir
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setRevokeOpen((open) => !open)}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />
              Yetkiyi Kaldır
            </button>
          )}
        </div>
      </div>

      {row.documentFileName && (
        <p className="mt-2 text-xs text-muted-foreground">
          Belge: {row.documentFileName}
          {row.documentReviewNote ? ` — ${row.documentReviewNote}` : ""}
        </p>
      )}
      {/*
       * SAĞLIK UYARISI (proje raporu, "Belge Onayı / Hizmet Yetkilendirme
       * Senkron Sorunu"): migration 0041'den SONRA bu durum (belge onaylı +
       * yetki yok) yalnızca review_provider_document'in kendi best-effort
       * bloğu başarısız olursa oluşabilir — teorik olarak nadir, ama
       * SESSİZCE geçilmemeli. Admin'e "Yetkilendir" butonuna zaten basılabilir
       * olduğunu tekrarlamak yerine BUNUN normalde OTOMATİK olması gerektiğini
       * ve olmadığını açıkça söyler.
       */}
      {row.documentStatus === "approved" && !row.authorized && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Belge onaylı ama otomatik yetkilendirme oluşmadı — beklenmeyen bir tutarsızlık, aşağıdan manuel
          yetkilendirebilirsiniz.
        </p>
      )}
      {row.revokedAt && !row.authorized && (
        <p className="mt-2 text-xs text-danger">
          {new Date(row.revokedAt).toLocaleDateString("tr-TR")} tarihinde kaldırıldı{row.revokeReason ? `: ${row.revokeReason}` : "."}
        </p>
      )}

      {revokeOpen && (
        <div className="mt-3 rounded-md border border-border bg-surface p-3">
          <label className="text-xs font-medium text-foreground">
            Kaldırma nedeni (zorunlu)
            <textarea
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Örn. faaliyet belgesi bulunmuyor, firma problemi..."
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRevoke()}
              disabled={submitting || revokeReason.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Onayla
            </button>
            <button type="button" onClick={() => setRevokeOpen(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
              İptal
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function AdminServiceAuthorizationsCard({
  providerId,
  rows,
  onChanged,
}: {
  providerId: string;
  rows: ServiceAuthorizationRow[];
  onChanged: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h3 className="text-base font-bold tracking-heading text-foreground">Hizmet Yetkileri</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Kullanıcının kayıt sırasında SEÇTİĞİ hizmetler, admin tarafından ONAYLANMIŞ hizmetlerle aynı şey değildir —
        her hizmet bağımsız olarak yetkilendirilir/kaldırılır. Yetkisi olmayan bir hizmetin ilanlarını provider hiç
        göremez, teklif veremez.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Bu firma henüz hiçbir hizmet seçmedi.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {rows.map((row) => (
            <ServiceAuthorizationRowItem key={row.serviceCategoryId} providerId={providerId} row={row} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  );
}
