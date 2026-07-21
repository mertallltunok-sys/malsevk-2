"use client";

import {
  getJobAvailabilityForProvider,
  getProviderClosedReasonLabel,
} from "../_lib/job-requests";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import type { Session } from "../_lib/types";
import { JobCard } from "./job-card";
import { JobList } from "./job-list";

/**
 * `/ilanlar` sayfasının rol bazlı giriş noktası. Hizmet Veren için iki
 * bölümlü (Teklife Açık / Teklife Kapalı) özel görünüm; diğer tüm
 * durumlarda (Hizmet Alan, oturum yok, henüz hidrasyon tamamlanmadı)
 * mevcut, değişmemiş tek-grid görünüm (`JobList`) korunur.
 */
export function JobListingScreen() {
  const session = useSession();

  if (session?.role === "hizmet-veren") {
    return <ProviderJobListing session={session} />;
  }

  return (
    <>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          İş İlanları
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin, ilan
          detayında teklifinizi gönderin.
        </p>
      </div>

      <JobList />
    </>
  );
}

function ProviderJobListing({ session }: { session: Session }) {
  const jobs = useAllJobs();
  const offers = useAllOffers();

  // Tamamlanan/iptal edilen ilanlar aktif ilan ekranında gösterilmez —
  // onlar ilgili kullanıcıların geçmiş/Tamamlanan İşler alanlarında kalır.
  const activeJobs = jobs.filter((job) => job.status === "yayinda");

  const classified = activeJobs.map((job) => ({
    job,
    ...getJobAvailabilityForProvider(job, offers, session.id),
  }));

  const openEntries = classified.filter((entry) => entry.open);
  const closedEntries = classified.filter((entry) => !entry.open);

  return (
    <>
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Aktif İlanlar
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin ve uygun
          ilanlara teklif gönderin.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold text-foreground">
            Teklife Açık İlanlar ({openEntries.length})
          </h2>
          <div className="mt-4">
            {openEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Şu anda teklif verebileceğiniz aktif ilan bulunmuyor.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {openEntries.map(({ job }) => (
                  <JobCard key={job.id} job={job} offers={offers} />
                ))}
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">
            Teklife Kapalı İlanlar ({closedEntries.length})
          </h2>
          <div className="mt-4">
            {closedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Teklife kapalı ilan bulunmuyor.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {closedEntries.map(({ job, closedReason }) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    offers={offers}
                    forceClosed
                    closedReasonLabel={
                      closedReason ? getProviderClosedReasonLabel(closedReason) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
