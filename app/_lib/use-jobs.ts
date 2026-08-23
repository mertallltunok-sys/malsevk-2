"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getJobs as getSeedJobs } from "./jobs";
import { getJobsByOperationId, userJobsStore } from "./job-store";
import { fetchAllVisibleJobsFromSupabase } from "./supabase-job-reads";
import { isSupabaseJobSyncEnabled } from "./supabase-job-sync";
import type { Job } from "./types";

const EMPTY_OPERATION_JOBS: Job[] = [];
const EMPTY_REMOTE_JOBS: Job[] = [];

/**
 * Merkezi Veri Zorunluluğu (Development Temizliği görevi, Faz 5) — bu
 * tarayıcının hiç oluşturmadığı (yalnızca Supabase'te var olan, ör. başka
 * bir hesap/cihazda oluşturulmuş ya da doğrudan RPC ile senkronlanmış) ilanlar
 * için TEK, paylaşılan geri dönüş noktası. `useAllJobs()` içinde (aşağıda)
 * kullanılır — böylece hem ilan listeleme ekranları (job-list.tsx,
 * provider-job-listing.tsx) hem `useJobById` (job-detail-content.tsx) TEK
 * bir değişiklikle aynı anda kapsanır, üç ayrı yerde tekrar mantık yazılmaz.
 * `isSupabaseJobSyncEnabled()` kapalıyken (varsayılan) bu hiç çalışmaz —
 * bugünkü localStorage-only davranış BİREBİR korunur.
 */
function useRemoteJobsFallback(): Job[] {
  const [remoteJobs, setRemoteJobs] = useState<Job[]>(EMPTY_REMOTE_JOBS);

  useEffect(() => {
    if (!isSupabaseJobSyncEnabled()) return;
    let cancelled = false;
    fetchAllVisibleJobsFromSupabase().then((jobs) => {
      if (!cancelled) setRemoteJobs(jobs);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return remoteJobs;
}

/**
 * Bir ilan hem yerelde hem Supabase'te varsa hangisinin KAZANACAĞI —
 * "Kritik İlan Senkronizasyonu" görevi: sunucu ADMİN TARAFINDAN GERÇEK bir
 * karar verdiyse (onay/red/kapatma — moderationStatus artık "pending_review"
 * DEĞİL, ya da closedAt doluysa) o karar TEK doğruluk kaynağıdır, eski
 * yerel taslak onu asla EZMEMELİDİR ("Eski localStorage kaydı Supabase'teki
 * yeni durumu ezmemeli" — görev gereksinimi). Admin henüz karar VERMEDİYSE
 * (hâlâ "pending_review", hiç kapatılmamış) yerel kopya kazanır — bu, ilan
 * sahibinin `job-edit-form.tsx` ile yaptığı ve BUGÜN Supabase'e hiç
 * senkronlanmayan bir düzenlemenin (bkz. supabase-job-sync.ts'in yalnızca
 * CREATE'i senkronladığı, UPDATE'i değil) kendi tarayıcısında görünmez
 * olmasını ÖNLER — aksi halde bir düzenleme, admin karar vermeden önce bile,
 * sahibinin kendi ekranında sessizce kaybolurdu.
 */
function remoteWinsOverLocal(remote: Job): boolean {
  return remote.moderationStatus !== undefined && remote.moderationStatus !== "pending_review" || Boolean(remote.closedAt);
}

/**
 * İlanlar üç kaynaktan gelir: sabit kod içi örnek ilanlar (her yerde
 * bilinir), kullanıcının BU tarayıcıda oluşturduğu ilanlar (localStorage) ve
 * BAŞKA bir tarayıcı/hesapta oluşturulup ya da yalnızca Supabase'e
 * senkronlanmış ilanlar (yukarıdaki `useRemoteJobsFallback`). Yalnız yerelde
 * olan bir ilan (hiç Supabase karşılığı yok, ör. senkron başarısız oldu —
 * bkz. types.ts#Job.supabaseSyncFailedAt) daima yerel kalır. HER İKİSİNDE de
 * varsa `remoteWinsOverLocal` kararı uygulanır (yukarıda). Kullanıcı ilanları
 * en yeni önde gösterilir.
 */
export function useAllJobs(): Job[] {
  const userCreated = useSyncExternalStore(
    userJobsStore.subscribe,
    userJobsStore.getSnapshot,
    userJobsStore.getServerSnapshot,
  );
  const remoteJobs = useRemoteJobsFallback();
  const local = [...userCreated].reverse().concat(getSeedJobs());
  if (remoteJobs.length === 0) return local;

  const remoteById = new Map(remoteJobs.map((job) => [job.id, job]));
  const merged = local.map((localJob) => {
    const remote = remoteById.get(localJob.id);
    return remote && remoteWinsOverLocal(remote) ? remote : localJob;
  });

  const localIds = new Set(local.map((job) => job.id));
  const remoteOnly = remoteJobs.filter((job) => !localIds.has(job.id));
  return remoteOnly.length === 0 ? merged : merged.concat(remoteOnly);
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
