"use client";

import { Loader2, PencilLine, ShieldOff, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getRequesterDetailForAdmin,
  reinstateRequesterRemote,
  suspendRequesterRemote,
  updateRequesterProfileAsAdmin,
  type AdminRequesterListItem,
} from "../_lib/admin-requesters";
import { useSession } from "../_lib/use-session";
import { AdminProfileEditForm } from "./admin-profile-edit-form";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const COMPANY_TYPE_LABEL: Record<string, string> = {
  bireysel: "Bireysel",
  "sahis-isletmesi": "Şahıs İşletmesi",
  "limited-sirket": "Limited Şirket",
  "anonim-sirket": "Anonim Şirket",
  diger: "Diğer",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function AdminRequesterDetail({ userId }: { userId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [requester, setRequester] = useState<AdminRequesterListItem | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Askıya alma akışı: gerekçe zorunlu (RPC'nin kendisi boş bırakmıyor değil, ama anlamlı bir denetim kaydı için burada zorunlu tutulur).
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  // Geri açma akışı: reinstate_user RPC'sinde gerekçe parametresi hiç yok — yalnızca tek adımlık bir onay adımı.
  const [reinstateConfirmOpen, setReinstateConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getRequesterDetailForAdmin(userId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result) {
        setNotFound(true);
        return;
      }
      setRequester(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, userId, refreshKey]);

  async function handleSuspend() {
    if (suspendReason.trim().length === 0) return;
    setSubmitting(true);
    setActionError(null);
    const result = await suspendRequesterRemote(userId, suspendReason);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setSuspendOpen(false);
    setSuspendReason("");
    refresh();
  }

  async function handleReinstate() {
    setSubmitting(true);
    setActionError(null);
    const result = await reinstateRequesterRemote(userId);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setReinstateConfirmOpen(false);
    refresh();
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/hizmet-alanlar/${userId}`} />;
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
  if (notFound || !requester) {
    return <p className="text-sm text-muted-foreground">Hizmet alan kullanıcı bulunamadı.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-heading leading-tight text-foreground">{requester.fullName ?? "İsimsiz Kullanıcı"}</h2>
            <p className="text-sm text-muted-foreground">{requester.companyName ?? "—"}</p>
          </div>
          <StatusBadge
            label={requester.accountStatus === "active" ? "Aktif" : requester.accountStatus === "suspended" ? "Askıya Alınmış" : "Yasaklı"}
            tone={requester.accountStatus === "active" ? "success" : "danger"}
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Firma Türü" value={requester.companyType ? (COMPANY_TYPE_LABEL[requester.companyType] ?? requester.companyType) : "—"} />
          <InfoRow label="Kayıt Tarihi" value={new Date(requester.createdAt).toLocaleDateString("tr-TR")} />
          <InfoRow label="İl / İlçe" value={[requester.province, requester.district].filter(Boolean).join(" / ") || "—"} />
          <InfoRow label="Telefon" value={requester.phone ?? "—"} />
        </div>
      </div>

      {/* Profil Bilgileri + Hesap İşlemleri — admin-company-detail.tsx ile AYNI
          yan-yana desen (masaüstü genişlik/yoğunluk düzeltmesi). */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold tracking-heading text-foreground">Profil Bilgileri</h3>
          <button
            type="button"
            onClick={() => setEditOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            Profili Düzenle
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Ad Soyad, telefon, firma adı/türü ve il/ilçe bilgilerindeki hataları düzeltin. Değişiklik admin işlem
          geçmişine (audit log) kaydedilir.
        </p>
        {editOpen && (
          <AdminProfileEditForm
            userId={userId}
            initial={{
              fullName: requester.fullName ?? "",
              phone: requester.phone ?? "",
              companyName: requester.companyName ?? "",
              companyType: requester.companyType ?? "bireysel",
              province: requester.province ?? "",
              district: requester.district ?? "",
            }}
            onSave={updateRequesterProfileAsAdmin}
            onSaved={() => {
              setEditOpen(false);
              refresh();
            }}
            onCancel={() => setEditOpen(false)}
          />
        )}
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Hesap İşlemleri</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Askıya alma/geri açma, mevcut <code>suspend_user</code>/<code>reinstate_user</code> RPC&apos;lerini kullanır ve admin işlem geçmişine
          (audit log) otomatik olarak kaydedilir.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {requester.accountStatus === "active" ? (
            <button
              type="button"
              onClick={() => {
                setSuspendOpen((open) => !open);
                setReinstateConfirmOpen(false);
                setActionError(null);
              }}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldOff className="h-4 w-4" aria-hidden="true" />
              Askıya Al
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setReinstateConfirmOpen((open) => !open);
                setSuspendOpen(false);
                setActionError(null);
              }}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-4 py-2 text-sm font-medium text-success transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Askıyı Kaldır
            </button>
          )}
        </div>

        {suspendOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="admin-requester-suspend-reason">
              Askıya alma nedeni (zorunlu)
            </label>
            <textarea
              id="admin-requester-suspend-reason"
              value={suspendReason}
              onChange={(event) => setSuspendReason(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Hesap neden askıya alınıyor?"
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSuspend()}
                disabled={submitting || suspendReason.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Onayla
              </button>
              <button
                type="button"
                onClick={() => {
                  setSuspendOpen(false);
                  setSuspendReason("");
                }}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {reinstateConfirmOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <p className="text-sm text-foreground">Bu hesabın askısını kaldırıp yeniden aktif hale getirmek istediğinize emin misiniz?</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReinstate()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Evet, Askıyı Kaldır
              </button>
              <button type="button" onClick={() => setReinstateConfirmOpen(false)} className="text-sm font-medium text-muted-foreground hover:text-foreground">
                İptal
              </button>
            </div>
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}
      </div>
      </div>
    </div>
  );
}
