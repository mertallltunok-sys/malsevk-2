"use client";

import { AlertTriangle, Check, ClipboardCopy, ExternalLink, Eye, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { copyToClipboard } from "../_lib/clipboard";
import {
  buildClaudeFixInstructionText,
  getSystemErrorSeverityLabel,
  getSystemErrorStatusLabel,
  listSystemErrorLogs,
  updateSystemErrorStatus,
  type SystemErrorLog,
  type SystemErrorSeverity,
  type SystemErrorStatus,
} from "../_lib/system-health";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { StatusBadge } from "./status-badge";

type SeverityFilter = "tumu" | SystemErrorSeverity | "cozuldu";
type TimeFilter = "tumu" | "24s" | "7g";

const SEVERITY_FILTERS: { key: SeverityFilter; label: string }[] = [
  { key: "tumu", label: "Tümü" },
  { key: "critical", label: "Kritik" },
  { key: "high", label: "Yüksek" },
  { key: "warning", label: "Uyarı" },
  { key: "info", label: "Bilgi" },
  { key: "cozuldu", label: "Çözüldü" },
];

const SEVERITY_TONE: Record<SystemErrorSeverity, "danger" | "warning" | "neutral"> = {
  critical: "danger",
  high: "danger",
  warning: "warning",
  info: "neutral",
};

const STATUS_TONE: Record<SystemErrorStatus, "danger" | "warning" | "success"> = {
  yeni: "danger",
  inceleniyor: "warning",
  cozuldu: "success",
};

function matchesSeverityFilter(log: SystemErrorLog, filter: SeverityFilter): boolean {
  if (filter === "tumu") return true;
  if (filter === "cozuldu") return log.status === "cozuldu";
  return log.severity === filter;
}

function matchesTimeFilter(log: SystemErrorLog, filter: TimeFilter): boolean {
  if (filter === "tumu") return true;
  const thresholdMs = filter === "24s" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(log.lastSeenAt).getTime() <= thresholdMs;
}

export function AdminSystemHealthContent() {
  const session = useSession();
  const isAdmin = session?.role === "admin";
  const searchParams = useSearchParams();
  const deepLinkedId = searchParams.get("hata");
  const initialSeverity = searchParams.get("onem");

  const [logs, setLogs] = useState<SystemErrorLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>(
    initialSeverity === "critical" || initialSeverity === "high" || initialSeverity === "warning" || initialSeverity === "info"
      ? initialSeverity
      : "tumu",
  );
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("tumu");
  const [screenFilter, setScreenFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkedId);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  // Gerçek veri çekimi burada, `setLoading(true)`/`setError(null)` İSE
  // yalnızca aşağıdaki `refresh()` (gerçek bir kullanıcı olayından —
  // "Yenile" butonu/durum güncellemesi sonrası — çağrılır) içinde yapılır;
  // bu proje `react-hooks/set-state-in-effect` kuralını zorunlu kılar (bkz.
  // admin-jobs-list.tsx'in AYNI deseni).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void listSystemErrorLogs()
      .then((result) => {
        if (cancelled) return;
        setLogs(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Hata kayıtları yüklenemedi. Lütfen tekrar deneyin.");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, refreshKey]);

  function refresh() {
    setLoading(true);
    setError(null);
    setRefreshKey((key) => key + 1);
  }

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    const screenQuery = screenFilter.trim().toLocaleLowerCase("tr-TR");
    return logs.filter((log) => {
      if (!matchesSeverityFilter(log, severityFilter)) return false;
      if (!matchesTimeFilter(log, timeFilter)) return false;
      if (screenQuery && !(log.affectedScreen ?? "").toLocaleLowerCase("tr-TR").includes(screenQuery)) return false;
      return true;
    });
  }, [logs, severityFilter, timeFilter, screenFilter]);

  const selectedLog = logs?.find((log) => log.id === selectedId) ?? filteredLogs[0] ?? null;

  if (!session) {
    return <AuthGateNotice message="Bu sayfayı görüntülemek için yönetici girişi yapmalısınız." loginRedirect="/admin/sistem-sagligi" />;
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
  if (error || !logs) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {error ?? "Hata kayıtları yüklenemedi."}
      </div>
    );
  }

  const summary = {
    critical: logs.filter((log) => log.severity === "critical" && log.status !== "cozuldu").length,
    high: logs.filter((log) => log.severity === "high" && log.status !== "cozuldu").length,
    warning: logs.filter((log) => log.severity === "warning" && log.status !== "cozuldu").length,
    resolved: logs.filter((log) => log.status === "cozuldu").length,
  };

  async function handleStatusChange(status: SystemErrorStatus) {
    if (!selectedLog) return;
    setStatusUpdating(true);
    setStatusError(null);
    const result = await updateSystemErrorStatus(selectedLog.id, status);
    setStatusUpdating(false);
    if (!result.ok) {
      setStatusError(result.error);
      return;
    }
    refresh();
  }

  async function handleCopy() {
    if (!selectedLog) return;
    const text = buildClaudeFixInstructionText(selectedLog);
    const succeeded = await copyToClipboard(text);
    setCopyFeedback(succeeded ? "Düzeltme talimatı kopyalandı" : "Kopyalama başarısız oldu, lütfen tekrar deneyin.");
    setTimeout(() => setCopyFeedback(null), 3000);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Kritik Hata</p>
          <p className="mt-1 text-2xl font-bold text-danger">{summary.critical}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Yüksek Öncelik</p>
          <p className="mt-1 text-2xl font-bold text-warning">{summary.high}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Uyarı</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{summary.warning}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Çözüldü</p>
          <p className="mt-1 text-2xl font-bold text-success">{summary.resolved}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {SEVERITY_FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSeverityFilter(option.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                severityFilter === option.key ? "bg-primary text-primary-foreground" : "border border-border text-foreground hover:border-primary/40"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          value={timeFilter}
          onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
          className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="tumu">Tüm Zamanlar</option>
          <option value="24s">Son 24 Saat</option>
          <option value="7g">Son 7 Gün</option>
        </select>
        <input
          type="text"
          value={screenFilter}
          onChange={(event) => setScreenFilter(event.target.value)}
          placeholder="Ekrana göre filtrele..."
          className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="button"
          onClick={refresh}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Yenile
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted-foreground">Henüz hiçbir sistem hatası kaydedilmedi.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <ul className="flex flex-col gap-2">
            {filteredLogs.length === 0 && (
              <li className="rounded-card border border-border bg-surface p-4 text-sm text-muted-foreground">Bu filtreye uyan kayıt yok.</li>
            )}
            {filteredLogs.map((log) => {
              const active = selectedLog?.id === log.id;
              return (
                <li key={log.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(log.id)}
                    className={`w-full rounded-card border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active ? "border-primary bg-accent-soft" : "border-border bg-surface hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge label={getSystemErrorSeverityLabel(log.severity)} tone={log.status === "cozuldu" ? "success" : SEVERITY_TONE[log.severity]} />
                      <span className="text-xs text-muted-foreground">{log.occurrenceCount}x</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium text-foreground">{log.message}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {log.affectedScreen ?? log.route ?? "Ekran belirtilmemiş"} · {getSystemErrorStatusLabel(log.status)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="rounded-card border border-border bg-surface p-6">
            {!selectedLog ? (
              <p className="text-sm text-muted-foreground">Detayları görmek için soldan bir kayıt seçin.</p>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge label={getSystemErrorSeverityLabel(selectedLog.severity)} tone={SEVERITY_TONE[selectedLog.severity]} />
                      <StatusBadge label={getSystemErrorStatusLabel(selectedLog.status)} tone={STATUS_TONE[selectedLog.status]} />
                    </div>
                    <p className="mt-2 text-base font-bold text-foreground">{selectedLog.message}</p>
                  </div>
                  {selectedLog.route && (
                    <Link
                      href={selectedLog.route}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Ekrana Git
                    </Link>
                  )}
                </div>

                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Etkilenen bölüm</dt>
                    <dd className="text-foreground">{selectedLog.affectedScreen ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Etkilenen rol</dt>
                    <dd className="text-foreground">{selectedLog.affectedRole ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Etkilenen işlem</dt>
                    <dd className="text-foreground">{selectedLog.affectedAction ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Hata kodu</dt>
                    <dd className="text-foreground">{selectedLog.errorCode ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">İlk görülme</dt>
                    <dd className="text-foreground">{new Date(selectedLog.firstSeenAt).toLocaleString("tr-TR")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Son görülme</dt>
                    <dd className="text-foreground">{new Date(selectedLog.lastSeenAt).toLocaleString("tr-TR")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Tekrar sayısı</dt>
                    <dd className="text-foreground">{selectedLog.occurrenceCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Ortam</dt>
                    <dd className="text-foreground">{selectedLog.environment}</dd>
                  </div>
                  {selectedLog.sourceFile && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs text-muted-foreground">Kaynak dosya / fonksiyon</dt>
                      <dd className="font-mono text-xs text-foreground">
                        {selectedLog.sourceFile}
                        {selectedLog.functionName ? ` (${selectedLog.functionName})` : ""}
                        {selectedLog.lineNumber ? `:${selectedLog.lineNumber}` : ""}
                      </dd>
                    </div>
                  )}
                </dl>

                <div className="rounded-md border border-border bg-background p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Muhtemel Neden</p>
                  {selectedLog.probableCause ? (
                    <>
                      <p className="mt-1.5 text-sm text-foreground">{selectedLog.probableCause}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Güven: {selectedLog.confidence === "yuksek" ? "Yüksek" : selectedLog.confidence === "orta" ? "Orta" : "Düşük"}
                      </p>
                      {selectedLog.relatedFiles && selectedLog.relatedFiles.length > 0 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">İlgili Kaynak:</span> {selectedLog.relatedFiles.join(", ")}
                        </p>
                      )}
                      {selectedLog.recommendedCheck && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Önerilen Kontrol:</span> {selectedLog.recommendedCheck}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      Bu kayıt için henüz otomatik bir kök neden çıkarımı yapılmadı — kaynak dosya/hata koduna göre elle inceleme
                      gerekir.
                    </p>
                  )}
                </div>

                {selectedLog.stackExcerpt && (
                  <div className="rounded-md border border-border bg-background p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hata Detayı</p>
                    <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">{selectedLog.stackExcerpt}</pre>
                  </div>
                )}

                {statusError && <p className="text-sm text-danger">{statusError}</p>}
                {copyFeedback && (
                  <p role="status" aria-live="polite" className="text-sm font-medium text-success">
                    {copyFeedback}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <button
                    type="button"
                    disabled={statusUpdating || selectedLog.status === "inceleniyor"}
                    onClick={() => handleStatusChange("inceleniyor")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    İnceleniyor Olarak İşaretle
                  </button>
                  <button
                    type="button"
                    disabled={statusUpdating || selectedLog.status === "cozuldu"}
                    onClick={() => handleStatusChange("cozuldu")}
                    className="inline-flex items-center gap-1.5 rounded-full bg-success px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Çözüldü Olarak İşaretle
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
                  >
                    <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                    Claude Düzeltme Talimatını Kopyala
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
