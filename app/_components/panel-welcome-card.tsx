import { formatJobDate } from "../_lib/jobs";
import { getInitials } from "../_lib/profile";

/**
 * `session` girişli kullanıcı için PanelSummary tarafından yalnızca
 * `!session` kontrolünden SONRA render edildiği için (bkz.
 * panel-summary.tsx), bu bileşen hiçbir zaman sunucu tarafı ilk
 * hidrasyon geçişinin bir parçası olmaz — `new Date()` burada güvenle
 * çağrılabilir, hidrasyon uyuşmazlığı riski yoktur.
 */
export function PanelWelcomeCard({ name, subtitle }: { name: string; subtitle: string }) {
  const todayLabel = formatJobDate(new Date().toISOString());

  return (
    <div className="mt-8 flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
          {getInitials(name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-foreground">Hoş geldiniz, {name}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <p className="shrink-0 text-sm text-muted-foreground sm:text-right">{todayLabel}</p>
    </div>
  );
}
