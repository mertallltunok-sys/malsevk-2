"use client";

import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveFacilityCandidate,
  FACILITY_CANDIDATE_CONFIDENCE_LABEL,
  FACILITY_CANDIDATE_CONFIDENCE_TONE,
  FACILITY_CANDIDATE_STATUS_LABEL,
  FACILITY_CANDIDATE_STATUS_TONE,
  FACILITY_CANDIDATE_TYPE_OPTIONS,
  getFacilityCandidateDetail,
  rejectFacilityCandidate,
  updateFacilityCandidateSuggestion,
  type AdminFacilityCandidateDetail as AdminFacilityCandidateDetailData,
  type FacilityCandidateType,
} from "../_lib/admin-facility-candidates";
import { getDistrictsByProvinceCode, getProvinces } from "../_lib/turkey-locations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="w-40 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

export function AdminFacilityCandidateDetail({ candidateId }: { candidateId: string }) {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [candidate, setCandidate] = useState<AdminFacilityCandidateDetailData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const provinces = useMemo(() => getProvinces(), []);
  const [name, setName] = useState("");
  const [provinceName, setProvinceName] = useState("");
  const [district, setDistrict] = useState("");
  const [types, setTypes] = useState<FacilityCandidateType[]>([]);

  const [showRejectBox, setShowRejectBox] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void getFacilityCandidateDetail(candidateId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result) {
        setNotFound(true);
        return;
      }
      setCandidate(result);
      setName(result.suggestedName);
      setProvinceName(result.suggestedProvince);
      setDistrict(result.suggestedDistrict ?? "");
      setTypes(result.suggestedTypes);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, candidateId, refreshKey]);

  const provinceCode = provinces.find((item) => item.name === provinceName)?.code ?? "";
  const districtOptions = provinceCode ? getDistrictsByProvinceCode(provinceCode) : [];

  function toggleType(type: FacilityCandidateType) {
    setTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]));
  }

  async function handleApprove() {
    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    const result = await approveFacilityCandidate(candidateId, name, provinceName, district, types);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionMessage("Aday onaylandı — bu tesis artık doğrulanmış kayıt olarak işaretlendi.");
    refresh();
  }

  async function handleSaveEdits() {
    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    const result = await updateFacilityCandidateSuggestion(candidateId, name, provinceName, district, types);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionMessage("Değişiklikler kaydedildi.");
    refresh();
  }

  async function handleReject() {
    if (rejectReason.trim().length === 0) return;
    setSubmitting(true);
    setActionError(null);
    setActionMessage(null);
    const result = await rejectFacilityCandidate(candidateId, rejectReason);
    setSubmitting(false);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setShowRejectBox(false);
    setRejectReason("");
    refresh();
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect={`/admin/sistem-beslemesi/${candidateId}`} />;
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
  if (notFound || !candidate) {
    return <p className="text-sm text-muted-foreground">Aday bulunamadı.</p>;
  }

  const isPending = candidate.status === "pending";

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold tracking-heading leading-tight text-foreground">{candidate.suggestedName}</h2>
            <p className="text-sm text-muted-foreground">Toplam kullanım: {candidate.usageCount}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusBadge label={FACILITY_CANDIDATE_STATUS_LABEL[candidate.status]} tone={FACILITY_CANDIDATE_STATUS_TONE[candidate.status]} />
            <StatusBadge label={FACILITY_CANDIDATE_CONFIDENCE_LABEL[candidate.confidence]} tone={FACILITY_CANDIDATE_CONFIDENCE_TONE[candidate.confidence]} />
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="İlk Görülme" value={new Date(candidate.firstSeenAt).toLocaleString("tr-TR")} />
          <InfoRow label="Son Görülme" value={new Date(candidate.lastSeenAt).toLocaleString("tr-TR")} />
          {candidate.reviewedAt && <InfoRow label="Karar Tarihi" value={new Date(candidate.reviewedAt).toLocaleString("tr-TR")} />}
          {candidate.reviewedByName && <InfoRow label="Kararı Veren" value={candidate.reviewedByName} />}
          {candidate.rejectionReason && <InfoRow label="Red Gerekçesi" value={candidate.rejectionReason} />}
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Tesis Bilgileri</h3>
        <p className="mt-1 text-xs text-muted-foreground">Öneri yanlışsa aşağıdan düzenleyip kaydedin, doğruysa doğrudan Onayla.</p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium text-foreground" htmlFor="fc-name">
              Doğru Tesis Adı
            </label>
            <input
              id="fc-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-foreground" htmlFor="fc-province">
                İl
              </label>
              <select
                id="fc-province"
                value={provinceName}
                onChange={(event) => {
                  setProvinceName(event.target.value);
                  setDistrict("");
                }}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Seçiniz</option>
                {provinces.map((province) => (
                  <option key={province.code} value={province.name}>
                    {province.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground" htmlFor="fc-district">
                İlçe
              </label>
              <select
                id="fc-district"
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                disabled={!provinceCode}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Seçiniz</option>
                {districtOptions.map((districtName) => (
                  <option key={districtName} value={districtName}>
                    {districtName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-foreground">Tesis Tipi (birden fazla seçilebilir)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {FACILITY_CANDIDATE_TYPE_OPTIONS.map((option) => {
                const active = types.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleType(option.value)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:border-primary/40"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          {isPending && (
            <button
              type="button"
              onClick={() => void handleApprove()}
              disabled={submitting || !name.trim() || !provinceName}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              Onayla
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleSaveEdits()}
            disabled={submitting || !name.trim() || !provinceName}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Değişiklikleri Kaydet
          </button>
          {isPending && (
            <button
              type="button"
              onClick={() => {
                setShowRejectBox((value) => !value);
                setActionError(null);
              }}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-danger/30 bg-danger-soft px-5 py-2.5 text-sm font-medium text-danger transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Reddet
            </button>
          )}
        </div>

        {showRejectBox && (
          <div className="mt-4 rounded-md border border-border bg-background p-4">
            <label className="text-xs font-medium text-foreground" htmlFor="fc-reject-reason">
              Reddedilme nedeni (zorunlu)
            </label>
            <textarea
              id="fc-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              placeholder="Ör. Anlamsız girdi, mükerrer kayıt, gerçek bir tesis değil..."
            />
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={submitting || rejectReason.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Gönder
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRejectBox(false);
                  setRejectReason("");
                }}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                İptal
              </button>
            </div>
          </div>
        )}

        {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}
        {actionMessage && !actionError && <p className="mt-3 text-sm text-success">{actionMessage}</p>}
      </div>

      <div className="rounded-card border border-border bg-surface p-6">
        <h3 className="text-base font-bold tracking-heading text-foreground">Benzer Yazımlar</h3>
        <p className="mt-1 text-xs text-muted-foreground">Bu gruba toplanan tüm ham kullanıcı girdileri ve kullanım sayıları.</p>
        <ul className="mt-4 flex flex-col gap-2">
          {candidate.spellings.map((spelling) => (
            <li key={spelling.rawText} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
              <span className="text-sm font-medium text-foreground">&quot;{spelling.rawText}&quot;</span>
              <span className="text-xs text-muted-foreground">
                {spelling.count} kez · son: {new Date(spelling.lastSeenAt).toLocaleDateString("tr-TR")}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
