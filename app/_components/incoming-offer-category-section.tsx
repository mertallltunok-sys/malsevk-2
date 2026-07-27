"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { formatJobLocationLine } from "../_lib/job-location";
import type { IncomingOfferCategoryGroup } from "../_lib/incoming-offer-grouping";
import { formatJobDate } from "../_lib/jobs";
import type { Offer, Session } from "../_lib/types";
import { IncomingOfferCard } from "./incoming-offer-card";

/**
 * "Gelen Teklifler" ekranındaki TEK bir hizmet türü kutusu — kendi içinde
 * ilan bazlı alt gruplar, her ilan grubunun altında da o `jobId`ye ait
 * teklifler (mevcut, DEĞİŞTİRİLMEMİŞ `IncomingOfferCard`) render edilir.
 * Bu component salt görünümdür: veri çekmez, hiçbir Offer/Job'ı değiştirmez,
 * hiçbir yeni route/link üretmez — tüm veri `incoming-offers-panel.tsx`den
 * (bkz. `incoming-offer-grouping.ts#groupIncomingOffersByCategoryAndJob`)
 * hazır gelir.
 */
export function IncomingOfferCategorySection({
  group,
  session,
  highlightOfferId,
  onOfferCompleted,
}: {
  group: IncomingOfferCategoryGroup;
  session: Session;
  highlightOfferId: string | null;
  /** Bir teklif "completed" olduğunda tetiklenir — değerlendirme modalını AÇAN state artık burada değil, çağıranda (incoming-offers-panel.tsx) tutulur; bkz. oradaki dokümantasyon. */
  onOfferCompleted: (offer: Offer) => void;
}) {
  return (
    <section className="flex h-fit min-w-0 flex-col gap-6 rounded-card border border-border bg-surface p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-4">
        <h2 className="text-lg font-bold text-foreground">{group.categoryLabel}</h2>
        <span className="text-sm text-muted-foreground">{group.offerCount} Teklif</span>
      </header>

      {/*
        `min-w-0`, aşağıdaki İÇ İÇE flex-col zincirinin (kategori kutusu ->
        ilan grubu -> teklif kartları listesi) HER seviyesinde tekrar
        gerekir: bir flex öğesinin varsayılan `min-width` değeri `auto`dur
        (içeriğinin min-content genişliği) — tek bir seviyede unutulsa bile,
        `IncomingOfferCard` içindeki (DEĞİŞTİRİLMEMİŞ) uzun/kırılmasız metin
        bu zincir boyunca yukarı doğru "iterek" tüm kategori kutusunu (ve
        onunla birlikte sayfayı) dar ekranlarda gerçek içerikten daha geniş
        yapabilir — kartların KENDİSİ (zaten `truncate`/`min-w-0` kullanıyor)
        doğru render olsa bile. Bu, görsel olarak fark edilmeyen ama
        `document.documentElement.scrollWidth`de ölçülebilen klasik bir
        "iç içe flex-col'da min-width:auto" taşma hatasıdır.
      */}
      <div className="flex min-w-0 flex-col gap-6">
        {group.jobGroups.map((jobGroup) => (
          <div key={jobGroup.jobId} className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0 rounded-md bg-background px-4 py-3">
              <h3
                className="line-clamp-2 break-words text-base font-semibold text-foreground"
                title={jobGroup.job?.title}
              >
                {jobGroup.job ? jobGroup.job.title : "İlan bilgisine ulaşılamadı"}
              </h3>
              {jobGroup.job && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{formatJobLocationLine(jobGroup.job)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {formatJobDate(jobGroup.job.workDate)}
                  </span>
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground">{jobGroup.offers.length} teklif</p>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {jobGroup.offers.map((offer) => (
                <IncomingOfferCard
                  key={offer.id}
                  offer={offer}
                  job={jobGroup.job}
                  session={session}
                  highlighted={offer.id === highlightOfferId}
                  onCompleted={onOfferCompleted}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
