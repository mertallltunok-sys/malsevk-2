"use client";

import { useAllJobs } from "../_lib/use-jobs";
import { JobCard } from "./job-card";

export function JobList() {
  const jobs = useAllJobs();

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
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
