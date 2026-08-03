"use client";

import Link from "next/link";
import {
  getPublicOperationStatusSummary,
  getOperationStatusBucketLabel,
  PUBLIC_OPERATION_STATUS_BUCKET_ORDER,
} from "../_lib/job-requests";
import { useFilterVisibleJobs } from "../_lib/job-visibility";
import { getOperationServiceCardStatus } from "../_lib/offers";
import { getCategoryDisplayLabel } from "../_lib/service-catalog";
import { useJobsForOperation } from "../_lib/use-jobs";
import type { Job, Offer, Session } from "../_lib/types";
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
 * Çoklu Hizmet Operasyonu — bir önceki "hizmet kartlarının sadeleştirilmesi"
 * görevi YANLIŞ uygulanmıştı: aynı veriyi (kardeş ilan listesi + durum/aksiyon)
 * hâlâ ÜÇ AYRI kart olarak ("Bu Operasyondaki Diğer Hizmetler",
 * "Operasyondaki Hizmetler", "Operasyon Durumu") render ediyordu — yalnızca
 * her kartın İÇİNDEKİ satır metnini birleştirmişti, kartların KENDİLERİNİ
 * birleştirmemişti. Bu görev kök nedeni düzeltir: artık sayfada operasyon
 * hizmetlerinin gösterildiği TEK yer burasıdır — eski
 * `operation-sibling-jobs-card.tsx` (OperationSiblingJobsCard) ve
 * `operation-service-offers-card.tsx` (OperationServiceOffersCard) dosyaları
 * SİLİNDİ; ikisinin sahip olduğu veri/durum/aksiyon/yönlendirme davranışı
 * (aşağıdaki satır listesi) buraya taşındı.
 *
 * `currentJob.operationId` yoksa YA DA operasyondaki toplam ilan sayısı 2'den
 * azsa (yalnızca kendisi) HİÇ render edilmez — çağıran taraf
 * (job-detail-content.tsx) zaten `operationId` varlığını kontrol eder, burada
 * "en az 2 ilan" kuralı AYRICA (savunma amaçlı) uygulanır.
 *
 * Özet sayıları (Toplam Hizmet/Teklife Açık/Devam Ediyor/.../İlerleme %) hâlâ
 * `getPublicOperationStatusSummary`den (GLOBAL/job-geneli, viewer-scoping yok)
 * gelir — bu görev bu aggregate hesaplamayı DEĞİŞTİRMEDİ. TEK istisna: Nakliye
 * izolasyonu (bkz. job-visibility.ts) — `operationJobs` bu fonksiyona
 * ulaşmadan ÖNCE `useFilterVisibleJobs` (REAKTİF, bkz. o dosyanın
 * dokümantasyonu) ile süzülür, bu yüzden Nakliye'ye kilitlenmiş bir Hizmet
 * Veren için "GLOBAL" olan şey zaten yalnızca kendi görebildiği (Nakliye)
 * hizmet(ler)dir — gizli kardeşlerin varlığı/sayısı özet sayılarına da satır
 * listesine de HİÇ sızmaz. Diğer tüm viewer'lar için bu hook girdiyi
 * değiştirmeden döner, davranış birebir aynı kalır.
 *
 * Hizmet listesindeki HER SATIR (hizmet türü + ilan başlığı + TEK durum/
 * aksiyon alanı) tek ortak doğruluk kaynağından, `offers.ts#
 * getOperationServiceCardStatus`den gelir — üç ayrı kartın üçünün de aynı
 * fonksiyonu çağırdığı ÖNCEKİ (yanlış) yapı yerine artık TEK kart TEK kez
 * hesaplıyor, paralel/tekrarlı bir mantık yok. `allowOfferAction: !isCurrent`
 * — şu an görüntülenen ilanın kendi satırı hiçbir zaman "Teklif Ver"
 * göstermez (o ilanın gerçek teklif formu zaten aynı sayfada, yukarıda,
 * OfferPanel olarak görünür durumdadır) ve "Bu ilan" ibaresiyle işaretlenir.
 *
 * Kardeş (current olmayan) satırlar, eski OperationSiblingJobsCard'ın
 * "keşif" amaçlı yönlendirme davranışını KORUYARAK tamamen bir `<Link
 * href="/ilanlar/[id]">`dır — "Teklif Ver" bu linkin İÇİNDE statik bir
 * görsel ifade (`<span>`) olarak gösterilir, ayrı/iç içe bir `<a>` OLARAK
 * DEĞİL: satırın herhangi bir yerine tıklamak zaten aynı hedefe (o ilanın
 * kendi sayfasındaki gerçek OfferPanel'e) götürür, bu yüzden geçersiz iç içe
 * bağlantı oluşturulmadan mevcut teklif verme davranışı birebir korunur.
 */
export function OperationStatusCard({
  currentJob,
  offers,
  session,
}: {
  currentJob: Job;
  offers: Offer[];
  session: Session | null;
}) {
  const allOperationJobs = useJobsForOperation(currentJob.operationId);
  const operationJobs = useFilterVisibleJobs(session, allOperationJobs);

  if (!currentJob.operationId || operationJobs.length < 2) return null;

  const summary = getPublicOperationStatusSummary(operationJobs, offers);

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Operasyon Durumu</h2>

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
        {PUBLIC_OPERATION_STATUS_BUCKET_ORDER.map((bucket) => (
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
          const status = getOperationServiceCardStatus(operationJob, offers, session, {
            allowOfferAction: !isCurrent,
          });

          // Satır ızgarası (grid, `flex flex-wrap` DEĞİL) — kök neden düzeltmesi
          // (görev tanımı): `flex-wrap`'te satır kırma kararı çocukların
          // HİPOTETİK (küçültülmeden ÖNCEKİ, doğal) genişliğine göre verilir,
          // `min-w-0`/`truncate` bu kararı ETKİLEMEZ — bu yüzden uzun bir
          // hizmet başlığı/açıklaması, sağdaki "Teklif Ver" butonunu sola/alta
          // kaydırıyordu. `grid-cols-[minmax(0,1fr)_auto]` bunun yerine sabit
          // iki KOLON tanımlar: sol kolon 0'a kadar küçülüp `truncate`
          // edebilir, sağ kolon içeriğine göre boyutlanır ve ASLA sıkışmaz —
          // masaüstünde satır kırma diye bir kavram yoktur. Mobilde
          // (`grid-cols-1`) ikisi ayrı satıra düşer, `justify-self-end` sağ
          // kolonu (hem mobildeki kendi tam-genişlik satırında hem
          // masaüstündeki auto kolonda) sağa hizalı tutar.
          const rowContent = (
            <>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {getCategoryDisplayLabel(operationJob.category)}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {operationJob.title}
                  {isCurrent && <span> (Bu ilan)</span>}
                </p>
              </div>
              <div className="shrink-0 justify-self-end">
                {status.kind === "teklif-ver" ? (
                  <span className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">
                    Teklif Ver
                  </span>
                ) : (
                  <StatusBadge label={status.label} tone={status.tone} />
                )}
              </div>
            </>
          );

          if (isCurrent) {
            return (
              <li key={operationJob.id} className="grid grid-cols-1 items-center gap-x-3 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                {rowContent}
              </li>
            );
          }

          return (
            <li key={operationJob.id}>
              <Link
                href={`/ilanlar/${operationJob.id}`}
                className="-mx-2 grid grid-cols-1 items-center gap-x-3 gap-y-1 rounded-md px-2 py-2.5 transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[minmax(0,1fr)_auto]"
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
