"use client";

import { useSyncExternalStore } from "react";
import { getJobs as getSeedJobs } from "./jobs";
import { userJobsStore } from "./job-store";
import type { Job } from "./types";

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
