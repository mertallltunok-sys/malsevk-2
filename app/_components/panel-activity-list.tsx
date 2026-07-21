import { Activity } from "lucide-react";
import Link from "next/link";
import { formatJobDate } from "../_lib/jobs";
import { getOfferStatusLabel, getOfferStatusTone } from "../_lib/offers";
import type { PanelActivityItem } from "../_lib/panel-summary";
import { StatusBadge } from "./status-badge";

export function PanelActivityList({
  items,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  emptyActionHref,
}: {
  items: PanelActivityItem[];
  emptyTitle: string;
  emptyDescription: string;
  emptyActionLabel: string;
  emptyActionHref: string;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{emptyDescription}</p>
        <Link
          href={emptyActionHref}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {emptyActionLabel}
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 rounded-card border border-border bg-surface p-4"
        >
          <Activity className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed text-foreground">
              <span className="font-semibold">{item.title}</span> {item.suffix}
            </p>
            {(item.status || item.dateIso) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {item.status && (
                  <StatusBadge
                    label={getOfferStatusLabel(item.status)}
                    tone={getOfferStatusTone(item.status)}
                  />
                )}
                {item.dateIso && (
                  <span className="text-xs text-muted-foreground">{formatJobDate(item.dateIso)}</span>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
