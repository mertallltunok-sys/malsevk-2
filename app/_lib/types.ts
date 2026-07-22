export type UserRole = "hizmet-alan" | "hizmet-veren";

export type Session = {
  id: string;
  name: string;
  role: UserRole;
};

export type Currency = "TRY" | "USD";

export type JobStatus = "yayinda" | "tamamlandi" | "iptal";

export type JobPhoto = {
  id: string;
  /** 0 tabanlı sıra; 0 olan kapak fotoğrafıdır. */
  order: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** photo-blob-store.ts (IndexedDB) içindeki asıl dosyanın anahtarı. */
  storageKey: string;
};

export type Job = {
  id: string;
  title: string;
  category: string;
  province: string;
  district: string;
  workLocationType: string;
  workDate: string;
  description: string;
  operationDetails: string;
  status: JobStatus;
  /** İlanı oluşturan Hizmet Alan kullanıcısının id'si. Sabit örnek ilanlar için null. */
  requesterId: string | null;
  /** Sıralı operasyon fotoğrafları. Eski/sabit ilanlarda boş dizi olabilir. */
  photos: JobPhoto[];
};

/**
 * "accepted" sonrası olası akış: iş fiilen başlar ("in_progress") ya da
 * taraflar anlaşamaz ("agreement_failed"). İş başladıktan sonra Hizmet
 * Veren tamamlandığını bildirir ("completion_requested"); Hizmet Alan bunu
 * onaylar ("completed") ya da itiraz eder ("completion_disputed") —
 * itiraz da Hizmet Alan tarafından "completed" ya da "cancelled" olarak
 * sonuçlandırılır (bkz. offers.ts#resolveCompletionDispute). Job.status bu
 * geçişlerin hiçbirinde değişmez (bkz. jobs.ts) — ilanın "teklife
 * açık/kapalı" ve "devam eden iş" görünümü, her zaman olduğu gibi, ilgili
 * Offer kayıtlarından türetilir (bkz. job-requests.ts#ENGAGED_OFFER_STATUSES).
 * "pending" durumundaki bir teklif, Hizmet Alan henüz karar vermeden
 * Hizmet Veren tarafından "withdrawn"a taşınabilir (bkz.
 * offers.ts#withdrawOffer) — bilerek ENGAGED_OFFER_STATUSES dışında: hiçbir
 * zaman aktif iş kapasitesine sayılmamış, hiçbir zaman iletişim bilgisi
 * açılmamış bir teklifin sessizce geri çekilmesidir.
 */
export type OfferStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "agreement_failed"
  | "completion_requested"
  | "completion_disputed"
  | "completed"
  | "cancelled"
  | "withdrawn";

/** Yalnızca status "agreement_failed" olduğunda anlamlıdır. */
export type DisagreementReason =
  | "telefona_ulasilamadi"
  | "epostaya_donus_olmadi"
  | "fiyatta_anlasilamadi"
  | "tarih_planinda_anlasilamadi"
  | "hizmet_veren_yapamayacagini_bildirdi"
  | "hizmet_alan_vazgecti"
  | "diger";

export type Offer = {
  id: string;
  jobId: string;
  providerId: string;
  amount: number;
  currency: Currency;
  description: string;
  estimatedDuration: string;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
  /** Yalnızca status "agreement_failed" olan tekliflerde bulunur; eski kayıtlarda yoktur. */
  disagreementReason?: DisagreementReason;
  /** Yalnızca disagreementReason "diger" olduğunda ve kullanıcı bir not girdiğinde bulunur. */
  disagreementNote?: string;
  /** Yalnızca status "completion_disputed" olan (ya da olmuş) tekliflerde bulunur. */
  completionDisputeNote?: string;
  /**
   * Tamamlama talebini başlatan kullanıcının id'si (bkz.
   * offers.ts#requestCompletion). Yalnızca status "completion_requested"
   * olan (ya da olmuş) tekliflerde bulunur; bu özellikten önce oluşturulmuş
   * kayıtlarda hiç yoktur. Talebi başlatan kullanıcının kendi talebini
   * onaylayamaması/itiraz edememesi için kullanılır (bkz.
   * confirmCompletion/disputeCompletion).
   */
  completionRequestedByUserId?: string;
  /**
   * `requestCompletion` çağrıldığı an kaydedilir — 7 günlük otomatik
   * tamamlanma sayacının ve geri sayım UI'ının tek doğruluk kaynağı (bkz.
   * offers.ts#COMPLETION_AUTO_APPROVE_DAYS/applyExpiredCompletionAutoApprovals).
   * Yalnızca status "completion_requested" olmuş tekliflerde bulunur.
   */
  completionRequestedAt?: string;
  /**
   * true ise bu teklif, Hizmet Alan hiç onaylamadan 7 gün dolduğu için
   * sistem tarafından otomatik "completed" yapılmıştır (bkz.
   * applyExpiredCompletionAutoApprovals). Yalnızca bu durumda puanlama
   * penceresi 30 günle sınırlıdır (bkz. ratings.ts) — manuel onaylanan
   * işlerde süre sınırı yoktur.
   */
  autoCompleted?: boolean;
};

export type Rating = {
  id: string;
  offerId: string;
  jobId: string;
  /** Puanlanan Hizmet Veren. */
  providerId: string;
  /** Puanı veren Hizmet Alan (yalnızca ilgili işin gerçek tarafı olabilir). */
  raterId: string;
  /** 1-5 arası tam sayı. */
  stars: number;
  createdAt: string;
};
