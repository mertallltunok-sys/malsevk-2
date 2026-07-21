import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

function ComingSoonBadge() {
  return (
    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Yakında
    </span>
  );
}

function CardBody({
  icon: Icon,
  label,
  value,
  description,
  comingSoon,
  showFooterLink,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  description: string;
  comingSoon: boolean;
  showFooterLink: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {comingSoon && <ComingSoonBadge />}
      </div>

      <p className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{value}</p>

      {/* min-h, iki satırlık başlıklarda bile tüm kartların hizalı kalması için */}
      <p className="mt-2 min-h-[2.75rem] text-sm font-semibold leading-snug text-foreground">
        {label}
      </p>

      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>

      {showFooterLink && (
        <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-primary">
          Görüntüle
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </span>
      )}
    </>
  );
}

/**
 * Panel özeti sayaç kartı. `href` verilirse tüm kart tıklanabilir bir
 * bağlantı olur; verilmezse (henüz route'u olmayan istatistikler için)
 * sahte bir bağlantı oluşturulmadan, imleç/hover davranışı olmayan statik
 * bir kart olarak render edilir — `comingSoon` ile "Yakında" etiketi
 * gösterilebilir.
 */
export function PanelStatCard({
  icon,
  label,
  value,
  description,
  href,
  comingSoon = false,
  hideFooterLink = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  description: string;
  href?: string;
  comingSoon?: boolean;
  /** Kartın tamamı zaten tıklanabilirken içeride ayrıca "Görüntüle" bağlantı metni gösterilmesin. */
  hideFooterLink?: boolean;
}) {
  if (href) {
    return (
      <Link
        href={href}
        className="group flex h-full flex-col rounded-card border border-border bg-surface p-6 shadow-sm transition duration-200 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <CardBody
          icon={icon}
          label={label}
          value={value}
          description={description}
          comingSoon={false}
          showFooterLink={!hideFooterLink}
        />
      </Link>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface p-6 shadow-sm">
      <CardBody
        icon={icon}
        label={label}
        value={value}
        description={description}
        comingSoon={comingSoon}
        showFooterLink={false}
      />
    </div>
  );
}
