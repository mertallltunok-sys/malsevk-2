"use client";

import { useState } from "react";
import {
  executeDemoDataReset,
  planDemoDataReset,
  type DemoDataCounts,
  type DemoDataPlan,
} from "../_lib/reset-demo-data";

function CountsTable({ title, counts }: { title: string; counts: DemoDataCounts }) {
  const rows: { label: string; total: number; demo: number }[] = [
    { label: "Kullanıcılar", total: counts.totalUsers, demo: counts.demoUsers },
    { label: "İlanlar", total: counts.totalJobs, demo: counts.demoJobs },
    { label: "Teklifler", total: counts.totalOffers, demo: counts.demoOffers },
    { label: "İlan fotoğrafları (yalnızca demo ilanlarına bağlı)", total: counts.demoPhotoCount, demo: counts.demoPhotoCount },
  ];

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-muted-foreground">
              <th className="pb-2 font-medium">Kayıt türü</th>
              <th className="pb-2 font-medium">Toplam</th>
              <th className="pb-2 font-medium">Demo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="py-2 text-foreground">{row.label}</td>
                <td className="py-2 text-foreground">{row.total}</td>
                <td className="py-2 font-semibold text-accent">{row.demo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DemoDataResetPanel() {
  const [plan, setPlan] = useState<DemoDataPlan | null>(null);
  const [afterCounts, setAfterCounts] = useState<DemoDataCounts | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refreshPlan() {
    setError(null);
    setAfterCounts(null);
    try {
      setPlan(planDemoDataReset());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan hesaplanamadı.");
    }
  }

  async function handleExecute() {
    if (!plan || running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await executeDemoDataReset(plan);
      setAfterCounts(result);
      // Uygulama sonrası planı da güncel (boş) haliyle tazele.
      setPlan(planDemoDataReset());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Temizlik uygulanamadı.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-warning bg-warning-soft p-4 text-sm leading-relaxed text-foreground">
        Bu sayfa yalnızca geliştirme ortamında (NODE_ENV=development) çalışır. Yalnızca aşağıdaki
        demo hesaplarla ilişkili ilan, teklif, bildirim okunma durumu ve ilan fotoğrafı verilerini
        siler. Demo hesapların kendisi (giriş bilgileri, rol) ve gerçek kullanıcı verileri hiç
        değiştirilmez.
      </div>

      {plan && <CountsTable title="Şu anki durum" counts={plan.before} />}

      {plan && (
        <div className="rounded-card border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground">Tespit edilen demo hesaplar</h2>
          {plan.demoUserEmails.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Henüz hiçbir demo hesap oluşturulmamış (bu ortamda ilk kez giriş yapılmamış olabilir).
              Silinecek bir şey yok.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
              {plan.demoUserEmails.map((email) => (
                <li key={email}>{email}</li>
              ))}
            </ul>
          )}

          <h3 className="mt-4 text-sm font-semibold text-foreground">Silinecek kayıtlar (dry-run)</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <li>{plan.jobIdsToRemove.length} ilan</li>
            <li>{plan.offerIdsToRemove.length} teklif</li>
            <li>{plan.photoStorageKeysToRemove.length} ilan fotoğrafı</li>
            <li>{plan.demoUserIds.length} kullanıcının bildirim okunma kaydı</li>
          </ul>

          {plan.duplicateOfferPairs.length > 0 && (
            <div className="mt-4 rounded-md border border-warning bg-warning-soft p-3 text-sm text-foreground">
              <p className="font-medium">
                Aynı (providerId, jobId) çifti için birden fazla teklif kaydı tespit edildi:
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {plan.duplicateOfferPairs.map((dup) => (
                  <li key={`${dup.providerId}-${dup.jobId}`}>
                    providerId={dup.providerId.slice(0, 8)}…, jobId={dup.jobId.slice(0, 8)}…,{" "}
                    {dup.count} kayıt — {dup.isDemo ? "demo (bu temizlikle kalkacak)" : "GERÇEK KULLANICI (dokunulmuyor, yalnızca rapor)"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={refreshPlan}
              disabled={running}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Planı Yenile (Dry-Run)
            </button>
            <button
              type="button"
              onClick={handleExecute}
              disabled={running || plan.jobIdsToRemove.length + plan.offerIdsToRemove.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? "Uygulanıyor..." : "Temizliği Uygula"}
            </button>
          </div>
        </div>
      )}

      {!plan && (
        <button
          type="button"
          onClick={refreshPlan}
          className="inline-flex w-fit items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Planı Hesapla (Dry-Run)
        </button>
      )}

      {afterCounts && (
        <>
          <CountsTable title="Temizlik sonrası durum" counts={afterCounts} />
          <p role="status" className="text-sm font-medium text-success">
            Temizlik tamamlandı. Demo hesapların giriş bilgileri değişmedi; yalnızca işlem verileri
            temizlendi.
          </p>
        </>
      )}
    </div>
  );
}
