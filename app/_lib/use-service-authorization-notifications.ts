"use client";

import { useEffect, useState } from "react";
import { getServiceAuthorizationNotifications } from "./supabase-service-authorization-notifications";
import type { AppNotification } from "./notifications";

/**
 * `getServiceAuthorizationNotifications`in reaktif hâli — use-notifications.ts#
 * useNotifications tarafından, mevcut localStorage-türetilmiş bildirimlerin
 * YANINA eklenir (bkz. o dosyanın güncellenmiş dokümantasyonu). `loading`
 * yalnızca `true -> false` yönünde hareket eder (bkz. use-my-service-
 * authorizations.ts'in AYNI, projede zaten kabul edilmiş deseni) — bir
 * effect gövdesinde senkron `setState`i yasaklayan proje kuralı gereği.
 */
export function useServiceAuthorizationNotifications(providerId: string | undefined): AppNotification[] {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    void getServiceAuthorizationNotifications().then((result) => {
      if (cancelled) return;
      setNotifications(result);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  return providerId ? notifications : [];
}
