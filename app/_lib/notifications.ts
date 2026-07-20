import type { Job, Offer, Session } from "./types";

export type NotificationType = "yeni_teklif";

export type AppNotification = {
  id: string;
  notificationType: NotificationType;
  message: string;
  ilanId: string;
  offerId: string;
  /** Bildirime tıklanınca gidilecek hedef route. */
  href: string;
  createdAt: string;
};

/**
 * Bildirimler yalnızca gerçek sistem verisinden türetilir: Hizmet Alan
 * kullanıcının kendi oluşturduğu ilanlara (requesterId eşleşmesi) gelen
 * gerçek tekliflerden. Sabit/demo bildirim üretilmez. Hedef route, teklif
 * formunun olduğu ilan detayına değil, Gelen Teklifler sayfasındaki ilgili
 * teklif kartına gider.
 */
export function getNotificationsForSession(
  session: Session,
  jobs: Job[],
  offers: Offer[],
): AppNotification[] {
  if (session.role !== "hizmet-alan") return [];

  const myJobTitleById = new Map(
    jobs
      .filter((job) => job.requesterId === session.id)
      .map((job) => [job.id, job.title] as const),
  );

  return offers
    .filter((offer) => myJobTitleById.has(offer.jobId))
    .map((offer) => ({
      id: offer.id,
      notificationType: "yeni_teklif" as const,
      message: `İlanınıza yeni teklif geldi: ${myJobTitleById.get(offer.jobId)}`,
      ilanId: offer.jobId,
      offerId: offer.id,
      href: `/panel/gelen-teklifler?offerId=${offer.id}`,
      createdAt: offer.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
