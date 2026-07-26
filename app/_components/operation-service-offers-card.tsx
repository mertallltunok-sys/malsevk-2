"use client";

import Link from "next/link";
import {
  getOperationStatusBucket,
  getOperationStatusBucketLabel,
  getOperationStatusBucketTone,
} from "../_lib/job-requests";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import { useJobsForOperation } from "../_lib/use-jobs";
import type { Job, Offer } from "../_lib/types";
import { StatusBadge } from "./status-badge";

/**
 * Çoklu Hizmet Operasyonu — Aşama 5: Aşama 3 ("Bu Operasyondaki Diğer
 * Hizmetler") ve Aşama 4 ("Operasyon Durumu") kartları DEĞİŞMEDEN korunur —
 * bu, onların HEMEN ALTINA eklenen, ayrı, üçüncü bir liste. Her hizmet
 * kendi bağımsız "Teklif Ver" kısayolunu taşır — bu yalnızca mevcut
 * `/ilanlar/[id]` route'una bir Link'tir (yeni bir teklif formu/route/modal
 * YOK); gerçek teklif akışı hep olduğu gibi o sayfadaki OfferPanel'de kalır.
 * Bir hizmete teklif verilmesi diğerlerini hiçbir şekilde etkilemez — her
 * satır tamamen bağımsız bir ilana işaret eder.
 *
 * `currentJob.operationId` yoksa ya da operasyondaki toplam ilan sayısı 2'den
 * azsa HİÇ render edilmez (Aşama 4'ün kartıyla aynı eşik — grupsuz bir
 * "diğer hizmetler" listesi göstermenin anlamı yok).
 */
export function OperationServiceOffersCard({
  currentJob,
  offers,
}: {
  currentJob: Job;
  offers: Offer[];
}) {
  const operationJobs = useJobsForOperation(currentJob.operationId);

  if (!currentJob.operationId || operationJobs.length < 2) return null;

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-foreground">Operasyondaki Hizmetler</h2>

      <ul role="list" className="mt-4 flex flex-col divide-y divide-border border-t border-border">
        {operationJobs.map((operationJob) => {
          const isCurrent = operationJob.id === currentJob.id;
          const statusBucket = getOperationStatusBucket(operationJob, offers);

          return (
            <li key={operationJob.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {getCategoryDisplayLabel(operationJob.category)}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {operationJob.title}
                  {isCurrent && <span> (Bu ilan)</span>}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <StatusBadge
                  label={getOperationStatusBucketLabel(statusBucket)}
                  tone={getOperationStatusBucketTone(statusBucket)}
                />
                {!isCurrent && (
                  <Link
                    href={`/ilanlar/${operationJob.id}`}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                  >
                    Teklif Ver
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
