export type UserRole = "hizmet-alan" | "hizmet-veren";

export type Session = {
  id: string;
  name: string;
  role: UserRole;
};

/** Bkz. service-catalog.ts#SERVICE_FEATURE_OPTIONS. */
export type ServiceFeature = "operatorlu" | "operatorsuz" | "7-24" | "acil-hizmet" | "faturali";

/** Bkz. service-catalog.ts#EXPERIENCE_RANGE_OPTIONS. */
export type ExperienceRange = "0-1" | "1-3" | "3-5" | "5-10" | "10+";

/**
 * Yalnızca hizmet-veren kullanıcılarda anlamlı, tamamen opsiyonel bir
 * profil eki (bkz. users.ts#StoredUser). Kullanıcı kaydını oluştururken
 * zorunlu değildir — hiç doldurulmamışsa StoredUser.providerProfile hiç
 * yoktur, sahte/varsayılan bir profil üretilmez.
 */
export type ProviderProfile = {
  companyName: string;
  /** photo-blob-store.ts (IndexedDB) içindeki logo dosyasının anahtarı; yoksa logo yüklenmemiştir. */
  logoStorageKey?: string;
  bio: string;
  /** 1900 ile mevcut yıl arasında olmalıdır (bkz. provider-profile.ts); belirtilmemişse yoktur. */
  foundedYear?: number;
  /** İl adları (bkz. turkey-locations.ts#getProvinces) — hizmet verilen bölgeler. Panel > Profilim > Hizmet Bilgilerim'den de düzenlenir (bkz. users.ts#updateProviderServiceInfo). */
  regions: string[];
  /**
   * ESKİ, jobs.ts#SERVICE_CATEGORIES'ten (8 elemanlı düz liste) seçilmiş
   * uzmanlık alanları — Hesap Ayarları > Firma Profili'ndeki "Uzmanlık
   * Alanları" chip'leri hâlâ bunu okur/yazar (bkz. provider-profile-editor.tsx),
   * DEPRECATED ama kaldırılmadı (bkz. service-catalog.ts başındaki not).
   * Yeni kod bu alana YAZMAMALI — yalnızca `serviceCategories`e yazılır;
   * bu alan yalnızca geriye dönük okuma için var, migrasyonu
   * service-catalog.ts#migrateLegacyExpertiseToServiceCategoryIds yapar.
   */
  expertise: string[];
  /**
   * Platformun tek merkezi hizmet kataloğundan (service-catalog.ts#
   * SERVICE_CATEGORY_GROUPS) seçilmiş hizmet id'leri — hem "Hizmet
   * Bilgilerim" hem (aynı id'ler üzerinden) ilan kategorisi ile ortak
   * veri temelini paylaşır. Yeni kayıt/güncellemelerde ESAS ALINAN
   * alandır (bkz. users.ts#updateProviderServiceInfo). Bu alandan önce
   * oluşturulmuş profillerde yoktur — böyle profiller açıldığında
   * `expertise`ten migrateLegacyExpertiseToServiceCategoryIds ile
   * türetilen değerlerle BİRLEŞTİRİLEREK gösterilir (bkz.
   * service-info-editor.tsx), ama bu alanın kendisi yalnızca kullanıcı
   * kaydettiğinde yazılır.
   */
  serviceCategories?: string[];
  /** Yeni (Aşama 2): hizmet özellikleri çoklu seçimi. Bu alandan önce oluşturulmuş profillerde yoktur. */
  serviceFeatures?: ServiceFeature[];
  /** Yeni (Aşama 2): deneyim aralığı. Bu alandan önce oluşturulmuş profillerde yoktur. */
  experienceRange?: ExperienceRange;
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
  /** Bölge/Tesis GÖRÜNEN adı — `facilityId` doluysa o tesisin adının kopyası, "Listede yok / Diğer" seçilmişse (ya da facilityId'den önce oluşturulmuş eski ilanlarda) serbest metin. */
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca Bölge/Tesis alanında merkezi katalogdan bir tesis seçildiyse vardır. "Listede yok / Diğer" seçilmişse ya da bu alandan ÖNCE oluşturulmuş ilanlarda yoktur; bu durumda workLocationType serbest metindir ve job-location.ts#resolveJobFacility ad/takma-ad eşleştirmesiyle en iyi çaba ile bir Facility'e bağlamayı dener. */
  facilityId?: string;
  /** "Firma / Fabrika Adı". Bu alandan ÖNCE oluşturulmuş ilanlarda yoktur. */
  companyOrFactoryName?: string;
  /**
   * "Açık Adres" — serbest metin tam adres. GİZLİ alan: yalnızca ilan sahibi
   * (requesterId) HER ZAMAN, başka bir kullanıcı ise yalnızca bu ilana verdiği
   * teklif "meşgul" (bkz. job-requests.ts#canViewJobAddress/ENGAGED_OFFER_STATUSES)
   * durumundaysa görebilir — contact-access.ts'in telefon/e-posta kapısıyla AYNI
   * zamanlamayı kullanır ama AYRI bir fonksiyondadır (contact-access.ts yalnızca
   * telefon/e-posta içindir). Bu alandan önce oluşturulmuş ilanlarda yoktur.
   */
  addressText?: string;
  /**
   * "catalog" — Bölge/Tesis merkezi kataloktan seçildi (facilityId dolu ya
   * da eski/legacy bir ilan). "custom" — Hizmet Alan "Listede yok — tesis
   * bilgilerini kendim gireceğim" seçeneğiyle kendi tesis/adres bilgisini
   * girdi; bu durumda facilityId hiçbir zaman yoktur ve workLocationType
   * kullanıcının serbestçe yazdığı tesis/işletme adıdır. Bu alandan önce
   * oluşturulmuş TÜM ilanlarda yoktur — yokluğu HER ZAMAN "catalog" olarak
   * yorumlanır (bkz. job-location.ts, job-edit-form.tsx'in facilityId
   * varlığına dayanan geriye dönük mod tespiti zaten bu iki durumu da aynı
   * şekilde ele alır).
   */
  locationMode?: "catalog" | "custom";
  /**
   * Yalnızca locationMode "custom" olan ilanlarda anlamlı, isteğe bağlı
   * Bölge/Mahalle bilgisi. addressText ile AYNI gizlilik kapısını
   * (job-requests.ts#canViewJobAddress) kullanır — bkz. job-detail-content.tsx.
   */
  neighborhood?: string;
  /**
   * Yalnızca locationMode "custom" olan ilanlarda anlamlı, isteğe bağlı
   * konum/harita bağlantısı (düz metin URL, ayrı bir harita/coğrafi kodlama
   * entegrasyonu YOKTUR). addressText ile AYNI gizlilik kapısını kullanır.
   */
  locationUrl?: string;
  /**
   * Yalnızca locationMode "custom" olan ilanlarda anlamlı, isteğe bağlı
   * ilave adres tarifi notu. addressText ile AYNI gizlilik kapısını kullanır.
   */
  directionsNote?: string;
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
