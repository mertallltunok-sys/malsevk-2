"use client";

import { Check, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatFileSize } from "../_lib/photo-validation";
import { getProviderDocumentTypeAdminDescription, getProviderDocumentTypeLabel } from "../_lib/provider-documents";
import { getRecyclingActivityLabel, isRecyclingCategory } from "../_lib/recycling-catalog";
import { formatWasteCodeForDisplay, getWasteCodeEntry } from "../_lib/recycling-waste-code-catalog";
import { getProviderAuthorizationGroupByDocumentType, getServiceCategoryLabel } from "../_lib/service-catalog";
import {
  getImoClassOptionLabel,
  getStorageActivityScopeLabel,
  HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID,
  IMO_CLASS_OPTIONS,
  STORAGE_CONTAINER_CATEGORY_ID,
} from "../_lib/storage-container-catalog";
import { getStorageRiskGroupLabel, isHazardousStorageCategory } from "../_lib/storage-hazard-catalog";
import {
  getProviderDocumentForAdmin,
  listProviderDocumentReviewHistory,
  reviewProviderDocumentRemote,
  type AdminProviderDocumentDetail,
  type ProviderDocumentReviewHistoryEntry,
  type RemoteProviderDocumentReviewStatus,
} from "../_lib/supabase-provider-document-review";
import { createSignedUrlForProviderDocument } from "../_lib/supabase-provider-documents";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { MultiSelectChips } from "./multi-select-chips";
import { StatusBadge } from "./status-badge";

const IMO_CLASS_LABEL_BY_CODE = new Map<string, string>(IMO_CLASS_OPTIONS.map((option) => [option.id, getImoClassOptionLabel(option)]));

/** Bir belgenin Konteyner Depolama'yı kapsayıp kapsamadığı — tekil kategori seçimi VEYA "Depo Hizmetleri" grup belgesi (12 kategoriden biri olarak). Kısmi onay checklist'inin gösterilip gösterilmeyeceğine karar veren TEK yer (bkz. document-upload-content.tsx#pickTargetsContainerStorage İLE AYNI ilke, admin tarafındaki karşılığı). */
function documentTargetsContainerStorage(document: AdminProviderDocumentDetail): boolean {
  return document.serviceCategoryId === STORAGE_CONTAINER_CATEGORY_ID || document.documentType === "depo-hizmetleri-belgesi";
}

/** `documentTargetsContainerStorage` İLE AYNI ilke — Kimyasal Depolama/Tehlikeli Madde Depolama'yı hedefleyen bir belge için risk-grubu onay checklist'inin gösterilip gösterilmeyeceğine karar verir. */
function documentTargetsHazardousStorage(document: AdminProviderDocumentDetail): boolean {
  return (
    (document.serviceCategoryId !== null && isHazardousStorageCategory(document.serviceCategoryId)) ||
    document.documentType === "depo-hizmetleri-belgesi"
  );
}

/** `documentTargetsHazardousStorage` İLE AYNI ilke — Geri Dönüşüm & Atık Tahliye'yi hedefleyen bir belge için faaliyet/atık-kodu onay checklist'inin gösterilip gösterilmeyeceğine karar verir. Bu kategori hiçbir grup belgesine dahil değildir (migration 0044'ün kapsam dışı listesi) — bu yüzden `documentType` kontrolü gerekmez. */
function documentTargetsRecycling(document: AdminProviderDocumentDetail): boolean {
  return document.serviceCategoryId !== null && isRecyclingCategory(document.serviceCategoryId);
}

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

const REVIEW_ACTION_LABEL: Record<ProviderDocumentReviewHistoryEntry["action"], string> = {
  approved: "Onayladı",
  rejected: "Reddetti",
  revision_requested: "Revizyon istedi",
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function AdminDocumentReviewDetail({ documentId }: { documentId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [document, setDocument] = useState<AdminProviderDocumentDetail | null>(null);
  const [history, setHistory] = useState<ProviderDocumentReviewHistoryEntry[]>([]);
  const [notFound, setNotFound] = useState(false);

  const [pendingAction, setPendingAction] = useState<"rejected" | "revision_requested" | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Kısmi onay (görev talimatı: "belgenin kapsamadığı faaliyet alanını/IMO
  // sınıfını onay dışında bırakabilmeli") — belgenin TALEP ettiği kümeyle
  // ÖNCEDEN DOLU başlar (varsayılan: tam onay), admin yalnızca DARALTABİLİR
  // (checklist'in `options`u belgenin talep ettiği kümeyle sınırlıdır,
  // admin talep edilmeyen bir kapsamı ASLA EKLEYEMEZ). `document` yüklendiğinde
  // aşağıdaki fetch effect'inin KENDİ `.then()` callback'i içinde doldurulur
  // (senkron effect gövdesinde setState YASAK — react-hooks/set-state-in-effect).
  const [approvedScopes, setApprovedScopes] = useState<string[]>([]);
  const [approvedImoClasses, setApprovedImoClasses] = useState<string[]>([]);
  // "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi —
  // approvedScopes İLE AYNI "belgenin talep ettiği kümeyle ÖNCEDEN DOLU
  // başlar, admin yalnızca DARALTABİLİR" kuralı.
  const [approvedStorageRiskGroups, setApprovedStorageRiskGroups] = useState<string[]>([]);
  // "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi —
  // approvedStorageRiskGroups İLE AYNI "belgenin talep ettiği kümeyle
  // ÖNCEDEN DOLU başlar, admin yalnızca DARALTABİLİR" kuralı, iki BAĞIMSIZ
  // eksen (faaliyet + atık kodu).
  const [approvedRecyclingActivities, setApprovedRecyclingActivities] = useState<string[]>([]);
  const [approvedRecyclingWasteCodes, setApprovedRecyclingWasteCodes] = useState<string[]>([]);

  const [refreshKey, setRefreshKey] = useState(0);
  // AdminProviderDocumentReviewPanelRemote ile AYNI desen: `loading`nin
  // ilk `true` değeri useState'in kendi başlangıç değerinden gelir, effect
  // içinde SENKRON bir setLoading(true) çağrısı YOK (react-hooks/set-state-
  // in-effect kuralı bunu yasaklar) — yalnızca .then() içinde (asenkron
  // callback, kural kapsamı dışı) setLoading(false) çağrılır. Bir eylem
  // sonrası "yeniden yükleniyor" göstergesi zaten `submitting` state'i
  // (aşağıdaki butonlarda) tarafından karşılanıyor, ayrı bir senkron
  // setLoading(true) gerekmiyor.
  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void Promise.all([getProviderDocumentForAdmin(documentId), listProviderDocumentReviewHistory(documentId)]).then(
      ([documentResult, historyResult]) => {
        if (cancelled) return;
        setLoading(false);
        if (!documentResult) {
          setNotFound(true);
          return;
        }
        setDocument(documentResult);
        setHistory(historyResult);
        setApprovedScopes(documentResult.storageActivityScopes ?? []);
        setApprovedImoClasses(documentResult.imoClassCodes ?? []);
        setApprovedStorageRiskGroups(documentResult.requestedStorageRiskGroups ?? []);
        setApprovedRecyclingActivities(documentResult.requestedRecyclingActivities ?? []);
        setApprovedRecyclingWasteCodes(documentResult.requestedRecyclingWasteCodes ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isAdmin, documentId, refreshKey]);

  async function handleView() {
    if (!document) return;
    setViewing(true);
    setActionError(null);
    const signedUrl = await createSignedUrlForProviderDocument(document.storagePath);
    setViewing(false);
    if (!signedUrl) {
      setActionError("Belge görüntülenemedi. Lütfen tekrar deneyin.");
      return;
    }
    window.open(signedUrl, "_blank", "noopener");
  }

  async function submitReview(status: "approved" | "rejected" | "revision_requested", reviewNote?: string) {
    setSubmitting(true);
    setActionError(null);
    const targetsContainerStorage = Boolean(document && documentTargetsContainerStorage(document));
    const targetsHazardousStorage = Boolean(document && documentTargetsHazardousStorage(document));
    const targetsRecycling = Boolean(document && documentTargetsRecycling(document));
    const result = await reviewProviderDocumentRemote(
      documentId,
      status,
      reviewNote,
      status === "approved" && targetsContainerStorage ? approvedScopes : undefined,
      status === "approved" && targetsContainerStorage && approvedScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) ? approvedImoClasses : undefined,
      status === "approved" && targetsHazardousStorage ? approvedStorageRiskGroups : undefined,
      status === "approved" && targetsRecycling ? approvedRecyclingActivities : undefined,
      status === "approved" && targetsRecycling ? approvedRecyclingWasteCodes : undefined,
    );
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setPendingAction(null);
    setNote("");
    refresh();
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/firma-belgeleri/${documentId}`} />;
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
  if (notFound || !document) {
    return <p className="text-sm text-muted-foreground">Belge bulunamadı.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-heading leading-tight text-foreground" title={document.originalFileName}>
              {document.originalFileName}
            </h2>
            <p className="text-sm text-muted-foreground">
              {formatFileSize(document.sizeBytes)} · {document.extension.toUpperCase()}
            </p>
          </div>
          <StatusBadge label={STATUS_LABEL[document.currentReviewStatus]} tone={STATUS_TONE[document.currentReviewStatus]} />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="Firma Adı" value={document.providerCompanyName ?? "—"} />
          <InfoRow label="Yetkili Kişi" value={document.providerName ?? "—"} />
          <InfoRow label="Telefon" value={document.providerPhone ?? "—"} />
          <InfoRow label="İl / İlçe" value={[document.providerProvince, document.providerDistrict].filter(Boolean).join(" / ") || "—"} />
          <InfoRow label="Belge Türü" value={getProviderDocumentTypeLabel(document.documentType)} />
          <InfoRow
            label="Hizmet Grubu"
            value={
              document.serviceCategoryId
                ? (getServiceCategoryLabel(document.serviceCategoryId) ?? document.serviceCategoryId)
                : (getProviderAuthorizationGroupByDocumentType(document.documentType)?.label ?? "—")
            }
          />
          <InfoRow label="Yükleme Tarihi" value={new Date(document.uploadedAt).toLocaleString("tr-TR")} />
        </div>

        {(() => {
          const groupDescription = getProviderDocumentTypeAdminDescription(document.documentType);
          return groupDescription ? (
            <p className="mt-3 rounded-md border border-accent/30 bg-accent-soft p-3 text-sm text-foreground">{groupDescription}</p>
          ) : null;
        })()}

        {document.currentReviewNote && (
          <p className="mt-4 rounded-md border border-border bg-background p-3 text-sm text-foreground">
            <span className="font-medium">Güncel not:</span> {document.currentReviewNote}
          </p>
        )}

        {documentTargetsContainerStorage(document) && (document.storageActivityScopes?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Talep Edilen Faaliyet Alanları
              {document.imoClassCodes && document.imoClassCodes.length > 0 && " / IMO Sınıfları"}
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {(document.storageActivityScopes ?? []).map((scope) => (
                <li key={scope} className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {getStorageActivityScopeLabel(scope) ?? scope}
                </li>
              ))}
              {(document.imoClassCodes ?? []).map((code) => (
                <li key={code} className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  IMO {IMO_CLASS_LABEL_BY_CODE.get(code) ?? code}
                </li>
              ))}
            </ul>

            {document.currentReviewStatus === "pending" && (
              <div className="mt-2 flex flex-col gap-4 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Onaylamadan önce, belgenin GERÇEKTEN kapsamadığını düşündüğünüz alan/sınıfların işaretini
                  kaldırabilirsiniz — yalnızca talep edilenler arasından daraltabilirsiniz, listeye yeni bir alan
                  eklenemez.
                </p>
                <MultiSelectChips
                  id="approved-storage-activity-scopes"
                  label="Onaylanacak Faaliyet Alanları"
                  options={(document.storageActivityScopes ?? []).map((scope) => ({ value: scope, label: getStorageActivityScopeLabel(scope) ?? scope }))}
                  selected={approvedScopes}
                  onChange={(next) => {
                    setApprovedScopes(next);
                    if (!next.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID)) setApprovedImoClasses([]);
                  }}
                />
                {approvedScopes.includes(HAZARDOUS_STORAGE_ACTIVITY_SCOPE_ID) && (document.imoClassCodes?.length ?? 0) > 0 && (
                  <MultiSelectChips
                    id="approved-imo-class-codes"
                    label="Onaylanacak IMO Sınıfları"
                    options={(document.imoClassCodes ?? []).map((code) => ({ value: code, label: IMO_CLASS_LABEL_BY_CODE.get(code) ?? code }))}
                    selected={approvedImoClasses}
                    onChange={setApprovedImoClasses}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {documentTargetsHazardousStorage(document) && (document.requestedStorageRiskGroups?.length ?? 0) > 0 && (
          <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <p className="text-xs font-medium text-muted-foreground">Talep Edilen Depolama Risk Grupları</p>
            <ul className="flex flex-wrap gap-1.5">
              {(document.requestedStorageRiskGroups ?? []).map((riskGroupId) => (
                <li key={riskGroupId} className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId}
                </li>
              ))}
            </ul>

            {document.currentReviewStatus === "pending" && (
              <div className="mt-2 flex flex-col gap-4 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Bu belge, firmanın belirttiği risk gruplarının GERÇEKTEN kapsamda olduğuna dair kanıt taşıyor mu?
                  Yalnızca gerçekten onayladığınız grupları işaretli bırakın — her grup bağımsız değerlendirilir,
                  onaylanmayan bir grup için firma ilgili ilanları göremez/teklif veremez.
                </p>
                <MultiSelectChips
                  id="approved-storage-risk-groups"
                  label="Onaylanacak Risk Grupları"
                  options={(document.requestedStorageRiskGroups ?? []).map((riskGroupId) => ({
                    value: riskGroupId,
                    label: getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId,
                  }))}
                  selected={approvedStorageRiskGroups}
                  onChange={setApprovedStorageRiskGroups}
                />
              </div>
            )}
          </div>
        )}

        {documentTargetsRecycling(document) &&
          ((document.requestedRecyclingActivities?.length ?? 0) > 0 || (document.requestedRecyclingWasteCodes?.length ?? 0) > 0) && (
            <div className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Talep Edilen Faaliyetler ve Atık Kodları</p>
              <ul className="flex flex-wrap gap-1.5">
                {(document.requestedRecyclingActivities ?? []).map((activityId) => (
                  <li key={activityId} className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    {getRecyclingActivityLabel(activityId) ?? activityId}
                  </li>
                ))}
                {(document.requestedRecyclingWasteCodes ?? []).map((code) => (
                  <li key={code} className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                    {formatWasteCodeForDisplay(code)}
                    {getWasteCodeEntry(code) ? ` — ${getWasteCodeEntry(code)!.description}` : ""}
                  </li>
                ))}
              </ul>

              {document.currentReviewStatus === "pending" && (
                <div className="mt-2 flex flex-col gap-4 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">
                    Bu belge, firmanın belirttiği faaliyetlerin ve atık kodlarının GERÇEKTEN kapsamda olduğuna dair
                    kanıt taşıyor mu? Faaliyetler ve atık kodları BAĞIMSIZ değerlendirilir — yalnızca gerçekten
                    onayladığınız öğeleri işaretli bırakın; onaylanmayan bir faaliyet/kod için firma ilgili ilanları
                    göremez/teklif veremez.
                  </p>
                  {(document.requestedRecyclingActivities?.length ?? 0) > 0 && (
                    <MultiSelectChips
                      id="approved-recycling-activities"
                      label="Onaylanacak Faaliyetler"
                      options={(document.requestedRecyclingActivities ?? []).map((activityId) => ({
                        value: activityId,
                        label: getRecyclingActivityLabel(activityId) ?? activityId,
                      }))}
                      selected={approvedRecyclingActivities}
                      onChange={setApprovedRecyclingActivities}
                    />
                  )}
                  {(document.requestedRecyclingWasteCodes?.length ?? 0) > 0 && (
                    <MultiSelectChips
                      id="approved-recycling-waste-codes"
                      label="Onaylanacak Atık Kodları"
                      options={(document.requestedRecyclingWasteCodes ?? []).map((code) => ({
                        value: code,
                        label: `${formatWasteCodeForDisplay(code)}${getWasteCodeEntry(code) ? ` — ${getWasteCodeEntry(code)!.description}` : ""}`,
                      }))}
                      selected={approvedRecyclingWasteCodes}
                      onChange={setApprovedRecyclingWasteCodes}
                    />
                  )}
                </div>
              )}
            </div>
          )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleView()}
            disabled={viewing}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {viewing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
            Görüntüle / İndir
          </button>

          {/* Yalnızca "pending" durumundaki bir belge üzerinde karar
              verilebilir — zaten karara bağlanmış (approved/rejected/
              revision_requested) veya tarihçeye geçmiş (superseded) bir
              satırın review_provider_document'e TEKRAR gönderilmesi, o
              RPC'nin "approved olursa aynı türdeki önceki approved satırı
              superseded'e çevir" yan etkisini istenmeden tetikleyebilir —
              bkz. admin-provider-document-review-panel-remote.tsx'in AYNI
              korumasının kendi yorumu (0024). */}
          {document.currentReviewStatus === "pending" && (
            <>
              <button
                type="button"
                onClick={() => void submitReview("approved")}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft px-4 py-2 text-sm font-medium text-success transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Onayla
              </button>
              <button
                type="button"
                onClick={() => setPendingAction(pendingAction === "rejected" ? null : "rejected")}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Reddet
              </button>
              <button
                type="button"
                onClick={() => setPendingAction(pendingAction === "revision_requested" ? null : "revision_requested")}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Revizyon İste
              </button>
            </>
          )}
        </div>

        {pendingAction && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="admin-review-note">
              {pendingAction === "rejected" ? "Reddetme açıklaması (zorunlu)" : "Revizyon isteme açıklaması (zorunlu)"}
            </label>
            <textarea
              id="admin-review-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Açıklama girin..."
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void submitReview(pendingAction, note)}
                disabled={submitting || note.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Gönder
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingAction(null);
                  setNote("");
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
        <h3 className="text-base font-bold tracking-heading text-foreground">Önceki İnceleme Geçmişi</h3>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Bu belge için henüz bir inceleme kararı verilmemiş.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{REVIEW_ACTION_LABEL[entry.action]}</span>
                  <span className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString("tr-TR")}</span>
                </div>
                {entry.note && <p className="mt-1 text-sm text-muted-foreground">{entry.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
