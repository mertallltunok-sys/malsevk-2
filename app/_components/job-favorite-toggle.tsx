"use client";

import { Heart } from "lucide-react";
import { toggleFavoriteJob } from "../_lib/job-favorites";

/**
 * Kalp ikonlu favori butonu. Kendi state'ini tutmaz — toggleFavoriteJob
 * localStorage'ı güncelleyip notify() çağırır, bu da use-job-favorites.ts
 * üzerinden ebeveyni (provider-job-listing.tsx) otomatik yeniden render
 * eder. `event.preventDefault()`/`stopPropagation()` çağrılmaz çünkü bu
 * buton hiçbir zaman bir `<Link>` içine YERLEŞTİRİLMEZ (bkz.
 * job-listing-table.tsx/job-listing-cards.tsx — ayrı bir hücre/konumdadır),
 * iç içe etkileşimli eleman anti-pattern'inden kaçınmak için.
 */
export function JobFavoriteToggle({
  userId,
  jobId,
  isFavorited,
}: {
  userId: string;
  jobId: string;
  isFavorited: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => toggleFavoriteJob(userId, jobId)}
      aria-pressed={isFavorited}
      aria-label={isFavorited ? "Favorilerden çıkar" : "Favorilere ekle"}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
        isFavorited
          ? "border-danger bg-danger-soft text-danger"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      <Heart className="h-4 w-4" fill={isFavorited ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}
