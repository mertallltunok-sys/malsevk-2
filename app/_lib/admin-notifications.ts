import { getApprovalCenterItems } from "./admin-approval-center";
import { getSystemErrorSeverityLabel, listSystemErrorLogs } from "./system-health";

/**
 * ADMIN BİLDİRİM MERKEZİ (görev bölüm 17) — ikinci bir bildirim tablosu/
 * sistemi İCAT EDİLMEZ. Liste, ZATEN var olan iki gerçek kaynaktan
 * (`admin-approval-center.ts`in bekleyen kuyruğu, `system-health.ts`nin
 * çözülmemiş kritik hataları) her admin sayfa yüklemesinde türetilir.
 * Okundu/okunmadı durumu için de ikinci bir mekanizma YOKTUR — mevcut
 * `notification-reads.ts` (hizmet alan/hizmet veren bildirimlerinin zaten
 * kullandığı, kullanıcı id'sine göre anahtarlanmış localStorage listesi)
 * doğrudan yeniden kullanılır, admin id'si de yalnızca bir "userId" olduğu
 * için bu modülün rol farkı gözetmeyen tasarımına birebir uyar.
 */

export type AdminNotificationSeverity = "critical" | "warning" | "info";

export type AdminNotification = {
  id: string;
  title: string;
  detail: string;
  createdAtIso: string;
  severity: AdminNotificationSeverity;
  href: string;
};

export async function getAdminNotifications(): Promise<AdminNotification[]> {
  const [approvalItems, errorLogs] = await Promise.all([
    getApprovalCenterItems().catch(() => []),
    listSystemErrorLogs().catch(() => []),
  ]);

  const notifications: AdminNotification[] = [];

  for (const item of approvalItems) {
    notifications.push({
      id: `approval-${item.kind}-${item.id}`,
      title:
        item.kind === "belge"
          ? item.isAdditionalDocumentFollowUp
            ? "Ek belge bekleniyor"
            : "Yeni firma belgesi onay bekliyor"
          : "Yeni ilan onayı bekliyor",
      detail: `${item.subjectName}${item.categoryLabel ? ` · ${item.categoryLabel}` : ""}`,
      createdAtIso: item.waitingSinceIso,
      severity: item.isPriority ? "warning" : "info",
      href: item.href,
    });
  }

  for (const log of errorLogs) {
    if (log.severity !== "critical" || log.status === "cozuldu") continue;
    notifications.push({
      id: `system-error-${log.id}`,
      title: `Kritik sistem hatası (${getSystemErrorSeverityLabel(log.severity)})`,
      detail: log.message,
      createdAtIso: log.lastSeenAt,
      severity: "critical",
      href: `/admin/sistem-sagligi?hata=${log.id}`,
    });
  }

  notifications.sort((a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime());
  return notifications;
}
