"use client";

import { useMemo } from "react";
import { getNotificationsForSession, type AppNotification } from "./notifications";
import { useAllJobs } from "./use-jobs";
import { useAllOffers } from "./use-offers";
import type { Session } from "./types";

export function useNotifications(session: Session): AppNotification[] {
  const jobs = useAllJobs();
  const offers = useAllOffers();
  return useMemo(
    () => getNotificationsForSession(session, jobs, offers),
    [session, jobs, offers],
  );
}
