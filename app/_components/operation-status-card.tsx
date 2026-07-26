"use client";

import {
  getOperationStatusBucket,
  getOperationStatusBucketLabel,
  getOperationStatusBucketTone,
  getOperationStatusSummary,
  OPERATION_STATUS_BUCKET_ORDER,
} from "../_lib/job-requests";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import { useJobsForOperation } from "../_lib/use-jobs";
import type { Job, Offer } from "../_lib/types";
import { StatusBadge } from "./status-badge";

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border bg-background px-3 py-2">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Çoklu Hizmet Operasyonu — Aşama 4: aynı operasyondaki tüm kardeş ilanların
 * (bkz. Aşama 3'ün OperationSiblingJobsCard'ı, hemen üstünde render edilir)
 * durumunu TEK BAKIŞTA özetleyen, YALNIZCA GÖRSEL bir kart. Hiçbir ilanın/
 * teklifin durumunu değiştirmez, hiçbir toplu işlem içermez — bkz.
 * job-requests.ts#getOperationStatusSummary (tek türetme kaynağı, bu
 * bileşen ve Aşama 3 kartı aynı yardımcıları paylaşır).
 *
 * `currentJob.operationId` yoksa YA DA operasyondaki toplam ilan sayısı 2'den
 * azsa (yalnızca kendisi) HİÇ render edilmez — çağıran taraf
 * (job-detail-content.tsx) zaten `operationId` varlığını kontrol eder, burada
 * "en az 2 ilan" kuralı AYRICA (savunma amaçlı) uygulanır.
 */
export function OperationStatusCard({
  currentJob,
  offers,
}: {
  currentJob: Job;
  offers: Offer[];
}) {
  const operationJobs = useJobsForOperation(currentJob.operationId);

  if (!currentJob.operationId || operationJobs.length < 2) return null;

  const summary = getOperationStatusSummary(operationJobs, offers);

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-foreground">Operasyon Durumu</h2>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-medium text-foreground">
            Operasyon İlerlemesi: %{summary.progressPercent}
          </span>
          <span className="text-xs text-muted-foreground">
            {summary.completedCount} / {summary.total} hizmet tamamlandı
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={summary.progressPercent}
          aria-label="Operasyon ilerlemesi"
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-accent-soft"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${summary.progressPercent}%` }}
          />
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <SummaryStat label="Toplam Hizmet" value={summary.total} />
        {OPERATION_STATUS_BUCKET_ORDER.map((bucket) => (
          <SummaryStat
            key={bucket}
            label={getOperationStatusBucketLabel(bucket)}
            value={summary.counts[bucket]}
          />
        ))}
      </dl>

      <ul role="list" className="mt-5 flex flex-col divide-y divide-border border-t border-border">
        {operationJobs.map((operationJob) => {
          const isCurrent = operationJob.id === currentJob.id;
          const statusBucket = getOperationStatusBucket(operationJob, offers);
          return (
            <li key={operationJob.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm text-foreground">
                {getCategoryDisplayLabel(operationJob.category)}
                {isCurrent && <span className="font-normal text-muted-foreground"> (Bu ilan)</span>}
              </span>
              <StatusBadge
                label={getOperationStatusBucketLabel(statusBucket)}
                tone={getOperationStatusBucketTone(statusBucket)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
