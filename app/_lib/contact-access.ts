import { ENGAGED_OFFER_STATUSES } from "./job-requests";
import { findJobById } from "./jobs-lookup";
import { getAllOffers } from "./offers";
import type { Session } from "./types";
import { findUserById, type StoredUser } from "./users";

/**
 * `phone`/`email` `null` olabilir — bu, zamanlama kapısının kapalı olmasından
 * (o durumda `RevealedContact`in TAMAMI `null` döner, aşağıya bkz.) AYRI bir
 * kavramdır: kapı açık (taraflar birbirinin ismini görebiliyor) ama bu
 * ALANIN sahibi "İletişim Bilgisi Görünürlüğü" (Hesap Ayarları) tercihinde
 * bu alanı paylaşmamayı seçmiş demektir (bkz. `applyContactVisibility`).
 * `name` hiçbir zaman bu tercihe tabi değildir — yalnızca e-posta/telefon
 * bağımsız olarak kapatılabilir.
 */
export type ContactInfo = { name: string; phone: string | null; email: string | null };

export type RevealedContact = {
  /** Teklifi veren Hizmet Veren'in iletişim bilgisi. */
  provider: ContactInfo;
  /** İlanı oluşturan Hizmet Alan'ın iletişim bilgisi. */
  requester: ContactInfo;
};

/**
 * Bir kullanıcının HAM `phone`/`email` değerlerini, o kullanıcının KENDİ
 * "İletişim Bilgisi Görünürlüğü" tercihine göre süzer — bu, veri erişim
 * katmanının kendisidir (yalnızca görsel gizleme değil): opt-out edilmiş bir
 * alanın ham değeri bu fonksiyonun DIŞINA hiç çıkmaz. `undefined` (kullanıcı
 * henüz tercih belirlemedi) her iki alan için de `true` (görünür) sayılır —
 * bu, özellik eklenmeden ÖNCEki davranışla (her ikisi de her zaman
 * gösteriliyordu) birebir aynı sonucu verir, mevcut kullanıcıların akışını
 * bozmaz. Bir kullanıcının tercihi yalnızca KENDİ kaydından okunur — karşı
 * tarafın tercihini asla etkilemez.
 */
function applyContactVisibility(user: StoredUser): ContactInfo {
  return {
    name: user.name,
    phone: (user.showPhoneAfterAgreement ?? true) ? user.phone : null,
    email: (user.showEmailAfterAgreement ?? true) ? user.email : null,
  };
}

/**
 * İletişim bilgilerinin TEK ortak erişim kapısı. Bu fonksiyon dışında
 * hiçbir bileşen doğrudan kullanıcı kaydından phone/email okumamalıdır.
 * Yalnızca şu koşulların TAMAMI doğruysa veri döner, aksi halde null:
 *  - Teklif gerçekten var mı ve durumu "meşgul" (ENGAGED_OFFER_STATUSES —
 *    accepted/in_progress/completion_requested/completion_disputed) mi?
 *    İş sona erdiğinde (completed/cancelled/agreement_failed ve diğer tüm
 *    durumlar) iletişim bilgisi otomatik gizlenir — hem eski kabul eden
 *    firma hem de ilan sahibi karşı tarafın bilgisini kaybeder, ayrı bir
 *    "gizle" işlemi gerekmez.
 *  - İlgili ilan bulunabiliyor mu ve bir requesterId'si var mı?
 *  - Oturumdaki kullanıcı işin taraflarından biri mi (teklifi veren
 *    Hizmet Veren ya da ilanı oluşturan Hizmet Alan)?
 *
 * NOT (mimari sınır): Bu uygulamada gerçek bir backend yok; tüm kullanıcı
 * kayıtları (telefon/e-posta dahil) tarayıcının localStorage'ında durur ve
 * teknik olarak herhangi bir istemci JS'i (ör. devtools konsolu) bu ham
 * veriyi doğrudan okuyabilir. Bu fonksiyon, UYGULAMA KATMANININ (React
 * bileşenlerinin) yetkisiz veriye asla erişmemesini garanti eder — ama
 * localStorage'ın kendisini bir üçüncü tarafın doğrudan incelemesine karşı
 * koruyamaz. Bu, gerçek bir sunucu/API olmadan aşılamayacak temel bir
 * mimari sınırdır.
 */
export function getRevealedContactForOffer(
  session: Session | null,
  offerId: string,
): RevealedContact | null {
  if (!session) return null;

  const offer = getAllOffers().find((item) => item.id === offerId);
  if (!offer || !ENGAGED_OFFER_STATUSES.includes(offer.status)) return null;

  const job = findJobById(offer.jobId);
  if (!job || !job.requesterId) return null;

  const isParty = session.id === offer.providerId || session.id === job.requesterId;
  if (!isParty) return null;

  const provider = findUserById(offer.providerId);
  const requester = findUserById(job.requesterId);
  if (!provider || !requester) return null;

  return {
    provider: applyContactVisibility(provider),
    requester: applyContactVisibility(requester),
  };
}
