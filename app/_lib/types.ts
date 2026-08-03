/**
 * "admin" yalnızca Hizmet Veren Belge Kontrolü panelini (bkz. app/admin) kullanan,
 * dev-seed ile oluşturulan (bkz. users.ts#DEV_ACCOUNTS) bir roldür — kayıt formunda
 * ("Hesap Türü") hiçbir zaman bir seçenek olarak sunulmaz, kendi kaydını oluşturamaz.
 */
export type UserRole = "hizmet-alan" | "hizmet-veren" | "admin";

export type Session = {
  id: string;
  name: string;
  role: UserRole;
};

/** Bkz. provider-document-reviews.ts. */
export type ProviderDocumentReviewStatus = "pending" | "approved" | "rejected" | "revision_requested";

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
  /**
   * DEPRECATED — 2026-07-29 itibarıyla artık YAZILMAZ. Bir hizmet-veren'in
   * güncel hizmet seçimleri artık provider-services.ts (userId -> serviceCategoryId
   * ilişkisel tablosu, tek doğruluk kaynağı) üzerinden okunur/yazılır — bu
   * alan yalnızca BU DEĞİŞİKLİKTEN ÖNCE zaten localStorage'a yazılmış eski
   * profillerin normalizeStoredUser'da hata vermeden okunabilmesi için
   * tipte tutulur (bkz. `expertise` alanındaki AYNI "deprecated ama
   * kaldırılmadı" deseni). Yeni kod bu alana ASLA yazmamalı.
   */
  serviceCategories?: string[];
  /** Yeni (Aşama 2): hizmet özellikleri çoklu seçimi. Bu alandan önce oluşturulmuş profillerde yoktur. */
  serviceFeatures?: ServiceFeature[];
  /** Yeni (Aşama 2): deneyim aralığı. Bu alandan önce oluşturulmuş profillerde yoktur. */
  experienceRange?: ExperienceRange;
};

/** Bkz. money.ts#CURRENCY_VALUES/isValidCurrency/getCurrencyLabel — TEK doğruluk kaynağı, hiçbir dosya "TRY"/"USD"/"EUR" değerlerini kendi başına elle karşılaştırmaz. */
export type Currency = "TRY" | "USD" | "EUR";

export type JobStatus = "yayinda" | "tamamlandi" | "iptal";

/** Bkz. job-closure.ts — bir ilanın Hizmet Alan tarafından manuel olarak neden kapatıldığı. */
export type JobClosureReason =
  | "baska-hizmet-verenle-anlasildi"
  | "hizmete-ihtiyac-kalmadi"
  | "yanlislikla-olusturuldu"
  | "diger";

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

/**
 * Gümrük Müşavirliği ilanına eklenen destekleyici bir evrak — JobPhoto ile
 * BİREBİR aynı şekil (aynı depo, aynı persist/rollback yardımcıları,
 * job-store.ts#persistPhotosOrRollback ikisi için de tekrar kullanılır) —
 * yalnızca semantik netlik için ayrı bir isimle dışa aktarılır. `order`
 * evraklar için anlamsızdır (sıralama yok) ama tip uyumluluğu için taşınır.
 */
export type JobCustomsDocument = JobPhoto;

export type Job = {
  id: string;
  title: string;
  category: string;
  province: string;
  district: string;
  /**
   * Bölge/Tesis GÖRÜNEN adı — `facilityId` doluysa o tesisin adının kopyası,
   * "Listede yok / Diğer" seçilmişse (ya da facilityId'den önce oluşturulmuş
   * eski ilanlarda) serbest metin. Depolama (Kapalı/Açık Saha) VE Gümrük
   * Müşavirliği'nde (bkz. job-location.ts#isSimplifiedLocationCategory) HER
   * ZAMAN `""`dır — bu iki grubun lokasyonu yalnızca İl/İlçe'den oluşur,
   * gösterilecek bir tesis/bölge adı yoktur (bkz. job-location.ts#
   * formatJobLocationLine'ın boş değeri nasıl atladığı).
   */
  workLocationType: string;
  /** turkey-locations.ts#Facility.id — yalnızca Bölge/Tesis alanında merkezi katalogdan bir tesis seçildiyse vardır. "Listede yok / Diğer" seçilmişse, bu alandan ÖNCE oluşturulmuş ilanlarda, ya da Depolama/Gümrük Müşavirliği'nde (bkz. isSimplifiedLocationCategory) yoktur; bu durumda workLocationType serbest metindir ve job-location.ts#resolveJobFacility ad/takma-ad eşleştirmesiyle en iyi çaba ile bir Facility'e bağlamayı dener. */
  facilityId?: string;
  /** "Firma / Fabrika Adı". Bu alandan ÖNCE oluşturulmuş ilanlarda yoktur. */
  companyOrFactoryName?: string;
  /**
   * "Açık Adres" — serbest metin tam adres. GİZLİ alan: yalnızca ilan sahibi
   * (requesterId) HER ZAMAN, başka bir kullanıcı ise yalnızca bu ilana verdiği
   * teklif "meşgul" (bkz. job-requests.ts#canViewJobAddress/ENGAGED_OFFER_STATUSES)
   * durumundaysa görebilir — contact-access.ts'in telefon/e-posta kapısıyla AYNI
   * zamanlamayı kullanır ama AYRI bir fonksiyondadır (contact-access.ts yalnızca
   * telefon/e-posta içindir). Bu alandan önce oluşturulmuş ilanlarda, ve
   * Depolama/Gümrük Müşavirliği'nde (bkz. isSimplifiedLocationCategory) yoktur.
   */
  addressText?: string;
  /**
   * "catalog" — Bölge/Tesis merkezi kataloktan seçildi (facilityId dolu ya
   * da eski/legacy bir ilan). "custom" — Hizmet Alan "Listede yok — tesis
   * bilgilerini kendim gireceğim" seçeneğiyle kendi tesis/adres bilgisini
   * girdi; bu durumda facilityId hiçbir zaman yoktur ve workLocationType
   * kullanıcının serbestçe yazdığı tesis/işletme adıdır. Bu alandan önce
   * oluşturulmuş TÜM ilanlarda, ve Depolama/Gümrük Müşavirliği'nde (bkz.
   * isSimplifiedLocationCategory) yoktur — yokluğu HER ZAMAN "catalog" olarak
   * yorumlanır (bkz. job-location.ts, job-edit-form.tsx'in facilityId
   * varlığına dayanan geriye dönük mod tespiti zaten bu iki durumu da aynı
   * şekilde ele alır).
   */
  locationMode?: "catalog" | "custom";
  /**
   * ESKİ (LEGACY) ALAN — artık hiçbir kategorinin formu bu alanı toplamıyor
   * (Gümrük Müşavirliği'nin bu üç alanı topladığı eski "custom" konum bloğu
   * kaldırıldı, bkz. job-location.ts#isSimplifiedLocationCategory). Yalnızca
   * bu değişiklikten ÖNCE Gümrük Müşavirliği'nin "Listede yok — tesis
   * bilgilerini kendim gireceğim" moduyla oluşturulmuş eski ilanlarda anlamlı
   * olabilir; o kayıtlar düzenlense bile (job-store.ts#resolveLocationFields
   * artık bu alanı hiç yazmadığı için) değeri dokunulmadan korunur. addressText
   * ile AYNI gizlilik kapısını (job-requests.ts#canViewJobAddress) kullanır —
   * bkz. job-detail-content.tsx.
   */
  neighborhood?: string;
  /** Bkz. neighborhood — AYNI eski (legacy) alan, AYNI gerekçe/koruma. Düz metin konum/harita bağlantısı (ayrı bir harita/coğrafi kodlama entegrasyonu YOKTUR). */
  locationUrl?: string;
  /** Bkz. neighborhood — AYNI eski (legacy) alan, AYNI gerekçe/koruma. İlave adres tarifi notu. */
  directionsNote?: string;
  workDate: string;
  description: string;
  operationDetails: string;
  status: JobStatus;
  /** İlanı oluşturan Hizmet Alan kullanıcısının id'si. Sabit örnek ilanlar için null. */
  requesterId: string | null;
  /**
   * Aynı ilan oluşturma formunda birden fazla hizmet seçildiğinde doğan
   * bağımsız `Job` kayıtlarını birbirine bağlayan ortak kimlik (bkz.
   * job-store.ts#createJobsForOperation) — yalnızca dahili eşleştirme
   * amaçlıdır, kullanıcıya gösterilen bir kod DEĞİLDİR. Tek hizmetle
   * oluşturulan (bugün olduğu gibi `createJob` ile) ilanlarda hiç yoktur.
   */
  operationId?: string;
  /**
   * Çoklu Hizmet Operasyonu — Aşama 2: bu hizmetin bitiş tarihi. `workDate`
   * ile birlikte bir tarih ARALIĞI tanımlar (aynı gün başlayıp bitmesi
   * geçerlidir). Bu alandan önce oluşturulmuş TÜM ilanlarda yoktur — yokluğu
   * bir hata durumu değildir, yalnızca eski (tek günlü ya da bu alan
   * eklenmeden önce oluşturulmuş) bir ilanı işaret eder; hiçbir ekran bunu
   * zorunlu okumaz. Yalnızca YENİ oluşturulan ilanlarda form doğrulamasıyla
   * zorunlu tutulur (bkz. job-request-form.tsx).
   */
  workEndDate?: string;
  /**
   * "Ürün Bilgileri" — yalnızca product-catalog.ts#requiresProductInfo'nun
   * true döndüğü hizmet kategorilerinde doldurulur: Liman Hizmetleri kapsamı
   * (bkz. PORT_SERVICE_CATEGORY_IDS — Lashing, Unlashing, Yükleme/Boşaltma
   * Gözetimi, Konteyner Dolum/Boşaltım) İLE Nakliye'nin (bkz.
   * isTransportationCategory) BİRLEŞİMİ. Depolama/Forklift Hizmeti ve
   * diğer tüm kategoriler KAPSAM DIŞIDIR. Bu üç alandan önce oluşturulmuş
   * TÜM ilanlarda ve kapsam dışı bir kategoride oluşturulan ilanlarda
   * hiçbiri yoktur — yokluğu bir hata durumu değildir. productQuantity/
   * productType her zaman zorunlu; productTonnage Nakliye'de ZORUNLU,
   * Liman Hizmetleri'nin tamamında isteğe bağlıdır (bkz.
   * product-catalog.ts#isTonnageRequired). Görüntüleme tarafında her zaman
   * product-catalog.ts#hasProductInfo/formatJobProductInfoLine üzerinden
   * okunmalı — bunlar kapsam kontrolünü de uygular, ham alan varlığına
   * (`productType !== undefined` gibi) doğrudan bakmak eski/kapsam-dışı
   * kalıntı veriyi yanlışlıkla gösterebilir (bkz. o dosyanın dokümantasyonu).
   * Çoklu Hizmet Operasyonu'nda her hizmet kendi ürün bilgisini bağımsız
   * taşır (bkz. job-store.ts#OperationServiceInput).
   */
  productQuantity?: number;
  /** Bkz. productQuantity üstündeki doküman. Ondalıklı olabilir (ör. 8.5). */
  productTonnage?: number;
  /** Bkz. productQuantity üstündeki doküman. Serbest metin — product-catalog.ts#PRODUCT_TYPE_SUGGESTIONS listeden seçilmiş ya da kullanıcının kendi yazdığı bir değer olabilir. */
  productType?: string;
  /** Sıralı operasyon fotoğrafları. Eski/sabit ilanlarda boş dizi olabilir. */
  photos: JobPhoto[];
  /**
   * Gümrük Müşavirliği'ne ÖZEL "Operasyon Bilgileri" — yalnızca
   * customs-brokerage-catalog.ts#isCustomsBrokerageCategory(category) true
   * iken doldurulur; diğer TÜM kategorilerde (Nakliye dahil) bu alanların
   * hiçbiri hiç yoktur. customsTransactionType/customsProductType her zaman
   * zorunlu; customsRequestedServices/customsDocuments isteğe bağlıdır. Bu
   * alanlardan önce oluşturulmuş ya da ilgisiz bir kategoride oluşturulmuş
   * ilanlarda hiçbiri yoktur — yokluğu bir hata durumu değildir (bkz.
   * job-store.ts#resolveCustomsBrokerageFields). Çoklu Hizmet Operasyonu'nda
   * YALNIZCA Gümrük Müşavirliği hizmet kartı bu alanları taşır — kardeş
   * ilanlara asla kopyalanmaz (bkz. görev tanımı).
   */
  customsTransactionType?: string;
  /**
   * ESKİ (legacy) alan — "Gümrük Müdürlüğü", formdan tamamen kaldırıldı
   * (eski yerinde artık Ürün Cinsi var, bkz. customs-brokerage-fields.tsx).
   * customsGtipCode/customsDeclarationItemCount/customsContainerCount İLE
   * AYNI gerekçe/koruma: hiçbir form artık bunu toplamaz/gösterir, ama var
   * olan bir değeri düzenleme sırasında dokunulmadan korunur (bkz.
   * job-store.ts#resolveCustomsBrokerageFields).
   */
  customsOfficeId?: string;
  /** Bkz. customsTransactionType üstündeki doküman. customs-brokerage-catalog.ts#CUSTOMS_REQUESTED_SERVICE_OPTIONS'a ait id'ler — isteğe bağlı, boş seçim hiç yazılmaz (undefined). */
  customsRequestedServices?: string[];
  /**
   * Bkz. customsTransactionType üstündeki doküman. Gümrüklenecek ürünün
   * cinsi — product-catalog.ts#Job.productType ile KARIŞTIRILMAMALI, o alan
   * Liman Hizmetleri/Nakliye içindir, bu alan tamamen bağımsızdır (AYNI
   * `Job` üzerinde ikisi asla birlikte bulunmaz, kategoriler kesişmez).
   * Form tarafında productType ile AYNI seçim sistemini (product-catalog.ts#
   * PRODUCT_TYPE_SUGGESTIONS/ProductTypeCombobox) kullanır — ama kaydedilen
   * son değer her zaman düz metindir (katalogdan seçilmiş öneri ya da
   * kullanıcının serbestçe yazdığı ad); sentinel değeri burada asla
   * saklanmaz.
   */
  customsProductType?: string;
  /**
   * ESKİ (LEGACY) ALAN — GTİP Kodu, formdan tamamen kaldırıldı, artık hiçbir
   * ilanda yeni yazılmaz (bkz. job-store.ts#resolveCustomsBrokerageFields).
   * Yalnızca bu değişiklikten ÖNCE oluşturulmuş bir Gümrük Müşavirliği
   * ilanında anlamlı olabilir; o ilan düzenlense bile değeri dokunulmadan
   * korunur (görüntülenmez, silinmez).
   */
  customsGtipCode?: string;
  /** Bkz. customsGtipCode — AYNI eski (legacy) alan, AYNI gerekçe/koruma. Tahmini Beyan Kalem Sayısı. */
  customsDeclarationItemCount?: number;
  /** Bkz. customsGtipCode — AYNI eski (legacy) alan, AYNI gerekçe/koruma. Konteyner Sayısı. */
  customsContainerCount?: number;
  /** Bkz. customsTransactionType üstündeki doküman. İsteğe bağlı destekleyici evraklar (Ticari Fatura, Packing List, ATR, EUR.1, Menşe Şahadetnamesi vb.) — JobPhoto ile AYNI depolama şeklini (photo-blob-store.ts IndexedDB + storageKey) paylaşır, bu yüzden JobPhoto tipiyle birebir aynı şekle sahiptir (bkz. JobCustomsDocument tanımı). */
  customsDocuments?: JobCustomsDocument[];
  /**
   * İlan Yayın Süresi Yönetimi: ilanın GERÇEKTEN oluşturulduğu an (ISO 8601
   * zaman damgası — yalnızca tarih değil, saat/dakika/saniye de içerir; 14
   * günlük süre bunun üzerinden milisaniye hassasiyetiyle hesaplanır, bkz.
   * job-publish-window.ts). Bu alandan ÖNCE oluşturulmuş TÜM ilanlarda
   * (sabit örnek ilanlar dahil) yoktur — yokluğu bir hata değildir, o ilanın
   * yayın süresi kuralından TAMAMEN muaf olduğu (hiçbir zaman otomatik
   * "süresi doldu" sayılmayacağı) anlamına gelir; bkz.
   * job-publish-window.ts#isJobPublishWindowExpired'ın bu alanı zorunlu
   * kılan kontrolü. `createJob`/`createJobsForOperation`/`republishJob`
   * (job-store.ts) HER ZAMAN doldurur.
   */
  createdAt?: string;
  /**
   * `createdAt` + `job-publish-window.ts#JOB_PUBLISH_WINDOW_DAYS` (14) —
   * yine job-publish-window.ts'in TEK yardımcı fonksiyonuyla (computePublishEndAt)
   * üretilir, başka hiçbir yerde elle hesaplanmaz. `createdAt` gibi bu
   * alandan önceki ilanlarda da yoktur ve aynı muafiyet mantığına tabidir.
   */
  publishEndAt?: string;
  /**
   * Yeniden Yayınlama: bu ilan, süresi dolmuş BAŞKA bir ilanın (bkz.
   * `republishedToJobId`, aşağıda) yerine `job-store.ts#republishJob` ile
   * KLONLANARAK oluşturulduysa, o eski ilanın id'sini taşır — geçmişin
   * (hangi ilanın hangi ilandan doğduğunun) izlenebilir kalması için. Normal
   * `createJob`/`createJobsForOperation` ile oluşturulmuş ilanlarda hiç
   * yoktur.
   */
  republishedFromJobId?: string;
  /**
   * Yeniden Yayınlama: bu ilan süresi dolduktan SONRA `republishJob` ile
   * yeniden yayınlandıysa, onun yerine geçen YENİ ilanın id'sini taşır. Bu
   * alan set edildiği an bu (eski) ilan artık "aksiyon bekleyen süresi dolan
   * ilan" değil, salt geçmiş kaydıdır — job-publish-window.ts#
   * isExpiredListingAwaitingAction bunu ayırt eder, aynı zamanda AYNI eski
   * ilanın birden fazla kez yeniden yayınlanmasını (kontrolsüz kopya
   * üretimini) önlemenin de tek kaynağıdır (bkz. republishJob'ın bu alanı
   * zaten dolu bir ilan için reddettiği kontrol).
   */
  republishedToJobId?: string;
  /**
   * İlan Kapatma: Hizmet Alan bu ilanı `job-closure.ts#closeJobListing` ile
   * manuel olarak kapattıysa doluTUR (ISO zaman damgası) — İlan Yayın Süresi
   * Yönetimi'ndeki `publishEndAt` ile AYNI ilkeyle, `Job.status`a HİÇ
   * dokunulmaz (bkz. CLAUDE.md "No real backend"'in Job.status'un asla
   * değişmediği notu); ilan yalnızca "aktif" sayılmaktan çıkar. Kayıt
   * SİLİNMEZ — bu alan doluyken bile ilan, teklif geçmişi ve bildirimleri
   * olduğu gibi erişilebilir kalır. Bu alandan önce oluşturulmuş/kapatılmamış
   * TÜM ilanlarda yoktur.
   */
  closedAt?: string;
  /** Yalnızca `closedAt` doluysa anlamlıdır — seçilen kapatma nedeni, kalıcı olarak saklanır. */
  closureReason?: JobClosureReason;
  /**
   * Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer" (delivery). Yalnızca
   * product-catalog.ts#isTransportationCategory(category) true iken doldurulur;
   * diğer TÜM kategorilerde (Nakliye dışında) bu altı alanın hiçbiri hiç
   * yoktur (bkz. job-store.ts#resolveDeliveryLocationFields — Ürün Bilgileri/
   * Gümrük Müşavirliği alanlarıyla AYNI "TEK yer, kategori kapsam dışıysa
   * temizlenir" deseni). "Yük Alınacak Yer" (pickup) İÇİN AYRI bir alan grubu
   * YOKTUR — yukarıdaki province/district/workLocationType/facilityId/
   * addressText/locationMode alanları Nakliye ilanlarında pickup'ın kendisidir
   * (bkz. nakliye-route.ts); bu, mevcut filtreleme/görünürlük/adres-gizliliği
   * sistemlerinin HİÇBİRİNİN değişmemesini sağlayan kasıtlı bir tercihtir
   * (neighborhood/locationUrl/directionsNote Nakliye'nin pickup'ında hiç
   * kullanılmaz — yalnızca Nakliye DIŞINDAKİ kategorilerin "Listede yok"
   * serbest-tesis moduna özeldir). `deliveryLocationType` "facility" ise
   * deliveryFacilityId/deliveryFacilityName doludur, deliveryAddressText
   * yoktur; "open_address" ise tam tersi. deliveryAddressText, job.addressText
   * ile AYNI gizlilik kapısını (job-requests.ts#canViewJobAddress) kullanır —
   * yeni bir güvenlik kuralı YOKTUR (bkz. nakliye-route-card.tsx).
   */
  deliveryProvince?: string;
  deliveryDistrict?: string;
  deliveryLocationType?: "facility" | "open_address";
  /** turkey-locations.ts#Facility.id — yalnızca deliveryLocationType "facility" iken vardır. */
  deliveryFacilityId?: string;
  /** Seçilen tesisin GÖRÜNEN adı (facilityId'nin denormalize kopyası — workLocationType'ın pickup'taki rolüyle AYNI). */
  deliveryFacilityName?: string;
  /** Yalnızca deliveryLocationType "open_address" iken vardır. */
  deliveryAddressText?: string;
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
  /**
   * "Tamamlanması Taahhüt Edilen Gün" — yalnızca Nakliye kategorisindeki
   * ilanlara verilen tekliflerde toplanır (bkz. product-catalog.ts#
   * isTransportationCategory, offer-form.tsx); Nakliye DIŞINDAKİ hiçbir
   * kategoride bu alan artık hiç yoktur (undefined) — teklif formu
   * göstermez/zorunlu kılmaz, offers.ts#createOffer doğrulamaz/yazmaz. Bu
   * değişiklikten ÖNCE oluşturulmuş, kategorisi ne olursa olsun HER teklifte
   * bu alan zaten dolu — o eski değerler asla silinmez, yalnızca Nakliye
   * dışı bir ilanın teklif kartında/özetinde artık gösterilmez.
   *
   * Nakliye'deki yeni teklifler her zaman `number` (1-60 arası, bkz.
   * offers.ts#createOffer'ın doğrulaması) olarak saklar; bu alan bu
   * özellikten ÖNCE serbest metin ("1 iş günü" gibi) olarak toplanıyordu, o
   * eski kayıtlar `string` olarak okunmaya devam eder — hiçbiri geriye dönük
   * olarak sayıya ZORLA çevrilmez/kaybolmaz. Görüntüleme tarafı her zaman
   * offers.ts#formatCommittedDays üzerinden okunmalı (eski metni güvenle
   * sayıya çevirebiliyorsa "N gün" gösterir, çeviremiyorsa ham metni olduğu
   * gibi gösterir, hiç yoksa "-" gösterir — asla çökmez).
   */
  estimatedDuration?: string | number;
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
