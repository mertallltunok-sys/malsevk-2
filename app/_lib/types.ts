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
  /**
   * Geri Dönüşüm & Atık Tahliye'ye özel, TAMAMEN OPSİYONEL "uzmanlık
   * alanları" — recycling-catalog.ts#RECYCLING_MATERIAL_CATEGORIES'in üst
   * kategori id'leri (alt tür yok). `regions`/`serviceFeatures` ile AYNI
   * "bilgilendirme amaçlı" ilke: yalnızca profilde gösterilir, HİÇBİR
   * filtre/görünürlük/yetkilendirme fonksiyonu tarafından okunmaz — gerçek
   * erişim tamamen provider_service_authorizations'ın (bkz. CLAUDE.md
   * "Service Authorization") tek kategori bazlı yetkilendirmesinden gelir,
   * bu alan ikinci bir yetkilendirme ekseni DEĞİLDİR. Bu alandan önce
   * oluşturulmuş profillerde yoktur.
   */
  recyclingMaterialSpecialties?: string[];
};

/** Bkz. money.ts#CURRENCY_VALUES/isValidCurrency/getCurrencyLabel — TEK doğruluk kaynağı, hiçbir dosya "TRY"/"USD"/"EUR" değerlerini kendi başına elle karşılaştırmaz. */
export type Currency = "TRY" | "USD" | "EUR";

export type JobStatus = "yayinda" | "tamamlandi" | "iptal";

/** Bkz. job-moderation.ts — bir ilanın admin onay/moderasyon durumu. `JobStatus`tan (operasyonel yaşam döngüsü) KASITLI OLARAK ayrı bir kavram. */
export type JobModerationStatus = "pending_review" | "approved" | "rejected";

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

/**
 * "Konteyner Grubu" — Konteyner Depolama ilanlarında farklı ölçü/tip/yük
 * durumuna sahip konteyner kalemlerinin HER BİRİ kendi bağımsız grubu olarak
 * girilir (bkz. Job.storageContainerGroups üstündeki doküman). `id`,
 * job-photo-upload.tsx#PhotoItem.clientId İLE AYNI ilke — yalnızca
 * React key/hata eşleştirmesi için `crypto.randomUUID()` ile üretilir, iş
 * kuralı taşımaz.
 */
export type StorageContainerGroup = {
  id: string;
  quantity: number;
  size: "20" | "40" | "45";
  type: "standart" | "high-cube" | "reefer" | "open-top" | "tank";
  status: "dolu" | "bos";
  /** Yalnızca status === "dolu" iken anlamlıdır. */
  content?: string;
  /** Yalnızca status === "dolu" iken anlamlıdır. */
  grossWeight?: number;
  /** Yalnızca status === "dolu" iken anlamlıdır. */
  hazardous?: boolean;
  /** Yalnızca status === "dolu" VE hazardous === true iken anlamlıdır. */
  unNumber?: string;
  /** Bkz. unNumber üstündeki doküman — AYNI koşul. */
  imoClass?: string;
  /** Yalnızca type === "reefer" iken anlamlıdır (Dolu/Boş fark etmeksizin). */
  reeferTemperature?: number;
  /** Bkz. reeferTemperature üstündeki doküman — AYNI koşul. */
  reeferElectrical?: boolean;
};

/**
 * "Nakliye Yeniden Tasarımı" — Nakliye'nin (karayolu taşımacılığı) yeni
 * yapılandırılmış alanları TEK bir `Job.nakliyeDetails` objesinde toplanır
 * (bkz. nakliye-transport-catalog.ts, TÜM seçenek listeleri/etiketler/
 * doğrulama yardımcıları için TEK doğruluk kaynağı — bu dosya kendi kuralı
 * gereği hiçbir modülü İÇE AKTARMADIĞI için tipler burada AYRICA, elle
 * senkron tutularak inline tanımlanır, StorageContainerGroup İLE AYNI
 * desen). Nakliye'nin ZATEN VAR OLAN paylaşılan alanları (pickup konumu,
 * `deliveryProvince`/vb., `productType`/`productQuantity`/`productTonnage`/
 * `productTonnageUnit`, `workDate`/`workEndDate`) BU OBJENİN DIŞINDA kalır —
 * yalnızca YENİ, bu görevle eklenen alanlar burada.
 */
export type NakliyeVehiclePreference = {
  /** "Nakliyeci uygun aracı önersin" — true iken vehicleTypes/trailerTypes zorunlu DEĞİLDİR. */
  suggestByProvider: boolean;
  vehicleTypes?: string[];
  trailerTypes?: string[];
};

/**
 * "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi — Yükün Hazırlanış
 * Biçimi kartının içinde açılan, TAMAMEN isteğe bağlı sade bir alt kart.
 * TEK düz obje, koşullu alt alanlar (StorageContainerGroup İLE AYNI ilke) —
 * hangi alanların hangi `loadPreparationType` için anlamlı olduğu
 * nakliye-transport-catalog.ts#getMeasurementFieldGroup'ta merkezi olarak
 * tanımlanır. Eski, kaldırılmış zengin `NakliyePackagingEntry` alt-form
 * sisteminin (onlarca zorunlu-olabilen alan, tip başına ayrı kart) YERİNE
 * GEÇMEZ — bu, kasıtlı olarak çok daha küçük ve tamamen opsiyonel bir alt
 * kümedir.
 */
export type NakliyeMeasurementInfo = {
  /** "Ölçüleri bilmiyorum" — true iken diğer tüm alanlar anlamsızdır/gizlenir. */
  dimensionsUnknown?: boolean;
  /** Yalnızca "paletli" grubu — Euro/Standart seçilince widthCm/lengthCm otomatik doldurulur (kullanıcı yine de değiştirebilir). */
  palletType?: "euro" | "standart" | "ozel" | "bilinmiyor";
  widthCm?: number;
  lengthCm?: number;
  heightCm?: number;
  /** Yalnızca "roll" (rulo/bobin) grubu. */
  outerDiameterCm?: number;
  innerDiameterCm?: number;
  /** Yalnızca "drum" (varil/bidon) grubu. */
  diameterCm?: number;
  /** Yalnızca "roll" (rulo/bobin) grubu. */
  rollWidthCm?: number;
  /** Yalnızca "bulk" (dökme) grubu. */
  volumeM3?: number;
  /** Yalnızca "bale" (balya) grubu — yerleşimden (placementType) BAĞIMSIZ, ayrı bir dropdown. */
  orientation?: "yatay" | "dikey";
  /** nakliye-transport-catalog.ts#getPlacementOptionsForGroup'tan biri, ya da NAKLIYE_MANUAL_ENTRY_VALUE sentinel'i (bu durumda gerçek metin placementCustomText'tedir). "bulk"/"container" gruplarında hiç anlamlı değildir. */
  placementType?: string;
  placementCustomText?: string;
  /** Yalnızca placementType === "ust-uste" iken anlamlıdır (hangi grup olursa olsun). */
  maxStackCount?: number;
};

/**
 * ADR/Tehlikeli Madde bloğu — "Konteyner Taşıması ve ADR Bağımsız Bölümleri"
 * görevi ile SADELEŞTİRİLDİ: eski zengin alan kümesi (Alt Sınıf/İkincil
 * Tehlike, Toplam Miktar, Taşıma Şekli, Atık Niteliği, Tünel Kısıtlama Kodu,
 * Sınırlı Miktar/İstisna, İlave Güvenlik Açıklaması, SDS/MSDS dosyası) TAMAMEN
 * kaldırıldı — yeni "ADR Bilgileri" kartı yalnızca dört alan taşır: UN
 * Numarası, Resmî Taşımacılık Adı (UN kaydından OTOMATİK ve SALT OKUNUR —
 * kullanıcı elle değiştiremez, bkz. nakliye-transport-catalog.ts#
 * findAdrUnEntry), ADR Sınıfı, Ambalaj Grubu. `status` "hayir" iken TÜM diğer
 * alanlar anlamsızdır. `adrClass`, storage-container-catalog.ts#ImoClassCode
 * İLE AYNI 20 kanonik kod kümesini paylaşır — ikinci bir sınıf listesi İCAT
 * EDİLMEDİ. Bu blok YALNIZCA "4 — Tehlikeli Madde / ADR" bağımsız
 * bölümünden okunur/yazılır (bkz. nakliye-transport-fields.tsx#HazmatFields)
 * — Konteyner Taşıması'nın "Dolu Konteyner Bilgileri" alt kartı eskiden AYNI
 * bu alana yazan ikinci bir "Tehlikeli Madde/ADR var mı?" kontrolü
 * barındırıyordu, "Dolu Konteyner Bilgileri İçindeki ADR Kontrolünün
 * Kaldırılması" göreviyle BİLEREK kaldırıldı (bkz. NakliyeContainerTransport
 * üstündeki doküman) — iki ayrı/çelişebilen ADR kaydı YOKTUR, ve artık tek
 * bir yazma yeri olduğu için "senkron" diye bir kavram da yoktur. Eski (bu
 * görevden önce kaydedilmiş)
 * subsidiaryRisk/totalQuantity/carryForm/isWaste/tunnelRestrictionCode/
 * limitedQuantityException/additionalSafetyNote/sdsStorageKey değerleri
 * kanıtsız silinmez — yalnızca artık hiçbir yeni yazımda üretilmez/hiçbir
 * ekranda gösterilmez (bir sonraki düzenlemede, `nakliyeDetails` bütün obje
 * olarak yeniden yazıldığında, doğal olarak düşer).
 */
export type NakliyeHazmatDetail = {
  status: "evet" | "hayir" | "emin-degil";
  unNumber?: string;
  /** nakliye-transport-catalog.ts#findAdrUnEntry(unNumber) ile OTOMATİK doldurulur — form asla bunu elle düzenlemeye izin vermez. */
  properShippingName?: string;
  adrClass?: string;
  packingGroup?: "I" | "II" | "III" | "uygulanmaz" | "bilinmiyor";
};

/**
 * Konteyner Taşıması bloğu — "Konteyner Taşıması ve ADR Bağımsız Bölümleri"
 * göreviyle NakliyeHazmatDetail İLE AYNI üç durumlu (`status`) yapıya
 * dönüştürüldü (eskiden bu blok yalnızca varlığıyla "etkin" sayılan, ikili
 * bir kavramdı — "Emin Değilim" seçeneği YOKTU). `status` "hayir"/"emin-degil"
 * iken diğer TÜM alanlar anlamsızdır. `status` "evet" iken bile `content`/
 * `contentCustomText`/`contentDescription` YALNIZCA `loadStatus === "dolu"`
 * iken anlamlıdır — Boş seçilince bu üçü asla yeni bir yazıma dahil edilmez
 * (görev talimatı: "gizlenen eski yük içeriği ve açıklaması yeni payload'a
 * gönderilmesin"). Tehlikeli Madde/ADR durumu BURADA HİÇ TUTULMAZ — bu blok
 * `NakliyeDetails.hazmat`a hiç dokunmaz, hiç okumaz/yazmaz; ADR durumu
 * YALNIZCA bağımsız "4 — Tehlikeli Madde / ADR" bölümünden yönetilir (bkz. o
 * tipin üstündeki doküman). "Dolu Konteyner Bilgileri" alt kartı eskiden
 * kendi ADR sorusunu da barındırıyordu — "Dolu Konteyner Bilgileri İçindeki
 * ADR Kontrolünün Kaldırılması" göreviyle BİLEREK kaldırıldı.
 * Eski (bu görevden önce kaydedilmiş) direction/demurrageDeadline/
 * reeferTemperatureCelsius/hazmatImoClass/chassisNeeded/genSetNeeded
 * değerleri kanıtsız silinmez, yalnızca artık üretilmez/gösterilmez (NakliyeHazmatDetail'in
 * üstündeki AYNI "bir sonraki düzenlemede doğal olarak düşer" notu).
 */
export type NakliyeContainerTransport = {
  status: "evet" | "hayir" | "emin-degil";
  /** nakliye-transport-catalog.ts#ContainerTypeId'den biri, NAKLIYE_MANUAL_ENTRY_VALUE sentinel'i, ya da (geriye dönük okuma için) eski bir id — yalnızca status "evet" iken anlamlıdır. */
  containerType?: string;
  /** Yalnızca containerType sentinel iken anlamlıdır — gerçek serbest metin. */
  containerTypeCustomText?: string;
  loadStatus?: "dolu" | "bos";
  /** Konteyner Adedi — "Yükün Hazırlanış Biçimi: Konteyner İçinde" seçiliyse Yük Bilgileri'ndeki paylaşılan adet buraya yazılır (dedup — bkz. nakliye-transport-catalog.ts#getProductQuantityFieldConfig). */
  quantity?: number;
  /** Konteyner VE içindeki yükün toplam brüt ağırlığı — Dolu iken "Dolu Konteyner Bilgileri" alt kartında, Boş iken üst grid'de gösterilir; AYNI tek alan, asla iki kez sorulmaz. */
  grossWeightTon?: number;
  /** "Konteyner İçindeki Yük" — nakliye-transport-catalog.ts#ContainerContentId'den biri ya da NAKLIYE_MANUAL_ENTRY_VALUE. Yalnızca loadStatus "dolu" iken anlamlıdır. */
  content?: string;
  contentCustomText?: string;
  /** "Yük Açıklaması" — isteğe bağlı, yalnızca loadStatus "dolu" iken anlamlıdır. */
  contentDescription?: string;
};

/**
 * "Nakliye Alan Sadeleştirmesi" görevi (uncommitted) — Taşıma Şekli,
 * Sevkiyat Yapısı (+ tüm sefer/tekrar alt alanları), Boşaltma Yöntemi,
 * Sıcaklık Kontrollü ve Gabari Dışı/Ağır Yük TAMAMEN kaldırıldı (eski
 * `shipmentPlan`/`temperatureControl`/`oversizedLoad` blokları ve eski
 * `packaging: NakliyePackagingEntry[]` çoklu-seçim dizisi bu yüzden ARTIK
 * YOK). `loadPreparationType`/`loadPreparationCustomText` ("Yükün Hazırlanış
 * Biçimi") TEK seçimli bir dropdown'a indirgendi — nakliye-transport-
 * catalog.ts#LoadPreparationTypeId'den biri, ya da NAKLIYE_MANUAL_ENTRY_VALUE
 * sentinel'i (bu durumda gerçek metin `loadPreparationCustomText`'tedir).
 * Aşağıdaki blokların TAMAMI isteğe bağlıdır — yalnızca kullanıcının
 * GERÇEKTEN doldurduğu alanlar/bloklar dolu gelir, boş bir Nakliye ilanı
 * `nakliyeDetails: undefined` olabilir.
 */
export type NakliyeDetails = {
  /**
   * ESKİ (LEGACY) ALAN — "Nakliye Çoklu Yük Grubu" göreviyle YENİ yazımlarda
   * ARTIK KULLANILMAZ; yerini Job.nakliyeCargoGroups[] aldı (bkz. o alanın
   * üstündeki doküman). Yalnızca bu görevden ÖNCE oluşturulmuş/nakliyeCargoGroups
   * hiç eklenmemiş eski ilanların geriye dönük okunması için (nakliye-cargo-
   * groups.ts#getJobCargoGroups'un "Yük Grubu 1" sentezinde) AYAKTA tutulur —
   * kanıtsız silinmez, yalnızca artık üretilmez (NakliyeHazmatDetail'in
   * subsidiaryRisk/vb. alanlarıyla AYNI "bir sonraki düzenlemede doğal olarak
   * düşer" ilkesi).
   */
  loadPreparationType?: string;
  loadPreparationCustomText?: string;
  /** ESKİ (LEGACY) ALAN — bkz. loadPreparationType üstündeki AYNI not. "MALSEVK Nakliye Ölçü ve Yerleşim Bilgileri" görevi — bkz. NakliyeMeasurementInfo üstündeki doküman. */
  measurementInfo?: NakliyeMeasurementInfo;
  vehiclePreference?: NakliyeVehiclePreference;
  /**
   * nakliye-transport-catalog.ts#LoadingMethodId'den biri, ya da
   * NAKLIYE_MANUAL_ENTRY_VALUE sentinel'i (bu durumda gerçek metin
   * `loadingMethodCustomText`'tedir). "+ Ek yükleme koşulları"/"+ Ek
   * teslimat koşulları" panelleri (eski `loadingOperations`/
   * `unloadingOperations` blokları — Yer Tipi/Randevu/Saat/Kantar/Erişim/
   * PPE/Süre/Bekleme/POD) TAMAMEN kaldırıldığı için bu iki alan artık
   * doğrudan üst seviyede, tek başına — sarmalayan bir "loadingOperations"
   * nesnesine ihtiyaç kalmadı.
   */
  loadingMethod?: string;
  loadingMethodCustomText?: string;
  hazmat?: NakliyeHazmatDetail;
  /** ESKİ (LEGACY) ALAN — bkz. loadPreparationType üstündeki AYNI not. */
  containerTransport?: NakliyeContainerTransport;
};

/**
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — grup başına
 * BAĞIMSIZ, sade ADR bloğu. Eski job-seviyeli `NakliyeHazmatDetail`den
 * BİLEREK FARKLI/DAHA DAR: yalnızca iki durumlu (`"evet" | "hayir"`, "Emin
 * Değilim" YOK) + (Evet iken) ADR Sınıfı. UN Numarası/Resmî Taşımacılık
 * Adı/Ambalaj Grubu BİLEREK hiç YOK — görev talimatının kendi kesin kuralı
 * ("bu alanları ekleme"). Eski job-seviyeli `NakliyeDetails.hazmat` (tri-state,
 * dört alanlı) hâlâ AYAKTA — yalnızca ESKİ (bu görevden önce kaydedilmiş)
 * tek-gruplu ilanların geriye dönük okunması için (bkz. nakliye-cargo-
 * groups.ts#getJobCargoGroups'un "Yük Grubu 1" sentezi, "emin-degil"i
 * güvenli görünüm olarak "hayir"a normalize eder — ContainerToggle'ın kendi
 * tri-state→binary dönüşümüyle AYNI ilke) — yeni yazımlarda bir daha hiç
 * üretilmez.
 */
export type NakliyeCargoGroupHazmat = {
  status: "evet" | "hayir";
  /** Yalnızca status "evet" iken anlamlıdır — storage-container-catalog.ts#ImoClassCode İLE AYNI 20 kanonik kod, ya da ADR_CLASS_UNKNOWN_VALUE sentineli. */
  adrClass?: string;
};

/**
 * "Nakliye Çoklu Yük Grubu" görevi (uncommitted) — Nakliye'nin "2 — Yük
 * Bilgileri" kartı artık TEK değil, sıralı bağımsız bir "Yük Grubu" dizisi
 * taşıyabilir (ör. aynı ilanda 1 adet 40' konteyner + ayrı bir paletli yük).
 * `id`, StorageContainerGroup.id İLE AYNI ilke — yalnızca React key/hata
 * eşleştirmesi için, iş kuralı taşımaz. Her grup kendi ürün bilgisini VE
 * kendi bağımsız tehlikeli madde/ADR durumunu taşır. `productQuantity`/
 * `productTonnage`/`productType`/`productTonnageUnit` Job'un üst seviyedeki
 * AYNI adlı alanlarının Nakliye'ye özel YERİNİ TUTAR — bir Nakliye ilanı bu
 * dizi doluysa (length >= 1) artık o üst seviye alanları hiç okumaz/güvenmez
 * (bkz. nakliye-cargo-groups.ts#getJobCargoGroups TEK doğruluk kaynağı).
 *
 * "Konteyner Tetikleyicisi Ürün/Yük Cinsi'ne Taşındı" görevi — eskiden
 * konteyner dalı grubun KENDİ bağımsız Hayır/Evet sorusuyla (artık kaldırılan
 * bir UI kontrolü) seçiliyordu; artık TEK tetikleyici
 * `nakliye-transport-catalog.ts#isNakliyeContainerProductType(productType)`
 * — `productType === "Konteyner"` (büyük/küçük harf duyarsız). `containerTransport`
 * HER ZAMAN gerçek bir obje (asla undefined) ve `.status` alanı BU
 * tetikleyiciden TÜRETİLİR (kullanıcı tarafından ayrıca seçilmez) — "hayir"
 * iken normal ürün/yük alanları, "evet" iken yalnızca konteyner alanları
 * anlamlıdır. `containerTransport.grossWeightTon` ESKİ (LEGACY) bir alandır:
 * konteyner ağırlığı artık PAYLAŞILAN `productTonnage`/`productTonnageUnit`
 * üzerinden girilir (görev talimatı: "toplam tonaj alanını tekrar etmeden
 * kullan") — bu alan yeni yazımlarda bir daha hiç üretilmez, yalnızca eski
 * kayıtların geriye dönük okunması için AYAKTA tutulur.
 */
export type NakliyeCargoGroup = {
  id: string;
  productQuantity?: number;
  productTonnage?: number;
  productType?: string;
  productTonnageUnit?: "ton" | "kg";
  loadPreparationType?: string;
  loadPreparationCustomText?: string;
  measurementInfo?: NakliyeMeasurementInfo;
  containerTransport: NakliyeContainerTransport;
  hazmat?: NakliyeCargoGroupHazmat;
};

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
  /**
   * "Toplam Ağırlık" birimi — YALNIZCA Nakliye'ye özeldir (bkz.
   * product-catalog.ts#isTransportationCategory); Liman Hizmetleri kapsamındaki
   * ilanlarda bu alan HİÇ yazılmaz/okunmaz, o kategoriler eski sabit "ton"
   * gösterimini AYNEN korur (bkz. product-catalog.ts#formatProductTonnage'ın
   * ikinci parametresi — verilmezse "ton" varsayılan). Bu alandan ÖNCE
   * oluşturulmuş TÜM Nakliye ilanlarında da yoktur — yokluğu HER ZAMAN "Ton"
   * olarak yorumlanır (bkz. görev tanımı — geriye dönük uyumluluk), asla
   * `undefined`/boş gösterilmez.
   */
  productTonnageUnit?: "ton" | "kg";
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
   * yeni bir güvenlik kuralı YOKTUR — ancak "Nakliye ilan detayı görsel
   * düzenlemesi" göreviyle, Nakliye ilanlarında açık adresler artık bu
   * kapıdan BAĞIMSIZ olarak (kategori/yetki kontrolünü geçen herkese) HER
   * ZAMAN gösterilir — bkz. job-detail-content.tsx#NakliyeRouteSummary,
   * eski nakliye-route-card.tsx (SİLİNDİ) bu davranışı taşıyordu.
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
  /**
   * "Nakliye Yeniden Tasarımı" — bkz. NakliyeDetails üstündeki doküman.
   * Yalnızca product-catalog.ts#isTransportationCategory(category) true iken
   * doldurulur/gösterilir; bu alan kendi başına bir görünürlük kuralı
   * UYGULAMAZ. Bu görevden ÖNCE oluşturulmuş HER Nakliye ilanında `undefined`
   * — eski ilanlar bozulmaz, yalnızca bu yeni bloklar boş görünür.
   */
  nakliyeDetails?: NakliyeDetails;
  /**
   * "Nakliye Çoklu Yük Grubu" görevi (uncommitted) — bkz. NakliyeCargoGroup
   * üstündeki doküman. YALNIZCA isTransportationCategory(category) true iken
   * anlamlıdır. Doluysa (length >= 1) bu ilanın "Yük Bilgileri"si için TEK
   * doğruluk kaynağıdır — bu durumda üstteki productQuantity/productTonnage/
   * productType/productTonnageUnit VE nakliyeDetails.loadPreparationType/
   * measurementInfo/containerTransport artık yalnızca GERİYE DÖNÜK UYUMLULUK
   * için grup 1'in bir KOPYASI olarak yazılır (bkz. nakliye-cargo-groups.ts#
   * deriveLegacyMirrorFields) — bu sayede henüz gruplardan HABERSİZ eski
   * ekranlar/yardımcılar (job-listing-row.ts, product-catalog.ts#hasProductInfo
   * vb.) en azından ilk grubu doğru göstermeye devam eder. Bu alandan ÖNCE
   * oluşturulmuş (ya da tek grup asla eklenmemiş) TÜM Nakliye ilanlarında
   * yoktur — yokluğu bir hata durumu DEĞİLDİR; nakliye-cargo-groups.ts#
   * getJobCargoGroups bu durumda üstteki tekil alanlardan SALT OKUNUR tek
   * elemanlı bir dizi ("Yük Grubu 1") sentezler — bu sentez asla depolanan
   * job'u geriye yazmaz/mutasyona uğratmaz, kayıt yalnızca kullanıcı GERÇEKTEN
   * yeniden kaydettiğinde gerçek bir nakliyeCargoGroups kazanır.
   */
  nakliyeCargoGroups?: NakliyeCargoGroup[];
  /**
   * Geri Dönüşüm & Atık Tahliye'ye ÖZEL alan grubu — yalnızca
   * recycling-catalog.ts#isRecyclingCategory(category) true iken doldurulur;
   * diğer TÜM kategorilerde bu yedi alanın hiçbiri hiç yoktur (bkz.
   * job-store.ts#resolveRecyclingFields, Gümrük Müşavirliği'nin
   * resolveCustomsBrokerageFields'ıyla AYNI "TEK yer, kategori kapsam
   * dışıysa temizlenir" deseni). KASITLI OLARAK burada bir "işlem türü"
   * (hizmet satın alma / alım teklifi) alanı YOKTUR — MALSEVK'in temel
   * modeli bu kategoride de aynıdır, teklif her zaman normal, TEK bir toplam
   * hizmet bedeli üzerinden verilen hizmet teklifidir (bkz. offers.ts, bu
   * kategori için hiç değiştirilmedi). Bu hizmet ANAHTAR TESLİM/tek başına
   * tamamlanabilir bir hizmettir — Hizmet Alan'ın ayrıca Nakliye/Forklift/
   * Vinç ilanı oluşturması hiçbir şekilde zorunlu değildir; Hizmet Veren'in
   * kendi aracı/ekipmanı/personeli kendi operasyonel organizasyonudur.
   * recyclingMaterialCategoryId/recyclingMaterialSubtypeId/recyclingQuantity/
   * recyclingUnit/recyclingScopeOfWork her zaman zorunlu; recyclingMaterialCondition
   * zorunlu, recyclingMaterialConditionNote yalnızca recyclingMaterialCondition
   * "diger" iken anlamlıdır. Çoklu Hizmet Operasyonu'nda her hizmet kendi
   * bilgisini bağımsız taşır (bkz. job-store.ts#OperationServiceInput).
   */
  recyclingMaterialCategoryId?: string;
  /** Bkz. recyclingMaterialCategoryId üstündeki doküman — recycling-catalog.ts#RECYCLING_MATERIAL_CATEGORIES'teki ilgili kategorinin bir alt türü. */
  recyclingMaterialSubtypeId?: string;
  /** Bkz. recyclingMaterialCategoryId üstündeki doküman. Ondalıklı olabilir. */
  recyclingQuantity?: number;
  /** Bkz. recyclingMaterialCategoryId üstündeki doküman — "kg" | "ton" | "adet" | "litre" ("litre" yalnızca Geri Dönüşüm'ün kendi Miktar alanı için, bkz. recycling-catalog.ts#RecyclingUnit'in kendi dokümanı). */
  recyclingUnit?: "kg" | "ton" | "adet" | "litre";
  /** Bkz. recyclingMaterialCategoryId üstündeki doküman — "ayristirilmis" | "karisik" | "diger". */
  recyclingMaterialCondition?: "ayristirilmis" | "karisik" | "diger";
  /** Yalnızca recyclingMaterialCondition "diger" iken anlamlıdır. */
  recyclingMaterialConditionNote?: string;
  /**
   * "Hizmet Kapsamı" — recycling-catalog.ts#RECYCLING_SCOPE_OF_WORK_OPTIONS'a
   * ait id'lerin çoklu seçimi (Sahadan toplama / Yükleme / Tesisten tahliye /
   * Taşıma). Hiçbir seçenek başka bir hizmet/ilan OLUŞTURMAZ — yalnızca bu
   * TEK ilanın kapsamını, Hizmet Veren teklif vermeden önce görsün diye,
   * kaydeder (bkz. recyclingMaterialCategoryId üstündeki doküman).
   */
  recyclingScopeOfWork?: string[];
  /**
   * "MALSEVK Geri Dönüşüm Hizmetinin Uçtan Uca Geliştirilmesi" görevi —
   * recycling-catalog.ts#RecyclingRequestedOperationId'ye ait id (Atık
   * Tahliyesi/Taşıma, Geri Dönüşüm/Geri Kazanım, Bertaraf, Tahliye+Geri
   * Kazanım, Tahliye+Bertaraf). recyclingScopeOfWork (yukarıda, SAHADAKİ
   * fiziksel adımlar) İLE KARIŞTIRILMAZ — bu alan atığın NİHAİ akıbetini
   * sorar, arka planda getRequiredRecyclingActivities ile gereken faaliyet
   * yetkisine (provider_recycling_authorizations, "activity" ekseni)
   * çözümlenir.
   */
  recyclingRequestedOperation?: string;
  /**
   * "C. ATIK KODU" — recycling-waste-code-catalog.ts#WASTE_CODE_ENTRIES'e
   * ait, GERÇEK/resmî 6 haneli bir Atık Yönetimi Yönetmeliği EK-4 kodu
   * (ör. "15 01 10"). `recyclingWasteCodeUnknown` true iken bu alan
   * `undefined`dir — ikisi birbirini dışlar.
   */
  recyclingWasteCode?: string;
  /**
   * "Atık kodunu bilmiyorum" — true iken ilan normal şekilde yayımlanmaz,
   * admin incelemesine düşer (bkz. job-moderation.ts, bu alan admin'in
   * "pending_review"u normal onaya ek olarak neden beklettiğini anlamak
   * için ayrıca okunur) ve kod doğrulanana kadar uygun firma eşleştirmesi/
   * teklif verme AÇILMAZ (recycling_waste_code null olduğu için provider_can_
   * view_job'un atık-kodu dalı hiçbir zaman eşleşmez — fail-closed, sistem
   * KULLANICININ YERİNE tahmini bir kod ÜRETMEZ).
   */
  recyclingWasteCodeUnknown?: boolean;
  /**
   * "D. TEHLİKE DURUMU" — recyclingWasteCode'un KENDİSİNDEN otomatik
   * türetilir (yıldızlı kod = true), kullanıcı ASLA yazamaz/değiştiremez.
   * Sunucu tarafında da (migration) her zaman koddan yeniden hesaplanır —
   * istemciden gelen değer asla doğrudan güvenilmez (job-store.ts#
   * resolveRecyclingHazardFields).
   */
  recyclingHazardous?: boolean;
  /**
   * "E. TEHLİKELİ ATIK İÇİN EK BİLGİ" — yalnızca recyclingHazardous true
   * iken anlamlıdır. recycling-waste-code-catalog.ts#WasteHazardPropertyId
   * değerlerinin çoklu seçimi (Yanıcı/Aşındırıcı/Zehirli/Oksitleyici/
   * Reaktif/Çevreye Zararlı) — storage-hazard-catalog.ts#StorageRiskGroupId
   * İLE KARIŞTIRILMAZ, tamamen ayrı/bağımsız bir katalog.
   */
  recyclingHazardProperties?: string[];
  /**
   * "Depolanacak Ürün Bilgileri" — service-catalog.ts#isStorageGroupCategory
   * (Depo Hizmetleri grubunun 12 alt kategorisinin TAMAMI) kapsamına özel
   * dört alan. `product-catalog.ts#Job.productType/productQuantity/
   * productTonnage` (Liman Hizmetleri/Nakliye'ye özel, her zaman "adet"
   * varsayan) BİLEREK yeniden kullanılmadı — Depolama'nın esnek bir "Birim"
   * alanına (kg/ton/adet) ihtiyacı var, bu recycling-catalog.ts#RecyclingUnit
   * ile AYNI 3 sabit değer (ikinci bir birim kataloğu İCAT EDİLMEDİ).
   * `storageProductType`, product-catalog.ts#PRODUCT_TYPE_CUSTOM_VALUE
   * sentinel/ProductTypeCombobox deseninin AYNEN yeniden kullanımıdır —
   * "Listede yok, kendim gireceğim" seçildiğinde bu alana kullanıcının
   * yazdığı GERÇEK metin yazılır, sentinel asla kaydedilmez/görüntülenmez.
   * Dördü de yalnızca isStorageGroupCategory(category) kapsamındaysa
   * anlamlıdır — job-store.ts#resolveStorageProductFields kapsam dışı bir
   * kategoride hepsini `undefined`e indirger (recycling/customs alanlarıyla
   * AYNI "tek yer, kopyalanmaz" ilkesi).
   */
  storageProductType?: string;
  /** Bkz. storageProductType üstündeki doküman — zorunlu, 0dan büyük, ondalıklı olabilir. */
  storageProductQuantity?: number;
  /** Bkz. storageProductType üstündeki doküman — "kg" | "ton" | "adet", zorunlu. */
  storageProductUnit?: "kg" | "ton" | "adet";
  /** Bkz. storageProductType üstündeki doküman — isteğe bağlı, 0dan büyük. */
  storageProductTonnage?: number;
  /**
   * "Konteyner Grupları" — YALNIZCA hizmet türü "Konteyner Depolama"
   * (storage-container-catalog.ts#isContainerStorageCategory) iken
   * anlamlıdır. Tek bir ilan, farklı ölçü/tip/yük durumuna sahip BİRDEN
   * FAZLA konteyner grubunu (ör. "20 adet 20 ft Standart Boş" + "15 adet
   * 40 ft High Cube Dolu") aynı anda taşıyabilir — bu yüzden "Depolanacak
   * Ürün Bilgileri"nin (storageProductType/Quantity/Unit/Tonnage, yukarıda)
   * TEK değerli alanları BURADA YENİDEN KULLANILMAZ (tek bir grup varken
   * mümkündü, N grup varken anlamsız) — o kart bu kategori için hâlâ
   * TAMAMEN GİZLİDİR, dört alan da job-store.ts#resolveStorageProductFields
   * tarafından her zaman `undefined`e indirgenir. Toplam konteyner adedi HİÇ
   * ayrı bir alan olarak SAKLANMAZ — her zaman gruplardan TÜRETİLİR (bkz.
   * storage-container-catalog.ts#computeTotalContainerQuantity), hem
   * istemci render'ında hem (varsa) sunucu tarafı doğrulamada — istemciden
   * gelen bir "toplam" değerine asla güvenilmez çünkü öyle bir değer hiç
   * gönderilmez/kabul edilmez.
   *
   * Kategori değiştirilirse job-store.ts#resolveStorageContainerFields bu
   * alanı `undefined`e indirger (`storageProductType`/vb. ile AYNI "tek yer,
   * kopyalanmaz" ilkesi). Boş dizi ile `undefined` arasında anlam farkı
   * YOKTUR — ikisi de "hiç grup yok" demektir.
   */
  storageContainerGroups?: StorageContainerGroup[];
  /**
   * "Kimyasal Depolama / Tehlikeli Madde Depolama" görevi — storage-hazard-
   * catalog.ts#isHazardousStorageCategory kapsamındaki İKİ alt kategoriye
   * (kimyasal-depolama/tehlikeli-madde-depolama) özel iki alan. `Kimyasal
   * Depolama`da kullanıcının Hayır/Evet seçimi burada saklanır; `Tehlikeli
   * Madde Depolama`da soru hiç sorulmaz ama bu alan yine de her zaman `true`
   * yazılır (job-store.ts#resolveStorageHazardFields — ürün zaten tehlikeli
   * kabul edilir). Kapsam dışı HER kategoride (Konteyner Depolama dahil —
   * o kategori kendi `storageContainerGroups[].hazardous`ını kullanır, bu
   * alanla KARIŞTIRILMAMALI) her zaman `undefined`e indirgenir.
   */
  storageHazardous?: boolean;
  /**
   * storage-hazard-catalog.ts#StorageRiskGroupId'lerin çoklu seçimi —
   * `storageHazardous === true` iken ZORUNLU (en az bir grup), `false`/
   * kapsam dışı bir kategoride her zaman `undefined`. BİLEREK Nakliye ADR
   * kataloğundan (storage-container-catalog.ts#IMO_CLASS_OPTIONS) TAMAMEN
   * AYRI bir kod kümesi — ADR karayolu taşımacılığı sınıflandırmasıdır,
   * depolama uygunluğu deponun faaliyet kapsamına/izinlerine bağlıdır (bkz.
   * storage-hazard-catalog.ts'in kendi başlık dokümanı). Bu alanın gerektirdiği
   * depocu yetkisi provider_storage_risk_authorizations tablosunda TUTULUR —
   * provider_service_authorizations'ın kategori-seviyesi yetkisinden BAĞIMSIZ,
   * ek bir katman (bkz. migration 0068 ve app/_lib/supabase-storage-risk-
   * authorizations.ts).
   */
  storageRiskGroups?: string[];
  /**
   * DEPRECATED (2026-08-19) — bu 8 düz alan, "Konteyner Bilgileri"nin TEK
   * gruplu (tekrarlanamayan) önceki sürümünden kalmadır. Yeni kod bunlara
   * ASLA yazmaz — yalnızca storageContainerGroups'tan ÖNCE oluşturulmuş
   * (bu oturumun kendi erken test verisi de dahil) bir ilanın localStorage'da
   * hâlâ bu şekilde durması İHTİMALİNE karşı OKUNUR: storage-container-
   * catalog.ts#normalizeStorageContainerGroupsForDisplay bu sekizini TEK
   * elemanlı bir storageContainerGroups dizisine yükseltir (görev tanımı:
   * "eski tek gruplu ilanlar bozulmamalı, sessizce veri kaybına uğramamalı").
   */
  storageContainerSize?: "20" | "40" | "45";
  storageContainerType?: "standart" | "high-cube" | "reefer" | "open-top" | "tank";
  storageContainerStatus?: "dolu" | "bos";
  storageContainerHazardous?: boolean;
  storageContainerUnNumber?: string;
  storageContainerImoClass?: string;
  storageContainerReeferTemperature?: number;
  storageContainerReeferElectrical?: boolean;
  /**
   * İlan Onayı (admin moderasyonu) — bkz. job-moderation.ts, TEK ortak
   * doğruluk kaynağı. `Job.status` (yukarıdaki operasyonel yaşam döngüsü:
   * yayinda/tamamlandi/iptal) ile KASITLI OLARAK AYRI, karıştırılmaması
   * gereken bir kavram: bu alan yalnızca "bu ilan Hizmet Veren'e görünsün mü"
   * sorusuna cevap verir, hiçbir teklif/tamamlanma akışını etkilemez.
   * `undefined` (bu alan eklenmeden önce oluşturulmuş her ilan, tüm statik
   * jobs.ts seed ilanları dahil) `"approved"` ile AYNI davranır — bkz.
   * job-moderation.ts#getJobModerationStatus; geriye dönük veri kaybı/yanlış
   * gizleme YOKTUR. Yeni bir `createJob`/`createJobsForOperation` çağrısı
   * her zaman `"pending_review"` ile başlar (bkz. job-store.ts).
   */
  moderationStatus?: JobModerationStatus;
  /** Yalnızca admin en az bir kez karar verdiyse doludur (onay veya red). */
  moderationReviewedAt?: string;
  /** Kararı veren adminin `profiles.id`'si — yalnızca moderationReviewedAt doluysa anlamlıdır. */
  moderationReviewedBy?: string;
  /** Yalnızca moderationStatus "rejected" iken anlamlıdır; onaya dönerse (yeniden inceleme) bu alan temizlenir. */
  moderationRejectionReason?: string;
  /**
   * "Kritik İlan Senkronizasyonu" görevi — `createJob`/`createJobsForOperation`
   * yerel yazımı her zaman başarılı olur ve `moderationStatus`u hemen
   * `"pending_review"` yapar (yukarıda), ama bu, sunucu (Supabase) tarafında
   * GERÇEKTEN bir kayıt oluştuğu anlamına GELMEZ — `supabase-job-sync.ts`nin
   * kendi senkronu AYRI, en-iyi-çaba bir sonraki adımdır. Bu alan, o adımın
   * BAŞARISIZ olduğu anı (ISO zaman damgası) KALICI olarak işaretler —
   * eskiden bu bilgi yalnızca bir URL sorgu parametresiyle (`?senkronUyarisi=1`)
   * TAŞINIYORDU, sayfa yenilendiğinde/farklı bir ekrana geçildiğinde
   * KAYBOLUYORDU (job-requests-panel.tsx o zaman "Admin Onayı Bekleniyor"
   * göstermeye devam ederdi, ilan sunucuda hiç var olmasa bile — gerçek bir
   * kullanıcı hatasının kök nedeni). Dolu olduğu sürece `getJobModerationStatus`
   * "pending_review" yerine ayrı bir "senkronizasyon başarısız" durumunu
   * (job-requests-panel.tsx/job-detail-content.tsx'in ayrıca kontrol ettiği)
   * tetikler — asla sunucuda var olmayan bir ilan için "admin inceliyor"
   * YANILTICI mesajı gösterilmez. Yeniden deneme başarılı olduğunda
   * (retryJobSupabaseSync, supabase-job-sync.ts) temizlenir.
   */
  supabaseSyncFailedAt?: string;
  /** Bkz. supabaseSyncFailedAt — o denemenin ham hata mesajı, yalnızca hata ayıklama/kullanıcıya gösterim içindir, hiçbir mantık buna dallanmaz. */
  supabaseSyncError?: string;
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
  /**
   * "Teklifin Ticari Yönü" — YALNIZCA Geri Dönüşüm & Atık Tahliye
   * kategorisindeki ilanlara verilen tekliflerde toplanır (bkz.
   * recycling-catalog.ts#isRecyclingCategory, offer-form.tsx) —
   * estimatedDuration'ın Nakliye'ye özel olmasıyla AYNI ilke. Diğer HİÇBİR
   * kategoride bu alan yoktur (undefined) ve `amount` her zamanki gibi
   * "Hizmet Alan'ın ödeyeceği tutar" anlamına gelir. Bu alan SALT ETİKET/
   * GÖRÜNÜM amaçlıdır — mevcut ödeme altyapısı, offer status akışı,
   * accept/complete/dispute mekanizmaları BİREBİR AYNI kalır, hiçbir yeni
   * para hareketi yönü İCAT EDİLMEDİ:
   *  - "hizmet-bedeli" (varsayılan/diğer kategorilerle aynı anlam): Hizmet
   *    Alan `amount`i öder.
   *  - "atik-satin-alma": Hizmet Veren atık için `amount` teklif eder
   *    (parasal yön TERSİNE döner, ama bu SADECE görüntüleme/etiket
   *    seviyesinde bir yorumdur — `amount` yine aynı `number` alanı, yeni
   *    bir "kim kime öder" alanı/mantığı EKLENMEDİ).
   *  - "ucretsiz-alim": `amount` her zaman `0`dır, teklif formu bu durumda
   *    tutar alanını hiç göstermez.
   */
  commercialDirection?: "hizmet-bedeli" | "atik-satin-alma" | "ucretsiz-alim";
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
  /**
   * MALSEVK genel ilan gizlilik kuralı (bkz. supabase-offer-sync.ts) — bu
   * teklifin `public.offers`'taki GERÇEK karşılığının id'si. KATEGORİDEN
   * BAĞIMSIZ olarak, yalnızca sunucu senkronu (`NEXT_PUBLIC_ENABLE_SUPABASE_
   * JOB_SYNC` açıkken) en az bir kez başarılı olduysa doludur — bu alan eski
   * bir "yalnızca Nakliye" tasarımından genel bir kurala genişletildi
   * (`isSupabaseJobSyncEnabled()` tek koşuldur, kategori kontrolü YOK).
   * `createOffer`/`updateOfferStatus`/`withdrawOffer`/`recordAgreementFailure`/
   * `resolveCompletionDispute` içindeki ilgili Supabase RPC çağrısı başarılı
   * DÖNDÜKTEN SONRA yazılır — bu alan asla "iyimser" olarak önceden
   * doldurulmaz. Ayrıca `supabase-offer-reads.ts#fetchVisibleOffersFromSupabase`
   * ile cihazlar arası okunan (bu tarayıcının hiç oluşturmadığı) teklifler
   * için de doludur — orada yerel `id` ile AYNI değere ayarlanır (bkz. o
   * dosyanın dokümanı).
   */
  supabaseOfferId?: string;
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
