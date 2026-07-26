"use client";

import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { formatJobDate } from "../_lib/jobs";
import { getViewerScopedJobStatus } from "../_lib/offers";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import { useJobsForOperation } from "../_lib/use-jobs";
import type { Job, Offer, Session } from "../_lib/types";
import { StatusBadge } from "./status-badge";

/**
 * Çoklu Hizmet Operasyonu — Aşama 3: aynı operasyona (bkz.
 * job-store.ts#getJobsByOperationId) bağlı kardeş ilanların keşfi. Bu
 * yalnızca bir "keşif" bölümüdür — bkz. CLAUDE.md "Bağımsızlık": her ilan
 * kendi teklif/kabul/tamamlama/değerlendirme akışını bağımsız sürdürür,
 * burada hiçbir toplu işlem yoktur.
 *
 * `currentJob.operationId` yoksa çağıran taraf (job-detail-content.tsx) bu
 * bileşeni HİÇ render etmemelidir — burada da aynı kontrol tekrarlanır (savunma
 * amaçlı, tek bir görünürlük kuralı).
 *
 * Durum rozeti KRİTİK KULLANICI İZOLASYONU DÜZELTMESİ ile
 * `offers.ts#getViewerScopedJobStatus`e taşındı — `session` bu yüzden artık
 * zorunlu bir prop: durum, ilanın GERÇEK (job-geneli) durumu değil, GÖSTEREN
 * oturuma göre hesaplanır (bkz. o fonksiyonun dokümantasyonu).
 */
export function OperationSiblingJobsCard({
  currentJob,
  offers,
  session,
}: {
  currentJob: Job;
  offers: Offer[];
  session: Session | null;
}) {
  const operationJobs = useJobsForOperation(currentJob.operationId);

  if (!currentJob.operationId || operationJobs.length === 0) return null;

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-semibold text-foreground">Bu Operasyondaki Diğer Hizmetler</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Bu operasyon kapsamında toplam {operationJobs.length} hizmet ilanı bulunmaktadır.
      </p>

      <ul role="list" className="mt-4 flex flex-col gap-3">
        {operationJobs.map((operationJob) => {
          const isCurrent = operationJob.id === currentJob.id;
          const { label: statusLabel, tone: statusTone } = getViewerScopedJobStatus(operationJob, offers, session);

          const rowContent = (
            <>
              <div className="min-w-0 flex-1">
                <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
                  {getCategoryDisplayLabel(operationJob.category)}
                </span>
                <p className="mt-1.5 break-words text-sm font-semibold leading-snug text-foreground">
                  {operationJob.title}
                  {isCurrent && <span className="font-normal text-muted-foreground"> (Bu ilan)</span>}
                </p>
                <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{operationJob.district}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {formatJobDate(operationJob.workDate)}
                  </span>
                </div>
              </div>
              <StatusBadge label={statusLabel} tone={statusTone} />
            </>
          );

          if (isCurrent) {
            return (
              <li
                key={operationJob.id}
                aria-current="true"
                className="flex items-start justify-between gap-3 rounded-[10px] border border-accent bg-accent-soft/40 p-4"
              >
                {rowContent}
              </li>
            );
          }

          return (
            <li key={operationJob.id}>
              <Link
                href={`/ilanlar/${operationJob.id}`}
                className="flex items-start justify-between gap-3 rounded-[10px] border border-border bg-background p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {rowContent}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
