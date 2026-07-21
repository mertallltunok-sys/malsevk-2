import type { Job, Offer, Session } from "./types";

export type NotificationType = "yeni_teklif" | "anlasma_saglanamadi" | "ilan_yeniden_yayinda";

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
 * Bildirimler yalnızca gerçek sistem verisinden türetilir, sabit/demo
 * bildirim üretilmez. Rol bazında iki ayrı türetim vardır — Hizmet Alan ve
 * Hizmet Veren asla birbirinin bildirimini görmez:
 *
 *  - Hizmet Alan: kendi ilanlarına gelen her teklif için "yeni_teklif"
 *    (değişmedi) + kendi ilanlarında anlaşma sağlanamayan her teklif için
 *    "ilan_yeniden_yayinda".
 *  - Hizmet Veren: kendi verdiği, sonradan anlaşma sağlanamayan her teklif
 *    için "anlasma_saglanamadi".
 *
 * Her iki yeni tür de var olan bir Offer kaydının status'unun
 * "agreement_failed" olmasından türetilir — ayrı bir "bildirim" veya "olay"
 * tablosu yok, tıpkı "yeni_teklif"in offer.createdAt'ten türetilmesi gibi.
 * Bu sayede id'ler sabit kalır (offer.id'ye bağlı) ve okunma durumu
 * (notification-reads.ts) kalıcı olarak eşleşmeye devam eder.
 */
export function getNotificationsForSession(
  session: Session,
  jobs: Job[],
  offers: Offer[],
): AppNotification[] {
  if (session.role === "hizmet-alan") {
    const myJobTitleById = new Map(
      jobs
        .filter((job) => job.requesterId === session.id)
        .map((job) => [job.id, job.title] as const),
    );

    const newOfferNotifications: AppNotification[] = offers
      .filter((offer) => myJobTitleById.has(offer.jobId))
      .map((offer) => ({
        id: `offer-received-${offer.id}`,
        notificationType: "yeni_teklif",
        message: `İlanınıza yeni teklif geldi: ${myJobTitleById.get(offer.jobId)}`,
        ilanId: offer.jobId,
        offerId: offer.id,
        href: `/panel/gelen-teklifler?offerId=${offer.id}`,
        createdAt: offer.createdAt,
      }));

    const reopenedNotifications: AppNotification[] = offers
      .filter((offer) => offer.status === "agreement_failed" && myJobTitleById.has(offer.jobId))
      .map((offer) => ({
        id: `job-reopened-${offer.id}`,
        notificationType: "ilan_yeniden_yayinda",
        message:
          "Anlaşma sağlanamadığı için ilanınız yeniden yayına alındı ve yeni teklifler almaya hazır.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: `/ilanlar/${offer.jobId}`,
        createdAt: offer.updatedAt,
      }));

    return [...newOfferNotifications, ...reopenedNotifications].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  if (session.role === "hizmet-veren") {
    return offers
      .filter((offer) => offer.providerId === session.id && offer.status === "agreement_failed")
      .map((offer) => ({
        id: `agreement-failed-${offer.id}`,
        notificationType: "anlasma_saglanamadi" as const,
        message:
          "Teklifinizin kabul edildiği ilan için anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: `/ilanlar/${offer.jobId}`,
        createdAt: offer.updatedAt,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return [];
}
