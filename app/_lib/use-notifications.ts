"use client";

import { useMemo } from "react";
import { getNotificationsForSession, type AppNotification } from "./notifications";
import { useAllJobs } from "./use-jobs";
import { useAllOffers } from "./use-offers";
import { useDismissedNotificationIds } from "./use-notification-dismissals";
import type { Session } from "./types";

/**
 * Silinen (dismiss edilen) bildirimler burada, TEK noktada filtrelenir —
 * bu hook'un her tüketicisi (notification-bell.tsx, notifications-panel.tsx)
 * otomatik olarak güncel listeyi görür; ayrı ayrı filtreleme tekrarlanmaz.
 */
export function useNotifications(session: Session): AppNotification[] {
  const jobs = useAllJobs();
  const offers = useAllOffers();
  const dismissedIds = useDismissedNotificationIds(session.id);
  return useMemo(() => {
    const all = getNotificationsForSession(session, jobs, offers);
    if (dismissedIds.length === 0) return all;
    const dismissedSet = new Set(dismissedIds);
    return all.filter((notification) => !dismissedSet.has(notification.id));
  }, [session, jobs, offers, dismissedIds]);
}
