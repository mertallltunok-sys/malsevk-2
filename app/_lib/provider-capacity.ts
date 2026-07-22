import { ENGAGED_OFFER_STATUSES } from "./job-requests";
import type { Offer } from "./types";

/**
 * Bir Hizmet Veren'in aynı anda yürütebileceği en fazla aktif iş sayısı.
 * Tek, merkezi bir sabit olarak tutulur — kod içinde başka hiçbir yerde "2"
 * değeri tekrarlanmamalıdır. İleride kullanıcı tipine/üyelik paketine göre
 * (ör. bir kullanıcının/paketin kendi limitini döndüren bir fonksiyona)
 * kolayca dönüştürülebilmesi için ayrı, bağımsız bir modülde tutulur.
 */
export const MAX_ACTIVE_JOBS = 5;

/**
 * Bir Hizmet Veren'in şu an aktif (henüz sonuçlanmamış — bkz.
 * job-requests.ts#ENGAGED_OFFER_STATUSES) kaç işi olduğunu sayar.
 */
export function getActiveJobCount(providerId: string, offers: Offer[]): number {
  return offers.filter(
    (offer) => offer.providerId === providerId && ENGAGED_OFFER_STATUSES.includes(offer.status),
  ).length;
}

/** Bir Hizmet Veren'in aktif iş kapasitesinin dolu olup olmadığını söyler. */
export function hasReachedActiveJobLimit(providerId: string, offers: Offer[]): boolean {
  return getActiveJobCount(providerId, offers) >= MAX_ACTIVE_JOBS;
}
