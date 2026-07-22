"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getDismissedNotificationIds,
  subscribeToNotificationDismissals,
} from "./notification-dismissals";

const EMPTY_IDS: string[] = [];

function getServerDismissedIdsSnapshot(): string[] {
  return EMPTY_IDS;
}

export function useDismissedNotificationIds(userId: string): string[] {
  const getSnapshot = useCallback(() => getDismissedNotificationIds(userId), [userId]);
  return useSyncExternalStore(subscribeToNotificationDismissals, getSnapshot, getServerDismissedIdsSnapshot);
}
