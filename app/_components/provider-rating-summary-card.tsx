import { Star } from "lucide-react";
import type { ProviderRatingSummary } from "../_lib/ratings";

/**
 * Yalnızca Hizmet Veren'in kendi profilinde gösterilir (bkz. Bölüm 9).
 * Ortalama, her tamamlanan iş = 1 oy olacak şekilde aritmetik ortalamadır
 * (bkz. ratings.ts#getProviderRatingSummary) — burada hiçbir hesap
 * tekrarlanmaz, yalnızca gösterilir.
 */
export function ProviderRatingSummaryCard({ summary }: { summary: ProviderRatingSummary }) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-foreground">Değerlendirmeleriniz</h2>

      {summary.averageStars === null ? (
        <p className="mt-3 text-sm text-muted-foreground">Henüz değerlendirme bulunmuyor.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex" aria-hidden="true">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className="h-6 w-6 text-rating"
                  fill={star <= Math.round(summary.averageStars ?? 0) ? "currentColor" : "transparent"}
                  strokeWidth={1.75}
                />
              ))}
            </div>
            <span className="text-lg font-semibold text-foreground">
              {summary.averageStars.toFixed(1)} / 5
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{summary.ratingCount} değerlendirme</p>
        </>
      )}

      <p className="mt-1 text-sm text-muted-foreground">{summary.completedJobCount} tamamlanan iş</p>
    </div>
  );
}
