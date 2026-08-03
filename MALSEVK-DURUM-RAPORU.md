# MALSEVK — Admin Paneli Planlaması İçin Durum Raporu

> Bu rapor yalnızca inceleme amaçlıdır, hiçbir kod değişikliği içermez. Tüm tespitler mevcut kaynak koddan (çalışma kopyası, commit edilmemiş değişiklikler dahil) doğrudan okunarak çıkarılmıştır. Tarih: 2026-08-01.

---

## 1. KLASÖR YAPISI

`app/` altında toplam **19 `page.tsx`**, **3 `route.ts`** (API), **78 dosya** `app/_components/`, **76 dosya** `app/_lib/` altında.

```
app/
├── _components/                          (78 dosya — UI bileşenleri, "_" ön eki route dışı bırakır)
│   ├── account-settings-content.tsx
│   ├── admin-provider-document-review-panel.tsx   ← BUGÜNKÜ TEK ADMIN EKRANI
│   ├── auth-gate-notice.tsx
│   ├── button-link.tsx
│   ├── completion-countdown.tsx
│   ├── contact-info-block.tsx
│   ├── contact-visibility-settings.tsx
│   ├── customs-brokerage-fields.tsx
│   ├── demo-data-reset-panel.tsx
│   ├── dialog-shell.tsx
│   ├── final-cta-section.tsx
│   ├── guest-access-card.tsx
│   ├── header-auth-actions.tsx
│   ├── hero-section.tsx
│   ├── hero-visual-panel.tsx
│   ├── incoming-offer-card.tsx
│   ├── incoming-offer-category-section.tsx
│   ├── incoming-offers-panel.tsx
│   ├── job-card.tsx
│   ├── job-customs-document-editor.tsx
│   ├── job-customs-document-upload.tsx
│   ├── job-detail-content.tsx
│   ├── job-edit-form.tsx
│   ├── job-list.tsx
│   ├── job-listing-cards.tsx
│   ├── job-listing-filter-bar.tsx
│   ├── job-listing-screen.tsx
│   ├── job-listing-table.tsx              ← uygulamadaki TEK gerçek <table>
│   ├── job-photo-card.tsx
│   ├── job-photo-editor.tsx
│   ├── job-photo-gallery.tsx
│   ├── job-photo-upload.tsx
│   ├── job-rating-modal.tsx
│   ├── job-rating-widget.tsx
│   ├── job-request-form.tsx
│   ├── job-requests-panel.tsx
│   ├── job-thumbnail.tsx
│   ├── legal-document-content.tsx
│   ├── legal-document-modal.tsx
│   ├── login-form.tsx                     ← giriş + kayıt formu (tek bileşen)
│   ├── manual-facility-name-field.tsx
│   ├── mobile-menu.tsx
│   ├── multi-select-chips.tsx
│   ├── my-offers-panel.tsx
│   ├── nakliye-listing-route.tsx
│   ├── nakliye-location-fields.tsx
│   ├── nakliye-route-card.tsx
│   ├── notification-bell.tsx
│   ├── notifications-panel.tsx
│   ├── offer-form.tsx
│   ├── offer-outcome-panel.tsx
│   ├── offer-panel.tsx
│   ├── operation-service-tags.tsx
│   ├── operation-status-card.tsx
│   ├── panel-activity-list.tsx
│   ├── panel-quick-action-card.tsx
│   ├── panel-stat-card.tsx
│   ├── panel-summary-hizmet-alan.tsx
│   ├── panel-summary-hizmet-veren.tsx
│   ├── panel-summary.tsx
│   ├── panel-welcome-card.tsx
│   ├── product-type-combobox.tsx
│   ├── profile-info-card.tsx
│   ├── profile-menu.tsx
│   ├── profile-page-content.tsx
│   ├── provider-document-card.tsx
│   ├── provider-document-upload.tsx
│   ├── provider-job-listing.tsx
│   ├── provider-profile-editor.tsx
│   ├── provider-rating-summary-card.tsx
│   ├── role-cards-section.tsx
│   ├── searchable-select.tsx
│   ├── service-info-editor.tsx
│   ├── services-section.tsx
│   ├── site-footer.tsx
│   ├── site-header.tsx
│   ├── star-rating-input.tsx
│   └── status-badge.tsx
│
├── _data/turkey/                         (statik referans veri, pipeline dışı)
│   ├── districts.json                     (81 il için ilçeler)
│   └── provinces.json                     (81 il)
│
├── _lib/                                  (76 dosya — TÜM veri/iş mantığı katmanı)
│   ├── types.ts                           ← bkz. Bölüm 2 (tam içerik)
│   ├── session.ts / users.ts              ← kimlik/oturum (bkz. Bölüm 4)
│   ├── job-store.ts / offers.ts / jobs.ts / jobs-lookup.ts
│   ├── provider-services.ts / provider-documents.ts / provider-document-reviews.ts
│   │   / provider-document-consents.ts / provider-registration.ts / provider-profile.ts
│   ├── ratings.ts / notifications.ts / notification-reads.ts / notification-dismissals.ts
│   ├── contact-access.ts / job-visibility.ts / job-closure.ts / job-completion.ts
│   ├── job-publish-window.ts / job-location.ts / job-listing-row.ts / job-listing-filters.ts
│   ├── customs-brokerage-catalog.ts / customs-license.ts / nakliye-route.ts / product-catalog.ts
│   ├── legal-documents.ts / legal-content-{privacy,terms,kvkk}.ts / legal-consent.ts
│   ├── site-access.ts                     (site geneli şifre kapısı — kimlik sisteminden AYRI)
│   ├── db.ts                              (Neon/Drizzle — yalnızca health-check, bkz. Bölüm 3)
│   ├── local-storage.ts / photo-blob-store.ts   (alt katman depolama yardımcıları)
│   ├── reset-demo-data.ts                 (dev-only temizlik aracı)
│   ├── service-catalog.ts / turkey-locations.ts / company-type.ts / money.ts / phone.ts / ...
│   ├── *-form-validation.ts               (job/offer/register/login form doğrulamaları — saf fonksiyonlar)
│   └── use-*.ts                           (17 adet reaktif hook — useSyncExternalStore tabanlı)
│
├── admin/
│   └── page.tsx                           ← /admin — TEK sayfa, alt-route YOK
│
├── api/                                    (3 Route Handler — uygulamadaki TEK sunucu kodu)
│   ├── health/route.ts                     (DB bağlantı testi)
│   ├── job-photos/process/route.ts         (sharp ile fotoğraf işleme, stateless)
│   └── provider-documents/validate/route.ts (belge format doğrulama, stateless)
│
├── gelistirme/demo-veri-sifirla/page.tsx   (yalnızca NODE_ENV=development'ta erişilebilir)
├── giris-yap/page.tsx                       (giriş + kayıt, tek sayfa)
├── gizlilik-politikasi/page.tsx
├── hizmet-talebi-olustur/page.tsx           (Hizmet Alan ilan oluşturma formu)
├── ilanlar/
│   ├── [id]/page.tsx                        (ilan detay)
│   └── page.tsx                             (ilan listeleme — role göre farklı bileşen render eder)
├── kullanim-kosullari/page.tsx
├── kvkk-aydinlatma-metni/page.tsx
├── panel/
│   ├── bildirimler/page.tsx
│   ├── gelen-teklifler/page.tsx
│   ├── hesap-ayarlari/page.tsx
│   ├── hizmet-taleplerim/
│   │   ├── [id]/page.tsx
│   │   └── page.tsx
│   ├── profil/page.tsx
│   ├── tekliflerim/page.tsx
│   └── page.tsx                             (panel özeti/dashboard)
├── site-erisim/
│   ├── actions.ts                           (Server Action — site şifresi doğrulama)
│   ├── page.tsx
│   └── site-access-form.tsx
├── favicon.ico
├── globals.css
├── layout.tsx                                (TEK root layout — SiteHeader + main + SiteFooter)
└── page.tsx                                  (ana sayfa / landing)
```

**Not:** `app/panel/` altında ayrı bir `layout.tsx` YOK — her panel sayfası kendi `<section><div className="mx-auto max-w-… py-16">` sarmalayıcısını kendi başına yazıyor. Ortak bir "PanelShell"/"AdminShell" bileşeni hiçbir yerde yok (bkz. Bölüm 6 ve 7).

---

## 2. VERİ MODELİ (`app/_lib/types.ts`, olduğu gibi)

```typescript
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
   * iken doldurulur; diğer TÜM kategorilerde (Nakliye dahil) bu yedi alanın
   * hiçbiri hiç yoktur. customsTransactionType/customsOfficeId/
   * customsProductType her zaman zorunlu; customsRequestedServices/
   * customsGtipCode/customsDeclarationItemCount/customsContainerCount/
   * customsDocuments isteğe bağlıdır. Bu alanlardan önce oluşturulmuş ya da
   * ilgisiz bir kategoride oluşturulmuş ilanlarda hiçbiri yoktur — yokluğu
   * bir hata durumu değildir (bkz. job-store.ts#resolveCustomsBrokerageFields).
   * Çoklu Hizmet Operasyonu'nda YALNIZCA Gümrük Müşavirliği hizmet kartı bu
   * alanları taşır — kardeş ilanlara asla kopyalanmaz (bkz. görev tanımı).
   */
  customsTransactionType?: string;
  /** Bkz. customsTransactionType üstündeki doküman. customs-brokerage-catalog.ts#KOCAELI_CUSTOMS_OFFICES'e ait bir id. */
  customsOfficeId?: string;
  /** Bkz. customsTransactionType üstündeki doküman. customs-brokerage-catalog.ts#CUSTOMS_REQUESTED_SERVICE_OPTIONS'a ait id'ler — isteğe bağlı, boş seçim hiç yazılmaz (undefined). */
  customsRequestedServices?: string[];
  /** Bkz. customsTransactionType üstündeki doküman. Serbest metin (gümrüklenecek ürünün cinsi) — product-catalog.ts#Job.productType ile KARIŞTIRILMAMALI, o alan Liman Hizmetleri/Nakliye içindir, bu alan tamamen bağımsızdır. */
  customsProductType?: string;
  /** Bkz. customsTransactionType üstündeki doküman. İsteğe bağlı GTİP (Gümrük Tarife İstatistik Pozisyonu) kodu, serbest metin. */
  customsGtipCode?: string;
  /** Bkz. customsTransactionType üstündeki doküman. İsteğe bağlı, pozitif tam sayı. */
  customsDeclarationItemCount?: number;
  /** Bkz. customsTransactionType üstündeki doküman. İsteğe bağlı, pozitif tam sayı. */
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
   * dokunulmaz; ilan yalnızca "aktif" sayılmaktan çıkar. Kayıt SİLİNMEZ —
   * bu alan doluyken bile ilan, teklif geçmişi ve bildirimleri olduğu gibi
   * erişilebilir kalır. Bu alandan önce oluşturulmuş/kapatılmamış TÜM
   * ilanlarda yoktur.
   */
  closedAt?: string;
  /** Yalnızca `closedAt` doluysa anlamlıdır — seçilen kapatma nedeni, kalıcı olarak saklanır. */
  closureReason?: JobClosureReason;
  /**
   * Nakliye Güzergâh Yönetimi — "Teslim Edilecek Yer" (delivery). Yalnızca
   * product-catalog.ts#isTransportationCategory(category) true iken doldurulur;
   * diğer TÜM kategorilerde (Nakliye dışında) bu altı alanın hiçbiri hiç
   * yoktur (bkz. job-store.ts#resolveDeliveryLocationFields). "Yük Alınacak
   * Yer" (pickup) İÇİN AYRI bir alan grubu YOKTUR — yukarıdaki
   * province/district/workLocationType/facilityId/addressText/locationMode
   * alanları Nakliye ilanlarında pickup'ın kendisidir (bkz. nakliye-route.ts).
   * `deliveryLocationType` "facility" ise deliveryFacilityId/deliveryFacilityName
   * doludur, deliveryAddressText yoktur; "open_address" ise tam tersi.
   * deliveryAddressText, job.addressText ile AYNI gizlilik kapısını
   * (job-requests.ts#canViewJobAddress) kullanır.
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
 * geçişlerin hiçbirinde değişmez. "pending" durumundaki bir teklif, Hizmet
 * Alan henüz karar vermeden Hizmet Veren tarafından "withdrawn"a taşınabilir
 * (bkz. offers.ts#withdrawOffer).
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
   * "Tamamlanması Taahhüt Edilen Gün" — yeni teklifler her zaman `number`
   * (1-60 arası, bkz. offers.ts#createOffer'ın doğrulaması) olarak saklar;
   * eski kayıtlar `string` olarak okunmaya devam eder. Görüntüleme tarafı
   * her zaman offers.ts#formatCommittedDays üzerinden okunmalı.
   */
  estimatedDuration: string | number;
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
   * olan (ya da olmuş) tekliflerde bulunur.
   */
  completionRequestedByUserId?: string;
  /**
   * `requestCompletion` çağrıldığı an kaydedilir — 7 günlük otomatik
   * tamamlanma sayacının ve geri sayım UI'ının tek doğruluk kaynağı (bkz.
   * offers.ts#COMPLETION_AUTO_APPROVE_DAYS/applyExpiredCompletionAutoApprovals).
   */
  completionRequestedAt?: string;
  /**
   * true ise bu teklif, Hizmet Alan hiç onaylamadan 7 gün dolduğu için
   * sistem tarafından otomatik "completed" yapılmıştır. Yalnızca bu durumda
   * puanlama penceresi 30 günle sınırlıdır (bkz. ratings.ts).
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
```

`StoredUser`/`RegisterInput`/`LoginResult`/`RegisterResult`/`StoredProviderDocument`/`StoredProviderDocumentReview` gibi diğer önemli tipler bu dosyada değil, ilgili modüllerinde (`users.ts`, `provider-documents.ts`, `provider-document-reviews.ts`) tanımlı — bkz. Bölüm 3.

---

## 3. VERİ KATMANI

### Veri şu an nerede tutuluyor?

**Gerçek/kalıcı sunucu tarafı veri YOK.** Üç depolama mekanizması var, üçü de istemci (tarayıcı) tarafında:

| Mekanizma | Ne için kullanılıyor |
|---|---|
| **localStorage** | Neredeyse her şey: kullanıcılar, ilanlar, teklifler, oturum, hizmet-veren belgeleri/onay durumu, rıza kayıtları, puanlar, bildirim okundu/kapatıldı durumu, son görüntülenenler, site-şifre çerezi (bu ayrı, aşağıda) |
| **IndexedDB** (`photo-blob-store.ts`) | İlan fotoğrafları, sağlayıcı logosu, Gümrük Müşavirliği destekleyici evrakları — localStorage'ın ~5-10MB kotası büyük dosyalar için yetersiz olduğundan |
| **Cookie** (`malsevk_site_access`) | Yalnızca `proxy.ts`'in site-geneli şifre kapısı için — uygulamanın kullanıcı oturumundan tamamen bağımsız, prodüksiyonda Vercel Hobby dağıtımını halka kapatan geçici bir katman |

İki Route Handler (`job-photos/process`, `provider-documents/validate`) **stateless** — hiçbir şeyi diskte/DB'de saklamaz, yalnızca işleyip client'a geri döner.

### Store/repository dosyaları

`app/_lib/` altında, her biri kendi localStorage anahtarını yöneten, modül-önbellek + `useSyncExternalStore` desenini paylaşan "tablo" modülleri:

| Dosya | Ne yapıyor |
|---|---|
| `local-storage.ts` | En alt katman: `readJson`/`writeJson`/`removeItem` — try/catch + `console.error`, yazma başarısını `boolean` döner (sessizce yutmaz) |
| `session.ts` | Aktif oturum (`{id,name,role}`) — `malsevk.session.v1` anahtarı |
| `users.ts` | Kullanıcı "tablosu": kayıt, giriş (şifre doğrulama), profil güncelleme, dev-seed hesaplar |
| `job-store.ts` | İlan "tablosu": oluşturma (tekli/çoklu-hizmet), güncelleme, silme, fotoğraf/konum/gümrük/nakliye alanlarının çözümlenmesi |
| `offers.ts` | Teklif "tablosu": oluşturma, durum geçişleri, kapasite/tamamlama/itiraz iş kuralları |
| `jobs.ts` / `jobs-lookup.ts` | Statik örnek ilanlar (bellek içi dizi, localStorage'a hiç yazılmaz) + iki kaynağı (statik + kullanıcı ilanları) birleştiren ortak arama |
| `provider-services.ts` | Sağlayıcının seçtiği hizmet kategorileri (ilişkisel `{userId, serviceCategoryId}` tablosu) |
| `provider-documents.ts` / `provider-document-reviews.ts` | Belge metadatası (denormalize durum) + admin inceleme geçmişi (append-only log) — **bugünkü tek admin özelliğinin veri katmanı** |
| `provider-document-consents.ts` | Beyan/rıza onayları |
| `provider-registration.ts` | Hizmet-veren kaydını 4 tabloya (users+services+documents+consents) "hepsi ya da hiçbiri" şeklinde yazan orkestratör |
| `ratings.ts` | Puanlar |
| `notifications.ts` | Bildirimler — **saklanmıyor**, her render'da `Offer`/`Job` durumundan CANLI türetiliyor |
| `notification-reads.ts` / `notification-dismissals.ts` | Bildirim okundu/kapatıldı bayrakları (ayrı localStorage anahtarları) |
| `recently-viewed-jobs.ts` | Son görüntülenen ilanlar |
| `legal-consent.ts` | Yasal metin onay kayıtları (Supabase şemasına 1:1 map edilecek şekilde tasarlanmış ama bugün localStorage) |
| `site-access.ts` | Site-geneli şifre kapısı token üretimi/doğrulaması (cookie tabanlı, kullanıcı sistemiyle ilgisiz) |
| `photo-blob-store.ts` | IndexedDB blob deposu (fotoğraf/logo/evrak dosyalarının kendisi) |
| `reset-demo-data.ts` | Yalnızca dev ortamda, seed hesapların işlemsel verisini temizleyen araç |

### Supabase veya başka bir veritabanı bağlı mı?

**Hayır — bugün hiçbir gerçek veritabanı bağlantısı iş akışlarına dahil değil:**

- `app/_lib/db.ts` + `drizzle.config.ts`: Neon (Postgres) için lazy bir client kurulumu var, ama **tek tüketicisi** `app/api/health/route.ts` — yalnızca `SELECT 1` çalıştırıp bağlantıyı test ediyor. Hiçbir kullanıcı/ilan/teklif verisi buradan okunmuyor/yazılmıyor. `DATABASE_URL` tanımlı değilse bu route 503 döner, geri kalan uygulama etkilenmez.
- `docs/database/` + `supabase/migrations/0001-0020`: Gelecekte localStorage/IndexedDB katmanının yerini alması tasarlanan **çok kapsamlı ama tamamen taslak** bir Supabase/Postgres şeması (RLS + `SECURITY DEFINER` RPC'ler, bildirimler için gerçek tablo, vb.) — **hiçbir gerçek Supabase projesine hiç uygulanmamış**, mevcut hiçbir özelliğin davranışını değiştirmiyor.
- `docs/database/future-migrations/phase2/` (admin RBAC + abonelik/kota) ve `phase3/` (ödeme): Faz 1'in bile ötesinde, ayrıca taslak, `supabase/migrations/` klasörünün DIŞINDA tutuluyor ki `supabase db push` bunları asla otomatik uygulamasın.

**Admin paneli planlaması için kritik sonuç:** Bugün canlıda (prod'da) `admin` rolü için bırakın ince yetkilendirmeyi, **kullanıcılar arasında paylaşılan hiçbir veri yok** — bkz. Bölüm 7, madde 1.

---

## 4. KİMLİK VE ROL

### Giriş sistemi nasıl çalışıyor?

- Tek bir istemci bileşeni (`login-form.tsx`) hem giriş hem kayıt modunu yönetiyor.
- **Giriş:** `users.ts#verifyLogin(email, password)` — girilen şifre tarayıcının `crypto.subtle.digest("SHA-256", ...)` fonksiyonuyla **tuzsuz (unsalted)** hash'lenip, e-postası eşleşen `StoredUser` kaydının localStorage'daki hash'iyle karşılaştırılıyor. Eşleşirse `session.ts#setSession({id, name, role})` çağrılıyor — bu, ayrı bir localStorage anahtarına (`malsevk.session.v1`) küçük bir JSON nesnesi yazmaktan ibaret. **Sunucu tarafında hiçbir oturum/JWT/cookie yok** (site-geneli şifre kapısının cookie'si bundan tamamen ayrı, bkz. Bölüm 3).
- **Kayıt:** `hizmet-alan` doğrudan `users.ts#registerUser`; `hizmet-veren` ayrı bir yoldan (`provider-registration.ts#registerProviderAccount`) geçiyor çünkü ek olarak hizmet kategorisi seçimi + 1'den fazla "Faaliyet Belgesi" yüklemesi + beyan onayı topluyor (KYC-lite kapı).
- `use-session.ts#useSession()` — her bileşenin oturumu okumak için kullandığı `useSyncExternalStore` hook'u; `getServerSnapshot` her zaman `null` (SSR güvenliği).
- Parola hash'leme dosyanın kendi yorumunda "dev-only stand-in, üretim kalitesinde kimlik doğrulama DEĞİL" olarak işaretli.

### Şu an hangi roller var?

`types.ts#UserRole = "hizmet-alan" | "hizmet-veren" | "admin"` — **üç rol:**

1. **`hizmet-alan`** — hizmet talep eden, ilan açan taraf.
2. **`hizmet-veren`** — hizmet sunan, teklif veren taraf.
3. **`admin`** — **kayıt formunda hiçbir zaman seçenek olarak sunulmuyor**, kendi kaydını oluşturamaz. Bugün **tek** oluşturulma yolu: `users.ts#DEV_ACCOUNTS` içindeki "Admin Kullanıcı" hesabı, `seedDevAccountsIfNeeded()` ile, **yalnızca `NODE_ENV === "development"` iken** oluşturuluyor. **Prodüksiyonda admin hesabı oluşturmanın hiçbir yolu yok** (bkz. Bölüm 7, madde 3).

### Rol kontrolü nerede yapılıyor?

**Merkezi bir kapıdan geçmiyor — sayfa/bileşen bazında tekrarlanıyor:**

- `proxy.ts` (Next.js middleware) yalnızca **rolle ilgisi olmayan**, site-geneli şifre kapısını uyguluyor (prod'da, tüm route'lar için) — hangi role hangi sayfanın açık olduğuna dair hiçbir mantık içermiyor.
- Rol bazlı erişim, her ekranın **kendi içinde** `useSession()` okuyup, rol uymuyorsa ortak `auth-gate-notice.tsx#AuthGateNotice` bileşenini render etmesiyle sağlanıyor. Bu deseni kullanan **13 farklı bileşen** var (`admin-provider-document-review-panel.tsx`, `job-request-form.tsx`, `offer-panel.tsx`, `my-offers-panel.tsx`, `incoming-offers-panel.tsx`, `job-requests-panel.tsx`, `job-edit-form.tsx`, `panel-summary.tsx`, `profile-page-content.tsx`, `notifications-panel.tsx`, `account-settings-content.tsx`, `guest-access-card.tsx`, vb.) — her biri kendi `if (session.role !== "...") return <AuthGateNotice .../>` satırını kendi başına yazıyor, **ortak bir route-guard/HOC/layout yok**.
- Admin özelinde: `admin-provider-document-review-panel.tsx:321` içinde `session.role !== "admin"` kontrolü var; ayrıca veri katmanında **ikinci bir bağımsız kontrol** de var — `provider-document-reviews.ts:78`'de `recordProviderDocumentReview` fonksiyonu `session.role !== "admin"` kontrolünü **kendisi de** yapıyor (yalnızca UI'a değil, "yazma" işlemine güvenmeyen bir ikinci katman).
- **Önemli sınırlama:** Bu kontrollerin tamamı, istemci tarafındaki `localStorage`'dan okunan bir `session` nesnesine güveniyor. Sunucu tarafında bunu doğrulayan hiçbir mekanizma yok (çünkü sunucu tarafı oturum kavramı hiç yok) — teknik olarak yetkin bir kullanıcı kendi tarayıcı konsolundan `session.role`'ü `"admin"` yapıp admin ekranına ulaşabilir. Bu, kod tabanında bilinçli/dokümante edilmiş bir sınırlama, ama gerçek bir admin paneli için tek başına yeterli bir güvenlik sınırı değil.
- `app/admin/page.tsx`'in kendisi **sunucu tarafında hiçbir yetki kontrolü yapmıyor** — sayfa HTML'i herkese aynı şekilde serveden geliyor, yetki kontrolü tamamen `AdminProviderDocumentReviewPanel` istemci bileşeninin içinde, ilk render'da gerçekleşiyor.

---

## 5. MEVCUT SAYFALAR

### Herkese açık (giriş gerektirmeyen) sayfalar

| Route | İçerik |
|---|---|
| `/` | Ana sayfa (hero, roller, hizmetler bölümü, final CTA) |
| `/ilanlar` | İlan listeleme — role göre **farklı bileşen** render eder: misafir/hizmet-alan → `JobList`/`JobCard`; hizmet-veren → `ProviderJobListing` (filtre araç çubuğu, masaüstü tablo/mobil kart) |
| `/ilanlar/[id]` | İlan detay (herkese açık, adres/iletişim bilgisi ayrıca gizli — Bölüm 2'deki alan notlarına bkz.) |
| `/giris-yap` | Giriş + kayıt (tek sayfa, mod query param ile: `?mode=kayit`) |
| `/gizlilik-politikasi`, `/kullanim-kosullari`, `/kvkk-aydinlatma-metni` | Yasal metinler (bağımsız sayfa + footer modalı, aynı içerik) |
| `/hizmet-talebi-olustur` | İlan oluşturma formu — sayfa herkese açık ama form yalnızca `hizmet-alan` oturumu için render oluyor (`AuthGateNotice` diğerlerinde) |
| `/site-erisim` | Yalnızca prod'da devrede olan site-geneli şifre ekranı |

### `/panel` altında (giriş gerektiren, role göre içerik değişen)

| Route | İçerik |
|---|---|
| `/panel` | Panel özeti/dashboard (`PanelSummary` — role göre `PanelSummaryHizmetAlan`/`PanelSummaryHizmetVeren`) |
| `/panel/hizmet-taleplerim` | Hizmet Alan'ın kendi ilanları (Aktif/Devam Eden/Süresi Dolan/Kapatılan/Tamamlanan sekmeleri) |
| `/panel/hizmet-taleplerim/[id]` | Tek bir ilanın düzenleme sayfası |
| `/panel/gelen-teklifler` | Hizmet Alan'ın gelen teklifleri (kategori → ilan → teklif hiyerarşisi) |
| `/panel/tekliflerim` | Hizmet Veren'in verdiği teklifler (Aktif/Devam Eden/Tamamlanan/Kapanan sekmeleri) |
| `/panel/profil` | Hizmet Veren'in "Hizmet Bilgilerim" tamamlama akışı |
| `/panel/hesap-ayarlari` | Firma profili, iletişim görünürlüğü tercihleri, demo veri sıfırlama paneli (dev-only) |
| `/panel/bildirimler` | Bildirim listesi (canlı türetilen) |

### Admin'e özel bir şey var mı?

**Evet ama tek bir sayfa, tek bir bileşen:** `/admin` → `AdminProviderDocumentReviewPanel` (373 satır). Alt-route yok, ayrı bir admin layout/menü/sidebar yok. Bugünkü tek yetenek: **Hizmet Veren belge kontrolü**:

- Belgesi olan her `hizmet-veren`'i (en son yüklemeye göre sıralı) listeler.
- Seçtiği hizmetleri, beyan onay durumunu ve her belgeyi (Görüntüle/İndir, doğrudan IndexedDB'den) gösterir.
- Onayla / Reddet / Yeniden Belge İste aksiyonları (`provider-document-reviews.ts#recordProviderDocumentReview`).
- İki bağımsız bölüm: genel Faaliyet Belgesi listesi + Gümrük Müşavirliği Belgeleri listesi (aynı tablo, `documentType` alanına göre ayrılmış).
- **Arama, filtre veya sayfalama YOK** — `getAllProviderDocuments()`/`getAllUsers()` doğrudan, tam liste olarak okunuyor.

Ayrıca `/gelistirme/demo-veri-sifirla` var ama bu **admin'e özel değil** — yalnızca `NODE_ENV === "development"` kontrolü yapıyor (`notFound()` prod'da), rol kontrolü yok; herhangi bir dev ortamı kullanıcısı erişebiliyor.

---

## 6. ORTAK BİLEŞENLER

### Gerçekten genel/tekrar kullanılan bileşenler (`app/_components/`)

| Bileşen | Ne işe yarıyor | Nerede kullanılıyor |
|---|---|---|
| `dialog-shell.tsx` | Uygulamadaki **tek** modal kabuğu (`size: "md" \| "lg"`, ESC/backdrop-click/focus tutarlı) | `job-rating-modal.tsx`, `offer-outcome-panel.tsx`, `legal-document-modal.tsx` |
| `searchable-select.tsx` | Uygulamadaki **tek** arama+seçim (dropdown) bileşeni | Form alanları (il/ilçe/tesis/kategori) + filtre araç çubuğu (`compact` varyantıyla) |
| `status-badge.tsx` | Durum rozeti (ilan/teklif status chip'i) | Birçok panel/kart bileşeni |
| `auth-gate-notice.tsx` | "Giriş yapmalısınız / bu sayfa yalnızca X içindir" kutusu | 13 farklı ekran (bkz. Bölüm 4) |
| `button-link.tsx` | Stilize link/buton varyantları | Genel |
| `multi-select-chips.tsx` | Çoklu seçim chip girişi | Hizmet özellikleri, kategori seçimleri |
| `star-rating-input.tsx` | 1-5 yıldız girişi | `job-rating-modal.tsx` |
| `job-thumbnail.tsx` | Küçük fotoğraf önizlemesi | `job-card.tsx`, ilan listeleme tablo/kart |
| `panel-stat-card.tsx` / `panel-quick-action-card.tsx` | Dashboard istatistik/kısayol kutuları | `panel-summary-hizmet-alan.tsx` / `panel-summary-hizmet-veren.tsx` |
| `mobile-menu.tsx` / `profile-menu.tsx` / `notification-bell.tsx` | Header navigasyon parçaları | `site-header.tsx` |
| `provider-document-card.tsx` | Tek bir belgenin kart görünümü | `provider-document-upload.tsx` **ve** `admin-provider-document-review-panel.tsx` (admin panelinin şu an tek "paylaşılan" alt-bileşeni) |

### Kesinlikle genel OLMAYAN, tek ekrana özel bileşenler

- **`job-listing-table.tsx` / `job-listing-cards.tsx`** — uygulamadaki **tek** gerçek `<table>`/kart-liste düzeni, tamamen Hizmet Veren "Aktif İlanlar" ekranının 7 sütununa (Fotoğraf/Hizmet Türü/İlan Başlığı/Firma-Bölge-Konum/İş Tarihi/Teklif Sayısı/İşlem) göre hardcode edilmiş. **Genel bir "DataTable" bileşeni değil** — admin paneli için kullanıcı/ilan/teklif listeleri gerekiyorsa sıfırdan yazılması gerekir.
- `incoming-offer-card.tsx`, `my-offers-panel.tsx`, `job-requests-panel.tsx`, `job-detail-content.tsx`, `job-request-form.tsx`, `job-edit-form.tsx`, `provider-job-listing.tsx` vb. — hepsi kendi ekranına özel, başka bir bağlamda yeniden kullanılabilir şekilde tasarlanmamış.
- `admin-provider-document-review-panel.tsx`'in kendisi **tek parça (373 satır)** — genel/tekrar kullanılabilir bir "AdminTable"/"AdminSection" alt-bileşeni çıkarılmamış.

### Eksik olan (henüz hiç yok) ortak bileşenler

- Genel bir **DataTable** (sıralama/sayfalama/arama destekli) yok.
- Genel bir **Pagination** bileşeni yok.
- Genel bir **onay diyaloğu** (confirm dialog) yok — her ekran kendi özel modalını yazıyor (`DialogShell` üzerine, ama tekrar kullanılabilir bir "ConfirmDialog" sarmalayıcısı olarak çıkarılmamış).
- **Toast/bildirim** (işlem başarılı/başarısız anlık mesajı) bileşeni yok — hatalar genelde satır-içi metin olarak gösteriliyor.
- Panel/Admin için ortak bir **layout/sidebar/shell** yok (bkz. Bölüm 1'deki not).

---

## 7. EKSİKLER

### 1. (En kritik, mimari) — Gerçek/paylaşılan bir veritabanı yok

Bugün **tüm veri** (kullanıcılar, ilanlar, teklifler, belgeler, puanlar, bildirim durumu) her kullanıcının **kendi tarayıcısının** localStorage/IndexedDB'sinde tutuluyor; sunucu tarafında kalıcı hiçbir veri yok (`db.ts` yalnızca bir health-check bağlantısı, hiçbir iş akışına bağlı değil — Bölüm 3).

**Admin paneli için doğrudan sonucu:** Bugünkü `/admin` sayfası yalnızca **admin'in kendi tarayıcısında zaten var olan** kullanıcı/belge verisini görebiliyor. Bu bugün "çalışıyor" görünüyor çünkü geliştirme modunda (`NODE_ENV=development`) tüm dev-seed hesaplar (Zeynep, Mert, Mehmet Demir, Nakliye Demo, Ahmet Yılmaz, Admin Kullanıcı) **aynı tarayıcıda** oluşturuluyor. Prodüksiyonda:

- (a) admin hesabı oluşturmanın hiçbir yolu yok (dev-seed kapalı, kayıt formunda admin seçeneği yok),
- (b) bir admin hesabı olsa bile, **başka bir kullanıcının kendi cihazında** oluşturduğu ilan/teklif/belgeyi **hiçbir zaman göremez** — çünkü o veri sunucuya hiç ulaşmıyor.

Gerçek/çok-kullanıcılı bir admin paneli, `docs/database/` altında taslak duran Supabase/Postgres şemasının (`supabase/migrations/0001-0020`) **gerçekten bir Supabase projesine uygulanmasını** ön koşul olarak gerektiriyor — bu bugüne kadar hiç yapılmamış.

### 2. Admin RBAC / ince yetkilendirme yok

Bugün tek, düz bir `admin` rolü var — "hepsi ya da hiçbiri" (yalnızca belge inceleme yeteneğiyle sınırlı). `docs/database/future-migrations/phase2/` altında ince taneli rol/izin modeli tasarlanmış (`super_admin`, `document_officer`, `finance_officer`, `support_officer`, `operations_officer` + `has_admin_permission(code)`) ama bu da yalnızca taslak SQL, hiçbir yere uygulanmamış.

### 3. Admin paneli bugün tek yetenek sunuyor: belge inceleme

Faz 1 taslağının (`docs/database/admin-permissions.md`) listelediği şu ihtiyaçların **hiçbiri** bugünkü gerçek uygulamada yok — hepsi yalnızca taslak view/RPC olarak var:

- Kullanıcıları görüntüleme/askıya alma (`admin_user_list`, `suspend_user`)
- İlanları görüntüleme/kapatma (`admin_job_list`, `close_job_as_admin`)
- Teklifleri görüntüleme (`admin_offer_list`)
- Şikâyet/itiraz kayıtlarını inceleme (`admin_dispute_queue`)
- Audit log görüntüleme (`admin_audit_log_search`)
- Ödeme/finans, raporlama (Faz 3, ayrıca daha da taslak)

### 4. Admin ekranında arama/filtre/sayfalama yok

`admin-provider-document-review-panel.tsx` tüm sağlayıcıları ve belgeleri **tek seferde, filtresiz/sayfalamasız** listeliyor. Veri arttıkça ölçeklenmeyecek.

### 5. Rol kontrolü tek bir merkezi kapıdan geçmiyor

Her ekran kendi `useSession()`'ını okuyup kendi `AuthGateNotice`'ını render ediyor (Bölüm 4). Büyüyecek bir admin alanı (`/admin/*` altında çoklu alt-sayfa) için merkezi bir route-guard/layout yok — her yeni admin sayfası aynı deseni kendi başına tekrarlamak zorunda kalacak.

### 6. Yetkilendirme yalnızca istemci tarafında doğrulanan bir oturuma dayanıyor

Sunucu tarafında hiçbir doğrulama yok (Bölüm 4) — bu, kod tabanında bilinçli olarak "kabul edilen risk" şeklinde dokümante edilmiş, ama gerçek bir admin paneli prodüksiyona çıkacaksa tek başına yeterli değil.

### 7. Genel/tekrar kullanılabilir admin UI bileşenleri henüz yok

DataTable, Pagination, ConfirmDialog, Toast gibi bileşenler yok (Bölüm 6) — yeni bir admin paneli muhtemelen bunları sıfırdan gerektirecek (`DialogShell` zaten var ve yeniden kullanılabilir; `provider-document-card.tsx` kısmen paylaşılıyor).

### 8. Yasal metinlerde doldurulmamış yer tutucular var

`[Şirket Unvanı]`, `[Şirket Adresi]`, `[MERSİS Numarası]`, `[Başvuru E-posta Adresi]` (`legal-content-*.ts`) — prodüksiyona çıkmadan önce doldurulması ve hukuki incelemeden geçmesi gerekiyor. Admin panelinin kendisiyle doğrudan ilgili değil ama genel durumun bir parçası.

### 9. Kod içinde literal TODO/FIXME işareti yok

`app/` altında arama yapıldı — hiçbir `TODO`/`FIXME` yorumu bulunamadı. "Yarım kalmış" işler yorum satırlarında değil, yukarıdaki **mimari/kapsam eksiklikleri** olarak duruyor; bu da planlamanın kod içi işaretlerden değil, doğrudan mimariyi okumaktan çıkması gerektiği anlamına geliyor (bu rapor bunu yapmaya çalıştı).

---

*Rapor sonu — hiçbir dosya değiştirilmedi.*
