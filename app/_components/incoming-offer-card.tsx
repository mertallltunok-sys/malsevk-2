"use client";

import { Building2, Check, CheckCircle2, MapPin, Package, ShieldCheck, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRevealedContactForOffer } from "../_lib/contact-access";
import { formatJobLocationLine } from "../_lib/job-location";
import {
  OFFER_PENDING_BLOCKED_MESSAGE,
  isOfferPendingActionBlocked,
  isOfferProviderIdentityRevealed,
} from "../_lib/job-requests";
import { formatJobDate } from "../_lib/jobs";
import { formatMoney } from "../_lib/money";
import { formatCommittedDays, getOfferStatusLabel, getOfferStatusTone, updateOfferStatus } from "../_lib/offers";
import { formatJobProductInfoLine, isTransportationCategory } from "../_lib/product-catalog";
import { getProviderProfileSummary } from "../_lib/provider-profile";
import {
  formatImoClassForDisplay,
  getRequiredStorageActivityForJob,
  getStorageActivityScopeLabel,
  isContainerStorageCategory,
} from "../_lib/storage-container-catalog";
import { formatRecyclingCommercialDirectionLabel, getRecyclingActivityLabel, getRequiredRecyclingActivities, isRecyclingCategory } from "../_lib/recycling-catalog";
import { formatWasteCodeForDisplay, getWasteCodeEntry } from "../_lib/recycling-waste-code-catalog";
import { getStorageRiskGroupLabel, isHazardousStorageCategory } from "../_lib/storage-hazard-catalog";
import { useJobCategoryEligibility } from "../_lib/use-job-category-eligibility";
import type { Job, Offer, Session, UserRole } from "../_lib/types";
import { useAllOffers } from "../_lib/use-offers";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { useAllRatings } from "../_lib/use-ratings";
import { findUserById } from "../_lib/users";
import { ContactInfoBlock } from "./contact-info-block";
import { OfferOutcomePanel } from "./offer-outcome-panel";
import { StatusBadge } from "./status-badge";

/**
 * "Faaliyet Kapsamı Uygun" — Konteyner Depolama/Kimyasal-Tehlikeli Madde
 * Depolama/Geri Dönüşüm & Atık Tahliye ilanlarında (görev talimatı),
 * Hizmet Alan'ın Gelen Teklifler ekranında, HER teklif kartının kendi
 * teklif verenine özel (bkz. useJobCategoryEligibility — gerçek
 * `provider_can_view_job()` RPC çağrısı, ikinci bir eşleştirme motoru İCAT
 * EDİLMEDİ). Etiketler `getRequiredStorageActivityForJob`/
 * `getRequiredRecyclingActivities`den (saf, istemci tarafı — Hizmet Alan
 * zaten KENDİ ilanının tam içeriğini görür, hassas değildir) — bu bileşen
 * bunun ÖTESİNDE HİÇBİR belge/admin-onay ayrıntısı (belge numarası/dosyası/
 * tarihi/inceleme notu) GÖSTERMEZ, görev talimatının kesin yasağı. Bu
 * bileşen KASITLI OLARAK yalnızca requester'ın (Hizmet Alan) Gelen Teklifler
 * ekranında render edilir — Hizmet Veren'in KENDİ teklif formunda (offer-
 * form.tsx/offer-panel.tsx) HİÇ gösterilmez (görev bölüm 6'nın kendi
 * kesin kuralı).
 *
 * SADELEŞTİRME GÖREVİ (referans görsele göre): uygun durumda ARTIK çerçeve/
 * arka plan/kapsül-etiket YOK — teklif kartının beyaz zemininde çıplak
 * metin+ikon satırları. Bu YALNIZCA `eligible === true` dalını değiştirir;
 * `eligible === false` (teklif oluşturulduktan SONRA belge reddedilmiş/
 * iptal edilmiş/yetki geri alınmışsa) hâlâ ayrıca dikkat çekmesi gereken
 * bir UYARI olduğu için kendi kırmızı kutusunu KORUR — "Kabul Et" backend'de
 * zaten migration 0060/0061/0069'un MLK87 kontrolüyle engellenir, bu
 * yalnızca onun arayüz yansımasıdır.
 */
function JobCategoryEligibilityBadge({ job, providerId }: { job: Job; providerId: string }) {
  const { loading, eligible } = useJobCategoryEligibility(job, providerId);
  if (loading || eligible === null) return null;

  if (!eligible) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2">
        <p className="text-xs font-medium text-danger">Bu teklifin hizmet uygunluğu artık geçerli değil.</p>
      </div>
    );
  }

  if (isHazardousStorageCategory(job.category)) {
    const riskGroups = job.storageHazardous ? (job.storageRiskGroups ?? []) : [];
    if (riskGroups.length === 0) return null;
    return (
      <div className="max-w-[260px]">
        <p className="flex items-center gap-1.5 text-sm font-bold text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Depolama Risk Kapsamı Uygun
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Firmanın admin onaylı depolama risk grupları ilan gereksinimleriyle eşleşiyor.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {riskGroups.map((riskGroupId) => (
            <li key={riskGroupId} className="flex items-start gap-1.5 text-xs text-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="break-words">{getStorageRiskGroupLabel(riskGroupId) ?? riskGroupId}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Nihai depolama uygunluğu, faaliyet izinleri, kapasite ve güvenlik koşulları hizmet verenle ayrıca teyit
          edilmelidir.
        </p>
      </div>
    );
  }

  if (isRecyclingCategory(job.category)) {
    const requiredActivities = getRequiredRecyclingActivities(job.recyclingRequestedOperation ?? "");
    const wasteCodeEntry = job.recyclingWasteCode ? getWasteCodeEntry(job.recyclingWasteCode) : undefined;
    return (
      <div className="max-w-[260px]">
        <p className="flex items-center gap-1.5 text-sm font-bold text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          Geri Dönüşüm Yetkisi Uygun
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Firmanın admin onaylı faaliyet ve atık kodu yetkileri ilan gereksinimleriyle eşleşiyor.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {requiredActivities.map((activityId) => (
            <li key={activityId} className="flex items-start gap-1.5 text-xs text-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="break-words">{getRecyclingActivityLabel(activityId) ?? activityId}</span>
            </li>
          ))}
          {job.recyclingWasteCode && (
            <li className="flex items-start gap-1.5 text-xs text-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
              <span className="break-words">
                {formatWasteCodeForDisplay(job.recyclingWasteCode)}
                {wasteCodeEntry ? ` — ${wasteCodeEntry.description}` : ""}
              </span>
            </li>
          )}
        </ul>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Nihai operasyon koşulları ve yasal taşıma süreçleri hizmet veren ile ayrıca teyit edilmelidir.
        </p>
      </div>
    );
  }

  const required = getRequiredStorageActivityForJob(job.storageContainerGroups ?? []);
  if (required.scopes.length === 0) return null;

  return (
    <div className="max-w-[260px]">
      <p className="flex items-center gap-1.5 text-sm font-bold text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Faaliyet Kapsamı Uygun
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Firmanın onaylı faaliyet alanları ilan gereksinimleriyle eşleşiyor.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {required.scopes.map((scope) => (
          <li key={scope} className="flex items-start gap-1.5 text-xs text-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
            <span className="break-words">{getStorageActivityScopeLabel(scope) ?? scope}</span>
          </li>
        ))}
        {required.imoClasses.map((code) => (
          <li key={code} className="flex items-start gap-1.5 text-xs text-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
            <span className="break-words">IMO {formatImoClassForDisplay(code) ?? code}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Nihai kapasite ve müsaitlik teklif sahibiyle teyit edilmelidir.
      </p>
    </div>
  );
}

function getRoleLabel(role: UserRole): string {
  return role === "hizmet-veren" ? "Hizmet Veren" : "Hizmet Alan";
}

/**
 * Kimlik henüz açılmadığında (bkz. isOfferProviderIdentityRevealed) firma
 * adının yerini alan takma ad — `providerId`den türetilen, TARAYICILAR ARASI
 * kararlı (aynı sağlayıcı her zaman aynı numarayı alır, böylece bir Hizmet
 * Alan farklı ilanlardaki tekliflerin aynı sağlayıcıdan geldiğini fark
 * edebilir) ama gerçek kimliği HİÇBİR ŞEKİLDE ortaya çıkarmayan basit bir
 * hash. Güvenlik amaçlı değildir (çakışma olabilir) — yalnızca görüntüleme
 * amaçlı bir etikettir.
 */
function getAnonymousProviderLabel(providerId: string): string {
  let hash = 0;
  for (let i = 0; i < providerId.length; i += 1) {
    hash = (hash * 31 + providerId.charCodeAt(i)) >>> 0;
  }
  return `Hizmet Veren #${1000 + (hash % 9000)}`;
}

export function IncomingOfferCard({
  offer,
  job,
  session,
  highlighted,
  onCompleted,
}: {
  offer: Offer;
  job: Job | undefined;
  session: Session;
  highlighted: boolean;
  /**
   * Teklif "completed" olduğunda çağrılır — değerlendirme modalını açan
   * state BİLEREK bu bileşende TUTULMAZ (bkz. incoming-offers-panel.tsx):
   * bir hizmet kalemi "tamamlandi" olur olmaz Gelen Teklifler'den (Operasyon
   * Hizmet Kalemi Yaşam Döngüsü Senkronizasyonu) düşebildiği için, bu kart
   * AYNI render'da unmount olabilir — modal state'i burada yerel kalsaydı
   * hiç açılmadan kaybolurdu (job-requests-panel.tsx'in AYNI sorunu AYNI
   * şekilde çözdüğü kanıtlanmış desen).
   */
  onCompleted: (offer: Offer) => void;
}) {
  const [pendingAction, setPendingAction] = useState<"accepted" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const provider = findUserById(offer.providerId);
  const revealedContact = getRevealedContactForOffer(session, offer.id);
  const allOffers = useAllOffers();
  const allRatings = useAllRatings();
  const providerProfile = provider?.providerProfile;
  const providerSummary = getProviderProfileSummary(offer.providerId, allOffers, allRatings);
  const logoUrl = useJobPhotoUrl(providerProfile?.logoStorageKey ?? null);
  const companyName = providerProfile?.companyName?.trim() || (provider ? provider.name : "Hizmet Veren");
  const identityRevealed = isOfferProviderIdentityRevealed(offer);
  const anonymousLabel = getAnonymousProviderLabel(offer.providerId);
  // "Kabul Et" butonunun kendisini de bu bilgiyle gater — backend zaten
  // migration 0060'ın MLK101 kontrolüyle bunu engeller, bu yalnızca aynı
  // gerçeği tıklamadan ÖNCE arayüzde yansıtır (isOfferPendingActionBlocked
  // İLE AYNI "backend gerçeğinin istemci yansıması" ilkesi).
  const jobCategoryEligibility = useJobCategoryEligibility(job, offer.providerId);
  const isCategoryIneligible =
    job &&
    (isContainerStorageCategory(job.category) || isHazardousStorageCategory(job.category) || isRecyclingCategory(job.category)) &&
    jobCategoryEligibility.eligible === false;

  useEffect(() => {
    if (!highlighted || !cardRef.current) return;
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    cardRef.current.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [highlighted]);

  async function handleDecision(nextStatus: "accepted" | "rejected") {
    if (pendingAction) return;
    setPendingAction(nextStatus);
    setError(null);
    const result = await updateOfferStatus(session, offer.id, nextStatus);
    setPendingAction(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <div
      ref={cardRef}
      className={`rounded-card border bg-surface p-6 transition-colors ${
        highlighted ? "border-primary ring-2 ring-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background">
            {identityRevealed && logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- IndexedDB blob object URL, next/image optimize edemez
              <img src={logoUrl} alt={`${companyName} logosu`} className="h-full w-full object-cover" />
            ) : identityRevealed ? (
              <Building2 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {job ? job.title : "İlan artık mevcut değil"}
            </p>
            {job && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                {formatJobLocationLine(job)}
              </p>
            )}
            {job && formatJobProductInfoLine(job) && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <Package className="h-3 w-3 shrink-0" aria-hidden="true" />
                {formatJobProductInfoLine(job)}
              </p>
            )}
            {identityRevealed ? (
              <p className="mt-1 truncate text-sm font-bold tracking-heading leading-tight text-foreground">
                {companyName}
                <span className="ml-2 font-normal text-muted-foreground">
                  ({getRoleLabel("hizmet-veren")})
                </span>
              </p>
            ) : (
              <p className="mt-1 truncate text-sm font-bold tracking-heading leading-tight text-foreground">{anonymousLabel}</p>
            )}
            {/*
              Yıldız puanı + tamamlanan iş sayısı BİLEREK `identityRevealed`den
              BAĞIMSIZ — Hizmet Alan, teklifi kabul/reddetmeden ÖNCE hizmet
              verenin performansını görebilmeli (bkz. görev tanımı). Bu ikisi
              yalnızca `providerSummary`ye (offers.ts/ratings.ts'ten türetilen,
              iptal/red/anlaşamama işleri hariç tutan TEK doğruluk kaynağı)
              dayanır — isim/logo/telefon/e-posta İÇERMEZ. Bölgeler `<span>`'ı
              ise coğrafi bilgi kimliğe yaklaşan bir sinyal olduğu için AYNEN
              `identityRevealed` kapılı kalır.
            */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="flex shrink-0 items-center gap-1">
                <span className="flex" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className="h-3 w-3 text-rating"
                      fill={
                        providerSummary.averageStars !== null && star <= Math.round(providerSummary.averageStars)
                          ? "currentColor"
                          : "transparent"
                      }
                      strokeWidth={1.75}
                    />
                  ))}
                </span>
                {providerSummary.averageStars !== null ? (
                  <span>
                    {providerSummary.averageStars.toFixed(1)} ({providerSummary.ratingCount})
                  </span>
                ) : (
                  <span>Henüz değerlendirme yok</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                {providerSummary.completedJobCount} tamamlanan iş
              </span>
              {identityRevealed && providerProfile && providerProfile.regions.length > 0 && (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{providerProfile.regions.join(", ")}</span>
                </span>
              )}
            </div>
            {!identityRevealed && offer.status === "pending" && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Firma kimliği ve iletişim bilgileri, teklifi kabul ettiğinizde görünür olacak.
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusBadge label={getOfferStatusLabel(offer.status)} tone={getOfferStatusTone(offer.status)} />
          {job && <JobCategoryEligibilityBadge job={job} providerId={offer.providerId} />}
        </div>
      </div>

      {identityRevealed && providerProfile && providerProfile.expertise.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {providerProfile.expertise.map((item) => (
            <span
              key={item}
              className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent"
            >
              {item}
            </span>
          ))}
        </div>
      )}

      {identityRevealed && providerProfile?.bio?.trim() && (
        <p className="mt-3 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
          {providerProfile.bio}
        </p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-lg font-semibold text-foreground">
          {offer.commercialDirection
            ? formatRecyclingCommercialDirectionLabel(offer.commercialDirection, formatMoney(offer.amount, offer.currency))
            : formatMoney(offer.amount, offer.currency)}
        </p>

        <div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
          {job && isTransportationCategory(job.category) && (
            <span>Tamamlanması Taahhüt Edilen Gün: {formatCommittedDays(offer.estimatedDuration)}</span>
          )}
          <span>Teklif tarihi: {formatJobDate(offer.createdAt)}</span>
        </div>

        <p className="mt-3 break-words text-sm leading-relaxed text-muted-foreground">{offer.description}</p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {offer.status === "pending" &&
        (isOfferPendingActionBlocked(offer, allOffers) ? (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{OFFER_PENDING_BLOCKED_MESSAGE}</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => handleDecision("accepted")}
              disabled={pendingAction !== null || isCategoryIneligible}
              title={isCategoryIneligible ? "Bu teklifin hizmet uygunluğu artık geçerli değil." : undefined}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-success px-5 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Kabul Et
            </button>
            <button
              type="button"
              onClick={() => handleDecision("rejected")}
              disabled={pendingAction !== null}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Reddet
            </button>
          </div>
        ))}

      {revealedContact && <ContactInfoBlock contact={revealedContact.provider} />}

      {(offer.status === "accepted" ||
        offer.status === "completion_requested" ||
        offer.status === "completion_disputed") && (
        <OfferOutcomePanel offer={offer} session={session} onCompleted={onCompleted} />
      )}
    </div>
  );
}
