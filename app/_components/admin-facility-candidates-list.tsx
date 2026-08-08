"use client";

import { Check, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  approveFacilityCandidate,
  FACILITY_CANDIDATE_CONFIDENCE_LABEL,
  FACILITY_CANDIDATE_CONFIDENCE_TONE,
  FACILITY_CANDIDATE_STATUS_LABEL,
  FACILITY_CANDIDATE_STATUS_TONE,
  getFacilityCandidateTypeLabel,
  listFacilityCandidatesForAdmin,
  type AdminFacilityCandidateListItem,
  type FacilityCandidateConfidence,
  type FacilityCandidateStatus,
} from "../_lib/admin-facility-candidates";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

const STATUS_FILTER_OPTIONS: { value: FacilityCandidateStatus | ""; label: string }[] = [
  { value: "", label: "Tüm durumlar" },
  { value: "pending", label: "Bekleyen" },
  { value: "approved", label: "Onaylanan" },
  { value: "rejected", label: "Reddedilen" },
];

const CONFIDENCE_FILTER_OPTIONS: { value: FacilityCandidateConfidence | ""; label: string }[] = [
  { value: "", label: "Tüm güven seviyeleri" },
  { value: "high", label: "Yüksek Güven" },
  { value: "medium", label: "Orta Güven" },
  { value: "low", label: "Düşük Güven" },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR");
}

export function AdminFacilityCandidatesList() {
  const session = useSession();
  const isAdmin = session?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<AdminFacilityCandidateListItem[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FacilityCandidateStatus | "">("pending");
  const [confidenceFilter, setConfidenceFilter] = useState<FacilityCandidateConfidence | "">("");

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listFacilityCandidatesForAdmin().then((result) => {
      if (cancelled) return;
      setCandidates(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR");
    return candidates.filter((candidate) => {
      if (statusFilter && candidate.status !== statusFilter) return false;
      if (confidenceFilter && candidate.confidence !== confidenceFilter) return false;
      if (normalizedSearch) {
        const haystack = `${candidate.suggestedName} ${candidate.sampleRawText ?? ""} ${candidate.suggestedProvince} ${candidate.suggestedDistrict ?? ""}`.toLocaleLowerCase(
          "tr-TR",
        );
        if (!haystack.includes(normalizedSearch)) return false;
      }
      return true;
    });
  }, [candidates, search, statusFilter, confidenceFilter]);

  async function handleQuickApprove(candidate: AdminFacilityCandidateListItem) {
    setApprovingId(candidate.id);
    setRowError(null);
    const result = await approveFacilityCandidate(
      candidate.id,
      candidate.suggestedName,
      candidate.suggestedProvince,
      candidate.suggestedDistrict ?? "",
      candidate.suggestedTypes,
    );
    setApprovingId(null);
    if (!result.ok) {
      setRowError({ id: candidate.id, message: result.error });
      return;
    }
    setRefreshKey((value) => value + 1);
  }

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/sistem-beslemesi" />;
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
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tesis adı, ham girdi, il veya ilçe ara..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FacilityCandidateStatus | "")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={confidenceFilter}
            onChange={(event) => setConfidenceFilter(event.target.value as FacilityCandidateConfidence | "")}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {CONFIDENCE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{filtered.length} aday bulundu.</p>

      <div className="flex flex-col gap-3">
        {filtered.map((candidate) => (
          <div key={candidate.id} className="rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold tracking-heading leading-tight text-foreground">{candidate.suggestedName}</h3>
                  <StatusBadge label={FACILITY_CANDIDATE_STATUS_LABEL[candidate.status]} tone={FACILITY_CANDIDATE_STATUS_TONE[candidate.status]} />
                  <StatusBadge label={FACILITY_CANDIDATE_CONFIDENCE_LABEL[candidate.confidence]} tone={FACILITY_CANDIDATE_CONFIDENCE_TONE[candidate.confidence]} />
                </div>
                {candidate.sampleRawText && candidate.sampleRawText !== candidate.suggestedName && (
                  <p className="mt-1 text-xs text-muted-foreground">Ham girdi örneği: &quot;{candidate.sampleRawText}&quot;</p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {[candidate.suggestedProvince, candidate.suggestedDistrict].filter(Boolean).join(" / ")}
                  {candidate.suggestedTypes.length > 0 && <> · {candidate.suggestedTypes.map((type) => getFacilityCandidateTypeLabel(type)).join(", ")}</>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Kullanım: {candidate.usageCount} · İlk görülme: {formatDate(candidate.firstSeenAt)} · Son görülme: {formatDate(candidate.lastSeenAt)}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {candidate.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => void handleQuickApprove(candidate)}
                    disabled={approvingId === candidate.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {approvingId === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                    Onayla
                  </button>
                )}
                <Link
                  href={`/admin/sistem-beslemesi/${candidate.id}`}
                  className="inline-flex items-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {candidate.status === "pending" ? "Düzenle / Reddet" : "Detay"}
                </Link>
              </div>
            </div>
            {rowError?.id === candidate.id && <p className="mt-2 text-sm text-danger">{rowError.message}</p>}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
            Arama/filtre kriterlerine uyan aday bulunamadı.
          </div>
        )}
      </div>
    </div>
  );
}
