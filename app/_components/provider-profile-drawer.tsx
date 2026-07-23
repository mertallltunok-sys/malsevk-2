"use client";

import { Briefcase, Calendar, CheckCircle2, Clock, MapPin, Star, TrendingUp, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatJobDate } from "../_lib/jobs";
import type { ProviderProfileSummary } from "../_lib/provider-profile";
import type { ProviderProfile } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";

/**
 * Hizmet Alan'ın "Gelen Teklifler" ekranından açtığı, Hizmet Veren'in
 * profilini gösteren görüntüleyici — sayfa değiştirmeden, mobilde tam
 * ekran sheet, masaüstünde ortalanmış modal olarak render edilir (aynı
 * `fixed`/ESC/dış-tıklama kapanma sözleşmesi dialog-shell.tsx ile aynı,
 * ama içerik çok daha zengin olduğu için o küçük merkezi kabuk yerine
 * kendi boyutlandırmasını taşır).
 *
 * GİZLİLİK: Bu bileşen telefon/e-posta/adres/vergi/TC gibi hiçbir iletişim
 * alanını hiç OKUMAZ — yalnızca ProviderProfile (firma adı/logo/tanıtım/
 * bölge/uzmanlık) ve ProviderProfileSummary (puan/iş sayıları) parametre
 * olarak alır. İletişim bilgisi açığa çıkarma tek noktası hâlâ
 * contact-access.ts#getRevealedContactForOffer'dır — bu bileşen o
 * fonksiyona hiç dokunmaz, ayrı ve bağımsız kalır.
 */
export function ProviderProfileDrawer({
  providerName,
  profile,
  summary,
  joinedAtIso,
  onClose,
}: {
  providerName: string;
  profile: ProviderProfile | undefined;
  summary: ProviderProfileSummary;
  joinedAtIso: string | undefined;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const logoUrl = useJobPhotoUrl(profile?.logoStorageKey ?? null);
  const companyName = profile?.companyName?.trim() || providerName;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hizmet-veren-profili-baslik"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-50 focus:outline-none"
    >
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 bg-black/50" />

      <div
        onClick={(event) => event.stopPropagation()}
        className="fixed inset-0 overflow-y-auto bg-surface p-6 shadow-md sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:border sm:border-border"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- IndexedDB blob object URL, next/image optimize edemez
                <img src={logoUrl} alt={`${companyName} logosu`} className="h-full w-full object-cover" />
              ) : (
                <Briefcase className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </span>
            <h2 id="hizmet-veren-profili-baslik" className="text-lg font-semibold leading-snug text-foreground">
              {companyName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="flex" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className="h-4 w-4 text-rating"
                fill={summary.averageStars !== null && star <= Math.round(summary.averageStars) ? "currentColor" : "transparent"}
                strokeWidth={1.75}
              />
            ))}
          </div>
          {summary.averageStars !== null ? (
            <span className="text-sm font-medium text-foreground">
              {summary.averageStars.toFixed(1)}{" "}
              <span className="font-normal text-muted-foreground">({summary.ratingCount} değerlendirme)</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">Henüz değerlendirme bulunmuyor</span>
          )}
        </div>

        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          MALSEVK&apos;e katılım: {joinedAtIso ? formatJobDate(joinedAtIso) : "—"}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3 border-y border-border py-4 text-center">
          <div>
            <p className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {summary.completedJobCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Tamamlanan İş</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
              <Clock className="h-4 w-4 text-warning" aria-hidden="true" />
              {summary.inProgressCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Devam Eden İş</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-1 text-lg font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-accent" aria-hidden="true" />
              {summary.acceptanceRatePercent !== null ? `%${summary.acceptanceRatePercent}` : "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Teklif Kabul Oranı</p>
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-foreground">Uzmanlık Alanları</h3>
          {profile && profile.expertise.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.expertise.map((item) => (
                <span
                  key={item}
                  className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent"
                >
                  {item}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Belirtilmemiş.</p>
          )}
        </div>

        <div className="mt-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            Hizmet Verilen Bölgeler
          </h3>
          {profile && profile.regions.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {profile.regions.map((region) => (
                <span
                  key={region}
                  className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground"
                >
                  {region}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Belirtilmemiş.</p>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-foreground">Firma Tanıtımı</h3>
          <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
            {profile?.bio?.trim() ? profile.bio : "Bu firma henüz bir tanıtım metni eklemedi."}
          </p>
        </div>
      </div>
    </div>
  );
}
