import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * SİSTEM SAĞLIĞI — Yönetim Paneli yeniden tasarımı, görev bölüm 11-15.
 *
 * Tüm okuma/yazma `report_system_error`/`update_system_error_status` RPC'leri
 * (migration 0072) ve `system_error_logs` tablosu üzerinden gerçekleşir —
 * bkz. o migration'ın kendi dokümantasyonu. Bu dosya ikinci bir hata
 * günlüğü İCAT ETMEZ; ciddiyet sınıflandırması SUNUCU tarafında (RPC içinde)
 * yapılır, bu dosya yalnızca çağırır ve tipler.
 */

export type SystemErrorSeverity = "critical" | "high" | "warning" | "info";
export type SystemErrorStatus = "yeni" | "inceleniyor" | "cozuldu";
export type SystemErrorSource = "client" | "server";

export type SystemErrorLog = {
  id: string;
  fingerprint: string;
  severity: SystemErrorSeverity;
  status: SystemErrorStatus;
  errorCode: string | null;
  message: string;
  source: SystemErrorSource;
  route: string | null;
  affectedScreen: string | null;
  affectedRole: string | null;
  affectedAction: string | null;
  environment: string;
  sourceFile: string | null;
  functionName: string | null;
  lineNumber: number | null;
  requestId: string | null;
  stackExcerpt: string | null;
  probableCause: string | null;
  confidence: "yuksek" | "orta" | "dusuk" | null;
  evidence: Record<string, unknown> | null;
  relatedFiles: string[] | null;
  /** 0073: "Önerilen Kontrol" — probable_cause'a eşlik eden, admin'in yapması önerilen somut bir sonraki adım (kural tabanlı, report_system_error() içinde hesaplanır). */
  recommendedCheck: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  createdAt: string;
};

type SystemErrorLogRow = {
  id: string;
  fingerprint: string;
  severity: SystemErrorSeverity;
  status: SystemErrorStatus;
  error_code: string | null;
  message: string;
  source: SystemErrorSource;
  route: string | null;
  affected_screen: string | null;
  affected_role: string | null;
  affected_action: string | null;
  environment: string;
  source_file: string | null;
  function_name: string | null;
  line_number: number | null;
  request_id: string | null;
  stack_excerpt: string | null;
  probable_cause: string | null;
  confidence: "yuksek" | "orta" | "dusuk" | null;
  evidence: Record<string, unknown> | null;
  related_files: string[] | null;
  recommended_check: string | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  created_at: string;
};

function mapRow(row: SystemErrorLogRow): SystemErrorLog {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    severity: row.severity,
    status: row.status,
    errorCode: row.error_code,
    message: row.message,
    source: row.source,
    route: row.route,
    affectedScreen: row.affected_screen,
    affectedRole: row.affected_role,
    affectedAction: row.affected_action,
    environment: row.environment,
    sourceFile: row.source_file,
    functionName: row.function_name,
    lineNumber: row.line_number,
    requestId: row.request_id,
    stackExcerpt: row.stack_excerpt,
    probableCause: row.probable_cause,
    confidence: row.confidence,
    evidence: row.evidence,
    relatedFiles: row.related_files,
    recommendedCheck: row.recommended_check,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS =
  "id, fingerprint, severity, status, error_code, message, source, route, affected_screen, affected_role, affected_action, environment, source_file, function_name, line_number, request_id, stack_excerpt, probable_cause, confidence, evidence, related_files, recommended_check, occurrence_count, first_seen_at, last_seen_at, resolved_at, created_at";

export async function listSystemErrorLogs(): Promise<SystemErrorLog[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("system_error_logs")
    .select(SELECT_COLUMNS)
    .order("last_seen_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as SystemErrorLogRow[]).map(mapRow);
}

export async function getUnresolvedCriticalErrorCount(): Promise<number | null> {
  const supabase = createSupabaseBrowserClient();
  const { count, error } = await supabase
    .from("system_error_logs")
    .select("*", { count: "exact", head: true })
    .eq("severity", "critical")
    .neq("status", "cozuldu");
  if (error) return null;
  return count ?? 0;
}

export type UpdateSystemErrorStatusResult = { ok: true } | { ok: false; error: string };

const STATUS_ERROR_MESSAGES: Record<string, string> = {
  ML152: "Bu işlem yalnızca yöneticiler tarafından yapılabilir.",
  ML153: "Geçersiz durum değeri.",
  ML154: "Hata kaydı bulunamadı.",
};

export async function updateSystemErrorStatus(
  errorId: string,
  status: SystemErrorStatus,
): Promise<UpdateSystemErrorStatusResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_system_error_status", {
    p_error_id: errorId,
    p_status: status,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    console.error("update_system_error_status başarısız:", error);
    return { ok: false, error: (code && STATUS_ERROR_MESSAGES[code]) || "Durum güncellenemedi. Lütfen tekrar deneyin." };
  }
  return { ok: true };
}

export type ReportSystemErrorInput = {
  message: string;
  source: SystemErrorSource;
  errorCode?: string | null;
  route?: string | null;
  affectedScreen?: string | null;
  affectedAction?: string | null;
  sourceFile?: string | null;
  functionName?: string | null;
  lineNumber?: number | null;
  stackExcerpt?: string | null;
  requestId?: string | null;
  evidence?: Record<string, unknown> | null;
};

/**
 * Herhangi bir GERÇEK, beklenmeyen istisnayı (thrown exception / kod hatası)
 * Sistem Sağlığı'na bildirir. Yalnızca oturum açmış bir kullanıcı için
 * çalışır (RPC `auth.uid()` gerektirir, bkz. migration) — anonim/oturumsuz
 * bağlamlarda sessizce atlanır (görev kapsamı: kayıt sırasında zaten
 * `document-validation` gibi rotaların oturumsuz çalıştığı biliniyor, bunlar
 * için raporlama zorunlu DEĞİL). Ateşle-ve-unut (fire-and-forget): mevcut
 * `console.error` çağrısının YANINA eklenir, onun YERİNE geçmez — bkz.
 * local-storage.ts#writeJson'un "gerçek hata konsola, kullanıcıya sade mesaj"
 * ilkesiyle aynı ruh. Kendi hatası asla uygulamayı çökertmez (kendi içinde
 * yutulur) — görev gereksinimi: "hata izleme mekanizmasının kendi hatası
 * uygulamayı çökertmesin."
 */
export function reportSystemError(input: ReportSystemErrorInput): void {
  if (typeof window === "undefined") return;
  try {
    const supabase = createSupabaseBrowserClient();
    void supabase
      .rpc("report_system_error", {
        p_message: input.message.slice(0, 500),
        p_source: input.source,
        p_error_code: input.errorCode ?? null,
        p_route: input.route ?? (typeof window !== "undefined" ? window.location.pathname : null),
        p_affected_screen: input.affectedScreen ?? null,
        p_affected_action: input.affectedAction ?? null,
        p_source_file: input.sourceFile ?? null,
        p_function_name: input.functionName ?? null,
        p_line_number: input.lineNumber ?? null,
        p_stack_excerpt: input.stackExcerpt ? input.stackExcerpt.slice(0, 2000) : null,
        p_request_id: input.requestId ?? null,
        p_evidence: input.evidence ?? null,
        p_environment: process.env.NODE_ENV === "production" ? "production" : "development",
      })
      .then(({ error }) => {
        // RPC oturumsuz çağrılırsa (ML150) ya da geçici bir ağ hatasıysa
        // burada sessizce bırakılır — Sistem Sağlığı'nın kendisi ikinci bir
        // hata döngüsü BAŞLATMAMALI (görev gereksinimi).
        if (error) console.error("reportSystemError: report_system_error RPC başarısız:", error);
      });
  } catch (error) {
    console.error("reportSystemError: beklenmeyen hata (yutuldu):", error);
  }
}

const SEVERITY_LABEL: Record<SystemErrorSeverity, string> = {
  critical: "KRİTİK",
  high: "YÜKSEK",
  warning: "UYARI",
  info: "BİLGİ",
};

const STATUS_LABEL: Record<SystemErrorStatus, string> = {
  yeni: "Yeni",
  inceleniyor: "İnceleniyor",
  cozuldu: "Çözüldü",
};

export function getSystemErrorSeverityLabel(severity: SystemErrorSeverity): string {
  return SEVERITY_LABEL[severity];
}

export function getSystemErrorStatusLabel(status: SystemErrorStatus): string {
  return STATUS_LABEL[status];
}

/**
 * Claude Düzeltme Talimatını Kopyala — üçüncü taraf bir yapay zekâ servisine
 * hiçbir çağrı yapılmaz (görev gereksinimi); bu, kaydın kendi alanlarından
 * saf bir metin şablonu üreten YEREL bir fonksiyondur. Şifre/token/kişisel
 * veri İÇERMEZ — kaynak veri (message/route/stack) zaten `report_system_error`
 * çağıranların kendi kontrolündedir; bu şablon o alanların dışına hiçbir şey
 * eklemez.
 */
export function buildClaudeFixInstructionText(log: SystemErrorLog): string {
  const lines: string[] = [
    "MALSEVK Development ortamında tekrar eden bir sistem hatası var.",
    "",
    `Proje: MALSEVK`,
    `Ortam: ${log.environment === "production" ? "Production (DOKUNMA — bu talimat asla production'a uygulanmamalı)" : "Development"}`,
    `Ekran: ${log.affectedScreen ?? "Belirtilmemiş"}`,
    `Rota: ${log.route ?? "Belirtilmemiş"}`,
    `Etkilenen rol: ${log.affectedRole ?? "Bilinmiyor"}`,
    `Etkilenen işlem: ${log.affectedAction ?? "Belirtilmemiş"}`,
    `Ciddiyet: ${getSystemErrorSeverityLabel(log.severity)}`,
    `Hata kodu: ${log.errorCode ?? "Yok"}`,
    `Hata mesajı: ${log.message}`,
    `İlk görülme: ${new Date(log.firstSeenAt).toLocaleString("tr-TR")}`,
    `Son görülme: ${new Date(log.lastSeenAt).toLocaleString("tr-TR")}`,
    `Tekrar sayısı: ${log.occurrenceCount}`,
  ];
  if (log.sourceFile) lines.push(`Kaynak dosya: ${log.sourceFile}${log.functionName ? ` (${log.functionName})` : ""}${log.lineNumber ? `:${log.lineNumber}` : ""}`);
  if (log.probableCause) lines.push(`Muhtemel neden: ${log.probableCause} (Güven: ${log.confidence ?? "belirtilmemiş"})`);
  if (log.relatedFiles && log.relatedFiles.length > 0) lines.push(`İlgili kaynak: ${log.relatedFiles.join(", ")}`);
  if (log.recommendedCheck) lines.push(`Önerilen kontrol: ${log.recommendedCheck}`);
  if (log.stackExcerpt) lines.push("", "Stack/hata detayı (kısaltılmış):", log.stackExcerpt);

  lines.push(
    "",
    "Yeniden üretme adımları: yukarıdaki ekran/rotaya, belirtilen rolde gerçek bir Development hesabıyla gidip aynı işlemi tekrarlayın.",
    "",
    "Talimatlar:",
    "- Önce mevcut mimariyi ve ilgili dosyaları analiz et, kök nedeni bul.",
    "- Mevcut Supabase/RLS/RPC yetkilendirme sınırlarını KORUYARAK düzelt — hiçbir güvenlik kontrolünü gevşetme.",
    "- Hizmet alan/hizmet veren rol izolasyonunu koru.",
    "- Yalnızca Development ortamında çalış, Production'a KESİNLİKLE dokunma.",
    "- Düzeltmeyi gerçek bir kullanıcı akışıyla (gerçek tarayıcı, gerçek Development verisi) test et.",
    "- Tamamladığında kısa bir sonuç raporu ver: kök neden, yapılan değişiklik, test kanıtı.",
  );

  return lines.join("\n");
}
