"use client";

import { Ban, CheckCircle2, Loader2, PencilLine, RefreshCw, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  JOB_STATUS_LABEL,
  JOB_STATUS_TONE,
  approveJobAsAdmin,
  getAdminJobCargoGroups,
  getJobDetailForAdmin,
  rejectJobAsAdmin,
  unpublishJobAsAdmin,
  type AdminJobDetail,
} from "../_lib/admin-jobs";
import { JOB_CLOSURE_REASON_OPTIONS, getJobClosureReasonLabel, isJobClosureReason } from "../_lib/job-closure";
import { getJobModerationStatusLabel, getJobModerationStatusTone } from "../_lib/job-moderation";
import { formatCargoGroupTitle } from "../_lib/nakliye-cargo-groups";
import {
  formatContainerContentSummary,
  formatContainerTransportSummary,
  formatHazmatSummary,
  formatLoadingMethodSummary,
  formatLoadPreparationSummary,
  formatMeasurementSummary,
  formatNakliyeQuantity,
  getProductQuantityFieldConfig,
} from "../_lib/nakliye-transport-catalog";
import { isTransportationCategory } from "../_lib/product-catalog";
import {
  getRecyclingMaterialConditionLabel,
  getRecyclingMaterialTypeDetailLine,
  getRecyclingMaterialTypeLabel,
  getRecyclingRequestedOperationLabel,
  getRecyclingScopeOfWorkLabels,
} from "../_lib/recycling-catalog";
import {
  deriveWasteCodeHazardous,
  formatWasteCodeForDisplay,
  getWasteCodeEntry,
  getWasteHazardPropertyLabel,
} from "../_lib/recycling-waste-code-catalog";
import { getStorageRiskGroupLabel } from "../_lib/storage-hazard-catalog";
import type { JobClosureReason } from "../_lib/types";
import { useSession } from "../_lib/use-session";
import { AdminJobEditForm } from "./admin-job-edit-form";
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

export function AdminJobDetail({ jobId }: { jobId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<AdminJobDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [unpublishReason, setUnpublishReason] = useState<JobClosureReason>("hizmete-ihtiyac-kalmadi");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // İlan Onayı (bkz. job-moderation.ts) — "İlanı Düzenle"/"İlanı Reddet"in
  // AYNI inline-genişleyen kutu deseni (admin-company-detail.tsx#Hesap
  // İşlemleri ile aynı), ayrı bir modal/dialog bileşeni İCAT EDİLMEDİ.
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [moderationSubmitting, setModerationSubmitting] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getJobDetailForAdmin(jobId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result) {
        setNotFound(true);
        return;
      }
      setJob(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, jobId, refreshKey]);

  async function handleUnpublish() {
    setSubmitting(true);
    setActionError(null);
    const result = await unpublishJobAsAdmin(jobId, unpublishReason);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setUnpublishOpen(false);
    setUnpublishReason("hizmete-ihtiyac-kalmadi");
    refresh();
  }

  async function handleApprove() {
    if (!job) return;
    setModerationSubmitting(true);
    setModerationError(null);
    const result = await approveJobAsAdmin(jobId, job.updatedAt);
    setModerationSubmitting(false);
    if (!result.ok) {
      setModerationError(result.error);
      return;
    }
    refresh();
  }

  async function handleReject() {
    if (!job || rejectReason.trim().length === 0) return;
    setModerationSubmitting(true);
    setModerationError(null);
    const result = await rejectJobAsAdmin(jobId, rejectReason, job.updatedAt);
    setModerationSubmitting(false);
    if (!result.ok) {
      setModerationError(result.error);
      return;
    }
    setRejectOpen(false);
    setRejectReason("");
    refresh();
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/ilanlar/${jobId}`} />;
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
  if (notFound || !job) {
    return <p className="text-sm text-muted-foreground">İlan bulunamadı.</p>;
  }

  const canUnpublish = job.closedAt === null && job.status !== "tamamlandi" && job.status !== "devam_ediyor";
  const isNakliyeJob = isTransportationCategory(job.categoryId);
  // "Nakliye Çoklu Yük Grubu" görevi — Ürün Adedi/Tonaj/Cinsi/Yükün
  // Hazırlanış Biçimi/Ölçü ve Yerleşim/Konteyner Taşıması artık BURADA (job
  // seviyesinde, TEK) DEĞİL, aşağıda grup başına ayrı ayrı gösterilir (bkz.
  // admin-jobs.ts#getAdminJobCargoGroups). Yükleme Yöntemi/Tehlikeli
  // Madde-ADR bu görevin kapsamı DIŞINDA — job seviyesinde, TEK kalmaya
  // devam eder.
  const nakliyeCargoGroups = isNakliyeJob ? getAdminJobCargoGroups(job) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">{job.title}</h2>
            <p className="text-sm text-muted-foreground">{job.categoryLabel}</p>
          </div>
          <StatusBadge label={JOB_STATUS_LABEL[job.status]} tone={JOB_STATUS_TONE[job.status]} />
        </div>

        {job.photos.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-3">
            {job.photos.map((photo) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={photo.id}
                src={photo.url}
                alt={photo.originalFileName}
                className="h-24 w-24 rounded-md border border-border object-cover"
              />
            ))}
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="İl / İlçe" value={`${job.province} / ${job.district}`} />
          <InfoRow label="Bölge / Tesis" value={job.workLocationType || "—"} />
          <InfoRow label="Adres" value={job.addressText || "—"} />
          {job.neighborhood && <InfoRow label="Bölge / Mahalle" value={job.neighborhood} />}
          {job.locationUrl && <InfoRow label="Konum Bağlantısı" value={job.locationUrl} />}
          {job.directionsNote && <InfoRow label="Adres Tarifi" value={job.directionsNote} />}
          <InfoRow label="İş Tarihi" value={job.workEndDate ? `${job.workDate} – ${job.workEndDate}` : job.workDate} />
          {!isNakliyeJob && job.productQuantity !== null && <InfoRow label="Ürün Adedi" value={String(job.productQuantity)} />}
          {!isNakliyeJob && job.productTonnage !== null && <InfoRow label="Tonaj" value={`${job.productTonnage} ton`} />}
          {!isNakliyeJob && job.productType !== null && <InfoRow label="Ürün Cinsi" value={job.productType} />}
          {job.customsProductType !== null && <InfoRow label="Gümrük Ürün Cinsi" value={job.customsProductType} />}
          {job.storageProductType !== null && <InfoRow label="Depolanacak Ürün" value={job.storageProductType} />}
          {job.storageProductQuantity !== null && job.storageProductUnit !== null && (
            <InfoRow label="Miktar" value={`${job.storageProductQuantity} ${job.storageProductUnit}`} />
          )}
          {job.storageProductTonnage !== null && <InfoRow label="Toplam Tonaj" value={`${job.storageProductTonnage} ton`} />}
          {job.storageHazardous !== null && (
            <InfoRow label="Tehlikeli Madde" value={job.storageHazardous ? "Evet" : "Hayır"} />
          )}
          {job.storageHazardous === true && job.storageRiskGroups !== null && job.storageRiskGroups.length > 0 && (
            <InfoRow
              label="Depolama Risk Grupları"
              value={job.storageRiskGroups.map((riskGroupId) => getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId).join(", ")}
            />
          )}
          {isNakliyeJob &&
            nakliyeCargoGroups.map((group, index) => {
              const isContainerMode = group.containerTransport.status === "evet";
              const quantityFieldConfig = !isContainerMode
                ? getProductQuantityFieldConfig(group.loadPreparationType ?? "", group.loadPreparationCustomText)
                : undefined;
              const loadPreparationLabel = !isContainerMode
                ? formatLoadPreparationSummary(group.loadPreparationType, group.loadPreparationCustomText)
                : undefined;
              const measurementSummary = !isContainerMode
                ? group.measurementInfo?.dimensionsUnknown
                  ? { dimensionsLabel: "Ölçüler bilinmiyor" as string | undefined, placementLabel: undefined, maxStackLabel: undefined }
                  : formatMeasurementSummary(group.measurementInfo)
                : { dimensionsLabel: undefined, placementLabel: undefined, maxStackLabel: undefined };
              const measurementParts = [measurementSummary.dimensionsLabel, measurementSummary.placementLabel, measurementSummary.maxStackLabel].filter(
                (part): part is string => Boolean(part),
              );
              const containerLabel = isContainerMode ? formatContainerTransportSummary(group.containerTransport) : null;
              const contentLabel = isContainerMode ? formatContainerContentSummary(group.containerTransport) : null;
              return (
                <div key={group.id} className="flex flex-col gap-3 sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-3">
                  {nakliyeCargoGroups.length > 1 && (
                    <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {formatCargoGroupTitle(index)}
                    </p>
                  )}
                  {!isContainerMode && quantityFieldConfig?.useVolumeInstead
                    ? group.measurementInfo?.volumeM3 !== undefined && (
                        <InfoRow label={quantityFieldConfig.label} value={formatNakliyeQuantity(group.measurementInfo.volumeM3, quantityFieldConfig.unit)} />
                      )
                    : !isContainerMode &&
                      group.productQuantity !== undefined && (
                        <InfoRow
                          label={quantityFieldConfig?.label ?? "Ürün Adedi"}
                          value={formatNakliyeQuantity(group.productQuantity, quantityFieldConfig?.unit ?? "adet")}
                        />
                      )}
                  {/* Paylaşılan Toplam Ağırlık — HER İKİ dalda da anlamlı (görev talimatı: "toplam tonaj alanını tekrar etmeden kullan"); eski konteyner kayıtları için grossWeightTon'a düşer. */}
                  {(() => {
                    const effectiveTonnage = group.productTonnage ?? (isContainerMode ? group.containerTransport.grossWeightTon : undefined);
                    return (
                      effectiveTonnage !== undefined && (
                        <InfoRow label="Toplam Ağırlık" value={`${effectiveTonnage} ${group.productTonnageUnit ?? "ton"}`} />
                      )
                    );
                  })()}
                  {!isContainerMode && group.productType && <InfoRow label="Ürün Cinsi" value={group.productType} />}
                  {loadPreparationLabel && <InfoRow label="Yükün Hazırlanış Biçimi" value={loadPreparationLabel} />}
                  {measurementParts.length > 0 && <InfoRow label="Ölçü ve Yerleşim" value={measurementParts.join(" · ")} />}
                  {containerLabel && <InfoRow label="Konteyner Taşıması" value={containerLabel} />}
                  {contentLabel && <InfoRow label="Konteyner İçindeki Yük" value={contentLabel} />}
                  {(() => {
                    const hazmatLabel = formatHazmatSummary(group.hazmat);
                    return hazmatLabel && <InfoRow label="Tehlikeli Madde / ADR" value={hazmatLabel} />;
                  })()}
                </div>
              );
            })}
          {(() => {
            const loadingMethodLabel = formatLoadingMethodSummary(job.nakliyeLoadingMethod ?? undefined, job.nakliyeLoadingMethodCustomText ?? undefined);
            return loadingMethodLabel ? <InfoRow label="Yükleme Yöntemi" value={loadingMethodLabel} /> : null;
          })()}
          {job.recyclingRequestedOperation !== null && (
            <InfoRow
              label="Talep Edilen İşlem"
              value={getRecyclingRequestedOperationLabel(job.recyclingRequestedOperation) ?? job.recyclingRequestedOperation}
            />
          )}
          {job.recyclingMaterialCategoryId !== null && (
            <InfoRow
              label="Atık Türü"
              value={
                (getRecyclingMaterialTypeLabel(job.recyclingMaterialCategoryId) ?? job.recyclingMaterialCategoryId) +
                (() => {
                  const detail = getRecyclingMaterialTypeDetailLine(job.recyclingMaterialCategoryId, job.recyclingMaterialSubtypeId ?? undefined);
                  return detail ? ` — ${detail}` : "";
                })()
              }
            />
          )}
          {job.recyclingWasteCodeUnknown === true && (
            <InfoRow label="Atık Kodu" value="Bilinmiyor — admin incelemesi bekleniyor" />
          )}
          {job.recyclingWasteCode !== null && (
            <>
              <InfoRow
                label="Atık Kodu"
                value={
                  formatWasteCodeForDisplay(job.recyclingWasteCode) +
                  (getWasteCodeEntry(job.recyclingWasteCode) ? ` — ${getWasteCodeEntry(job.recyclingWasteCode)!.description}` : "")
                }
              />
              <InfoRow
                label="Tehlike Durumu"
                value={(job.recyclingHazardous ?? deriveWasteCodeHazardous(job.recyclingWasteCode)) ? "Tehlikeli" : "Tehlikesiz"}
              />
              {job.recyclingHazardProperties !== null && job.recyclingHazardProperties.length > 0 && (
                <InfoRow
                  label="Tehlike Özelliği"
                  value={job.recyclingHazardProperties.map((id) => getWasteHazardPropertyLabel(id) ?? id).join(", ")}
                />
              )}
            </>
          )}
          {job.recyclingQuantity !== null && (
            <InfoRow label="Tahmini Miktar" value={`${job.recyclingQuantity} ${job.recyclingUnit ?? ""}`.trim()} />
          )}
          {job.recyclingMaterialCondition !== null && (
            <InfoRow
              label="Malzeme Durumu"
              value={
                (getRecyclingMaterialConditionLabel(job.recyclingMaterialCondition) ?? job.recyclingMaterialCondition) +
                (job.recyclingMaterialCondition === "diger" && job.recyclingMaterialConditionNote
                  ? ` (${job.recyclingMaterialConditionNote})`
                  : "")
              }
            />
          )}
          {job.recyclingScopeOfWork !== null && job.recyclingScopeOfWork.length > 0 && (
            <InfoRow label="Hizmet Kapsamı" value={getRecyclingScopeOfWorkLabels(job.recyclingScopeOfWork).join(", ")} />
          )}
          {job.deliveryProvince !== null && (
            <InfoRow label="Teslim İl / İlçe" value={`${job.deliveryProvince} / ${job.deliveryDistrict ?? "—"}`} />
          )}
          {job.deliveryFacilityName !== null && <InfoRow label="Teslim Tesisi" value={job.deliveryFacilityName} />}
          {job.deliveryAddressText !== null && <InfoRow label="Teslim Adresi" value={job.deliveryAddressText} />}
          <InfoRow label="Oluşturulma Tarihi" value={new Date(job.createdAt).toLocaleString("tr-TR")} />
          <InfoRow label="Yayın Bitiş Tarihi" value={new Date(job.publishEndAt).toLocaleString("tr-TR")} />
          {job.closedAt && <InfoRow label="Kapatılma Tarihi" value={new Date(job.closedAt).toLocaleString("tr-TR")} />}
          {job.closureReason && (
            <InfoRow label="Kapatılma Nedeni" value={isJobClosureReason(job.closureReason) ? getJobClosureReasonLabel(job.closureReason) : job.closureReason} />
          )}
        </div>

        <div className="mt-4 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Açıklama</p>
          <p className="mt-1 text-sm text-foreground">{job.description}</p>
        </div>
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">Hizmet Bilgileri / Operasyon Detayı</p>
          <p className="mt-1 text-sm text-foreground">{job.operationDetails}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => {
              setUnpublishOpen((value) => !value);
              setActionError(null);
            }}
            disabled={submitting || !canUnpublish}
            title={!canUnpublish ? "Bu ilan zaten kapalı ya da devam eden/tamamlanmış bir işi olduğu için kapatılamaz." : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Yayından Kaldır
          </button>
          <button
            type="button"
            disabled
            title="Bu işlem için gerekli admin RPC'si (republish_job_as_admin) bu fazda henüz eklenmedi — bkz. proje raporu, sonraki faz önerileri."
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Yeniden Yayınla
          </button>
          <button
            type="button"
            disabled
            title="Şemada 'kapatma'dan ayrı bir 'pasife alma' durumu yok — bu işlem için gerekli backend altyapısı bu fazda henüz eklenmedi, bkz. proje raporu."
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Pasife Al
          </button>
        </div>

        {unpublishOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="admin-job-unpublish-reason">
              Yayından kaldırma nedeni
            </label>
            <select
              id="admin-job-unpublish-reason"
              value={unpublishReason}
              onChange={(event) => setUnpublishReason(event.target.value as JobClosureReason)}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {JOB_CLOSURE_REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleUnpublish()}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Gönder
              </button>
              <button
                type="button"
                onClick={() => {
                  setUnpublishOpen(false);
                  setUnpublishReason("hizmete-ihtiyac-kalmadi");
                }}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold tracking-heading text-foreground">İlan Moderasyonu</h3>
          <StatusBadge label={getJobModerationStatusLabel(job.moderationStatus)} tone={getJobModerationStatusTone(job.moderationStatus)} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Bu ilan, admin onaylayana kadar hizmet verenlere görünmez ve teklif alamaz. Onay/red işlemleri mevcut{" "}
          <code>approve_job_as_admin</code>/<code>reject_job_as_admin</code> RPC&apos;lerini kullanır.
        </p>
        {job.moderationStatus === "rejected" && job.moderationRejectionReason && (
          <p className="mt-2 text-sm text-danger">Reddedilme nedeni: {job.moderationRejectionReason}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditOpen((value) => !value);
              setRejectOpen(false);
              setModerationError(null);
            }}
            disabled={moderationSubmitting}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PencilLine className="h-4 w-4" aria-hidden="true" />
            İlanı Düzenle
          </button>
          {job.moderationStatus !== "rejected" && (
            <button
              type="button"
              onClick={() => {
                setRejectOpen((value) => !value);
                setEditOpen(false);
                setModerationError(null);
              }}
              disabled={moderationSubmitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              İlanı Reddet
            </button>
          )}
          {job.moderationStatus !== "approved" && (
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={moderationSubmitting}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {moderationSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              Onayla ve Yayınla
            </button>
          )}
        </div>

        {editOpen && <AdminJobEditForm job={job} onSaved={() => { setEditOpen(false); refresh(); }} onCancel={() => setEditOpen(false)} />}

        {rejectOpen && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="admin-job-reject-reason">
              Red nedeni (zorunlu)
            </label>
            <textarea
              id="admin-job-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="İlan neden reddediliyor? Bu nedeni ilan sahibi görecek."
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={moderationSubmitting || rejectReason.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {moderationSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Reddet
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason("");
                }}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {moderationError && <p className="mt-3 text-sm text-danger">{moderationError}</p>}
      </div>

      {/* Firma Bilgisi + Operasyon Bağlantısı — masaüstünde yan yana; Operasyon
          Bağlantısı yalnızca job.operationId varsa render olur, o durumda
          Firma Bilgisi `lg:col-span-2` ile tek başına tam genişlikte kalır
          (boş bir ikinci sütun bırakmamak için). */}
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
        <div className={`rounded-card border border-border bg-surface p-6${job.operationId ? "" : " lg:col-span-2"}`}>
          <h3 className="text-base font-bold tracking-heading text-foreground">Firma Bilgisi</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoRow label="Firma Adı" value={job.companyName ?? "—"} />
            <InfoRow label="Yetkili Kişi" value={job.requesterFullName ?? "—"} />
            <InfoRow label="Telefon" value={job.requesterPhone ?? "—"} />
          </div>
        </div>

        {job.operationId && (
          <div className="rounded-card border border-border bg-surface p-6">
            <h3 className="text-base font-bold tracking-heading text-foreground">Operasyon Bağlantısı</h3>
            {job.siblings.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Bu operasyonun başka aktif hizmet kalemi yok.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {job.siblings.map((sibling) => (
                  <li key={sibling.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{sibling.title}</p>
                      <p className="text-xs text-muted-foreground">{sibling.categoryLabel}</p>
                    </div>
                    <Link href={`/admin/ilanlar/${sibling.id}`} className="text-xs font-medium text-accent underline underline-offset-2">
                      Detay
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Gelen Teklifler</h3>
        {job.offers.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Bu ilana henüz teklif verilmemiş.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {job.offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{offer.providerCompanyName ?? offer.providerFullName ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {offer.amount.toLocaleString("tr-TR")} {offer.currency} · {new Date(offer.createdAt).toLocaleDateString("tr-TR")}
                  </p>
                </div>
                <StatusBadge label={OFFER_STATUS_LABEL[offer.status] ?? offer.status} tone="neutral" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
