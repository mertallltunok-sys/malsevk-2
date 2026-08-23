"use client";

import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { AppNotification } from "./notifications";

/**
 * HİZMET BAZLI PROVIDER YETKİLENDİRMESİ bildirimleri (migration 0038/0039:
 * `service_authorized`/`service_authorization_revoked`/`service_document_
 * required`) — projedeki HER DİĞER bildirimin (notifications.ts, "Notifications
 * are derived, not stored") aksine bunlar GERÇEK, persisted Supabase satırları
 * (public.notifications, create_notification() ile yazılır — bkz. o RPC'lerin
 * kendi çağrıları) ve bu modül onları OLDUĞU GİBİ okur, localStorage'dan
 * yeniden TÜRETMEZ.
 *
 * GEREKÇE (provider_service_authorizations ile AYNI, bkz. o modülün kendi
 * dokümantasyonu): görev bölüm 30-31 açıkça "cross-device" istiyor — admin
 * PC-A'da bir hizmeti onayladığında, provider PC-B'de (farklı bir tarayıcı,
 * dolayısıyla farklı bir localStorage) sayfayı yenilediğinde bildirimi
 * GÖRMELİDİR. Yalnızca bu üç tür için okunur (`.in("type", [...])`) — diğer
 * 20 tür (yeni_teklif, teklif_kabul_edildi, vb.) hâlâ TAMAMEN localStorage'dan
 * türetilir, bu modül onlara HİÇ dokunmaz.
 *
 * OKUMA/AZALTMA: `read_at`/`dismissed_at` bu tabloda GERÇEKTEN var (0009) ama
 * bilerek YAZILMAZ — bunun yerine, use-notifications.ts#useNotifications'ın
 * bu modülü çağıran tarafı, sonucu projenin MEVCUT yerel notification-reads.ts/
 * notification-dismissals.ts mekanizmasına (aynı `AppNotification.id` alanı
 * üzerinden) katar — ikinci bir okundu/kapatıldı altyapısı İCAT EDİLMEZ
 * (görev gereksinimi: mevcut sistemleri yeniden kullan).
 */

const SERVICE_AUTH_NOTIFICATION_TYPES = ["service_document_required", "service_authorized", "service_authorization_revoked"] as const;
type ServiceAuthNotificationType = (typeof SERVICE_AUTH_NOTIFICATION_TYPES)[number];

type NotificationRow = {
  id: string;
  type: ServiceAuthNotificationType;
  title: string | null;
  message: string;
  metadata: { service_category_id?: string } | null;
  created_at: string;
};

/** Bildirime tıklanınca gidilecek hedef — mümkünse doğrudan o hizmete kilitli (görev bölüm 37: "derin bağlantı"). */
function resolveHref(type: ServiceAuthNotificationType, serviceCategoryId: string | undefined): string {
  if (type === "service_document_required" && serviceCategoryId) {
    return `/panel/belge-yukleme?hizmet=${encodeURIComponent(serviceCategoryId)}`;
  }
  if (type === "service_authorized" && serviceCategoryId) {
    return `/ilanlar?kategori=${encodeURIComponent(serviceCategoryId)}`;
  }
  return "/panel/profil";
}

function mapRow(row: NotificationRow): AppNotification {
  const serviceCategoryId = row.metadata?.service_category_id;
  return {
    id: `sb-notif-${row.id}`,
    notificationType: row.type,
    title: row.title ?? undefined,
    message: row.message,
    ilanId: "",
    href: resolveHref(row.type, serviceCategoryId),
    createdAt: row.created_at,
  };
}

/** Yalnızca çağıranın KENDİ bildirimlerini döner — RLS (`recipient_id = auth.uid()`, ayrı bir politika gerekmez, notifications tablosunun 0009'daki kendi genel politikası) zaten bunu garanti eder. */
export async function getServiceAuthorizationNotifications(): Promise<AppNotification[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, metadata, created_at")
    .in("type", SERVICE_AUTH_NOTIFICATION_TYPES)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as unknown as NotificationRow[]).map(mapRow);
}
