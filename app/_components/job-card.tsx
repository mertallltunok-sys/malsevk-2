import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { formatJobDate, getJobStatusLabel, getJobStatusTone } from "../_lib/jobs";
import type { Job } from "../_lib/types";
import { StatusBadge } from "./status-badge";

export function JobCard({ job }: { job: Job }) {
  return (
    <Link
      href={`/ilanlar/${job.id}`}
      className="flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-sm transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex w-fit items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
          {job.category}
        </span>
        <StatusBadge label={getJobStatusLabel(job.status)} tone={getJobStatusTone(job.status)} />
      </div>

      <div>
        <h3 className="text-lg font-semibold leading-snug text-foreground">
          {job.title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {job.description}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          {job.district}, {job.province} · {job.workLocationType}
        </span>
        <span className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          {formatJobDate(job.workDate)}
        </span>
      </div>

      <span className="text-sm font-medium text-primary">İlanı İncele</span>
    </Link>
  );
}
