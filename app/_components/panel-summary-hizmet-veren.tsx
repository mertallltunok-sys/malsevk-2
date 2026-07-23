"use client";

import { Briefcase, CheckCircle2, CircleCheck, Clock, Gauge, Send } from "lucide-react";
import { getHizmetVerenPanelSummary } from "../_lib/panel-summary";
import { MAX_ACTIVE_JOBS, getActiveJobCount } from "../_lib/provider-capacity";
import type { Job, Offer, Session } from "../_lib/types";
import { PanelActivityList } from "./panel-activity-list";
import { PanelQuickActionCard } from "./panel-quick-action-card";
import { PanelStatCard } from "./panel-stat-card";
import { PanelWelcomeCard } from "./panel-welcome-card";

export function PanelSummaryHizmetVeren({
  session,
  jobs,
  offers,
}: {
  session: Session;
  jobs: Job[];
  offers: Offer[];
}) {
  const summary = getHizmetVerenPanelSummary(session, jobs, offers);
  const activeJobCount = getActiveJobCount(session.id, offers);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Panel Özeti
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        Uygun ilanları ve verdiğiniz teklifleri tek ekrandan takip edin.
      </p>

      <PanelWelcomeCard
        name={session.name}
        subtitle="Bugün işlerinizi kolayca yönetin ve yeni fırsatları değerlendirin."
      />

      <div className="mt-8 grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        <PanelStatCard
          icon={Briefcase}
          label="Uygun İlanlar"
          description="Teklif verebileceğiniz aktif ilanlar"
          value={summary.availableListingCount}
          href="/ilanlar"
        />
        <PanelStatCard
          icon={Send}
          label="Verdiğim Teklifler"
          description="Toplam verdiğiniz teklif sayısı"
          value={summary.myOfferCount}
          href="/panel/tekliflerim"
        />
        <PanelStatCard
          icon={CircleCheck}
          label="Kabul Edilen Teklifler"
          description="Kabul edilen teklif sayısı"
          value={summary.acceptedOfferCount}
          href="/panel/tekliflerim?durum=kabul-edildi"
        />
        <PanelStatCard
          icon={Clock}
          label="Devam Eden İşler"
          description="Devam eden iş sayısı"
          value={summary.inProgressCount}
          href="/panel/tekliflerim?durum=devam-eden"
        />
        <PanelStatCard
          icon={CheckCircle2}
          label="Tamamlanan İşler"
          description="Tamamlanan iş sayısı"
          value={summary.completedCount}
          href="/panel/tekliflerim?durum=tamamlandi"
        />
        <PanelStatCard
          icon={Gauge}
          label="Aktif İş Kapasitesi"
          description={`Aynı anda en fazla ${MAX_ACTIVE_JOBS} aktif iş yürütebilirsiniz`}
          value={`${activeJobCount} / ${MAX_ACTIVE_JOBS}`}
          href="/panel/tekliflerim"
        />
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Hızlı İşlemler</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PanelQuickActionCard
            href="/ilanlar"
            title="Uygun İlanları İncele"
            description="Sana uygun ilanları görüntüle ve yeni fırsatları incele."
          />
          <PanelQuickActionCard
            href="/panel/tekliflerim"
            title="Verdiğim Teklifleri Gör"
            description="Verdiğin teklifleri listele ve durumlarını takip et."
          />
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-foreground">Son Hareketler</h2>
        <p className="mt-1 text-sm text-muted-foreground">En son teklif ve işlem hareketleriniz</p>
        <div className="mt-4">
          <PanelActivityList
            items={summary.recentActivity}
            emptyTitle="Henüz bir teklif hareketiniz bulunmuyor"
            emptyDescription="Uygun ilanları inceleyerek ilk teklifinizi verebilirsiniz."
            emptyActionLabel="Uygun İlanları İncele"
            emptyActionHref="/ilanlar"
          />
        </div>
      </div>
    </div>
  );
}
