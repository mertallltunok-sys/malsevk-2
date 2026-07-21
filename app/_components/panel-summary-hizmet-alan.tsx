"use client";

import { CheckCircle2, ClipboardList, Clock, Inbox } from "lucide-react";
import { getHizmetAlanPanelSummary } from "../_lib/panel-summary";
import type { Job, Offer, Session } from "../_lib/types";
import { PanelActivityList } from "./panel-activity-list";
import { PanelQuickActionCard } from "./panel-quick-action-card";
import { PanelStatCard } from "./panel-stat-card";
import { PanelWelcomeCard } from "./panel-welcome-card";

export function PanelSummaryHizmetAlan({
  session,
  jobs,
  offers,
}: {
  session: Session;
  jobs: Job[];
  offers: Offer[];
}) {
  const summary = getHizmetAlanPanelSummary(session, jobs, offers);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Panel Özeti
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Hizmet taleplerinizi ve gelen tekliflerinizi tek ekrandan yönetin.
      </p>

      <PanelWelcomeCard
        name={session.name}
        subtitle="Bugün taleplerinizi ve gelen tekliflerinizi kolayca yönetin."
      />

      <div className="mt-8 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <PanelStatCard
          icon={ClipboardList}
          label="Aktif Hizmet Talepleri"
          description="Yayında olan, henüz teklifi kabul edilmemiş talepler"
          value={summary.activeRequestCount}
          href="/panel/hizmet-taleplerim?durum=aktif"
        />
        <PanelStatCard
          icon={Inbox}
          label="Gelen Teklifler"
          description="Taleplerinize gelen teklif sayısı"
          value={summary.incomingOfferCount}
          href="/panel/gelen-teklifler"
          hideFooterLink
        />
        <PanelStatCard
          icon={Clock}
          label="Devam Eden İşler"
          description="Teklifi kabul edilmiş, süren işler"
          value={summary.inProgressCount}
          href="/panel/hizmet-taleplerim?durum=devam-eden"
        />
        <PanelStatCard
          icon={CheckCircle2}
          label="Tamamlanan İşler"
          description="Tamamlanan iş sayısı"
          value={summary.completedCount}
          href="/panel/hizmet-taleplerim?durum=tamamlandi"
        />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Hızlı İşlemler</h2>
        <div className="mt-4 max-w-md">
          <PanelQuickActionCard
            href="/hizmet-talebi-olustur"
            title="Yeni Hizmet Talebi Oluştur"
            description="Yeni bir hizmet talebi oluştur ve teklif toplamaya başla."
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Son Hareketler</h2>
        <p className="mt-1 text-sm text-muted-foreground">En son teklif ve işlem hareketleriniz</p>
        <div className="mt-4">
          <PanelActivityList
            items={summary.recentActivity}
            emptyTitle="Henüz bir hareket bulunmuyor"
            emptyDescription="Yeni bir hizmet talebi oluşturarak süreci başlatabilirsiniz."
            emptyActionLabel="Hizmet Talebi Oluştur"
            emptyActionHref="/hizmet-talebi-olustur"
          />
        </div>
      </div>
    </div>
  );
}
