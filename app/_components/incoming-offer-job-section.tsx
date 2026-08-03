"use client";

import { CalendarDays, MapPin } from "lucide-react";
import { formatJobLocationLine } from "../_lib/job-location";
import type { IncomingOfferJobGroup } from "../_lib/incoming-offer-grouping";
import { formatJobDate } from "../_lib/jobs";
import type { Offer, Session } from "../_lib/types";
import { IncomingOfferCard } from "./incoming-offer-card";

/**
 * "Gelen Teklifler" ekranında, üstteki ilan seçici (bkz. incoming-offers-panel.tsx)
 * üzerinden seçilmiş TEK bir ilana ait teklif bloğu — eski
 * `incoming-offer-category-section.tsx`in (Hizmet Türü kutusu içinde birden
 * fazla ilan alt grubu gösteren) YERİNE geçer: artık aynı anda yalnızca TEK
 * ilanın teklifleri render edilir, bu yüzden ayrı bir "kategori kutusu"
 * sarmalayıcısına gerek yoktur. Bu component salt görünümdür: veri çekmez,
 * hiçbir Offer/Job'ı değiştirmez — tüm veri `incoming-offers-panel.tsx`den
 * (bkz. `incoming-offer-grouping.ts#groupIncomingOffersByJob`) hazır gelir.
 * `IncomingOfferCard`in kendisi DEĞİŞMEDİ — kabul/reddet, iletişim bilgisi
 * açılımı, tamamlama akışı burada hiç dokunulmadan aynen çalışmaya devam
 * eder.
 */
export function IncomingOfferJobSection({
  group,
  session,
  highlightOfferId,
  onOfferCompleted,
}: {
  group: IncomingOfferJobGroup;
  session: Session;
  highlightOfferId: string | null;
  /** Bir teklif "completed" olduğunda tetiklenir — değerlendirme modalını AÇAN state burada değil, çağıranda (incoming-offers-panel.tsx) tutulur; bkz. oradaki dokümantasyon. */
  onOfferCompleted: (offer: Offer) => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-6">
      <header className="border-b border-border pb-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.categoryLabel}</p>
        <h2
          className="mt-1 break-words text-lg font-bold tracking-heading leading-tight text-foreground"
          title={group.job?.title}
        >
          {group.job ? group.job.title : "İlan bilgisine ulaşılamadı"}
        </h2>
        {group.job && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{formatJobLocationLine(group.job)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {formatJobDate(group.job.workDate)}
            </span>
          </div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{group.offers.length} teklif</p>
      </header>

      <div className="flex flex-col gap-4">
        {group.offers.map((offer) => (
          <IncomingOfferCard
            key={offer.id}
            offer={offer}
            job={group.job}
            session={session}
            highlighted={offer.id === highlightOfferId}
            onCompleted={onOfferCompleted}
          />
        ))}
      </div>
    </section>
  );
}
