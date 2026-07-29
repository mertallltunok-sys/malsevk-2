"use client";

import { useMemo, useSyncExternalStore } from "react";
import { providerServicesStore } from "./provider-services";
import { isServiceCategoryId } from "./service-catalog";

/**
 * `provider-services.ts#getProviderServiceCategoryIds`'in REAKTİF hâli —
 * use-jobs.ts#useAllJobs ile AYNI `useSyncExternalStore` deseni. Bir
 * Hizmet Veren Hizmet Bilgilerim'den hizmetlerini değiştirip kaydettiğinde
 * (ya da farklı bir sekmede değiştirdiğinde), bu hook'u kullanan her bileşen
 * SAYFA YENİLENMEDEN yeniden render olur — job-visibility.ts'in Nakliye
 * izolasyon kuralının canlı ekranlarda (provider-job-listing.tsx,
 * job-detail-content.tsx, operation-status-card.tsx) her zaman GÜNCEL
 * hizmet kümesine göre uygulanmasını garanti eder.
 */
export function useProviderServiceCategoryIds(userId: string | undefined): string[] {
  const rows = useSyncExternalStore(
    providerServicesStore.subscribe,
    providerServicesStore.getSnapshot,
    providerServicesStore.getServerSnapshot,
  );
  return useMemo(() => {
    if (!userId) return [];
    return rows
      .filter((row) => row.userId === userId)
      .map((row) => row.serviceCategoryId)
      .filter(isServiceCategoryId);
  }, [rows, userId]);
}
