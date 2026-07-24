import {
  getJobRequestNotificationHref,
  getProviderOfferFilter,
  getProviderOfferNotificationHref,
  getSettledOfferForJob,
  isOfferVisibleInNormalLists,
} from "./job-requests";
import type { Job, Offer, Session } from "./types";
import { findUserById } from "./users";

export type NotificationType =
  | "yeni_teklif"
  | "teklif_kabul_edildi"
  | "teklif_reddedildi"
  | "is_basladi"
  | "anlasma_saglanamadi"
  | "baska_hizmet_verenle_anlasildi"
  | "ilan_yeniden_yayinda"
  | "tamamlanma_onayi_bekleniyor"
  | "is_tamamlandi"
  | "tamamlanma_onaylandi"
  | "tamamlanma_itiraz_edildi"
  | "itiraz_kaydedildi"
  | "is_iptal_edildi"
  | "teklif_geri_cekildi";

export type AppNotification = {
  id: string;
  notificationType: NotificationType;
  /** Yalnızca birkaç bildirim türünde bulunur (bugün "teklif_geri_cekildi" ve "baska_hizmet_verenle_anlasildi") — diğerlerinde yoktur, arayüz bu durumda başlık satırını hiç render etmez. */
  title?: string;
  message: string;
  ilanId: string;
  offerId: string;
  /** Bildirime tıklanınca gidilecek hedef route. */
  href: string;
  createdAt: string;
};

/**
 * Bildirimler yalnızca gerçek sistem verisinden (Offer.status) türetilir,
 * sabit/demo bildirim veya ayrı bir "bildirim"/"olay" tablosu yok — tıpkı
 * "yeni_teklif"in offer.createdAt'ten türetilmesi gibi. Bu sayede id'ler
 * sabit kalır (offer.id + olay adına bağlı) ve okunma durumu
 * (notification-reads.ts) kalıcı olarak eşleşmeye devam eder. Rol bazında
 * iki ayrı türetim vardır — Hizmet Alan ve Hizmet Veren asla birbirinin
 * bildirimini görmez.
 *
 * ÖNEMLİ: "accepted"/"in_progress"/"completion_requested"/
 * "completion_disputed" gibi GEÇİCİ (bir sonraki geçişte üzerine yazılan)
 * durumlara bağlı bildirimler, teklif o durumdan çıktığında (ör.
 * "completion_requested" -> "completed") listeden kendiliğinden kalkar —
 * çünkü hep offer'ın O ANKİ status'una göre süzülür, ayrı bir geçmiş kaydı
 * tutulmaz. "agreement_failed"/"completed"/"rejected"/"cancelled"/
 * "withdrawn" gibi TERMİNAL durumlar bu yüzden kalıcıdır (offer bir daha
 * o durumdan çıkmaz). Bu, mevcut mimarinin (ayrı olay tablosu yok, tek
 * doğruluk kaynağı Offer.status) doğal ve kasıtlı bir sonucudur.
 *
 * Aynı temel olay (ör. tamamlama onaylandı), alıcıya göre FARKLI
 * notificationType değerleriyle iki kez türetilebilir — "anlasma_saglanamadi"
 * (Hizmet Veren) / "ilan_yeniden_yayinda" (Hizmet Alan) ikilisiyle aynı
 * mevcut desen.
 *
 *  - Hizmet Alan: "yeni_teklif" (değişmedi) + anlaşma sağlanamayan teklif
 *    için "ilan_yeniden_yayinda" + Hizmet Veren tamamlama talebi
 *    gönderdiğinde "tamamlanma_onayi_bekleniyor" + kendi onayladığı
 *    tamamlanma için (işlem kaydı) "is_tamamlandi" + kendi gönderdiği
 *    itiraz için (işlem kaydı) "itiraz_kaydedildi" + geri çekilen teklif
 *    için "teklif_geri_cekildi".
 *  - Hizmet Veren: kabul edilen teklifi için "teklif_kabul_edildi" +
 *    reddedilen teklifi için "teklif_reddedildi" + işe başlanan teklifi
 *    için "is_basladi" + anlaşma sağlanamayan teklifi için
 *    "anlasma_saglanamadi" + Hizmet Alan'ın onayladığı tamamlanma için
 *    "tamamlanma_onaylandi" + Hizmet Alan'ın itiraz ettiği tamamlanma
 *    talebi için "tamamlanma_itiraz_edildi" + itirazın iptalle
 *    sonuçlanması için "is_iptal_edildi" + AYNI ilana verdiği (hâlâ
 *    "pending" kalan) bir teklifin, başka bir Hizmet Veren'in teklifi işe
 *    fiilen başladığı için kapanması durumunda "baska_hizmet_verenle_anlasildi"
 *    (bkz. siblingClosedNotifications, aşağıda — DİĞER altı bildirimden
 *    farklı olarak KENDİ Offer'ının değil, aynı jobId'deki KARDEŞ bir
 *    Offer'ın durum geçişinden türetilir).
 *
 * Hizmet Veren tarafındaki bu yedi bildirimin `href`i sabit bir string
 * DEĞİL — job-requests.ts#getProviderOfferNotificationHref(offer, offers)
 * çağrılır, bu da aynı teklifin "Verdiğim Teklifler" sayfasında GERÇEKTEN
 * hangi sekmede göründüğünü belirleyen tek kaynağı (getProviderOfferFilter)
 * kullanır. Böylece ör. "is_basladi" (in_progress) her zaman "Devam Eden"
 * sekmesine, "tamamlanma_onaylandi" (completed) her zaman "Tamamlanan"
 * sekmesine, "anlasma_saglanamadi" (agreement_failed), "is_iptal_edildi"
 * (cancelled) VE "baska_hizmet_verenle_anlasildi" (kapanan "pending" kardeş
 * teklif) her zaman "Kapanan Teklifler" sekmesine yönlendirir — bildirim
 * metnine göre kırılgan bir eşleştirme değil, Offer.status'a göre türetilen
 * bir eşleştirmedir.
 */
export function getNotificationsForSession(
  session: Session,
  jobs: Job[],
  offers: Offer[],
): AppNotification[] {
  if (session.role === "hizmet-alan") {
    const myJobs = jobs.filter((job) => job.requesterId === session.id);
    const myJobById = new Map(myJobs.map((job) => [job.id, job] as const));
    const myJobTitleById = new Map(myJobs.map((job) => [job.id, job.title] as const));

    // "withdrawn" teklifler burada BİLEREK hariç tutulur: href'i
    // (`/panel/gelen-teklifler?offerId=...`) her zaman sabit kalan bu
    // bildirim, statüsü ne olursa olsun türetildiği için geri çekilmiş bir
    // teklif için üretilmeye devam ederse Gelen Teklifler listesinde artık
    // hiç görünmeyen (bkz. isOfferVisibleInNormalLists, job-requests.ts —
    // tek ortak doğruluk kaynağı, aynı kural burada tekrar yazılmaz) bir
    // teklife işaret eden ölü bir bağlantıya dönüşür. Ayrı bir
    // "teklif_geri_cekildi" bildirimi zaten doğru (durum-farkında) href ile
    // bu olayı karşılıyor (bkz. withdrawnNotifications, aşağıda).
    const newOfferNotifications: AppNotification[] = offers
      .filter((offer) => myJobTitleById.has(offer.jobId) && isOfferVisibleInNormalLists(offer))
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

    const completionRequestedNotifications: AppNotification[] = offers
      .filter((offer) => offer.status === "completion_requested" && myJobTitleById.has(offer.jobId))
      .map((offer) => ({
        id: `completion-requested-${offer.id}`,
        notificationType: "tamamlanma_onayi_bekleniyor",
        message:
          "Hizmet Veren işin tamamlandığını bildirdi. Lütfen işi kontrol ederek onaylayın veya itiraz edin.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: "/panel/hizmet-taleplerim?durum=devam-eden",
        createdAt: offer.updatedAt,
      }));

    const completedNotifications: AppNotification[] = offers
      .filter((offer) => offer.status === "completed" && myJobTitleById.has(offer.jobId))
      .map((offer) => ({
        id: `job-completed-${offer.id}`,
        notificationType: "is_tamamlandi",
        message: "İşin tamamlanmasını onayladınız. İş Tamamlanan İşler bölümüne taşındı.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: "/panel/hizmet-taleplerim?durum=tamamlandi",
        createdAt: offer.updatedAt,
      }));

    const disputeRecordNotifications: AppNotification[] = offers
      .filter((offer) => offer.status === "completion_disputed" && myJobTitleById.has(offer.jobId))
      .map((offer) => ({
        id: `completion-disputed-record-${offer.id}`,
        notificationType: "itiraz_kaydedildi",
        message: "Tamamlanma talebine yaptığınız itiraz Hizmet Veren'e iletildi.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: "/panel/hizmet-taleplerim?durum=devam-eden",
        createdAt: offer.updatedAt,
      }));

    // Firma/görüntüleme adı: sözleşme kabul edilmeden önce hiçbir zaman
    // telefon/e-posta/adres gösterilmez (bkz. contact-access.ts — withdrawn
    // bir teklif ENGAGED_OFFER_STATUSES dışında olduğu için buraya zaten hiç
    // girmemiştir). Ad önceliği, provider-profile-drawer.tsx'teki AYNI
    // mevcut kalıp: firma adı varsa o, yoksa hesap adı, o da yoksa jenerik
    // "Hizmet Veren" — burada yeni bir isim/gizlilik kuralı icat edilmez.
    // Teklif kaydı ve dolayısıyla bu bildirim yalnızca offers.ts#withdrawOffer
    // başarıyla "pending" -> "withdrawn" yazdığında var olur (başarısız
    // denemede status değişmez, bildirim de türemez) ve offer.id başına en
    // fazla bir kayıt olabileceği için (art arda tıklamalar ikinci
    // "pending"i bulamayıp reddedilir) mükerrer bildirim yapısal olarak
    // imkânsızdır — ayrı bir dedup mekanizması gerekmez.
    const withdrawnNotifications: AppNotification[] = offers
      .filter((offer) => offer.status === "withdrawn" && myJobTitleById.has(offer.jobId))
      .map((offer) => {
        const provider = findUserById(offer.providerId);
        const displayName = provider?.providerProfile?.companyName?.trim() || provider?.name || "Hizmet Veren";
        const jobTitle = myJobTitleById.get(offer.jobId) ?? "ilanınız";
        return {
          id: `offer-withdrawn-${offer.id}`,
          notificationType: "teklif_geri_cekildi" as const,
          title: "Bir teklif geri çekildi",
          message: `${displayName}, "${jobTitle}" ilanına verdiği teklifi geri çekti. Bu teklif geri çekildiği için artık gelen teklifler arasında görüntülenmez.`,
          ilanId: offer.jobId,
          offerId: offer.id,
          href: getJobRequestNotificationHref(myJobById.get(offer.jobId) ?? null, offers),
          createdAt: offer.updatedAt,
        };
      });

    return [
      ...newOfferNotifications,
      ...reopenedNotifications,
      ...completionRequestedNotifications,
      ...completedNotifications,
      ...disputeRecordNotifications,
      ...withdrawnNotifications,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  if (session.role === "hizmet-veren") {
    const myOffers = offers.filter((offer) => offer.providerId === session.id);

    const acceptedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "accepted")
      .map((offer) => ({
        id: `offer-accepted-${offer.id}`,
        notificationType: "teklif_kabul_edildi",
        message: "Hizmet Alan teklifinizi kabul etti.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const rejectedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "rejected")
      .map((offer) => ({
        id: `offer-rejected-${offer.id}`,
        notificationType: "teklif_reddedildi",
        message: "Hizmet Alan teklifinizi kabul etmedi.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const startedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "in_progress")
      .map((offer) => ({
        id: `offer-started-${offer.id}`,
        notificationType: "is_basladi",
        message: "Hizmet Alan, işin başladığını onayladı.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const completionApprovedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "completed")
      .map((offer) => ({
        id: `completion-approved-${offer.id}`,
        notificationType: "tamamlanma_onaylandi",
        message: "Hizmet Alan işin tamamlandığını onayladı.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const completionDisputedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "completion_disputed")
      .map((offer) => ({
        id: `completion-disputed-requester-${offer.id}`,
        notificationType: "tamamlanma_itiraz_edildi",
        message: "Hizmet Alan, işin tamamlanma talebine itiraz etti. İtiraz açıklamasını kontrol edin.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const cancelledNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "cancelled")
      .map((offer) => ({
        id: `job-cancelled-${offer.id}`,
        notificationType: "is_iptal_edildi",
        message: "Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    const agreementFailedNotifications: AppNotification[] = myOffers
      .filter((offer) => offer.status === "agreement_failed")
      .map((offer) => ({
        id: `agreement-failed-${offer.id}`,
        notificationType: "anlasma_saglanamadi" as const,
        message:
          "Teklifinizin kabul edildiği ilan için anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.",
        ilanId: offer.jobId,
        offerId: offer.id,
        href: getProviderOfferNotificationHref(offer, offers),
        createdAt: offer.updatedAt,
      }));

    // DİĞER altı Hizmet Veren bildiriminden farklı olarak, myOffers'ı KENDİ
    // status'una göre değil, `getProviderOfferFilter` (job-requests.ts — tek
    // ortak doğruluk kaynağı, "Kapanan Teklifler" sekmesiyle BİREBİR aynı
    // kural) üzerinden süzer. Yalnızca hâlâ "pending" olan (bkz.
    // isOfferVisibleInNormalLists — withdrawn zaten "pending" değildir ama
    // netlik için) VE aynı jobId'de başka bir teklif fiilen işe başladığı
    // için "kapanan-teklifler"e düşen teklifler için üretilir:
    //  - Yalnızca KABUL (accepted) değil, İŞE BAŞLAMA (in_progress+) anında
    //    tetiklenir — getProviderOfferFilter, settled teklif hâlâ yalnızca
    //    "accepted" iken bilerek "aktif" döndürür (bkz. oradaki doküman).
    //  - İşi başlayan teklifin KENDİSİNE hiç gitmez — o offer.status
    //    "pending" değil "in_progress"tir, bu filtreye hiç girmez.
    //  - Reddedilmiş/iptal edilmiş/geri çekilmiş teklifler zaten "pending"
    //    olmadığı için otomatik elenir; ayrı bir kontrol gerekmez.
    //  - Settled teklif sonradan "cancelled" olup ilan yeniden açılırsa
    //    (bkz. isOfferClosedByJobProgress) bu teklif "aktif"e döner ve
    //    bildirim kendiliğinden listeden kalkar — TERMİNAL değil, GEÇİCİ bir
    //    bildirimdir (yukarıdaki genel not ile aynı desen).
    //  - id yalnızca offer.id'ye bağlıdır (yeni bir Offer.status/alan icat
    //    edilmedi) — aynı teklif için, koşul true kaldığı sürece HER render'da
    //    aynı id üretilir, mükerrer kayıt oluşmaz; okunma/silinme durumu
    //    (notification-reads.ts/notification-dismissals.ts) bu id'ye göre
    //    kalıcı kalır.
    const siblingClosedNotifications: AppNotification[] = myOffers
      .filter(
        (offer) => offer.status === "pending" && getProviderOfferFilter(offer, offers) === "kapanan-teklifler",
      )
      .map((offer) => {
        // Bildirimin "olay zamanı" (createdAt) kendi offer'ının değil,
        // ilanı kapatan kardeş teklifin ne zaman güncellendiğidir (işe
        // başlama anı) — kendi offer.updatedAt'i hâlâ teklifin ilk
        // gönderilme anını taşır, bu yüzden sıralamada yanlış olurdu.
        const settledOffer = getSettledOfferForJob(offer.jobId, offers);
        return {
          id: `sibling-closed-${offer.id}`,
          notificationType: "baska_hizmet_verenle_anlasildi" as const,
          title: "Başka Bir Hizmet Verenle Anlaşıldı",
          message: "Teklif verdiğiniz ilan için başka bir Hizmet Verenle işe başlandı.",
          ilanId: offer.jobId,
          offerId: offer.id,
          href: getProviderOfferNotificationHref(offer, offers),
          createdAt: settledOffer?.updatedAt ?? offer.updatedAt,
        };
      });

    return [
      ...acceptedNotifications,
      ...rejectedNotifications,
      ...startedNotifications,
      ...agreementFailedNotifications,
      ...siblingClosedNotifications,
      ...completionApprovedNotifications,
      ...completionDisputedNotifications,
      ...cancelledNotifications,
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return [];
}
