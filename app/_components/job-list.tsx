"use client";

import { filterModerationVisibleJobs } from "../_lib/job-moderation";
import { useAllJobs } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { JobCard } from "./job-card";

export function JobList() {
  const session = useSession();
  const allJobs = useAllJobs();
  const offers = useAllOffers();
  // İlan Onayı (bkz. job-moderation.ts): bu genel "İş İlanları" listesi bir
  // keşif/gezinme yüzeyidir (job-requests-panel.tsx'teki "kendi ilanlarım"
  // yönetim ekranından FARKLI) — admin henüz onaylamamış/reddetmiş bir ilan
  // burada, ilan sahibi kendisi olsa bile, görünmez (sahibin kendi ilanını
  // görebileceği yer panel/hizmet-taleplerim'dir).
  const jobs = filterModerationVisibleJobs(session, allJobs);

  if (jobs.length === 0) {
    return (
      <p className="mt-10 text-base text-muted-foreground">
        Şu anda görüntülenecek ilan bulunmuyor.
      </p>
    );
  }

  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} offers={offers} />
      ))}
    </div>
  );
}
