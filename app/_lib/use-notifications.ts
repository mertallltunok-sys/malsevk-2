"use client";

import { useMemo } from "react";
import { getNotificationsForSession, getProviderDocumentReviewNotifications, type AppNotification } from "./notifications";
import { useAllJobs } from "./use-jobs";
import { useAllOffers } from "./use-offers";
import { useDismissedNotificationIds } from "./use-notification-dismissals";
import type { Session } from "./types";

/**
 * Silinen (dismiss edilen) bildirimler burada, TEK noktada filtrelenir —
 * bu hook'un her tüketicisi (notification-bell.tsx, notifications-panel.tsx)
 * otomatik olarak güncel listeyi görür; ayrı ayrı filtreleme tekrarlanmaz.
 * Belge inceleme bildirimleri (bkz. getProviderDocumentReviewNotifications)
 * `jobs`/`offers`e bağlı olmadığı için AYRI türetilir, burada birleştirilir —
 * dismiss/okunma davranışı diğer bildirimlerle birebir aynıdır (aynı id
 * alanı üzerinden çalışır).
 */
export function useNotifications(session: Session): AppNotification[] {
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const dismissedIds = useDismissedNotificationIds(session.id);
  return useMemo(() => {
    const all = [...getNotificationsForSession(session, jobs, offers), ...getProviderDocumentReviewNotifications(session)].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
    if (dismissedIds.length === 0) return all;
    const dismissedSet = new Set(dismissedIds);
    return all.filter((notification) => !dismissedSet.has(notification.id));
  }, [session, jobs, offers, dismissedIds]);
}
