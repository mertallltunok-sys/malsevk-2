"use client";

import { useSyncExternalStore } from "react";
import { getJobs as getSeedJobs } from "./jobs";
import { getJobsByOperationId, userJobsStore } from "./job-store";
import type { Job } from "./types";

const EMPTY_OPERATION_JOBS: Job[] = [];

/**
 * İlanlar iki kaynaktan gelir: sabit kod içi örnek ilanlar (her yerde
 * bilinir) ve kullanıcının oluşturduğu ilanlar (yalnızca localStorage'da,
 * bu yüzden sadece istemcide bilinebilir). Kullanıcı ilanları en yeni önde
 * gösterilir.
 */
export function useAllJobs(): Job[] {
  const userCreated = useSyncExternalStore(
    userJobsStore.subscribe,
    userJobsStore.getSnapshot,
    userJobsStore.getServerSnapshot,
  );
  return [...userCreated].reverse().concat(getSeedJobs());
}

export function useJobById(id: string): Job | null {
  const all = useAllJobs();
  return all.find((job) => job.id === id) ?? null;
}

/**
 * Bir operasyona (bkz. job-store.ts#getJobsByOperationId) bağlı TÜM ilanları
 * (çağıranın kendi ilanı DAHİL, `useAllJobs`'un aksine hiç ters çevrilmeden —
 * bkz. CLAUDE.md "Çoklu Hizmet Operasyonu": kardeş ilanlar arasında sıralama
 * kullanıcının oluşturduğu sırayı korumalıdır) reaktif olarak döndürür.
 * Ham (stabil referanslı) mağaza anlık görüntüsü `useSyncExternalStore`'a
 * geçirilir, filtreleme render gövdesinde yapılır — `useJobById`'nin `.find()`
 * kalıbıyla aynı, `getJobsByOperationId`'nin kendisini `getSnapshot` olarak
 * geçirmek her render'da yeni bir dizi referansı üretip
 * `useSyncExternalStore`'un tutarlılık kontrolünü bozardı.
 */
export function useJobsForOperation(operationId: string | undefined): Job[] {
  useSyncExternalStore(
    userJobsStore.subscribe,
    userJobsStore.getSnapshot,
    userJobsStore.getServerSnapshot,
  );
  if (!operationId) return EMPTY_OPERATION_JOBS;
  return getJobsByOperationId(operationId);
}
