import { isJobManuallyClosed } from "./job-closure";
import { isJobOpenForOffers } from "./jobs";
import type { Job, Offer, OfferStatus, Session } from "./types";

export type JobRequestFilter = "aktif" | "kabul-edildi" | "devam-eden" | "tamamlandi";

/**
 * Bir teklifin "meşgul / henüz sonuçlanmamış" sayılan durumları — TEK ortak
 * doğruluk kaynağı, birden fazla bağımsız kuralın kullandığı:
 *  - "Bu ilan silinebilir mi" (jobHasAcceptedOffer, aşağıda — yalnızca
 *    offers.ts#deleteJobWithOffers'ın koruması; YENİ teklif verilebilirliğini
 *    ARTIK belirlemez, bkz. getJobOfferAvailability)
 *  - "Bu Hizmet Veren'in aktif iş kapasitesi doluyor mu"
 *    (provider-capacity.ts#getActiveJobCount)
 * İkisi kavramsal olarak aynı şeyi ifade eder: bir teklif bu durumlardan
 * birindeyse taraflar arasındaki iş henüz kapanmamıştır. Ayrıca
 * contact-access.ts, iletişim bilgisinin ne zaman açığa çıkacağını da bu
 * kümeyle belirler — iş süren tarafların birbirinin iletişim bilgisini
 * kaybetmemesi için. "agreement_failed" bilerek DAHİL DEĞİL — anlaşma
 * sağlanamadığında bu teklif artık "meşgul" sayılmaz (ilan silinebilir hale
 * gelir), Job.status'a hiç dokunulmadan. "completed"/"cancelled" de DAHİL
 * DEĞİL — bunlar işin sonuçlandığı, artık meşgul olmayan durumlardır.
 */
export const ENGAGED_OFFER_STATUSES: OfferStatus[] = [
  "accepted",
  "in_progress",
  "completion_requested",
  "completion_disputed",
];

/**
 * "Devam Eden İşler" olarak sayılan teklif durumları — TEK ortak doğruluk
 * kaynağı. İş fiilen başlamış ("in_progress") ama henüz iki tarafça da
 * kapatılmamış tüm durumları kapsar: tamamlandı bildirimi Hizmet Veren
 * tarafından gönderilmiş ama Hizmet Alan tarafından henüz onaylanmamış
 * ("completion_requested") ya da itiraz edilmiş ("completion_disputed")
 * olsa bile iş hâlâ "devam ediyor" sayılır. "accepted" bilerek DAHİL
 * DEĞİL — kabul edilmiş ama işe henüz başlanmamış teklifler ayrı bir
 * durumdur (bkz. getJobRequestFilter: "kabul-edildi").
 */
export const IN_PROGRESS_OFFER_STATUSES: OfferStatus[] = [
  "in_progress",
  "completion_requested",
  "completion_disputed",
];

/** "Tamamlanan İşler" olarak sayılan teklif durumları — TEK ortak doğruluk kaynağı. */
export const COMPLETED_OFFER_STATUSES: OfferStatus[] = ["completed"];

/**
 * Bir ilanın artık düzenlenemeyeceği teklif durumları — ENGAGED_OFFER_STATUSES
 * (iş hâlâ süren teklifler) + COMPLETED_OFFER_STATUSES (tamamlanmış) +
 * "cancelled" (bir tamamlanma anlaşmazlığının iptalle sonuçlanması, bkz.
 * offers.ts#resolveCompletionDispute) birleşimi. "cancelled" BİLEREK
 * ENGAGED_OFFER_STATUSES'a dahil değil (orası yalnızca "iş hâlâ sürüyor"
 * anlamına gelir, provider-capacity.ts onu bir kapasite serbest bırakma
 * sinyali olarak kullanır) — ama fiilen yaşanmış ve iptalle kapanmış bir
 * işin ilanı da artık düzenlenebilir olmamalı, bu yüzden burada AYRICA
 * ekleniyor. "pending"/"rejected"/"withdrawn"/"agreement_failed" bilerek
 * dışarıda — bunlar ilanın hâlâ düzenlenebilir kaldığı durumlardır (iş hiç
 * başlamadı ya da agreement_failed'da olduğu gibi ilan otomatik olarak
 * yeniden teklife açıldı). Modül dışına açılmıyor; tek erişim noktası
 * aşağıdaki `isJobEditable`'dır — durum listesi başka hiçbir dosyada
 * tekrar yazılmamalı.
 */
const JOB_LOCKING_OFFER_STATUSES: OfferStatus[] = [
  ...ENGAGED_OFFER_STATUSES,
  ...COMPLETED_OFFER_STATUSES,
  "cancelled",
];

/** job-edit-form.tsx (route koruması) ve job-store.ts#updateJob (veri katmanı) aynı mesajı kullanır. */
export const JOB_NOT_EDITABLE_MESSAGE = "Bu ilan, teklif süreci başladığı için artık düzenlenemez.";

/**
 * Bir ilanın (mevcut tekliflerine göre) hâlâ düzenlenebilir olup olmadığını
 * söyler — TEK ortak doğruluk kaynağı. job-requests-panel.tsx ("Düzenle"
 * linkinin görünürlüğü), job-edit-form.tsx (route koruması) ve
 * job-store.ts#updateJob (veri katmanı koruması) HEPSİ bu fonksiyonu
 * çağırır; aynı kural üç yerde ayrı ayrı yazılmaz.
 */
export function isJobEditable(jobId: string, offers: Offer[]): boolean {
  return !offers.some(
    (offer) => offer.jobId === jobId && JOB_LOCKING_OFFER_STATUSES.includes(offer.status),
  );
}

/**
 * Bir teklif bu durumlardan birine geçtiğinde, aynı Hizmet Veren'in aynı
 * ilana yeniden teklif verebilmesi süreli olarak (bkz. REOFFER_COOLDOWN_DAYS)
 * engellenir — kalıcı değil. "accepted"/"in_progress"/"completion_requested"/
 * "completion_disputed"/"completed"/"cancelled" bilerek DAHİL DEĞİL — bu
 * durumlardan sonra aynı ilana asla yeniden teklif verilemez (bkz.
 * offers.ts#createOffer). TEK ortak doğruluk kaynağıdır.
 */
export type ReofferCooldownStatus = "withdrawn" | "rejected" | "agreement_failed";

export const REOFFER_COOLDOWN_OFFER_STATUSES: ReofferCooldownStatus[] = [
  "withdrawn",
  "rejected",
  "agreement_failed",
];

/** REOFFER_COOLDOWN_OFFER_STATUSES'tan birine geçtikten sonra yeniden teklif verilebilmesi için beklenmesi gereken gün sayısı. */
export const REOFFER_COOLDOWN_DAYS = 3;

/** Tip daraltıcı: `Array.prototype.includes` TypeScript'te otomatik daraltma yapmadığı için (bkz. offer-panel.tsx). */
export function isReofferCooldownStatus(status: OfferStatus): status is ReofferCooldownStatus {
  return status === "withdrawn" || status === "rejected" || status === "agreement_failed";
}

/**
 * Bir teklifin normal kullanıcı listelerinde/sayaçlarında görünüp
 * görünmeyeceğinin TEK ortak doğruluk kaynağı — bugün yalnızca "withdrawn"
 * hariç tutulur. Kayıt SİLİNMEZ (bkz. offers.ts#withdrawOffer): audit amaçlı
 * saklanır, yeniden-teklif-bekleme-süresi hesabında (REOFFER_COOLDOWN_*,
 * createOffer) ve kapasite/kabul geçmişi türetmelerinde (provider-profile.ts
 * #wasEverAccepted) hâlâ okunur — yalnızca "normal" listelerden/sayaçlardan
 * (Verdiğim Teklifler, Gelen Teklifler, panel özetleri) çıkarılır. Filtre
 * mantığı burada TEK yerde tutulur; her ekran kendi `!== "withdrawn"`
 * kontrolünü tekrar yazmaz.
 */
export function isOfferVisibleInNormalLists(offer: Offer): boolean {
  return offer.status !== "withdrawn";
}

/**
 * "Gelen Teklifler" ekranına (incoming-offers-panel.tsx) ÖZEL bir görünürlük
 * filtresi — TEK ortak doğruluk kaynağı, `isOfferVisibleInNormalLists`
 * (yukarıda) BİLEREK AYRI tutulur: o fonksiyon panel-summary.ts/
 * notifications.ts/job-listing-filters.ts/job-listing-row.ts gibi birçok
 * PAYLAŞILAN ekranda kullanılır ve yalnızca "withdrawn"ı eler — bu görev
 * yalnızca Gelen Teklifler'i etkileyeceği için (bkz. görev gereksinimi) o
 * paylaşılan fonksiyona dokunmak yerine yeni, dar kapsamlı bir filtre
 * eklenir.
 *
 * Amaç: bu ekranı yalnızca Hizmet Alan'dan GERÇEKTEN bir karar/aksiyon
 * bekleyen ya da takip edilmesi gereken tekliflerle sınırlı tutmak —
 * "rejected" (zaten reddedilmiş, geri dönüşü olmayan bir karar) ve
 * "agreement_failed" (anlaşma sağlanamadı, iş hiç başlamadı) sonuçlanmış ve
 * bu ekranda artık hiçbir aksiyon/takip gerektirmeyen iki durumdur. Kayıt
 * SİLİNMEZ/değişmez — teklif hâlâ mevcut, `getOfferStatusLabel`/bildirimleri
 * (notifications.ts)/geçmişi/diğer ekranlardaki görünürlüğü (ör. Verdiğim
 * Teklifler > Kapanan Teklifler) BU fonksiyondan tamamen bağımsız, olduğu
 * gibi korunur; yalnızca bu TEK ekranın render listesinden çıkar.
 *
 * "cancelled" (bir tamamlanma anlaşmazlığının iptalle sonuçlanması) BİLEREK
 * bu listede DEĞİL — görev yalnızca "Reddedildi" ve "Anlaşma Sağlanamadı"yı
 * saymıştır; diğer tüm durumlar (pending/accepted/in_progress/tamamlanma
 * süreci/cancelled) bu filtreden etkilenmeden görünmeye devam eder.
 */
export function isOfferShownInIncomingOffersScreen(offer: Offer): boolean {
  return offer.status !== "rejected" && offer.status !== "agreement_failed";
}

/**
 * "Gelen Teklifler" panelinde AYNI ilana (şablona) ait tekliflerin gösterim
 * ÖNCELİK sırası — TEK ortak doğruluk kaynağı, `sortIncomingOffersForDisplay`
 * dışında hiçbir yerde tekrar yazılmaz. Düşük sayı = daha yüksek öncelik
 * (daha üstte).
 *
 * "KABUL EDİLDİ AŞAĞI DÜŞMESİN" DÜZELTMESİ: "accepted" artık "pending"in
 * ÜSTÜNDE (bkz. görev gereksinimi) — eskiden tam tersiydi ("pending" HER
 * ZAMAN "accepted"tan üstteydi, bkz. bu fonksiyonun önceki sürümü). KÖK
 * NEDEN: bir teklif Kabul Et ile "accepted" olduğu anda, aynı ilandaki hâlâ
 * "pending" kalan kardeşleri (varsa) o teklifin ÜSTÜNE geçiyordu — Hizmet
 * Alan'ın az önce kendi kabul ettiği teklif, kendi ekranında aşağı kayıyordu.
 * Artık "accepted" en üst kademede: bir teklif kabul edildiği ANDA aşağı
 * TAŞINMAZ, ilan/şablon içinde üstte ve görünür kalır — "pending" kardeşler
 * (varsa) hâlâ görünmeye devam eder (bkz. isOfferShownInIncomingOffersScreen,
 * yukarıda — yalnızca "rejected"/"agreement_failed" bu ekrandan çıkar), ama
 * artık kabul edilenin ALTINDA sıralanır; aksiyon butonlarının kilitli kalması
 * kuralı (isOfferPendingActionBlocked) bu sıralamadan bağımsız, DEĞİŞMEDİ.
 *
 * Sıra kasıtlı olarak şu iş anlamını izler: teklif hâlâ bir karar/aksiyon/
 * takip bekliyorsa (accepted/pending/in_progress/tamamlanma süreci) en
 * üstte — bu grubun İÇİNDE "accepted" en öncelikli, "pending" hemen
 * ardından, "diğer görünür aktif durumlar" (in_progress/tamamlanma süreci)
 * onların altında; sonuçlanmış ama BAŞARIYLA bittiyse (completed) ondan
 * sonra; sonuçsuz/olumsuz kapananlar (agreement_failed/cancelled) daha da
 * altta; "rejected" HER ZAMAN en alt sırada — Hizmet Alan onu zaten daha en
 * başında reddettiği için tekrar dikkat çekmesine gerek yoktur. "withdrawn"
 * bu fonksiyona pratikte hiç ulaşmaz (bkz. `sortIncomingOffersForDisplay`
 * çağıranı, `isOfferVisibleInNormalLists` ile önceden elenir) — yalnızca
 * `OfferStatus` union'ının tamamını kapsayan bir switch yazabilmek için en
 * düşük önceliğe atanır. AYNI SEBEPLE "rejected"/"agreement_failed" de artık
 * bu fonksiyona pratikte hiç ulaşmaz (bkz. `isOfferShownInIncomingOffersScreen`,
 * yukarıda, `sortIncomingOffersForDisplay` çağıranında ("Gelen Teklifler"
 * ekranı) bunları önceden eler) — kendi ağırlıkları burada, mevcut deseni
 * bozmamak ve `OfferStatus` switch'ini eksiksiz tutmak için SİLİNMEDEN kalır;
 * bu fonksiyonun kendisi genel amaçlı kalır (ör. "cancelled" hâlâ gerçekten
 * ulaşır).
 *
 * "completion_requested" ve "completion_disputed" BİLEREK AYNI ("Tamamlanma
 * Süreci") ağırlığı paylaşır — ikisi de iş fiilen bitmiş ama iki tarafça da
 * henüz kapatılmamış aynı ara aşamayı temsil eder (bkz.
 * IN_PROGRESS_OFFER_STATUSES); aralarında ayrıca bir öncelik farkı YOKTUR,
 * kendi aralarındaki sıra (eşit ağırlıkta) her zamanki gibi recency'den gelir.
 */
function incomingOfferSortWeight(status: OfferStatus): number {
  switch (status) {
    case "accepted":
      return 0;
    case "pending":
      return 1;
    case "in_progress":
      return 2;
    case "completion_requested":
    case "completion_disputed":
      return 3;
    case "completed":
      return 4;
    case "agreement_failed":
    case "cancelled":
      return 5;
    case "rejected":
      return 6;
    case "withdrawn":
      return 7;
  }
}

/**
 * "Gelen Teklifler" panelinin (incoming-offers-panel.tsx) gösterim sırası —
 * TEK ortak doğruluk kaynağı. AYNI ilana (şablona) ait teklifler arasında
 * `incomingOfferSortWeight` (yukarıda) tanımlı yedi kademeli iş-öncelik
 * sırasını uygular (Kabul Edildi -> Beklemede -> İşe Başlandı/Devam Eden ->
 * Tamamlanma Süreci -> Tamamlandı -> Anlaşma Sağlanamadı/İptal -> Reddedildi);
 * AYNI ağırlık kademesindeki teklifler arasında (ör. iki "pending") sıra
 * recency'dir (en yeni ilk, `offer.createdAt`). Bu, salt bir GÖRÜNTÜLEME
 * sıralamasıdır — hiçbir Offer.status'u, bildirim/aksiyon kuralını ya da
 * `getProviderOfferFilter`/`isOfferPendingActionBlocked` gibi iş mantığını
 * DEĞİŞTİRMEZ; yalnızca aynı şablon (jobId) içindeki kartların DİZİLİŞİNİ
 * belirler. Farklı bir ilana (jobId) ait teklifleri BAŞKA bir ilanın
 * tekliflerinin arasına TAŞIMAZ — bkz. aşağıdaki slot-yeniden-yerleştirme
 * algoritması.
 *
 * DETERMİNİSTİK SLOT-YENİDEN-YERLEŞTİRME algoritması kullanılır — bir
 * karşılaştırıcının farklı-ilan çiftleri için `0` döndürüp sıralama
 * motorunun kararlılığına (stability) güvenmesi BİLEREK TERCİH EDİLMEDİ:
 * `jobId` farklıyken `0` dönen bir karşılaştırıcı geçişsiz (non-transitive)
 * bir "eşitlik" tanımlar: A ile B farklı ilandan olduğu için eşit, B ile C
 * de farklı ilandan olduğu için eşit sayılsa bile, A ile C AYNI ilandan
 * olup farklı ağırlıkta olabilir — iki farklı ilanın teklifleri temel
 * dizide iç içe geçtiğinde bu çelişki motor/algoritma-bağımlı,
 * spesifikasyonun GARANTİ ETMEDİĞİ bir sonuca yol açabilir. Bunun yerine:
 *   1. Temel sıra (`byRecency`) yalnızca `createdAt`e göre kurulur.
 *   2. Her `jobId` için, o ilana ait tekliflerin `byRecency` İÇİNDEKİ
 *      SABİT konumları (index'leri) çıkarılır.
 *   3. Yalnızca o konumlardaki teklifler kendi aralarında (yalnızca
 *      `status` ağırlığına göre, tek tip/homojen bir alt grup — burada
 *      farklı-ilan karşılaştırması hiç YOK) yeniden sıralanır.
 *   4. Sonuç, tam olarak aynı konumlara geri yerleştirilir.
 * Böylece farklı bir ilana ait bir teklifin nihai konumu bu fonksiyon
 * tarafından ASLA değiştirilmez (kendi orijinal slotunda kalır) — "farklı
 * ilanların tekliflerini karıştırmama" kuralı motor davranışından bağımsız,
 * yapısal olarak garanti edilir. AYNI ağırlıktaki teklifler (ör. iki
 * "pending" ya da bir "completion_requested" + bir "completion_disputed")
 * arasında karşılaştırıcı `0` döner — bu durumda sıralarını `Array.
 * prototype.sort`ın (ES2019+ itibarıyla garantili) STABİLİTESİ korur; bu
 * subgroup zaten recency sırasında kurulduğu için (bkz. adım 1-2) sonuç
 * yine doğru recency sırasıdır. FARKLI ağırlıktaki bir çift için ise
 * karşılaştırıcı hiçbir zaman `0` dönmez, doğrudan ağırlık farkına göre
 * iyi-tanımlı bir sıra üretir.
 *
 * Teklif durumu geçiş kurallarına (`isOfferPendingActionBlocked`/
 * `isJobClosedToNewOffers`) ya da orijinal `offers` dizisine dokunmaz —
 * çağıranın verdiği diziyi kopyalar, salt görünüm katmanı için YENİ bir
 * dizi döndürür.
 */
export function sortIncomingOffersForDisplay(offers: Offer[]): Offer[] {
  const byRecency = [...offers].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const positionsByJobId = new Map<string, number[]>();
  byRecency.forEach((offer, index) => {
    const positions = positionsByJobId.get(offer.jobId);
    if (positions) positions.push(index);
    else positionsByJobId.set(offer.jobId, [index]);
  });

  const result = [...byRecency];
  for (const positions of positionsByJobId.values()) {
    // Tek teklifli bir ilan zaten "kendi içinde en altta" (tek başına) —
    // yeniden sıralamaya gerek yok, konumu da başka bir ilanla asla
    // paylaşılmıyor.
    if (positions.length < 2) continue;

    // `positions` artan sırada olduğu için (forEach index sırasıyla
    // dolduruldu) bu alt dizi zaten kendi içinde recency sırasındadır —
    // aşağıdaki sıralama SADECE status ağırlığına bakar, eşitlik
    // durumunda (aynı ağırlık) `Array.prototype.sort`'un stabilitesi bu
    // mevcut recency sırasını korur. Burada FARKLI bir ilana ait hiçbir
    // teklif yok — karşılaştırıcı iki farklı statüsün aynı ağırlığa denk
    // geldiği durumlar dışında hiçbir zaman `0` dönmez, dolayısıyla
    // motor/algoritma davranışına bağlı bir belirsizlik oluşmaz.
    const subgroup = positions.map((index) => byRecency[index]);
    const reordered = [...subgroup].sort(
      (a, b) => incomingOfferSortWeight(a.status) - incomingOfferSortWeight(b.status),
    );
    positions.forEach((index, i) => {
      result[index] = reordered[i];
    });
  }

  return result;
}

/** "completion_requested" durumundaki bir teklifin, Hizmet Alan hiç işlem yapmazsa kaç gün sonra otomatik "completed" olacağı. */
export const COMPLETION_AUTO_APPROVE_DAYS = 7;

/**
 * Bir ilana kilitli (bkz. ENGAGED_OFFER_STATUSES) bir teklif olup olmadığını
 * söyler. Job.status'ta bunun karşılığı yok (bkz. types.ts: JobStatus
 * yalnızca "yayinda" | "tamamlandi" | "iptal") — kabul/iş başlama kararı
 * yalnızca Offer kayıtlarında tutuluyor. TEK KULLANIM YERİ artık
 * offers.ts#deleteJobWithOffers'ın "aktif/tamamlanmış bir işi olan ilan
 * silinemez" korumasıdır. Kasıtlı olarak YENİ teklif verilebilirliği
 * belirlemek için KULLANILMAZ — bir ilana teklif kabul edilmiş olması artık
 * o ilanı diğer Hizmet Verenlere kapatmıyor (bkz. getJobOfferAvailability,
 * offers.ts#createOffer); aynı anda yalnızca TEK bir teklifin anlaşma
 * sürecinin ilerleyebilmesi kuralı artık yalnızca isOfferPendingActionBlocked
 * ile (Kabul Et/Reddet aksiyonları üzerinde) uygulanır.
 */
export function jobHasAcceptedOffer(jobId: string, offers: Offer[]): boolean {
  return offers.some(
    (offer) => offer.jobId === jobId && ENGAGED_OFFER_STATUSES.includes(offer.status),
  );
}

/**
 * Bir ilana kilitli (bkz. ENGAGED_OFFER_STATUSES) tekli teklifi döndürür —
 * `jobHasAcceptedOffer`'ın boolean değil, asıl kaydı döndüren hâli. Bir
 * ilanın aynı anda en fazla bir "meşgul" teklifi olabilir (createOffer bunu
 * zorunlu kılar), bu yüzden `.find()` güvenlidir. Hizmet Alan'ın kendi
 * ilanları listesinde (job-requests-panel.tsx), ilgili teklifin tam
 * durumuna (ör. "completion_requested") göre aksiyon kutusu göstermek için
 * kullanılır — aynı filtreleme mantığı tekrar yazılmaz.
 */
export function getEngagedOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return offers.find((offer) => offer.jobId === jobId && ENGAGED_OFFER_STATUSES.includes(offer.status)) ?? null;
}

/**
 * Bir ilanın açık adresini (Job.addressText) oturumdaki kullanıcının görüp
 * göremeyeceği — contact-access.ts#getRevealedContactForOffer ile AYNI
 * zamanlamayı (ENGAGED_OFFER_STATUSES) kullanır ama AYRI bir kapıdır (o
 * dosya yalnızca telefon/e-posta içindir, bkz. CLAUDE.md). İki İSTİSNA:
 *  - İlan sahibi (session.id === job.requesterId) HER ZAMAN görür, teklif
 *    durumundan bağımsız.
 *  - Diğer tüm kullanıcılar (Hizmet Veren dahil) yalnızca BU ilana verdiği
 *    kendi teklifi "meşgul" durumundaysa görür.
 */
export function canViewJobAddress(session: Session | null, job: Job, offers: Offer[]): boolean {
  if (!session) return false;
  if (session.id === job.requesterId) return true;
  return offers.some(
    (offer) =>
      offer.jobId === job.id &&
      offer.providerId === session.id &&
      ENGAGED_OFFER_STATUSES.includes(offer.status),
  );
}

/**
 * Firma kimliği görünürlüğü — bir Hizmet Veren'in kurumsal kimliğinin (logo/
 * firma adı/ortalama puan/değerlendirme sayısı/tamamlanan iş sayısı/
 * uzmanlık alanları/tanıtım yazısı/bölge — bkz. incoming-offer-card.tsx)
 * "Gelen Teklifler" ekranında ilan sahibine gösterilip gösterilmeyeceği.
 * AMAÇ: platform dışına çıkışı engellemek ve teklif değerlendirmesinin
 * "beklemede" aşamasında tamamen fiyat/süre/açıklama üzerinden yapılmasını
 * sağlamak — kimlik, taraflar fiilen eşleşmeden (teklif kabul edilip iş
 * süreci başlamadan) önce hiçbir biçimde açılmaz.
 *
 * contact-access.ts#getRevealedContactForOffer ile BİREBİR AYNI zamanlamayı
 * (ENGAGED_OFFER_STATUSES) kullanır — kimlik ve iletişim bilgisi her zaman
 * birlikte açılır/kapanır, tek bir "eşleşme" kavramının iki farklı alan
 * kümesi üzerindeki yansımasıdır. Yine de o dosyaya taşınmaz (o dosya
 * yalnızca ham telefon/e-posta içindir, bkz. CLAUDE.md) — canViewJobAddress
 * ile aynı "paralel kapı" deseni. "pending"/"rejected"/"agreement_failed"/
 * "cancelled" (ve Gelen Teklifler'de zaten hiç görünmeyen "withdrawn"/
 * "completed") için bilerek false döner: bir teklif reddedilse/anlaşma
 * sağlanamasa/iptalle sonuçlansa bile kimlik bir daha asla (geriye dönük
 * olarak da) açılmaz.
 */
export function isOfferProviderIdentityRevealed(offer: Offer): boolean {
  return ENGAGED_OFFER_STATUSES.includes(offer.status);
}

/**
 * Bir ilanın tamamlanmış (bkz. COMPLETED_OFFER_STATUSES) tekli teklifini
 * döndürür — `getEngagedOfferForJob`'ın "completed" karşılığı. Puanlama
 * ekranının (Hizmet Taleplerim > Tamamlanan) ilgili teklifi bulması için
 * kullanılır.
 */
export function getCompletedOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return (
    offers.find((offer) => offer.jobId === jobId && COMPLETED_OFFER_STATUSES.includes(offer.status)) ?? null
  );
}

/**
 * Bir ilana ait, taraflar arasında anlaşma süreci ilerlemiş (hâlâ meşgul —
 * bkz. getEngagedOfferForJob — YA DA başarıyla tamamlanmış — bkz.
 * getCompletedOfferForJob) tekli teklifi döndürür. Yeni bir durum listesi
 * icat etmez, yalnızca bu iki mevcut merkezi yardımcının birleşimidir.
 * "agreement_failed"/"cancelled"/"rejected"/"withdrawn"/"pending" BİLEREK
 * dışarıda — bunlar "bu teklifle iş yürümüyor" anlamına gelir ve ilanı
 * diğer bekleyen tekliflere yeniden açar (bkz. isOfferPendingActionBlocked).
 */
export function getSettledOfferForJob(jobId: string, offers: Offer[]): Offer | null {
  return getEngagedOfferForJob(jobId, offers) ?? getCompletedOfferForJob(jobId, offers);
}

/**
 * KRİTİK MİMARİ AYRIM (bkz. offers.ts#canProviderSubmitNewOffer/createOffer
 * dokümantasyonu — "Teklif Kabulü ve İşe Başlama Kilit Kuralı" düzeltmesi):
 * bir ilanın YENİ (başka bir Hizmet Veren'den) teklif alıp alamayacağının TEK
 * ortak doğruluk kaynağı. `getSettledOfferForJob`'ı (üstteki) tekrar yazmaz,
 * üzerine TEK bir ek koşulla inşa eder: settled teklif yalnızca "accepted"
 * ise (kabul edildi ama işe HENÜZ başlanmadı — ön anlaşma/görüşme aşaması)
 * BİLEREK false döner — "accepted" durumu, tek başına, ilanı yeni tekliflere
 * KAPATMAZ; ilan yalnızca settled teklif "accepted"ın ÖTESİNE geçtiğinde
 * (in_progress/completion_requested/completion_disputed/completed) kesin
 * olarak kapanır. Bu, `isOfferClosedByJobProgress`'in (aşağıda, "pending"
 * kardeş tekliflerin ne zaman "Başka hizmet verenle anlaşıldı" olarak
 * kapandığını belirleyen fonksiyon) kullandığı AYNI eşiktir — iki fonksiyon
 * kasıtlı olarak aynı "iş fiilen başladı mı" sınırını paylaşır, sadece biri
 * (bu fonksiyon) YENİ teklif verilebilirliğine, diğeri MEVCUT bekleyen bir
 * teklifin artık anlamlı olup olmadığına bakar.
 */
export function isJobClosedToNewOffers(jobId: string, offers: Offer[]): boolean {
  const settled = getSettledOfferForJob(jobId, offers);
  return settled !== null && settled.status !== "accepted";
}

/** incoming-offer-card.tsx (buton yerine gösterilir) ve offers.ts#updateOfferStatus (veri katmanı hata mesajı) AYNI metni paylaşır. */
export const OFFER_PENDING_BLOCKED_MESSAGE = "Bu ilan için başka bir teklifin anlaşma süreci devam ediyor.";

/**
 * Bir "pending" teklifin Kabul Et/Reddet eylemlerinin, AYNI ilana ait BAŞKA
 * bir teklifin anlaşma süreci ilerlediği için geçici (teklif "completed"
 * ise kalıcı) olarak askıya alınıp alınmadığını söyler — TEK ortak doğruluk
 * kaynağı. Hem incoming-offer-card.tsx (buton görünürlüğü) hem
 * offers.ts#updateOfferStatus (veri katmanında zorunlu kılma) bu fonksiyonu
 * çağırır; aynı kural iki yerde ayrı ayrı yazılmaz. Bir teklif yalnızca
 * BAŞKA bir teklif yüzünden engellenebilir — kendi durumu asla kendini
 * engellemez (bu yüzden `settled.id !== offer.id` kontrolü var).
 */
export function isOfferPendingActionBlocked(offer: Offer, offers: Offer[]): boolean {
  const settled = getSettledOfferForJob(offer.jobId, offers);
  return settled !== null && settled.id !== offer.id;
}

/**
 * "Kabul edildi" (karar bekleniyor), "devam eden" (iş fiilen başladı,
 * tamamlandı onayı bekliyor ya da itiraz edilmiş) ve "tamamlandı" ayrı
 * Job.status değerleri değil — ilgili Offer'ın durumuna göre ayrışır
 * (bkz. IN_PROGRESS_OFFER_STATUSES / COMPLETED_OFFER_STATUSES, tek ortak
 * doğruluk kaynağı). Var olmayan bir alan icat edilmiyor; yalnızca mevcut
 * Job.status ve Offer.status birleştirilerek türetiliyor. "iptal"
 * durumundaki ilanlar hiçbir filtreye girmez (null döner). "tamamlandi"
 * kontrolü hem Job.status hem Offer.status üzerinden yapılır: bugünkü
 * akışta yalnızca ikincisi gerçekleşir (Job.status hiçbir teklif
 * geçişinde değişmez, bkz. types.ts), ama Job.status'un ileride bir gün
 * gerçekten "tamamlandi" olabileceği ihtimaline karşı ilk kontrol de
 * korunur.
 */
export function getJobRequestFilter(job: Job, offers: Offer[]): JobRequestFilter | null {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status !== "yayinda") return null;

  const jobOffers = offers.filter((offer) => offer.jobId === job.id);
  if (jobOffers.some((offer) => COMPLETED_OFFER_STATUSES.includes(offer.status))) return "tamamlandi";
  if (jobOffers.some((offer) => IN_PROGRESS_OFFER_STATUSES.includes(offer.status))) return "devam-eden";
  if (jobOffers.some((offer) => offer.status === "accepted")) return "kabul-edildi";
  return "aktif";
}

export type JobOfferAvailability = "acik" | "kapali" | "tamamlandi" | "iptal";

/**
 * İlan listelerinde/detayında Hizmet Veren'e gösterilen "teklife açık mı"
 * durumu. `getJobStatusLabel`/`getJobStatusTone` (jobs.ts) genel ilan
 * yaşam döngüsünü anlatır ve başka yerlerde de kullanıldığı için
 * değiştirilmedi; bu, yalnızca "yeni teklif verilebilir mi" sorusuna
 * odaklanan ayrı (ama tutarlı) bir etiketleme katmanıdır.
 *
 * "Teklif Kabulü ve İşe Başlama Kilit Kuralı" DÜZELTMESİ: bu fonksiyon
 * eskiden `offers` parametresini hiç kullanmadan her zaman "acik" (ya da
 * job.status'a göre tamamlandi/iptal) döndürüyordu — kabul edilmiş
 * (accepted) BİR teklif kasıtlı olarak "kapali" üretmiyordu, ki bu hâlâ
 * DOĞRU (bkz. KRİTİK MİMARİ AYRIM: accepted = ön anlaşma/görüşme aşaması,
 * ilan hâlâ teklife açık, bkz. isJobClosedToNewOffers). AMA aynı kural
 * yanlışlıkla in_progress/tamamlama süreçleri/completed durumları için de
 * uygulanıyordu — "iş fiilen başladıktan sonra da ilan asla kapanmıyor"
 * anlamına geliyordu, ki bu YANLIŞTIR (bkz. offers.ts#canProviderSubmitNewOffer/
 * createOffer'daki AYNI düzeltme). Artık `isJobClosedToNewOffers`'a (üstte)
 * devrediyor: iş fiilen başladığında (in_progress) ya da ötesinde
 * (tamamlama süreçleri/completed) "kapali" döner. "kapali" değeri
 * `getJobAvailabilityForProvider`'ın (aşağıda) zaten var olan
 * "is-devam-ediyor" dalını da bu değişiklikle CANLANDIRIR — o kod hiç
 * değiştirilmedi, yalnızca artık gerçekten tetiklenebiliyor.
 */
export function getJobOfferAvailability(job: Job, offers: Offer[]): JobOfferAvailability {
  if (job.status === "tamamlandi") return "tamamlandi";
  if (job.status === "iptal") return "iptal";
  return isJobClosedToNewOffers(job.id, offers) ? "kapali" : "acik";
}

export function getJobOfferAvailabilityLabel(availability: JobOfferAvailability): string {
  switch (availability) {
    case "acik":
      return "Teklife Açık";
    case "kapali":
      return "Teklife Kapalı";
    case "tamamlandi":
      return "Tamamlandı";
    case "iptal":
      return "İptal Edildi";
  }
}

export function getJobOfferAvailabilityTone(
  availability: JobOfferAvailability,
): "success" | "neutral" | "danger" {
  switch (availability) {
    case "acik":
      return "success";
    case "kapali":
      return "neutral";
    case "tamamlandi":
      return "neutral";
    case "iptal":
      return "danger";
  }
}

/**
 * KULLANILMIYOR (hiçbir çağıranı yok) — yalnızca `job.status`a bakar,
 * offer-seviyesi kapanmayı (bkz. `isJobClosedToNewOffers`, gerçek teklif
 * verilebilirlik kontrolünün artık TEK doğruluk kaynağı —
 * offers.ts#canProviderSubmitNewOffer/createOffer) YANSITMAZ. `offers`
 * parametresi imza uyumluluğu için korunur, gövdede kullanılmaz.
 */
export function isJobAcceptingNewOffers(job: Job, offers: Offer[]): boolean {
  return isJobOpenForOffers(job.status);
}

export type ProviderClosedReason = "gorusme-bekleniyor" | "is-devam-ediyor" | "tekrar-teklif-veremez";

/**
 * "Teklife Açık"/"Teklife Kapalı" ayrımının Hizmet Veren'in oturumuna özel
 * hali (İş İlanları ekranındaki iki bölümlü listeleme için). Aynı ilan,
 * anlaşma sağlanamamış bir firma için "kapalı", daha önce hiç teklif
 * vermemiş başka bir firma için "açık" olabilir — bu yüzden yalnızca
 * `getJobOfferAvailability` (ilan-geneli) yetmez; burada üzerine tek bir ek
 * kural (bu sağlayıcının kendi "agreement_failed" geçmişi) eklenir. Genel
 * durum zaten "kapalı" ise (kabul edilmiş/iş başlamış), bunun nedeni de
 * herkes için aynıdır ve döndürülür. Bu fonksiyon `getJobOfferAvailability`
 * ve `jobHasAcceptedOffer`'ı tekrar yazmaz, üzerine inşa eder.
 */
export function getJobAvailabilityForProvider(
  job: Job,
  offers: Offer[],
  providerId: string,
): { open: boolean; closedReason: ProviderClosedReason | null } {
  const generalAvailability = getJobOfferAvailability(job, offers);

  if (generalAvailability === "kapali") {
    const jobOffers = offers.filter((offer) => offer.jobId === job.id);
    if (jobOffers.some((offer) => offer.status === "in_progress")) {
      return { open: false, closedReason: "is-devam-ediyor" };
    }
    if (jobOffers.some((offer) => offer.status === "accepted")) {
      return { open: false, closedReason: "gorusme-bekleniyor" };
    }
    // Güvenli türetilemeyen bir "kapalı" durumu (teorik olarak ulaşılmaz,
    // ama tip güvenliği ve "yanlış/uydurma durum yazma" kuralı için).
    return { open: false, closedReason: null };
  }

  if (generalAvailability === "acik") {
    const hasFailedAgreementAsThisProvider = offers.some(
      (offer) =>
        offer.jobId === job.id && offer.providerId === providerId && offer.status === "agreement_failed",
    );
    if (hasFailedAgreementAsThisProvider) {
      return { open: false, closedReason: "tekrar-teklif-veremez" };
    }
    return { open: true, closedReason: null };
  }

  // "tamamlandi" | "iptal": bu fonksiyon yalnızca aktif ilan ekranı için
  // kullanılmalı — çağıran taraf zaten status === "yayinda" filtresi
  // uygulamış olmalı (bkz. job-listing-screen.tsx). Buraya düşerse güvenli
  // bir varsayılan döner.
  return { open: false, closedReason: null };
}

export function getProviderClosedReasonLabel(reason: ProviderClosedReason): string {
  switch (reason) {
    case "gorusme-bekleniyor":
      return "Görüşme Sonucu Bekleniyor";
    case "is-devam-ediyor":
      return "İş Devam Ediyor";
    case "tekrar-teklif-veremez":
      return "Bu ilana yeniden teklif veremezsiniz";
  }
}

export function getJobRequestFilterLabel(filter: JobRequestFilter): string {
  switch (filter) {
    case "aktif":
      return "Aktif";
    case "kabul-edildi":
      return "Teklif Kabul Edildi";
    case "devam-eden":
      return "Devam Ediyor";
    case "tamamlandi":
      return "Tamamlandı";
  }
}

export function getJobRequestFilterTone(
  filter: JobRequestFilter,
): "success" | "warning" | "neutral" {
  switch (filter) {
    case "aktif":
      return "success";
    case "kabul-edildi":
    case "devam-eden":
      return "warning";
    case "tamamlandi":
      return "neutral";
  }
}

/**
 * "Hizmet Taleplerim > Devam Eden" sekmesinde, Hizmet Veren'in tamamlandı
 * bildirdiği ve Hizmet Alan'ın onayını/itirazını beklediği işleri (bkz.
 * offer-outcome-panel.tsx'in "Tamamlandı Onayı Bekleniyor" bloğu) diğer
 * devam eden işlerden ayırt eden TEK ortak doğruluk kaynağı —
 * job-requests-panel.tsx dışında tekrar yazılmaz. Yeni bir durum icat
 * etmez, yalnızca mevcut "completion_requested" (bkz.
 * IN_PROGRESS_OFFER_STATUSES) durumunu adlandırır. `engagedOffer`
 * parametresi `null` olabilir (ör. `getEngagedOfferForJob` bir sonuç
 * bulamadığında) — bu durumda güvenle `false` döner.
 */
export function isOfferAwaitingCompletionConfirmation(engagedOffer: Offer | null): boolean {
  return engagedOffer?.status === "completion_requested";
}

/**
 * Çoklu Hizmet Operasyonu — Aşama 4: "Operasyon Durumu" özet kartının (bkz.
 * operation-status-card.tsx) TEK ortak durum-türetme yardımcısı. YENİ bir
 * durum sistemi İCAT ETMEZ — `getJobRequestFilter`in 4 değerine (yukarıda),
 * o fonksiyonun `null` döndüğü TEK durumu ("iptal" — bkz. getJobRequestFilter
 * içindeki `if (job.status !== "yayinda") return null` dalı, ki bu yalnızca
 * job.status "iptal" olduğunda tetiklenir çünkü "tamamlandi" zaten yukarıda
 * ayrıca ele alınır) için `"iptal"` fallback bucket'ı ekler.
 */
export type OperationStatusBucket = JobRequestFilter | "iptal";

/** Özet kartındaki sabit gösterim sırası (Toplam Hizmet HARİÇ — o ayrıca gösterilir). */
export const OPERATION_STATUS_BUCKET_ORDER: OperationStatusBucket[] = [
  "aktif",
  "kabul-edildi",
  "devam-eden",
  "tamamlandi",
  "iptal",
];

/** Tek bir ilanın Operasyon Durumu bucket'ını döndürür — `getJobRequestFilter`i tekrar yazmaz, üzerine `"iptal"` fallback'i ekler. */
export function getOperationStatusBucket(job: Job, offers: Offer[]): OperationStatusBucket {
  return getJobRequestFilter(job, offers) ?? "iptal";
}

/**
 * `getOperationStatusBucket` sonucunun görünen etiketi. Aşama 5.2 KRİTİK ANA
 * ROZET DÜZELTMESİ: eskiden `getJobRequestFilterLabel`e devrediliyordu — ama
 * o fonksiyon Hizmet Alan'ın "Hizmet Taleplerim" sekmelerine ait metin
 * döndürür ("Aktif", "Teklif Kabul Edildi"). Bu fonksiyon artık kendi, kimin
 * teklifi olduğunu ima etmeyen sözlüğünü kullanır: "Teklife Açık" (aktif),
 * "Hizmet Veren Seçildi" (kabul-edildi — kimin seçildiğini SÖYLEMEZ, yalnızca
 * birinin seçildiğini), "Devam Ediyor", "Tamamlandı", "İptal Edildi".
 *
 * BUGÜNKÜ TEK KULLANIM YERİ: operation-status-card.tsx'in aggregate özet
 * kutucukları (Toplam Hizmet/Teklife Açık/Devam Ediyor/.../İlerleme %) —
 * hizmet listesindeki HER SATIRIN kendi durumu ("Operasyon içindeki hizmet
 * kartlarının sadeleştirilmesi" görevi) artık bunun yerine
 * `offers.ts#getOperationServiceCardStatus`i kullanır (izleyiciye özel "Teklif
 * Ver"/"Teklif Bekliyor"/"Teklif Kabul Edildi" vb. TEK durum alanı için) —
 * bkz. o fonksiyonun dokümantasyonu.
 */
export function getOperationStatusBucketLabel(bucket: OperationStatusBucket): string {
  switch (bucket) {
    case "aktif":
      return "Teklife Açık";
    case "kabul-edildi":
      return "Hizmet Veren Seçildi";
    case "devam-eden":
      return "Devam Ediyor";
    case "tamamlandi":
      return "Tamamlandı";
    case "iptal":
      return "İptal Edildi";
  }
}

export type OperationStatusSummary = {
  total: number;
  counts: Record<OperationStatusBucket, number>;
  completedCount: number;
  /** Tam sayı, 0-100 arasına sınırlandırılmış (bkz. fonksiyon gövdesi). */
  progressPercent: number;
};

/**
 * `getOperationStatusSummary` (gerçek/job-geneli bucket'larla) VE
 * `getPublicOperationStatusSummary`nin (aşağıda — operasyon kartlarının ANA
 * rozeti için birleştirilmiş bucket'larla, bkz. getPublicOperationStatusBucket)
 * PAYLAŞTIĞI TEK toplama mantığı — ikisi de aynı toplam/tamamlanan/ilerleme
 * hesabını (bkz. gövde) tekrar yazmasın diye buraya çıkarıldı. `getBucket`
 * her ilan için hangi bucket'a sayılacağını belirler.
 */
export function accumulateOperationStatusCounts(
  jobs: Job[],
  getBucket: (job: Job) => OperationStatusBucket,
): OperationStatusSummary {
  const counts: Record<OperationStatusBucket, number> = {
    aktif: 0,
    "kabul-edildi": 0,
    "devam-eden": 0,
    tamamlandi: 0,
    iptal: 0,
  };
  for (const job of jobs) {
    counts[getBucket(job)] += 1;
  }

  const total = jobs.length;
  const completedCount = counts.tamamlandi;
  const progressPercent =
    total === 0 ? 0 : Math.min(100, Math.max(0, Math.round((completedCount / total) * 100)));

  return { total, counts, completedCount, progressPercent };
}

/**
 * Bir operasyona (aynı `operationId`yi paylaşan ilanlar) ait, YALNIZCA
 * GÖRSEL bir özet üretir — hiçbir Job/Offer kaydını değiştirmez, hiçbir yeni
 * kalıcı alan okumaz/yazmaz; girdi olarak zaten canlı store'lardan okunan
 * `jobs`/`offers` dizilerini alır. İlerleme yüzdesi YALNIZCA tamamlanan ilan
 * sayısına göre hesaplanır (görev gereksinimi): `completedCount / total *
 * 100`, tam sayıya yuvarlanır, 0-100 arasına sınırlandırılır; `total === 0`
 * ise güvenli şekilde 0 döner (pratikte bu fonksiyon en az 2 elemanlı bir
 * operasyon için çağrılır, ama sıfır ilanlı çağrıda da çökmez).
 *
 * Bu, ilanın GERÇEK (job-geneli, "kabul-edildi"yi ayrı sayan) bucket'larını
 * kullanır — `offers.ts#getOperationServiceCardStatus`'un ilan sahibi koluna
 * (kabul edilmiş ama işe başlanmamış bir hizmeti fark etmesi için) ve
 * `job-listing-row.ts#buildOperationListingItem`e (yalnızca total/completedCount
 * okur, kabul-edildi sayısını hiç kullanmaz) hizmet eder. Operasyon
 * kartlarının (operation-status-card.tsx) ANA rozeti/özet kutucukları için
 * bunun yerine `getPublicOperationStatusSummary` (aşağıda) kullanılmalıdır —
 * bkz. o fonksiyonun dokümantasyonu.
 */
export function getOperationStatusSummary(jobs: Job[], offers: Offer[]): OperationStatusSummary {
  return accumulateOperationStatusCounts(jobs, (job) => getOperationStatusBucket(job, offers));
}

/**
 * `getOperationStatusBucket`'ın, operasyon kartlarının aggregate özet
 * kutucukları (operation-status-card.tsx, `getPublicOperationStatusSummary`
 * üzerinden) için BİRLEŞTİRİLMİŞ hâli — "Teklif Kabulü ve İşe Başlama Kilit
 * Kuralı" düzeltmesi. `getOperationStatusBucket`'ın KENDİSİ değiştirilmez
 * (`offers.ts#getOperationServiceCardStatus`'un ilan sahibi koluna hâlâ
 * ORİJİNAL, birleştirilmemiş bucket'ı sağlar — sahibin "İşe Başlama Onayı
 * Bekleniyor" ikincil bilgisini görebilmesi için, bkz. o fonksiyonun
 * dokümantasyonu).
 *
 * KÖK NEDEN: "accepted" (kabul edildi ama işe HENÜZ başlanmadı — ön anlaşma/
 * görüşme aşaması) TEK BAŞINA ilanı yeni tekliflere kapatmaz (bkz.
 * isJobClosedToNewOffers, yukarıda) — ilan hâlâ GERÇEKTEN teklife açıktır.
 * Ama Aşama 5.2, `getOperationStatusBucket`'ın "kabul-edildi" bucket'ını
 * DOĞRUDAN ANA rozet için kullanıyordu; bu da GERÇEKTE hâlâ açık olan bir
 * ilanın ana rozetinde "Hizmet Veren Seçildi" (kapanmış izlenimi veren)
 * göstermesine yol açıyordu — kimin teklifi kabul edildiğini gizlemek
 * yerine, ilanın hâlâ açık olduğu gerçeğini gizleyen YENİ bir hataydı. Bu
 * fonksiyon "kabul-edildi"yi "aktif"e katlayarak düzeltir; kalan dört
 * bucket (aktif/devam-eden/tamamlandi/iptal) `isJobClosedToNewOffers`'ın
 * kapanma eşiğiyle BİREBİR örtüşür — kartta "Devam Ediyor"/"Teklife Kapalı"
 * görünüyorsa, o ilana artık gerçekten yeni teklif verilemez.
 */
export function getPublicOperationStatusBucket(job: Job, offers: Offer[]): OperationStatusBucket {
  const bucket = getOperationStatusBucket(job, offers);
  return bucket === "kabul-edildi" ? "aktif" : bucket;
}

/** `getPublicOperationStatusBucket`'ın ürettiği sabit gösterim sırası — "kabul-edildi" ASLA dönmediği için `OPERATION_STATUS_BUCKET_ORDER`den farklı olarak burada yer almaz (kalıcı olarak 0 kalacak, yanıltıcı bir kutucuk olurdu). */
export const PUBLIC_OPERATION_STATUS_BUCKET_ORDER: OperationStatusBucket[] = [
  "aktif",
  "devam-eden",
  "tamamlandi",
  "iptal",
];

/** `getOperationStatusSummary`'nin operasyon kartlarının ANA rozeti/özet kutucukları için birleştirilmiş (`getPublicOperationStatusBucket`) hâli. */
export function getPublicOperationStatusSummary(jobs: Job[], offers: Offer[]): OperationStatusSummary {
  return accumulateOperationStatusCounts(jobs, (job) => getPublicOperationStatusBucket(job, offers));
}

export type ProviderOfferFilter = "aktif" | "devam-eden" | "tamamlandi" | "kapanan-teklifler";

/**
 * Bir "pending" kardeş teklifin (aynı ilana verilmiş, kabul edilmemiş başka
 * bir teklif), ilanın kabul edilmiş teklifi fiilen İŞE BAŞLADIĞI için artık
 * anlamsız kaldığını söyler — TEK ortak doğruluk kaynağı, yeni bir
 * Offer.status İCAT ETMEZ. getSettledOfferForJob'ı (üstteki, tek doğruluk
 * kaynağı) tekrar yazmaz, üzerine tek bir ek koşulla inşa eder: settled
 * teklif hâlâ yalnızca "accepted" ise (kabul edildi ama işe henüz
 * başlanmadı) bu BİLEREK false döner — kardeş teklif "aktif" kalmaya devam
 * eder, tıpkı işe başlamadan önceki mevcut davranışta olduğu gibi. Settled
 * teklif "in_progress"/"completion_requested"/"completion_disputed"/
 * "completed" olduğunda true döner. Settled teklif sonradan "cancelled"
 * sonucuyla biterse (bkz. offers.ts#resolveCompletionDispute)
 * getSettledOfferForJob onu artık döndürmez, bu da kardeş teklifi otomatik
 * olarak yeniden "aktif"e döndürür — isOfferPendingActionBlocked'daki aynı
 * yeniden-açılma deseniyle (Hizmet Alan tarafında Kabul Et/Reddet
 * butonlarının yeniden görünmesiyle) tutarlıdır.
 */
function isOfferClosedByJobProgress(offer: Offer, offers: Offer[]): boolean {
  const settled = getSettledOfferForJob(offer.jobId, offers);
  return settled !== null && settled.id !== offer.id && settled.status !== "accepted";
}

/**
 * Hizmet Veren'in "Verdiğim Teklifler" sayfasındaki sekme filtrelemesinin tek
 * ortak doğruluk kaynağı — yukarıdaki `getJobRequestFilter`in Job-seviyesi
 * (birden fazla teklifi birleştiren) muadili değil, TEK bir teklifin kendi
 * durumuna bakan Offer-seviyesi hali. IN_PROGRESS_OFFER_STATUSES/
 * COMPLETED_OFFER_STATUSES'ı (yukarıda tanımlı, tek doğruluk kaynağı)
 * doğrudan kullanır, yeni bir status kümesi icat etmez. İkinci parametre
 * (`offers`, ilana ait TÜM teklifler — yalnızca çağıranın kendi teklifleri
 * değil) `isOfferClosedByJobProgress` için gereklidir; tek bir Offer'ın
 * kendi durumuna bakmak yetmez, kardeş tekliflerin durumuna da bakılmalıdır.
 *
 * "accepted" (kabul edildi ama iş henüz başlamadı) burada `getJobRequestFilter`
 * ile aynı şekilde kendi başına bir sekme değildir — ayrı bir "Kabul Edilen"
 * sekmesi kaldırıldığı için "aktif"e düşer (bkz. my-offers-panel.tsx).
 * "rejected" (henüz kesin bir sonuca varmamış/kabul dışında sonuçlanmış her
 * şeyin toplandığı "aktif" sekmesinde kalır) DIŞINDA, kalıcı/olumsuz
 * sonuçlanan ÜÇ durum "kapanan-teklifler"e düşer: "agreement_failed" (kendi
 * kabulü sonradan bozulmuş), "cancelled" (kabul edilip iş başlamış, itiraz
 * edilmiş ve Hizmet Alan'ın "İptal Olarak Sonuçlandır" kararıyla kapanmış —
 * bkz. offers.ts#resolveCompletionDispute) ve "pending" bir kardeş teklif
 * (aynı ilandaki başka bir teklif fiilen işe başladıysa, bkz.
 * isOfferClosedByJobProgress — henüz kabul aşamasında ya da hiç kabul
 * yokken "aktif" kalır). Üçünde de kullanıcının üzerinde yapabileceği
 * hiçbir işlem kalmamıştır (bkz. my-offers-panel.tsx — bu durumlarda zaten
 * hiçbir aksiyon butonu render edilmez). Bu üç "kapanan-teklifler" durumu
 * ayrı gösterilir — my-offers-panel.tsx yalnızca "pending" olanı "Başka Bir
 * Hizmet Verenle Anlaşıldı" ile geçersiz kılar; "agreement_failed" ve
 * "cancelled" kendi getOfferStatusLabel'ını ("Anlaşma Sağlanamadı"/"İptal
 * Edildi") korur, "cancelled" ayrıca kartta "İtiraz sonrası iş iptal
 * edildi." bilgi satırını gösterir. "withdrawn" ise (bkz.
 * isOfferVisibleInNormalLists) `null` döner — `getJobRequestFilter`in
 * "iptal" ilan için null dönmesiyle aynı desen: hiçbir sekmede görünmesin
 * diye BİLEREK herhangi bir TabKey ile eşleşmez (my-offers-panel.tsx'teki
 * `=== activeTab` karşılaştırması bu yüzden ek bir filtre satırına gerek
 * duymadan withdrawn'ı otomatik eler).
 *
 * DÖRDÜNCÜ (İlan Kapatma) durum: offers.ts#closeJobListing, bir ilan manuel
 * olarak kapatıldığında hâlâ "pending" olan teklifleri de (deleteJobWithOffers
 * ile AYNI mekanik) "rejected"e çevirir — ama bu "rejected" bir gerçek
 * reddetme DEĞİLDİR, bu yüzden yalnızca job-closure.ts#isJobManuallyClosed
 * ile işaretli bir ilana ait "rejected" bir teklif de "kapanan-teklifler"e
 * düşer (tıpkı jobRemovedNotifications'ın "rejected"i "job yok" koşuluyla
 * ayrıştırması gibi, AYNI desen). `job` parametresi isteğe bağlıdır — yalnızca
 * bu üçüncü koşulu değerlendirmek için gerekir, geçirilmezse (eski çağıranlar)
 * davranış aynen korunur (yalnızca bu YENİ dal hiç tetiklenmez).
 */
export function getProviderOfferFilter(
  offer: Offer,
  offers: Offer[],
  job?: Job | null,
): ProviderOfferFilter | null {
  if (!isOfferVisibleInNormalLists(offer)) return null;
  if (IN_PROGRESS_OFFER_STATUSES.includes(offer.status)) return "devam-eden";
  if (COMPLETED_OFFER_STATUSES.includes(offer.status)) return "tamamlandi";
  if (offer.status === "agreement_failed" || offer.status === "cancelled") return "kapanan-teklifler";
  if (offer.status === "pending" && isOfferClosedByJobProgress(offer, offers)) return "kapanan-teklifler";
  if (offer.status === "rejected" && job && isJobManuallyClosed(job)) return "kapanan-teklifler";
  return "aktif";
}

/**
 * Bir `ProviderOfferFilter` sekmesinin "Verdiğim Teklifler" route'unu
 * üretir — sekme bağlantıları (my-offers-panel.tsx#tabHref) ve bildirim
 * hedefleri (notifications.ts) bu TEK fonksiyonu paylaşır, route string'ini
 * iki ayrı yerde elle tekrar yazmazlar. "aktif" query param'sız temel
 * route'tur (bkz. my-offers-panel.tsx: bilinmeyen/eksik `durum` değeri de
 * güvenli varsayılan olarak buraya düşer).
 */
export function getProviderOffersTabHref(filter: ProviderOfferFilter): string {
  return filter === "aktif" ? "/panel/tekliflerim" : `/panel/tekliflerim?durum=${filter}`;
}

/**
 * Bir teklifin, Hizmet Veren'in "Verdiğim Teklifler" sayfasında hangi
 * sekmede göründüğünün route'unu doğrudan Offer'dan üretir —
 * `getProviderOfferFilter` + `getProviderOffersTabHref`'in birleşimi.
 * Bildirim hedefleri (notifications.ts) bunu kullanır, böylece bir
 * bildirimin yönlendirdiği sekme her zaman aynı teklifin GERÇEKTEN
 * göründüğü sekmeyle birebir eşleşir. `offers` (ilana ait TÜM teklifler)
 * `getProviderOfferFilter`e aktarmak için vardır — bu fonksiyonu çağıran
 * bildirim türlerinden ("kabul/ret/işe başlama/anlaşma sağlanamadı/
 * tamamlanma/itiraz/iptal") hiçbiri "pending" bir teklif için üretilmez, o
 * yüzden "kapanan-teklifler" dalının "pending" (kardeş teklif) kolu buradan
 * hiç tetiklenmez; ANCAK "anlasma_saglanamadi" bildirimi "agreement_failed",
 * "is_iptal_edildi" bildirimi ise "cancelled" durumundaki teklif için
 * üretilir ve bu iki durum da "kapanan-teklifler"e eşlenir (bkz.
 * getProviderOfferFilter) — yani bu dal GERÇEKTEN tetiklenir, yalnızca
 * "pending" kolundan değil "agreement_failed"/"cancelled" kollarından da.
 * `?? "aktif"` yalnızca tip güvenliği içindir — bu fonksiyonu çağıran hiçbir
 * bildirim türü "withdrawn" bir teklif için üretilmez (bkz. notifications.ts),
 * o yüzden pratikte hiç tetiklenmez. `job` (isteğe bağlı) yalnızca
 * getProviderOfferFilter'ın İlan Kapatma dalı için ileri aktarılır —
 * notifications.ts#jobClosedNotifications bunu her zaman geçirir, diğer
 * bildirim türleri (job kapatılmamış olduğu için bu dalın hiç tetiklenmediği
 * durumlar) geçirmese de sonuç değişmez.
 */
export function getProviderOfferNotificationHref(offer: Offer, offers: Offer[], job?: Job | null): string {
  return getProviderOffersTabHref(getProviderOfferFilter(offer, offers, job) ?? "aktif");
}

/**
 * Bir ilanın, Hizmet Alan'ın "Hizmet Taleplerim" sayfasındaki route'unu
 * üretir — ilan hâlâ mevcutsa `getJobRequestFilter` ile doğru sekmeye (+
 * `ilanId` ile ilgili kartın vurgulanması/odaklanması için, bkz.
 * job-requests-panel.tsx) yönlendirir; ilan bulunamıyorsa (`job` null,
 * silinmiş) ya da hiçbir sekmeyle eşleşmiyorsa (`filter` null, ör. "iptal"
 * durumundaki ilan) güvenli şekilde ana görünüme (Aktif, vurgusuz) düşer.
 * "Bir teklif geri çekildi" bildirimi (notifications.ts) bunu kullanır.
 */
export function getJobRequestNotificationHref(job: Job | null, offers: Offer[]): string {
  if (!job) return "/panel/hizmet-taleplerim";
  const filter = getJobRequestFilter(job, offers);
  const base = filter && filter !== "aktif" ? `/panel/hizmet-taleplerim?durum=${filter}` : "/panel/hizmet-taleplerim";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}ilanId=${job.id}`;
}
