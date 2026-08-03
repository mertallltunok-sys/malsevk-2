# Supabase Migration Validation — Faz 1 Ön-Uygulama Analizi

> **Kapsam ve yöntem notu:** Bu belge, `supabase/migrations/0001`–`0020` ve `docs/database/*.md` altındaki taslak tasarımı, gerçek uygulama kaynak kodu (`app/_lib/**`, ilgili bileşenler) ile satır satır karşılaştıran bir **statik inceleme**dir. Hiçbir migration Supabase'e uygulanmadı, hiçbir SQL çalıştırılmadı, hiçbir bağlantı kurulmadı. Bulgular iki bağımsız kaynaktan (gerçek kod dosyaları ve gerçek SQL dosyaları) doğrudan okunarak çıkarılmış, ardından çapraz doğrulanmıştır — bir alanın "kullanıldığı" hiçbir yerde söylenmemiştir, koddan doğrudan görülmediyse. Taslak dokümanların kendi iddiaları (ör. "X zaten Y dosyasında var") ayrı ayrı, ilgili dosya gerçekten okunarak doğrulandı; doğrulanamayan hiçbir iddia "doğru" kabul edilmedi, "doğrulanmadı" olarak işaretlendi. Tarih: 2026-08-03.
>
> **GÜNCELLEME (2026-08-03, aynı gün — ikinci geçiş):** §20'de listelenen 11 düzeltme maddesinin TAMAMI `supabase/migrations/0001`–`0021` dosyalarına uygulandı (0021 yeni eklendi — `contact_messages`). Bu ikinci geçiş de yalnızca statik bir düzenleme + yeniden-doğrulamadır — **hiçbir SQL çalıştırılmadı, Supabase'e hâlâ hiçbir bağlantı kurulmadı**. Ayrıntılar için bkz. yeni eklenen "Uygulanan Migration Düzeltmeleri" bölümü (§20'den hemen sonra) ve §19/§20'deki her maddenin yanına eklenen durum etiketleri (✅ Çözüldü / ⚠️ Kısmen Çözüldü / ❌ Açık Kaldı). §2'deki karar (B) bu düzeltmelerin doğru uygulandığı varsayımıyla değil, aşağıdaki somut değişikliklerin kendisiyle güncellenmiştir — ama gerçek bir `supabase db reset` dry-run'ı hâlâ yapılmadı, bu yüzden "B" kararının koşulu (bkz. §2'nin son paragrafı) hâlâ geçerlidir.
>
> **GÜNCELLEME (2026-08-03, üçüncü geçiş — GERÇEK yerel dry-run tamamlandı):** Tamamen izole, yerel bir Docker + Supabase CLI ortamına karşı gerçek bir `supabase db reset` çalıştırıldı (hâlâ hiçbir uzak/hosted Supabase projesine bağlanılmadı). Bu, statik incelemenin yakalayamayacağı **4 gerçek, çalıştırma-zamanı hatası** buldu — 8 fonksiyonda plpgsql'in "record variable INTO listesinde tek başına olmalı" kuralı ihlali (0015), `storage.buckets`/`storage.objects` üzerinde sahiplik gerektiren iki ifade (0019, hosted'da da aynı şekilde başarısız olurdu), ve en önemlisi **`jobs`/`profiles`/`provider_profiles` tablolarında eksik bir `revoke all`** yüzünden `anon`/`authenticated`'in RLS'e hiç tabi olmayan `TRUNCATE` yetkisine sahip olduğu gerçek bir yetki sızıntısı (0003, 0004) — üçü de düzeltildi, iki ayrı ardışık `supabase db reset` ile (idempotency dahil) hatasız doğrulandı, 9/9 negatif güvenlik testi + 1 pozitif kontrol çalıştırıldı. Tam ayrıntı için bkz. "Yerel Migration Dry-Run Sonucu" bölümü (§20'nin düzeltmeler bölümünden hemen sonra, §21'den önce).

---

## 1. Yönetici Özeti

`supabase/migrations/0001`–`0020` taslağı, kendi içinde şaşırtıcı derecede olgun bir tasarım: dosyaların büyük bölümü zaten "önceki bir teknik denetim raporu"nun bulgularına atıfla yazılmış düzeltmeler içeriyor (ör. `offers_one_settled_per_job` unique index, view'lara eksik GRANT'ların eklenmesi, `close_job()`'daki compare-and-set düzeltmesi, son admin'in kaybolmasının engellenmesi). Migrationlar arası çapraz referanslar (bir dosyanın başka bir dosyada var olduğunu varsaydığı constraint'ler) bu incelemede tek tek dosya içeriği okunarak doğrulandı ve büyük çoğunluğu **gerçekten doğru** çıktı.

Ancak kod ile SQL'i satır satır karşılaştırdığımda, taslağın hiç çalıştırılmamış olmasının doğal sonucu olan, somut ve **ilk uygulamada gerçek hata üretecek** en az beş bağımsız sorun bulundu:

1. `offers.estimated_duration` SQL'de her teklif için **zorunlu (NOT NULL), 2–100 karakter serbest metin** olarak modellenmiş ve `create_offer()` RPC'si bunu zorunlu bir metin parametresi olarak alıyor — ama gerçek uygulama bunu artık yalnızca **Nakliye kategorisinde, opsiyonel bir 1–60 arası SAYI** olarak topluyor ve Nakliye-dışı her teklifte bu alanı hiç yazmıyor (`undefined`). Nakliye dışındaki (yani kategori kataloğunun büyük çoğunluğunu oluşturan) her teklif oluşturma çağrısı bu haliyle NOT NULL ihlaline çarpar.
2. `public.profiles` ve `public.provider_profiles` tablolarına, 20 dosyanın HİÇBİRİNDE bir `GRANT SELECT` verilmiyor — RLS politikaları (`profiles_select_own_or_admin` vb.) var ama tablo-seviyesi SELECT izni hiç yok; bu iki katman birbirinden bağımsızdır ve izin olmadan RLS'in hiçbir önemi kalmaz. Sonuç: `authenticated` bir kullanıcı kendi profilini bile okuyamaz.
3. `offers.currency` CHECK kısıtı yalnızca `('TRY','USD')` kabul ediyor; ama `money.ts#CURRENCY_VALUES` (uygulamanın tek doğruluk kaynağı) `'EUR'`yu da geçerli ve aktif kullanılan bir para birimi olarak listeliyor. EUR ile verilen bir teklif reddedilir.
4. `0020_seed_reference_data.sql`'in kategori seed verisi, `service-catalog.ts`'in **güncel olmayan, eski bir sürümünü** yansıtıyor: birleştirilmemiş Liman Hizmetleri kategorileri (`lashing`, `unlashing`, `konteyner-dolum`, `konteyner-bosaltim`, `yukleme-gozetimi`, `bosaltma-gozetimi`) ayrı satırlar olarak var, güncel birleşik id'ler (`lashing-unlashing`, `konteyner-dolum-bosaltim`, `gozetim-hizmetleri`) YOK; ayrıca kodun `REMOVED_CATEGORY_IDS` olarak işaretlediği 10 kategori aktif satır olarak seed ediliyor. `jobs.category_id`/`provider_services.service_category_id`'nin `service_categories(id)`'e FK'si olduğu için, güncel kod bu birleşik id'lerden birini yazmaya çalıştığında FK ihlali oluşur.
5. `legal_consents` ve `provider_document_consents` tabloları için 20 dosyanın hiçbirinde ne bir yazma RPC'si ne de bir INSERT GRANT/politikası var — ikisi de yalnız-okuma. Ama kayıt akışı (hem Hizmet Alan hem Hizmet Veren) bu iki tabloya kayıt anında yazmak zorunda. Migrasyon bu haliyle **kayıt akışını kilitler**.

Bunlara ek olarak, sıradan bir kullanıcının kendi ilanını silmesi için hiçbir RPC yok (yalnız `delete_job_as_admin`) — kaynak uygulamanın gerçek, aktif kullanılan `deleteJobWithOffers` özelliğinin migrasyonda karşılığı yok. Ayrıntılar §6, §7, §19, §20'de.

Bunların hepsi **noktasal, iyi anlaşılmış ve dar kapsamlı** düzeltmeler — mimariyi değiştirmiyorlar, var olan desenlere (GRANT/REVOKE deseni, RPC-only yazma deseni) birebir uyuyorlar. Bu yüzden karar **B**'dir (bkz. §2).

> **✅ GÜNCELLEME:** Yukarıdaki 5 maddenin TAMAMI, aşağıdaki "Uygulanan Migration Düzeltmeleri" bölümünde ayrıntılandırılan değişikliklerle çözüldü — sırasıyla: (1) `create_offer()`/`offers.estimated_duration` yeniden tasarlandı (0005, 0015); (2) `profiles`/`provider_profiles`'a `GRANT SELECT` eklendi (0003); (3) `currency` CHECK'ine `'EUR'` eklendi (0005); (4) `0020`'nin seed verisi `service-catalog.ts`'in güncel halinden yeniden üretildi; (5) `legal_consents`/`provider_document_consents` için RPC yazma yolları eklendi (0008, 0007). Ayrıca §20'nin geri kalan 6 maddesi de (owner-facing `delete_job`, `create_notification`/`append_job_activity_event` kilitlenmesi, tüm fonksiyonlarda açık EXECUTE izinleri, policy/trigger idempotency, `contact_messages` tablosu) uygulandı. **Hiçbir SQL çalıştırılmadı** — yalnızca dosyalar düzenlendi; gerçek bir dry-run hâlâ bekleniyor.

## 2. Geçişe Hazır Olma Kararı

### **KARAR: B — Küçük düzeltmelerden sonra uygulanabilir.**

Gerekçe: Bulunan sorunların hiçbiri mimari bir yeniden tasarım gerektirmiyor — hepsi ya (a) eksik bir SQL satırı (GRANT/CHECK-değeri eklemek), (b) yanlış/eski bir sabit listesi (seed verisini güncel kaynaktan yeniden üretmek) ya da (c) var olan desene uyan eksik bir fonksiyon (bir INSERT RPC'si veya bir owner-delete RPC'si eklemek). "C" (önemli şema/RLS değişikliği) ya da "D" (yeniden tasarım) için gereken türden bir mimari kusur (ör. RLS'in tamamen yanlış modellendiği, RPC'lerin transaction garantisi vermediği, tablo ilişkilerinin temelden yanlış olduğu) bulunmadı — aksine, mimari (append-only geçmiş tabloları, RPC-only yazma, SECURITY DEFINER + search_path deseni, compare-and-set eşzamanlılık kontrolü) tutarlı ve doğru uygulanmış durumda.

**Ama** "B" burada "kozmetik/önemsiz" anlamına gelmiyor — 5 sorunun her biri, düzeltilmeden uygulanırsa gerçek kullanıcı akışlarını (kayıt, Nakliye-dışı teklif verme, kendi profilini görme, ilan silme) doğrudan kırardı. §20'de her biri için somut düzeltme listesi var. Ayrıca bu tasarımın **hiçbir parçası gerçek bir Postgres'e karşı hiç çalıştırılmadı** — bu belge yalnız statik okuma ile üretildi; §9'daki test planı belgesinin kendisinin de söylediği gibi, `supabase db reset` ile boş bir projeye karşı gerçek bir "dry run" yapılmadan hiçbir SQL için "çalışıyor" denemez (bkz. görevin kendi kuralı). Bu yüzden B kararı şu koşula bağlıdır: §20'deki düzeltmeler yapıldıktan SONRA, gerçek bir dry-run (boş Supabase projesi + `supabase db reset`) mutlaka yapılmalı; bu belge o adımın YERİNE geçmez.

> **✅ GÜNCELLEME:** §20'deki 11 madde artık `supabase/migrations/0001`–`0021`'e uygulandı (bkz. "Uygulanan Migration Düzeltmeleri" bölümü) — statik olarak (SQL çalıştırılmadan, Supabase'e bağlanmadan) çapraz doğrulandı: kod ile birebir eşleşme (`estimated_duration`, `currency`, seed verisi), grant/revoke kapsamının RLS politikaları+view'larla tutarlılığı, idempotency, eski kategori id'lerinin tamamen temizlendiği. **Karar hâlâ B'dir, ama artık "düzeltilmesi gereken 11 madde" değil "uygulanmış 11 madde + hâlâ zorunlu olan gerçek dry-run" anlamına geliyor** — bu belgenin kendi kuralı gereği (§1, "Test edilmemiş SQL için çalışıyor deme"), bu ikinci geçiş de dahil hiçbir SQL gerçek bir Postgres'e karşı çalıştırılmadığı için, "artık A'dır" denemez — yalnız boş bir Supabase projesine karşı `supabase db reset` çalıştırılıp §9'un test planı uygulandıktan SONRA bu değerlendirme yapılabilir.
>
> **✅ GÜNCELLEME (üçüncü geçiş):** Bu paragrafın kendi koşulu — "gerçek bir dry-run mutlaka yapılmalı" — artık karşılandı: tamamen yerel/izole bir Docker + Supabase CLI ortamına karşı gerçek bir `supabase db reset` iki (yetki düzeltmesinden sonra üç) kez ardışık, hatasız çalıştırıldı; 9/9 negatif güvenlik testi + 1 pozitif kontrol geçti. Bu süreçte bulunan 4 gerçek hata (bkz. "Yerel Migration Dry-Run Sonucu") migration dosyalarının kendisinde düzeltildi. **Karar hâlâ B'dir** (bu belgenin A/B/C/D sınıflandırması, mimari bir yeniden tasarım GEREKMEDİĞİ anlamına geliyordu — bu hâlâ doğru, bulunan 4 hata da noktasal düzeltmelerdi) ama B'nin kendi koşulu artık tam olarak yerine getirildi: migration seti (0001–0021, üçüncü geçişin ek düzeltmeleriyle) gerçek bir Postgres'e karşı baştan sona çalıştırılmış, doğrulanmış ve hâlâ başarısız olan hiçbir adımı yoktur. Tek kalan fark, yerel dry-run'ın kapsamadığı katmanlardır (GoTrue'nun gerçek kayıt/JWT akışı, Storage API'nin gerçek HTTP dosya yükleme akışı — ikisi de bu migration setinin SQL/RPC katmanının dışında, "Yerel Migration Dry-Run Sonucu"nun son alt bölümünde ayrıntılı).

## 3. Mevcut Uygulama Veri Modeli

Aşağıdaki tüm alanlar doğrudan `app/_lib/types.ts` ve ilgili tablo modüllerinden (satır satır) çıkarılmıştır. Kaynak: `types.ts` (462 satır), `users.ts`, `session.ts`, `job-store.ts`, `offers.ts`, `ratings.ts`, `provider-services.ts`, `provider-documents.ts`, `provider-document-reviews.ts`, `contact-messages.ts`, `notifications.ts`, `notification-reads.ts`, `notification-dismissals.ts`, `photo-blob-store.ts`.

### 3.1 `StoredUser` (users.ts) / `Session` (types.ts)

`Session = { id: string; name: string; role: UserRole }` — `UserRole = "hizmet-alan" | "hizmet-veren" | "admin"`. Oturumun kendi id'si yok; gerçek `StoredUser.id`'yi taşır. `session.ts`, `readSessionSnapshot()` içinde artık `findUserById(value.id)` ile gerçek kullanıcıya karşı doğrulama yapıyor (K1 düzeltmesi) — sahte bir `role` ile oturum nesnesi elle değiştirilse bile gerçek kayıttan `name`/`role` yeniden kurulur.

`StoredUser` alanları (users.ts, tam liste doğrudan koddan): `id`, `name`, `email`, `phone`, `passwordHash` (tuzsuz SHA-256, dev-only), `role: UserRole`, `companyName?`, `companyType?`, `province?`, `district?`, `createdAt`, `providerProfile?: ProviderProfile`, `showEmailAfterAgreement?: boolean`, `showPhoneAfterAgreement?: boolean`. **ID üretimi**: `crypto.randomUUID()`. **Tarih biçimi**: `new Date().toISOString()`. **localStorage anahtarı**: `"malsevk.users.v1"`.

### 3.2 `ProviderProfile` (StoredUser'ın gömülü alt-nesnesi)

```
companyName: string;                    // zorunlu
logoStorageKey?: string;                // photo-blob-store.ts anahtarı
bio: string;                            // zorunlu
foundedYear?: number;                   // 1900–bugünkü yıl
regions: string[];                      // zorunlu, il adları
expertise: string[];                    // ESKİ/DEPRECATED — yeni kod asla yazmaz
serviceCategories?: string[];           // DEPRECATED (2026-07-29) — artık provider-services.ts tek kaynak
serviceFeatures?: ServiceFeature[];     // Aşama 2
experienceRange?: ExperienceRange;      // Aşama 2
```
`ServiceFeature = "operatorlu"|"operatorsuz"|"7-24"|"acil-hizmet"|"faturali"`. `ExperienceRange = "0-1"|"1-3"|"3-5"|"5-10"|"10+"`.

### 3.3 `StoredProviderService` (provider-services.ts) — GÜNCEL hizmet seçimi kaynağı

```
{ id: string; userId: string; serviceCategoryId: string; createdAt: string }
```
Yazma: `setProviderServiceCategoryIds(userId, categoryIds)` — **tam değiştirme** (sil-sonra-ekle, tek yazım). **localStorage**: `"malsevk.provider_services.v1"`.

### 3.4 `StoredProviderDocument` / `StoredProviderDocumentReview` (provider-documents.ts / provider-document-reviews.ts)

```ts
StoredProviderDocument = {
  id: string; userId: string; originalFileName: string; mimeType: string;
  extension: string; size: number; indexedDbStorageKey: string; uploadedAt: string;
  reviewStatus: ProviderDocumentReviewStatus;  // "pending"|"approved"|"rejected"|"revision_requested"
  reviewNote?: string; reviewedAt?: string; reviewedByAdminId?: string;
  documentType: ProviderDocumentType;          // "genel"|"gumruk-musaviri-izin-belgesi"
}
```
`documentType` alanı **zorunlu** tipte ama eksik eski kayıtlarda okuma anında `"genel"`'e normalize edilir (kalıcı yazılmaz, her `readAll()` çağrısında canlı uygulanır).

```ts
StoredProviderDocumentReview = {
  id: string; documentId: string; userId: string; adminId: string;
  action: ProviderDocumentReviewStatus;  // pratikte yalnız "approved"|"rejected"|"revision_requested"
  note?: string; createdAt: string;
}
```
Değişmez (append-only) günlük — `StoredProviderDocument.reviewStatus/reviewNote/reviewedAt` bu günlüğün yalnız EN SON satırının denormalize yansımasıdır.

### 3.5 `Job` (types.ts, tam alan listesi)

```ts
{
  id: string; title: string; category: string; province: string; district: string;
  workLocationType: string; facilityId?: string; companyOrFactoryName?: string;   // ESKİ
  addressText?: string; locationMode?: "catalog"|"custom"; neighborhood?: string;  // ESKİ
  locationUrl?: string; directionsNote?: string;                                  // ESKİ
  workDate: string; description: string; operationDetails: string;
  status: JobStatus;               // "yayinda"|"tamamlandi"|"iptal"
  requesterId: string | null;      // sabit örnek ilanlarda null
  operationId?: string;            // Çoklu Hizmet Operasyonu bağlantısı
  workEndDate?: string;
  productQuantity?: number; productTonnage?: number; productType?: string;
  photos: JobPhoto[];              // zorunlu (boş dizi olabilir)
  customsTransactionType?: string; customsOfficeId?: string;                      // ESKİ (officeId)
  customsRequestedServices?: string[]; customsProductType?: string;
  customsGtipCode?: string; customsDeclarationItemCount?: number;                 // ESKİ
  customsContainerCount?: number;                                                 // ESKİ
  customsDocuments?: JobCustomsDocument[];
  createdAt?: string; publishEndAt?: string;
  republishedFromJobId?: string; republishedToJobId?: string;
  closedAt?: string; closureReason?: JobClosureReason;
  deliveryProvince?: string; deliveryDistrict?: string;
  deliveryLocationType?: "facility"|"open_address";
  deliveryFacilityId?: string; deliveryFacilityName?: string; deliveryAddressText?: string;
}
```
**"ESKİ" işaretli 8 alan** (`companyOrFactoryName`, `addressText`'in eski davranışı değil ama `neighborhood`/`locationUrl`/`directionsNote`, ve `customsOfficeId`/`customsGtipCode`/`customsDeclarationItemCount`/`customsContainerCount`) hiçbir güncel form tarafından yazılmıyor, yalnız düzenlemede korunuyor. `JobPhoto = { id, order, fileName, fileSize, mimeType, storageKey }`; `JobCustomsDocument` bununla birebir aynı tip. **ID üretimi**: `crypto.randomUUID()` (job, foto, operationId hepsi). **Tarih biçimi**: `createdAt`/`publishEndAt` `job-publish-window.ts#createPublishWindow()` üretir (ISO string, milisaniye hassasiyetli — 14 gün ham milisaniye ile hesaplanır, takvim günü değil). **localStorage**: `"malsevk.jobs.v1"`.

### 3.6 `Offer` (types.ts)

```ts
{
  id: string; jobId: string; providerId: string; amount: number; currency: Currency; // "TRY"|"USD"|"EUR"
  description: string; estimatedDuration?: string | number;  // bkz. §6.1 — KRİTİK uyuşmazlık
  status: OfferStatus;  // 10 değer, bkz. §9
  createdAt: string; updatedAt: string;
  disagreementReason?: DisagreementReason; disagreementNote?: string;
  completionDisputeNote?: string;
  completionRequestedByUserId?: string; completionRequestedAt?: string;
  autoCompleted?: boolean;
}
```
**ID/Tarih**: `crypto.randomUUID()` / `.toISOString()`. **localStorage**: `"malsevk.offers.v1"`.

### 3.7 `Rating` (types.ts)

```ts
{ id: string; offerId: string; jobId: string; providerId: string; raterId: string; stars: number; createdAt: string }
```
`stars`: 1–5 tam sayı. **localStorage**: `"malsevk.ratings.v1"`.

### 3.8 `StoredContactMessage` (contact-messages.ts)

```ts
{
  id: string; referenceNumber: string;  // "BU-2026-00001" formatı, yalnız görüntü
  name: string; email: string; phone: string;  // en az biri dolu olmalı (email/phone)
  subject: ContactMessageSubject; message: string;
  createdAt: string; updatedAt: string;
  userId: string | null; userRole: UserRole | null;
  status: ContactMessageStatus;  // "yeni"|"inceleniyor"|"yanit-bekliyor"|"cozuldu"|"arsivlendi"
  adminNote?: string; reviewedByAdminId?: string;
}
```
**localStorage**: `"malsevk.contact-messages.v1"`.

### 3.9 Bildirimler (notifications.ts / notification-reads.ts / notification-dismissals.ts)

**Kaynakta HİÇBİR bildirim tablosu YOK** — her render'da `Offer`/`Job`'dan canlı türetilir. 19 `NotificationType` değeri (bkz. §9.4). Okundu/kapatıldı durumu iki ayrı per-user localStorage anahtarında (`malsevk_read_notifications_<userId>`, `malsevk_dismissed_notifications_<userId>`) düz `string[]` olarak tutulur — `AppNotification` kalıcı bir kayıt değildir, `{id, notificationType, message, ilanId, offerId?, href, createdAt}` şeklinde her render'da yeniden üretilir.

### 3.10 Foto/Logo/Belge blob metadata (photo-blob-store.ts)

Tek bir IndexedDB veritabanı (`"malsevk-photo-blobs"`), tek bir object store (`"blobs"`) — job fotoğrafları, provider logosu, provider belgeleri VE gümrük evrakları **aynı** düz key-value alanını paylaşır, yalnız `storageKey` string'i ile ayrılırlar. Bu store'da metadata YOK (dosya adı/mimeType/boyut) — bunlar yalnız referans veren kayıtta (`JobPhoto`/`JobCustomsDocument`/`StoredProviderDocument`) tutulur.

## 4. Mevcut Migration Envanteri

Aşağıdaki 20 dosyanın her biri tek tek, tam olarak okunmuştur (bkz. yöntem notu). Özet tablo; her satırın "Yeniden çalıştırılabilir mi" sütunu **ilk kez zaten uygulanmış bir veritabanına karşı ikinci kez çalıştırma** senaryosunu değerlendirir (ilk uygulama için hepsi güvenlidir).

| # | Dosya | Amaç | Bağımlılık | 2. çalıştırma güvenli mi? | Not |
|---|---|---|---|---|---|
| 0001 | extensions_and_helpers | `pgcrypto`, `set_updated_at()` | — | ✅ | search_path yok (INVOKER, tablo erişimi yok, risksiz) |
| 0002 | service_categories | Katalog tablosu | 0001 | ⚠️ | `create trigger` idempotent değil |
| 0003 | profiles_and_provider_catalog | profiles, provider_profiles, provider_services | 0001-02, `auth.users` | ⚠️ | **profiles/provider_profiles'a hiç `grant select` yok** (§6.2) |
| 0004 | operations_jobs_photos | operations, jobs, job_photos + 4 fonksiyon/4 tetikleyici | 0003 | ⚠️ | `jobs`'a da `grant select` yok (0013'te geliyor) |
| 0005 | offers_and_status_history | offers, offer_status_history + `offers_one_settled_per_job` | 0003-04 | ⚠️ | `estimated_duration NOT NULL text` (§6.1), `currency` EUR eksik (§6.3) |
| 0006 | ratings | ratings + `ensure_rating_matches_completed_offer` | 0003-05 | ⚠️ | — |
| 0007 | provider_documents_and_consents | provider_documents, provider_document_reviews, provider_document_consents | 0003 | ⚠️ | `provider_document_consents`'a yazma yolu hiçbir yerde yok (§6.5) |
| 0008 | legal_consents | legal_consents | 0003 | ✅ (trigger yok) | Yazma yolu hiçbir yerde yok (§6.5); UNIQUE(user,doc,version) yok |
| 0009 | notifications | notifications, recently_viewed_jobs | 0003-05 | ✅ (trigger yok) | — |
| 0010 | job_activity_and_audit | job_activity_events, audit_logs | 0003-04 | ✅ (trigger yok) | `audit_logs`'a hiçbir yerde `grant select` yok (yalnız `is_admin()` policy) |
| 0011 | indexes | 19 index | 0002-10 | ✅ | Tamamı `IF NOT EXISTS` |
| 0012 | rls_helpers | 18 yardımcı fonksiyon + `prevent_last_admin_loss` tetikleyicisi | 0002-10 | ⚠️ | trigger idempotent değil; çoğu fonksiyona açık REVOKE yok (varsayılan EXECUTE'a bağlı, doğrulanamadı) |
| 0013 | rls_policies | ~24 RLS politikası, tüm Faz-1 tablolarında | 0002-12 | ❌ | `create policy` idempotent DEĞİL — 2. çalıştırma ilk satırda hata verir |
| 0014 | rpc_job_functions | 8 RPC (create_job, create_operation_with_jobs, update_job, close_job, republish_job, get_job_address, delete_job_photo, set_provider_service_categories) | 0002-13 | ✅ (fonksiyonlar) | **Sıradan kullanıcı için "kendi ilanını sil" RPC'si yok** (§6.6) |
| 0015 | rpc_offer_functions | 11 RPC (create_offer…submit_rating) | 0002-14 | ✅ (fonksiyonlar) | `estimated_duration` uyuşmazlığı burada da (§6.1) |
| 0016 | rpc_document_notification_and_admin_functions | 11 RPC (create_notification…reinstate_user) | 0002-15 | ✅ (fonksiyonlar) | `create_notification`/`append_job_activity_event` iç yetki kontrolü yok (§19) |
| 0017 | views | 15 view + 1 fonksiyon (admin_audit_log_search) | 0002-16 | ✅ | Tüm view'larda açık GRANT var (önceki eksiklik düzeltilmiş) |
| 0018 | scheduled_jobs | 4 sweep fonksiyonu + pg_cron zamanlaması | 0002-17 | ⚠️ | Sweep fonksiyonlarına açık REVOKE yok; `cron.schedule()` idempotency sürüm-bağımlı, doğrulanamadı |
| 0019 | storage_policies | 3 bucket + 10 storage.objects politikası | 0012 | ❌ (policy'ler) | `create policy` idempotent değil |
| 0020 | seed_reference_data | service_categories seed (40 satır) | 0002 | ✅ (`ON CONFLICT DO NOTHING`) | **Veri güncel değil** (§6.4, §17) — dosyanın kendi "37 kategori" yorumu bile kendi VALUES listesiyle (40 satır) çelişiyor |

**Syntax/dependency sorunu bulunmadı** — her dosya, 20 dosyalık sıralı bir bütün olarak okunduğunda, hiçbir ileri-referans (henüz tanımlanmamış bir nesneye erişim) yok. **Aynı tablo/kolon/policy/fonksiyon adı iki kez tanımlanmıyor** — her ad tam olarak bir dosyada tanımlı. **DROP/veri kaybı riski**: tüm sette tek bir hard `DELETE` var (`sweep_stale_anonymous_legal_consents()`, 0018 — yalnız `user_id IS NULL AND accepted_at < now() - 90 gün` olan anonim onay kayıtları, açıkça "bu şemadaki tek hard delete" diye işaretlenmiş); hiçbir `DROP TABLE`/`DROP COLUMN` yok.

## 5. Migrationlar Arası Bağımlılık Haritası

Sonraki dosyaların önceki dosyalarda "var olduğunu varsaydığı" 13 iddia tek tek doğrulandı (bkz. §1'deki yöntem notu — her biri ilgili dosya bizzat okunarak kontrol edildi):

| İddia | Nerede varsayılıyor | Nerede tanımlı | Doğrulandı mı? |
|---|---|---|---|
| `offers_one_settled_per_job` partial unique index | `accept_offer()` (0015), `is_offer_pending_action_blocked()` (0012) | 0005 | ✅ **Doğrulandı** — birebir var |
| `job_photos_job_id_sort_order_unique` | 0011'in index atlama gerekçesi | 0004 | ✅ **Doğrulandı** |
| `jobs.republished_to/from_job_id` partial unique index'leri | 0011'in index atlama gerekçesi | 0004 | ✅ **Doğrulandı** |
| `provider_services` UNIQUE(provider_id, service_category_id) | 0011'in index atlama gerekçesi | 0003 | ✅ **Doğrulandı** |
| `notifications` UNIQUE(recipient_id, event_key) | `create_notification()`'ın ON CONFLICT'ı (0016) | 0009 | ✅ **Doğrulandı** |
| `recently_viewed_jobs` UNIQUE(user_id, job_id) | `record_job_viewed()`'in ON CONFLICT'ı (0016) | 0009 | ✅ **Doğrulandı** (aslında PK, unique'den de güçlü) |
| `service_categories` PK/unique(id) | 0020'nin ON CONFLICT(id)'i | 0002 | ✅ **Doğrulandı** |
| `profiles.role`/`deleted_at` kolonlarının `authenticated`'e KAPALI olduğu | 0012'nin yorumu ("0003'te zaten kapalı") | 0003 | ✅ **Doğrulandı** — yalnız 6 self-servis kolon UPDATE edilebilir, `role` dahil değil |
| `jobs`'un `listing_status`/`closed_at`/vb. kolonlarının owner'dan bile korunduğu | RLS'in `jobs_update_own_editable`'ının kolon kısıtı olmaması | 0002-10, 0013 | ✅ **Doğrulandı** — 0004'ün column-grant'ı yalnız 14 self-servis kolonu (title/description/…/work_end_date) UPDATE edilebilir kılıyor; `listing_status`/`closed_at`/`category_id`/`operation_id`/`publish_end_at` grant DIŞINDA, doğrudan client UPDATE'i bunları değiştiremez |
| `provider_profiles.verification_status`'un owner'dan korunduğu | Aynı mantık | 0003 | ✅ **Doğrulandı** — yalnız 6 self-servis kolon (bio/founded_year/…/logo_path) grant'lı, `verification_status` dışarıda |
| Default EXECUTE ayrıcalığının `anon`/`authenticated`'e kapalı olduğu | 0012/0018'in çoğu fonksiyonu için açık REVOKE yok | 0001-0020'nin hiçbiri | ❌ **Doğrulanamadı** — PostgreSQL'de `CREATE FUNCTION` varsayılan olarak `PUBLIC`'e EXECUTE verir; bunu değiştiren bir `ALTER DEFAULT PRIVILEGES` ifadesi 20 dosyanın hiçbirinde yok. **Bu gerçek bir açık risktir** (bkz. §19) |
| `jobs`'a `grant select`'in "0002-0010'da zaten ayarlandığı" (0013'ün kendi başlık yorumu) | 0013'ün önsözü | Gerçekte 0013'ün KENDİSİNDE | ⚠️ **Kısmen yanlış** — `jobs`'un SELECT grant'i 0004'te DEĞİL, 0013'ün içinde (`grant select on public.jobs to authenticated, anon;`, satır 107) veriliyor. Sonuç doğru ama dosyanın kendi bağımlılık iddiası yanıltıcı. |
| `profiles`/`provider_profiles`'a SELECT grant'in "0002-0010'da ayarlandığı" | 0013'ün önsözü | **Hiçbir yerde** | ❌ **YANLIŞ — bkz. §6.2, kritik bulgu** |

## 6. Kod ve SQL Arasındaki Uyuşmazlıklar

### 6.1 `Offer.estimatedDuration` — KRİTİK

- **Kod** (`offers.ts#CreateOfferInput.estimatedDuration?: number`, `createOffer`): yalnız `isTransportationCategory(job.category)` iken zorunlu, 1–60 arası **tam sayı**; Nakliye dışı kategorilerde alan hiç yazılmaz (`estimatedDuration: requiresEstimatedDuration ? input.estimatedDuration : undefined`).
- **SQL** (`0005`, satır 29): `estimated_duration text not null check (char_length(estimated_duration) between 2 and 100)`.
- **RPC** (`0015`, `create_offer(..., p_estimated_duration text)`): parametre zorunlu (default yok), doğrudan `insert ... values (..., p_estimated_duration)`.
- **Sonuç**: Nakliye dışı (yani `service-catalog.ts`'in 7 grubundan 6'sını oluşturan) her teklif çağrısı, `p_estimated_duration` NULL/uygun-olmayan bir değerle gönderilirse ya NOT NULL ihlaline ya da CHECK ihlaline çarpar; Nakliye teklifleri için de tip uyuşmazlığı var (SAYI vs `text`).

### 6.2 `profiles`/`provider_profiles` SELECT grant eksikliği — KRİTİK

`grep` ile 0003 ve 0013'ün tamamı tarandı: `profiles` ve `provider_profiles` için **hiçbir** `grant select` ifadesi bulunamadı (yalnızca kolon-kısıtlı `grant update (...)` var). RLS politikaları (`profiles_select_own_or_admin`, `provider_profiles_select_own_or_admin`) satır filtrelemesi yapar ama tablo-seviyesi SELECT izni olmadan bu politikalar hiç devreye girmez — `authenticated` rolü `SELECT * FROM profiles` denediğinde PostgreSQL "permission denied for table profiles" hatası verir, RLS'e bile ulaşmadan. Karşılaştırma için: `jobs` aynı sorunu 0004'te yaşıyordu ama **0013 satır 107**'de düzeltilmiş (`grant select on public.jobs to authenticated, anon;`) — `profiles`/`provider_profiles` için bu satırın eşdeğeri hiçbir dosyada yok.

### 6.3 `Currency` — EUR eksik

`money.ts#CURRENCY_VALUES = ["TRY", "USD", "EUR"]` (tek doğruluk kaynağı, `offer-form.tsx`/`offers.ts`/`offer-form-validation.ts` hepsi buradan okur) — ama `0005`'in `currency text check (currency in ('TRY', 'USD'))` kısıtı yalnız 2 değeri kabul ediyor.

### 6.4 `0020` seed verisi eski — bkz. §17 (ayrıntı orada)

### 6.5 `legal_consents` / `provider_document_consents` — yazma yolu yok

Her iki tablo da 0013'te yalnız SELECT politikasına sahip; 0007/0008'de yalnız `grant select` var (INSERT/UPDATE/DELETE hiç grant edilmemiş); 0014/0015/0016'nın tamamında "consent" geçen tek bir fonksiyon YOK (doğrulama: `grep -r consent supabase/migrations/001{4,5,6}*.sql` → 0 sonuç). Kaynak kodda `provider-registration.ts#registerProviderAccount` her Hizmet Veren kaydında `recordProviderDocumentConsent()` çağırıyor, `login-form.tsx` her kayıtta `recordConsentForAllLegalDocuments()` çağırıyor — **her iki kayıt akışı da bu tablolara güvenmeden tamamlanamaz.**

### 6.6 Sıradan kullanıcı için "ilanımı sil" RPC'si yok

0014'ün 8 fonksiyonu arasında yalnız `update_job`/`close_job`/`republish_job`/`delete_job_photo` var — job-seviyesinde bir `delete_job(job_id)` RPC'si yok. Tek silme yolu `delete_job_as_admin()` (0016), yalnız `is_admin()`. Kaynak kodun `offers.ts#deleteJobWithOffers` (Hizmet Alan'ın kendi ilanını, "aktif/tamamlanmış işi yoksa" koşuluyla silmesi — CLAUDE.md'de "Notifications are derived, not stored" bölümünün de bel kemiği) migrasyonda hiç karşılığı yok.

### 6.7 Doğrulanan (uyumsuzluk OLMAYAN) alanlar — kontrol edildi, eşleşiyor

`JobStatus` (`yayinda/tamamlandi/iptal`), `OfferStatus` (10 değer), `JobClosureReason` (4 değer), `DisagreementReason` (7 değer), `documentType` (`genel`/`gumruk-musaviri-izin-belgesi`), `ProviderDocumentReviewStatus` (4 değer), `LegalDocumentId` (`privacy_policy`/`terms_of_service`/`kvkk`, doğrudan `legal-documents.ts`'ten doğrulandı) — hepsi SQL CHECK listeleriyle **birebir** eşleşiyor.

## 7. Eksik Tablolar/Kolonlar

- **Tablo**: kullanıcının kendi ilanını silmesi için ayrı bir RPC yok (§6.6) — şema eksik değil (soft-delete `deleted_at` kolonu zaten `jobs`'ta var), yalnız client-callable fonksiyon eksik.
- **Tablo/RPC**: `legal_consents`/`provider_document_consents` için yazma yolu (§6.5).
- **Kolon**: `offers.currency` CHECK listesi `EUR` içermiyor (§6.3).
- **Değer**: `0020` seed verisinde güncel kategori kataloğunun bir kısmı eksik (§6.4/§17).
- **Not**: `operations.title`'ın hiçbir sorgu tarafından okunmadığı `schema-reference.md`'nin kendi "Açık Karar #9"unda zaten işaretli — kaynakta `Job.operationId`'nin karşılığı yalnız bir bağlantı anahtarıdır, insan-okunur bir "operasyon başlığı" kavramı YOK (CLAUDE.md: "yalnızca dahili eşleştirme amaçlıdır, kullanıcıya gösterilen bir kod DEĞİLDİR"). Bu bir eksiklik değil, dokümanın kendi belirsizliği — `operations.title` sütunu zararsız (nullable, hiç doldurulmasa da sorun çıkmaz).

## 8. Gereksiz veya Eski Tablolar/Kolonlar

Migrasyon tarafında gereksiz bir tablo/kolon **bulunmadı** — tasarım zaten kaynağın "eski/deprecated" alanlarını (ör. `Job.companyOrFactoryName`, `ProviderProfile.expertise`) taşımamayı seçmiş (bkz. `migration-strategy.md#§7`, "Normalizasyon" bölümü — bunlar bilinçli olarak migrate edilmiyor). Kod tarafında hâlâ var olan ama hiçbir güncel form tarafından yazılmayan "eski" `Job` alanları (§3.5'te işaretli 8 alan) zaten migrasyon şemasına hiç dahil edilmemiş — bu doğru bir karar, çünkü bu alanlar geriye-dönük-uyumluluk için kodda tutuluyor, yeni sisteme taşınmaları gerekmiyor.

Tek gerçek "gereksiz" bulgu: `0020`'nin seed verisi, kodun `REMOVED_CATEGORY_IDS` olarak işaretlediği 10 kategoriyi hâlâ aktif satır olarak taşıyor — bunlar migrasyon şemasında olmamalıydı (bkz. §17).

## 9. Status ve Enum Uyumluluğu

Tasarım native PostgreSQL `ENUM` yerine `text + CHECK` deseni kullanıyor (mimari karar, `architecture.md §2`) — bu, Türkçe status değerlerinin kod ile SQL arasında birebir string karşılaştırmasını mümkün kılıyor, ve gelecekte yeni bir değer eklemek `ALTER TYPE` yerine `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` gerektiriyor (native enum'dan daha esnek, migration riski daha düşük).

| Enum | Kod (types.ts) | SQL CHECK | Eşleşiyor mu? |
|---|---|---|---|
| `JobStatus` | 3 değer | 0004, 3 değer | ✅ |
| `OfferStatus` | 10 değer | 0005, 10 değer | ✅ |
| `Currency` | 3 değer (TRY/USD/**EUR**) | 0005, 2 değer (TRY/USD) | ❌ **bkz. §6.3** |
| `DisagreementReason` | 7 değer | 0005, 7 değer | ✅ |
| `JobClosureReason` | 4 değer | 0004, 4 değer | ✅ |
| `ProviderDocumentReviewStatus` | 4 değer | 0007, 4 değer | ✅ |
| `documentType` | 2 değer | 0007, 2 değer | ✅ |
| `LegalDocumentId` | 3 değer | 0008, 3 değer | ✅ |
| `locationMode` | `catalog`/`custom` | `0004`, aynı 2 değer | ✅ |
| `NotificationType` | 19 değer (kaynakta canlı türetilir, tablo yok) | 0009, 20 değer CHECK | ⚠️ **bkz. not aşağıda** |

**Not (`NotificationType`)**: Migrasyonun `notifications.type` CHECK listesi 20 değer içeriyor (0011-0020 denetiminde tam liste çıkarıldı); kaynağın `notifications.ts#NotificationType` union'ı 19 değer içeriyor + ayrıca `belge_onaylandi`/`belge_reddedildi`/`belge_revizyon_istendi` (provider-document-review kaynaklı, ayrı bir fonksiyondan türetiliyor) toplamda kesişimi tam saymak için iki listenin birebir karşılaştırılması bu turda satır satır yapılmadı (iki ayrı ajan farklı zamanlarda okudu) — **bu tek nokta doğrulanmadı olarak işaretlenmeli**, uygulama öncesi elle bir `diff` ile kesinleştirilmelidir.

## 10. Foreign Key ve Silme Davranışları

Neredeyse hiçbir FK'de açık `ON DELETE` yok (varsayılan `NO ACTION`) — **tek istisna**: `jobs.operation_id → operations.id ON DELETE RESTRICT` ve `job_photos.job_id → jobs.id ON DELETE CASCADE`, `profiles.id → auth.users.id ON DELETE CASCADE`. Bu, tasarımın genel felsefesiyle tutarlı: gerçek silme neredeyse hiç yok, her yerde `deleted_at`/`closed_at` soft-delete deseni var; `NO ACTION` varsayılanı, bir üst kaydın (`jobs`, `profiles`, `offers`) yanlışlıkla hard-delete edilip alt kayıtları (offers, ratings, notifications, vb.) sahipsiz bırakmasını **veritabanı seviyesinde engelliyor** — kasıtlı ve doğru bir seçim, çünkü uygulamanın kendisi de gerçek `DELETE` değil `deleted_at`/`closed_at` kullanıyor (`job-store.ts#deleteJob` gerçekte satırı silmiyor, kaynak kod incelemesinde teyit edildi — CLAUDE.md'nin "Notifications are derived, not stored" bölümü de bunu doğruluyor: silinen bir ilanın teklifleri hâlâ var, yalnız job "kayıp" görünüyor).

`auth.users` dışında hiçbir tabloya CASCADE DELETE bağlı değil — bu demektir ki bir `profiles` satırı gerçekten silinirse (yalnız `service_role`/doğrudan DB erişimiyle mümkün, hiçbir RPC bunu yapmıyor), o kullanıcının `jobs`/`offers`/`ratings`/vb. satırları **yetim kalır, silinmez** (FK `NO ACTION` bunu engeller — satırı silme işlemi başarısız olur). Pratikte bu, "gerçek kullanıcı silme" özelliğinin (bugün kaynakta zaten yok) bu şemada da tasarlanmadığı, yalnız soft-delete'in desteklendiği anlamına geliyor — kaynağın mevcut davranışıyla tutarlı.

## 11. Unique Constraint ve Index Değerlendirmesi

§5'te doğrulanan 7 kritik unique constraint/index dışında, `0011`'in 19 index'i doğrudan gerçek sorgu desenlerine (owner listeleme, kategori+il+ilçe filtreleme, süre-dolma taraması, aktif teklif sayımı) bire bir karşılık geliyor — kod tarafında karşılığı olmayan "spekülatif" bir index bulunmadı. **Index/constraint adı çakışması yok** — tüm 20 dosyada her isim benzersiz. Tek dikkat noktası: `0011`'in kendi yorumunda 3 index'in "zaten var olan bir unique index/constraint'in gereksiz tekrarı olacağı için atlandığı" belirtiliyor — bunların hepsi §5'te bağımsız doğrulandı ve gerçekten doğru.

`ratings.comment` alanı (kod: `Rating` tipinde `comment` alanı YOK — kod incelemesinde `Rating`'in yalnız `{id, offerId, jobId, providerId, raterId, stars, createdAt}` içerdiği doğrulandı) SQL'de `ratings.comment text nullable` olarak var — kaynakta karşılığı olmayan, tasarımın kendi "Açık Karar #3"ünde de işaretlenmiş, ileriye dönük bir alan (uzunluk sınırı/moderasyon henüz kararlaştırılmamış). Bu bir hata değil, bilinçli bir genişletme; ama §6'nın "kod ile SQL'in TAM örtüşmediği" ilkesi gereği burada da not edilmeli: **`ratings.comment` kaynak kodda hiç kullanılmıyor.**

## 12. Çoklu Operasyon Modelinin Doğruluğu

Kullanıcının 10 maddesi tek tek değerlendirildi:

| Kural | Migrasyonda karşılığı | Doğru mu? |
|---|---|---|
| Ana operasyon ve ayrı hizmet talepleri ayrılmalı | `operations`/`jobs` iki ayrı tablo, `jobs.operation_id` nullable FK | ✅ |
| Bir operasyonda birden fazla hizmet olabilmeli | `create_operation_with_jobs()` en az 2 servis zorunlu kılıyor (MLK53) | ✅ |
| Teklif doğrudan ilgili hizmet talebine bağlanmalı | `offers.job_id` (operation_id değil) | ✅ |
| Bir hizmet tamamlandığında yalnız o hizmet kapanmalı | `jobs.completed_at`/`listing_status` her job'a özel; `operations`'ta kendi status kolonu YOK | ✅ |
| Manuel kapatma/süre dolması/iptal/gerçek tamamlanma ayrı olmalı | `jobs.closed_at`+`closure_reason` (manuel) vs `publish_end_at`+`is_job_listing_expired()` (süre) vs `offers.status='cancelled'` (iptal, itiraz sonrası) vs `offers.status='completed'`+`jobs.completed_at` (gerçek tamamlanma) — dört ayrı mekanizma | ✅ |
| Tüm hizmetler kapandığında ana operasyonun durumu hesaplanabilmeli | `recompute_operation_terminal_state()` tetikleyicisi, her job değişiminde `operations.closed_at`/`completed_at`'i canlı hesaplıyor | ✅ |
| Kabul edilen/sonuçlanmış işi olan ilan silinememeli | `offers_one_settled_per_job` + `is_job_closed_to_new_offers()` iş kuralları var **AMA silme RPC'si yok** (§6.6) — kural kodlanmış ama uygulanacağı bir yazma yolu eksik | ⚠️ **kısmen** |
| Tamamlanmış iş geçmişi korunmalı | `offer_status_history` append-only, hiçbir DELETE grant'i yok | ✅ |
| İlan yeniden yayınlama eski kayıt geçmişini bozmamalı | `republish_job()` eskiyi güncellemeden yeni satır oluşturuyor, iki yönlü link (`republished_from/to_job_id`) + partial unique index'lerle döngü koruması | ✅ |
| İş akışı geçmişi denetlenebilir olmalı | `offer_status_history` + `audit_logs` + `job_activity_events` üç ayrı katman | ✅ |

**Sonuç**: model mimari olarak doğru ve kaynakla tutarlı; tek eksik §6.6'daki RPC boşluğu (mimari değil, fonksiyon eksikliği).

## 13. Auth ve Rol Modeli

- **`auth.users` ↔ `profiles` ilişkisi**: 1:1, `profiles.id` doğrudan `auth.users.id`'e `ON DELETE CASCADE` FK. Uygulamanın 3 rolü (`hizmet-alan`/`hizmet-veren`/`admin`) `profiles.role text check (...)` olarak korunuyor.
- **Rolün istemciden değiştirilememesi**: `profiles`'ın kolon-kısıtlı UPDATE grant'i `role`'ü İÇERMİYOR (yalnız 6 self-servis kolon) — client bunu hiçbir şekilde doğrudan değiştiremez; RLS'in kendisi de rol değişimini kısıtlamıyor ama grant zaten yeterli.
- **Admin rolünün atanması**: Faz 1'de **hiçbir client-callable RPC** `profiles.role`'ü `'admin'` yapamıyor — yalnız doğrudan (migration/service_role) DB erişimiyle mümkün, `admin-permissions.md`'nin kendi metniyle "YALNIZCA BİR KEZ, doğrudan DB erişimiyle" oluşturulmalı. `prevent_last_admin_loss()` tetikleyicisi son admin'in kazara kaybolmasını engelliyor.
- **Yeni kayıtta profil oluşturma tetikleyicisi**: **20 dosyanın hiçbirinde `auth.users` üzerinde bir `AFTER INSERT` tetikleyicisi (Supabase'in standart "yeni kullanıcı → otomatik profile satırı" deseni) bulunamadı** — `create_job`/`create_offer` gibi RPC'ler `profiles` satırının zaten var olduğunu varsayıyor. Bu, `migration-strategy.md §5 Adım 1`'in "Auth + profiles birlikte, admin API ile" yaklaşımıyla tutarlı (yani profil satırı, kayıt sırasında admin API çağrısının BİR PARÇASI olarak elle oluşturulacak, otomatik bir DB tetikleyicisiyle değil) — ama bu, dokümanların hiçbirinde AÇIKÇA "tetikleyici kasıtlı olarak yok, çünkü X" diye belirtilmemiş; **doğrulanmadı, yalnız çıkarım**.
- **Dev/demo hesapların geleceği**: `migration-strategy.md §3`, `DEV_ACCOUNTS`'un veri olarak taşınmayacağını, bunun yerine Admin API ile gerçek `auth.users` satırları üreten bir `NODE_ENV`-gated fonksiyonla yeniden-seed edileceğini açıkça belirtiyor.
- **SHA-256 şifrelerin taşınamayacağı**: `migration-strategy.md §2` bunu açıkça ele alıyor — zorunlu tek-seferlik şifre-sıfırlama akışı öneriliyor, e-posta doğrulama konusunda "bu belge karar vermiyor" diye açıkça belirtilmiş.
- **Hesap durumu (`account_status`) uygulanmıyor**: `suspended` bayrağı hiçbir RLS/RPC tarafından okunmuyor — 3 ayrı belgede (`schema-reference.md` Açık Karar #6, `admin-permissions.md` iki kez) kendi kendine işaretlenmiş, çözülmemiş bir ürün kararı.

## 14. RLS Erişim Matrisi

Aşağıdaki matris, `0013_rls_policies.sql`'in (ve ilgili tabloların oluşturulduğu dosyaların GRANT/REVOKE'larının) tam okumasından üretildi — kullanıcının istediği 7 rol perspektifiyle:

| Tablo | anon | auth. hizmet-alan | auth. hizmet-veren | kaydın sahibi | anlaşmanın karşı tarafı | admin | service_role |
|---|---|---|---|---|---|---|---|
| `profiles` | — | **YOK (§6.2)** | **YOK (§6.2)** | kendi (izin verilse) | — | SELECT all | tümü (RLS bypass) |
| `provider_profiles` | — | **YOK (§6.2)** | **YOK (§6.2)** | kendi (izin verilse) | — | SELECT all | tümü |
| `jobs` (temel) | görünüyorsa | own+görünen | görünen (`provider_can_view_category`) | own UPDATE | — | SELECT all + moderasyon | tümü |
| `jobs` (address_text vb.) | — | — (yalnız `get_job_address()` RPC) | — (aynı) | own (RPC ile) | karşı taraf (RPC ile, engaged ise) | RPC ile | tümü |
| `offers` | — | kendi ilanının teklifleri | kendi teklifi | — | — | SELECT all | tümü |
| `ratings` | SELECT all | SELECT all | SELECT all | INSERT (RPC, yalnız gerçek hizmet-alan) | — | SELECT all | tümü |
| `provider_documents` | — | — | own | — | — | SELECT all | tümü |
| `notifications` | — | own | own | — | — | — (kendi admin bildirimleri kendi own'unda) | tümü |
| `audit_logs` | — | — | — | — | — | SELECT (`is_admin()`) — **ama grant select hiç yok, bkz. §4 tablosu** | tümü |

**Doğrulanan özel kurallar** (kullanıcının açıkça sorduğu 16 madde):
- Kullanıcı yalnız kendi özel profilini okuyabilmeli → RLS politikası VAR ama grant EKSİK (§6.2, kırık).
- Genel/özel iletişim alanları ayrımı → `jobs.address_text` gibi kolonlar SELECT'ten tamamen `revoke` edilmiş, yalnız `get_job_address()` RPC'si (kendi içinde `can_view_job_contact()` kontrolüyle) okuyor — doğru ayrım.
- İletişim yalnız teklif kabulünden sonra açılmalı → `can_view_offer_contact()`/`get_offer_provider_display()`, `is_engaged_offer_status()` (kabul→…→tamamlandı) kontrolüyle doğru uygulanmış; `'completed'`ın da eklenmesi (C.8 düzeltmesi) kaynağın kendi mantığıyla tutarlı.
- Hizmet veren yalnız görebileceği kategorileri okuyabilmeli / Nakliyeci yalnız Nakliye / Gümrük Müşaviri kategori görünürlüğü → `provider_can_view_category()` tek fonksiyon, `job-visibility.ts#resolveVisibility`'nin BİREBİR aynısı (izole kategori hiç seçilmemişse HER ilan görünür kuralı dahil) — doğrulandı.
- İlan sahibi kendi ilanını yönetebilmeli / teklif veren yalnız kendi teklifini yönetebilmeli / ilan sahibi gelen teklifleri okuyabilmeli / başka kullanıcının teklif tutarı okunamamalı → hepsi `offers_select_parties_or_admin` politikasıyla doğru (rakip sağlayıcı asla başka bir teklif satırını görmez).
- Tamamlanmış/kabul edilmiş iş doğrudan silinememeli → §6.6'daki boşluk nedeniyle bu kural bugün "test edilemez" durumda (silme yolu hiç yok).
- Belge incelemesi yalnız admin → `review_provider_document()`'ın `is_admin()` kontrolü doğrulandı.
- Kullanıcı kendi belge durumunu okuyabilmeli → `provider_documents_select_own_or_admin` doğrulandı.
- Audit log kullanıcı tarafından değiştirilememeli → hiçbir rol için INSERT/UPDATE/DELETE grant'i yok, yalnız `log_audit_event()` (kendisi de `authenticated`'e REVOKE edilmiş) — doğrulandı, en sıkı korumalı tablo.
- Bize Ulaşın mesajları yalnız gönderen+admin → **`contact_messages` tablosu Faz 1 migrasyon setinde HİÇ YOK** — `contact-messages.ts` kaynak kodda var (§3.8) ama `supabase/migrations/0001`–`0020`'de karşılığı bulunamadı. Bu, §7'ye eklenmesi gereken bağımsız bir eksik tablo bulgusudur.
- Storage dosya yolları RLS sahipliğiyle uyumlu → `(storage.foldername(name))[1] = auth.uid()::text` deseni tüm INSERT/UPDATE/DELETE politikalarında tutarlı, doğrulandı (bkz. §16).

## 15. RPC/Transaction Planı

Kullanıcının listelediği 16 işlemin tamamı bir RPC'ye karşılık geliyor **("İletişim erişimini açma" hariç — bu ayrı bir yazma değil, `get_job_address()`/`get_offer_provider_display()` salt-okunur RPC'leri zaten koşullu okuma sağlıyor, "açma" diye ayrı bir yazma eylemi kaynakta da yok)** ve **"Bize Ulaşın" ile ilgili hiçbir RPC yok** (tablo da yok, §14).

| İşlem | RPC | Kim çağırabilir | Kilit | SECURITY DEFINER | search_path |
|---|---|---|---|---|---|
| İlan/operasyon oluşturma | `create_job`/`create_operation_with_jobs` | hizmet-alan | yok (saf insert) | ✅ | ✅ `public` |
| Çoklu hizmet ekleme | `create_operation_with_jobs` (tek çağrıda) | hizmet-alan | yok | ✅ | ✅ |
| Teklif oluşturma | `create_offer` | hizmet-veren | `pg_advisory_xact_lock` (provider-scoped) | ✅ | ✅ |
| Teklif kabul etme | `accept_offer` | ilan sahibi | advisory lock + CAS + unique_violation yakalama | ✅ | ✅ |
| Diğer teklifleri kapatma | Ayrı RPC yok — `offers_one_settled_per_job` unique index bunu DB seviyesinde otomatik garanti ediyor (ikinci accept başarısız olur) | — | — | — | — |
| İşi başlatma | `start_work` | ilan sahibi | CAS (`status='accepted'`) | ✅ | ✅ |
| Tamamlama talebi | `request_completion` | teklifin sağlayıcısı | CAS (`status='in_progress'`) | ✅ | ✅ |
| İtiraz | `dispute_completion` | ilan sahibi, ≠talebi başlatan | CAS | ✅ | ✅ |
| Otomatik tamamlama | `sweep_completion_auto_approvals()` (pg_cron, saatlik) | sistem (cron) | CAS, per-row | ✅ | ✅ |
| İlanı manuel kapatma | `close_job` | ilan sahibi | CAS (offer reject loop) | ✅ | ✅ |
| **İlanı silme** | **YOK** (yalnız `delete_job_as_admin`, admin-only) | — | — | — | — |
| Yeniden yayınlama | `republish_job` | ilan sahibi | yok | ✅ | ✅ |
| Değerlendirme gönderme | `submit_rating` | hizmet-alan (ilan sahibi) | unique constraint (offer_id) | ✅ | ✅ |
| Belge inceleme | `review_provider_document` | admin | yok | ✅ | ✅ |
| Admin rol atama | **YOK** (Faz 1'de client-callable yok, bkz. §13) | — | — | — | — |
| Bildirim üretme | `create_notification` | **internal (ama grant `authenticated`'e açık!)** | ON CONFLICT DO NOTHING | ✅ | ✅ |

**Rollback**: her RPC tek bir PL/pgSQL fonksiyon çağrısı, dolayısıyla Postgres'in kendi fonksiyon-seviyesi transaction'ı "ücretsiz" rollback sağlıyor (bir `RAISE EXCEPTION` fonksiyonun o ana kadar yaptığı TÜM yazımları geri alır) — kaynağın elle yazdığı "simüle transaction" (`provider-registration.ts`'in dört tabloyu manuel rollback etmesi) yerini gerçek bir DB transaction'ına bırakıyor; bu, tasarımın kod tabanına göre **iyileştirdiği**, güvenilirliği artırdığı bir nokta.

**En önemli istisna**: `create_notification()`/`append_job_activity_event()` kendi içlerinde `BEGIN...EXCEPTION WHEN OTHERS THEN RAISE WARNING` ile hatayı yutuyor (kaynağın "best-effort ikincil yazım" felsefesiyle tutarlı) — ama ikisi de `authenticated`'e doğrudan `GRANT EXECUTE` edilmiş ve içlerinde HİÇBİR yetki/sahiplik kontrolü yok. Bu iki fonksiyon açık bir güvenlik notu olarak §19'da işaretlendi.

## 16. Storage Bucket Planı

| | `job-photos` | `provider-logos` | `provider-documents` |
|---|---|---|---|
| Public/Private | **Public** | **Public** | **Private** |
| Yol standardı | `{requester_id}/{job_id}/{photo_id}.{ext}` | `{provider_id}/{logo_id}.{ext}` | `{provider_id}/{document_id}.{ext}` |
| Sahiplik modeli | İlk yol segmenti = `auth.uid()` (RLS ile zorlanır) | Aynı | Aynı |
| Boyut sınırı | 10 MB (kod: `photo-validation.ts`'ten doğrulanmış) | 10 MB | 15 MB (kod: `document-validation.ts`'ten doğrulanmış) |
| MIME sınırı | jpeg/png/webp | jpeg/png/webp | pdf, doc(x), xls(x), odt, jpeg/png/webp/heic/heif/tiff |
| Kim yükleyebilir | Owner (INSERT policy) | Owner | Owner |
| Kim okuyabilir | Herkes (public bucket + SELECT policy `anon`+`authenticated`) | Herkes | Owner veya admin |
| Kim silebilir | Owner | Owner | Owner |
| İlan silme/yeniden yayınlama sırasında yaşam döngüsü | Kod: fotoğraflar `duplicateJobPhotos` ile YENİ storageKey'lerle kopyalanıyor (republish), silmede blob temizleniyor. SQL tarafı: **DB satırı silinir ama Storage nesnesinin kendisi RPC içinde silinmiyor** — orphan sweep'e bırakılmış (henüz SQL olarak yazılmamış, `docs`'un kendi notu: "Postgres, Storage HTTP API'sini `pg_net` olmadan çağıramaz, bu tasarım turunun kapsamı dışında"). |
| Kabul sonrası belge/iletişim erişimi | N/A (bucket bazında değil, RLS+RPC ile) | N/A | `provider_documents_bucket_read_own_or_admin` — yalnız owner/admin, teklif kabulüyle İLİŞKİLİ DEĞİL (belgeler zaten hep owner/admin'e özel, bir "kabul sonrası açılma" kavramı yok — doğru, çünkü kaynakta da belgeler asla karşı tarafa açılmıyor) |
| Signed URL gereksinimi | Hayır (public) | Hayır (public) | **Önerilir** (~5 dk), henüz uygulanmamış — açıkça işaretli bir boşluk |

**Doğrulanmayan/eksik**: virüs/zararlı-yazılım taraması hiçbir katmanda yok — bu hem kaynak kodda (`document-validation.ts` yalnız magic-number/container kontrolü yapıyor) hem tasarımda açıkça "çözülmemiş güvenlik boşluğu" olarak işaretli (§19'da tekrar).

## 17. Referans ve Seed Veri Planı

MALSEVK bugün gerçek çok-kullanıcılı üretim verisi taşımıyor — bu, kodun kendisinden doğrulanabilir: `DEV_ACCOUNTS`, `NODE_ENV === "development"` kapılı, üretimde asla oluşturulmuyor (CLAUDE.md + `users.ts` incelemesiyle tutarlı); localStorage/IndexedDB, tanımı gereği her kullanıcının kendi tarayıcısında izole, sunucu tarafında toplanan/merkezi bir veri seti yok.

| Kaynak | Strateji |
|---|---|
| `DEV_ACCOUNTS` | **Veri olarak taşınmasın.** `NODE_ENV`-gated bir yeniden-seed fonksiyonuyla Supabase Admin API üzerinden gerçek `auth.users` satırları üretilsin (`migration-strategy.md §3`'ün kendi önerisi, mimari olarak doğru). |
| Demo kullanıcılar | Aynı — `DEV_ACCOUNTS`'un bir alt kümesi, ayrı bir kategori değil. |
| İl/ilçe ve tesis referans verileri | `data/locations/locations.json` bir derleme-zamanı JSON dosyası, kullanıcı verisi değil — `migration-strategy.md §8`'in kendi notu doğru: bunu bir `facilities` tablosuna taşımak "ayrı, daha düşük riskli bir iş," bu Faz 1 setinde yapılmamış (ne 20 dosyada ne de `docs/`'ta bir `facilities` tablo tasarımı bulunamadı — **bu, kullanıcının istemediği bir "eksik tablo" değil, çünkü konu dışı: `turkey-locations.ts#Facility`, `Job.facilityId`'nin serbest-metin bir REFERANS'ı olarak kalmaya devam edebilir, FK zorunlu değil**). |
| `service-catalog.ts` | **Seed verisi GÜNCEL DEĞİL (§6.4)** — `0020`'nin 40 satırı, kodun güncel 7-grup kataloğuyla (birleşik Liman Hizmetleri id'leri, `REMOVED_CATEGORY_IDS`'in dışarıda bırakılması) uyuşmuyor. Uygulama öncesi `0020` **kodun bugünkü `SERVICE_CATEGORY_GROUPS` sabitinden programatik olarak yeniden üretilmeli** (elle senkronize edilmeye güvenilmemeli — tam da bu yüzden bu kayma oluşmuş). |
| `product-catalog.ts` | Yalnız `PRODUCT_TYPE_SUGGESTIONS` (20 sabit öneri) — bir tabloya değil, `productType` serbest metin bir Job kolonu; migrasyon şemasında ayrı bir katalog tablosu yok, gerek de yok (kod da bunu bir seçenek listesi olarak kullanıyor, referans bütünlüğü gerektirmiyor). |
| `customs-brokerage-catalog.ts` | Aynı mantık — `CUSTOMS_TRANSACTION_TYPES`/`CUSTOMS_REQUESTED_SERVICE_OPTIONS` sabit listeler, DB'de ayrı bir tablo yok/gerekmiyor (`jobs.customs_transaction_type`/`customs_requested_services` serbest metin/dizi kolonlar). |
| Mevcut tarayıcı localStorage verileri | **Körü körüne taşınmamalı** — bkz. §18, veri niteliği aşağıda değerlendirildi. |
| Test/dummy ilan ve teklifler | `jobs.ts`'teki statik örnek ilanlar (`requesterId: null`) gerçek kullanıcı verisi değil, kod-gömülü sabit veri — bunlar da taşınmamalı, gerekirse aynı statik liste yeni sistemde de bir "örnek ilan" seed'i olarak ayrı tutulabilir (henüz tasarlanmamış, kapsam dışı). |
| Gerçek/demo veri ayrımı | Kodun kendi `reset-demo-data.ts`'i zaten `DEV_ACCOUNT_EMAILS`'e göre bir ayrım yapıyor — aynı mantık migrasyon sonrası da (örn. `profiles.email IN (<dev-seed-emails>)`) sürdürülebilir; ayrı bir "is_demo" bayrağı gerekmiyor. |

**Veri niteliği değerlendirmesi (görevin özel talebi)**: Mevcut localStorage kayıtları (a) yalnızca geliştiricinin kendi tarayıcısında, (b) `DEV_ACCOUNTS`'un ürettiği sabit test hesapları etrafında, (c) gerçek bir kullanıcı tarafından hiç görülmemiş, tek-makine geliştirme verisidir. Bunları "üretim verisi" gibi toptan taşımak hem gereksiz (test hesapları zaten yeniden üretilebilir) hem riskli (gerçek olmayan veriyi gerçekmiş gibi production'a sokmak) olur — bu yüzden **taşıma değil, yeniden-seed** doğru stratejidir.

## 18. LocalStorage/IndexedDB Geçiş Planı

`migration-strategy.md §6` bu konuyu ayrıntılı ele alıyor ve kritik bir gerçeği doğru tespit ediyor: **IndexedDB blob'ları yalnızca kullanıcının kendi tarayıcısında var, sunucu tarafında toplu taşınabilecek bir kopya yok.** Önerilen yaklaşım (istemci-taraflı, ilk-girişte senkronizasyon) mimari olarak doğru ve kaynağın kendi SHA-256 içerik-hash tekniğini (`photo-validation.ts#hashFileContent`) yeniden kullanarak yinelenen yüklemeleri önlüyor. Belgenin kendisi de dürüstçe **çözülmemiş bir ürün kararını** işaretliyor: kesim sonrası bir daha hiç giriş yapmayan kullanıcıların blob'ları hiç senkronize olmayacak — (a) kabul edilebilir veri kaybı, (b) eski sisteme geçici dual-read, (c) proaktif e-posta arasında **belge karar vermiyor**, açıkça "Open Decision" diye işaretli.

Bu belge bu kararı da almıyor (kapsam dışı — bir ürün kararı, bir şema/kod sorunu değil), ama şunu ekliyor: yukarıdaki §6.5 (consent tablolarının yazma yolu eksikliği) ile birleştiğinde, kayıt sırasında yüklenen belgeler (`provider-documents`) hem Storage'a hem DB'ye yazılamayacağı için, bu geçiş planının kayıt akışı düzeltilmeden test edilmesi bile mümkün değildir.

## 19. Riskler

Önem sırasına göre (kritik → düşük). Her maddenin durumu bu turun sonunda güncellendi — bkz. "Uygulanan Migration Düzeltmeleri" bölümü.

1. **[KRİTİK] ✅ ÇÖZÜLDÜ** — `profiles`/`provider_profiles` SELECT grant eksikliği (§6.2). `0003`'e `grant select ... to authenticated;` eklendi (her iki tablo için).
2. **[KRİTİK] ✅ ÇÖZÜLDÜ** — `offers.estimated_duration` NOT NULL/tip uyuşmazlığı (§6.1). `0005`'te kolon `integer`/nullable oldu; `0015`'te `create_offer()` yalnız Nakliye'de zorunlu kılıyor.
3. **[KRİTİK] ✅ ÇÖZÜLDÜ** — `legal_consents`/`provider_document_consents` yazma yolu yok (§6.5). `0007`'ye `record_provider_document_consent()`, `0008`'e `record_legal_consent()` (+ eksik UNIQUE kısıtı) eklendi.
4. **[YÜKSEK] ✅ ÇÖZÜLDÜ** — `0020` seed verisi eski (§6.4, §17). Dosya, `service-catalog.ts`'in güncel 7-grup/27-kategori halinden tamamen yeniden yazıldı.
5. **[YÜKSEK] ✅ ÇÖZÜLDÜ** — `contact_messages` tablosu yoktu (§14). Yeni `0021_contact_messages.sql` eklendi (tablo + RLS + iki RPC).
6. **[ORTA] ✅ ÇÖZÜLDÜ** — `offers.currency` EUR eksik (§6.3). `0005`'in CHECK'i `'EUR'`yu kapsayacak şekilde güncellendi.
7. **[ORTA] ✅ ÇÖZÜLDÜ** — Sıradan kullanıcı için "ilanımı sil" RPC'si yok (§6.6). `0014`'e `delete_job(p_job_id)` eklendi (owner-only, `deleteJobWithOffers` ile aynı koruma eşiği).
8. **[ORTA] ✅ ÇÖZÜLDÜ** — `create_notification()`/`append_job_activity_event()` `authenticated`'e doğrudan açıktı (§8). `0016`'da her ikisi de `public, anon, authenticated`'in tamamından `revoke all` edildi — artık yalnız aynı sahibin diğer SECURITY DEFINER fonksiyonlarından (owner-to-owner) çağrılabilirler, hiçbir client'a doğrudan grant yok.
9. **[ORTA] ✅ ÇÖZÜLDÜ** — Varsayılan `EXECUTE` ayrıcalığı belirsizdi. `0001`–`0021`'deki **69 fonksiyonun tamamına** artık açık `revoke all on function ...` (gerekmiyorsa hiç kimseye grant yok) veya `revoke` + dar kapsamlı `grant execute ... to <yalnız gerçekten ihtiyacı olan rol(ler)>` eklendi — her karar, RLS politikalarının (0013) ve `security_invoker=true` view'ların (0017) hangi yardımcı fonksiyonları DOĞRUDAN çağırdığı tek tek `grep` ile doğrulanarak verildi (bkz. "Uygulanan Migration Düzeltmeleri" §12 notu). **Not:** bu hâlâ statik bir inceleme — gerçek bir Supabase projesinde `\df+` ile son bir doğrulama önerilir, özellikle RLS-politika-çağırdığı fonksiyonların yanlışlıkla fazla kısıtlanmadığından emin olmak için (yanlış kısıtlama, "permission denied for function" hatasıyla İLGİLİ SORGULARI KIRAR — bu yüzden bu değişiklik grubu en dikkatli yapılan kısımdı).
10. **[ORTA] ✅ ÇÖZÜLDÜ** — `0013`/`0019`'daki politikalar ve 0002-0007/0012'deki tetikleyiciler idempotent değildi. Artık HER `CREATE POLICY`/`CREATE TRIGGER`, kendi `DROP ... IF EXISTS` satırından hemen sonra geliyor (otomatik taramayla doğrulandı — sıfır eksik).
11. **[DÜŞÜK] ❌ AÇIK KALDI (bilinçli, kapsam dışı)** — Virüs/zararlı-yazılım taraması hiçbir katmanda yok (§16). Bu, hem kaynak uygulamada hem tasarımda zaten var olan, bu görevin 11 maddesine dahil olmayan bir boşluk — değiştirilmedi.
12. **[DÜŞÜK] ❌ AÇIK KALDI (bilinçli, kapsam dışı)** — `account_status='suspended'` hiçbir yerde uygulanmıyor (§13). Görevin 11 maddesinin hiçbiri bunu kapsamıyor; üç belgede zaten kendi kendine işaretli bir "Açık Karar" olarak bırakıldı.
13. **[DÜŞÜK] ⚠️ KISMEN ÇÖZÜLDÜ** — `NotificationType` listesinin kod/SQL karşılaştırması. Bu turda `0009`'un CHECK listesi DEĞİŞTİRİLMEDİ (görevin 11 maddesine dahil değildi) — yalnızca yeni eklenen `0021`'in kendi durum/konu listeleri kod ile birebir doğrulandı. `notifications.type`'ın 20-değerli listesi hâlâ elle, satır satır karşılaştırılmadı; öneri aynı kalıyor.
14. **[DÜŞÜK] ❌ AÇIK KALDI (doğrulanamaz, statik incelemenin doğal sınırı)** — `pg_cron`'un `cron.schedule()` idempotency'si sürüm-bağımlı, yalnız gerçek bir Supabase projesinde doğrulanabilir.

## 20. Düzeltilmesi Gereken Migrationlar

**Tüm satırlar ✅ UYGULANDI — ayrıntılar için bir sonraki bölüme ("Uygulanan Migration Düzeltmeleri") bakın.**

| Dosya | Gerekli düzeltme | Tür | Durum |
|---|---|---|---|
| `0005_offers_and_status_history.sql` | `estimated_duration`'ı `nullable`, tipini `text`'ten `numeric`/`integer`'a çevir (veya iki kolon: eski metin kayıtları için `text`, yeni sayısal kayıtlar için `integer`, kodun `string \| number` union'ıyla eşleşecek şekilde); `currency` CHECK'ine `'EUR'` ekle | SQL değişikliği | ✅ Uygulandı |
| `0003_profiles_and_provider_catalog.sql` (veya `0013`) | `profiles`/`provider_profiles`'a `grant select` ekle (jobs'un 0013'teki desenine uygun) | SQL değişikliği | ✅ Uygulandı |
| `0015_rpc_offer_functions.sql` | `create_offer()`'ın imzasını/gövdesini `estimated_duration` düzeltmesine göre güncelle (yalnız Nakliye'de zorunlu, sayısal) | SQL değişikliği | ✅ Uygulandı |
| `0007_provider_documents_and_consents.sql` / yeni bir RPC dosyası | `provider_document_consents` için bir INSERT RPC'si (veya sahiplik kontrollü direkt INSERT grant + WITH CHECK politikası) ekle | Yeni RPC/politika | ✅ Uygulandı |
| `0008_legal_consents.sql` / yeni bir RPC dosyası | Aynısı `legal_consents` için | Yeni RPC/politika | ✅ Uygulandı |
| `0014_rpc_job_functions.sql` | Sıradan kullanıcı için `delete_job(p_job_id uuid)` RPC'si ekle — `getSettledOfferForJob`/`is_job_closed_to_new_offers` mantığıyla aynı korumayı uygulayan (kaynağın `deleteJobWithOffers`'ının SQL karşılığı) | Yeni RPC | ✅ Uygulandı |
| `0020_seed_reference_data.sql` | Tüm VALUES listesini kodun güncel `service-catalog.ts#SERVICE_CATEGORY_GROUPS`'undan **programatik olarak** yeniden üret | SQL değişikliği (veri) | ✅ Uygulandı |
| Yeni bir dosya (ör. `0021_contact_messages.sql`, Faz 1'e eklenirse) | `contact_messages` tablosu + RLS + yazma RPC'si — bugün Faz 1 setinde hiç yok | Yeni tablo | ✅ Uygulandı |
| `0016_rpc_document_notification_and_admin_functions.sql` | `create_notification()`/`append_job_activity_event()`'e ya iç bir yetki kontrolü (çağıranın `p_recipient_id`/`p_actor_id` ile ilişkili olması ya da admin olması) ekle, ya da bu iki fonksiyonu `authenticated`'den `revoke` edip yalnız diğer SECURITY DEFINER fonksiyonların İÇİNDEN çağrılabilir hale getir (zaten bugün tüm gerçek çağıranlar başka RPC'lerin içinden çağırıyor, dışarıdan doğrudan çağrılmalarına hiç gerek yok) | SQL değişikliği (güvenlik) | ✅ Uygulandı |
| `0012_rls_helpers.sql`, `0018_scheduled_jobs.sql` | Her fonksiyona (özellikle 4 sweep fonksiyonuna) açık `revoke all ... from public, anon, authenticated;` ekle — yalnız gerçek çağıranlara (`log_audit_event()`'in zaten yaptığı gibi hiç kimseye, ya da hiçbirine) açık bırak | SQL değişikliği (güvenlik sertleştirme) | ✅ Uygulandı (0012'nin 21 fonksiyonu tek tek incelendi — 10'u policy/view'dan çağrıldığı için dar kapsamlı grant aldı, 11'i tam kilitlendi) |
| `0002`–`0007` (trigger'lar), `0013`, `0019` (policy'ler) | İkinci-çalıştırma güvenliği için `DROP TRIGGER IF EXISTS ... ; CREATE TRIGGER ...` ve `DROP POLICY IF EXISTS ...; CREATE POLICY ...` desenine geçir (Postgres'te native "IF NOT EXISTS" bu ikisi için yok) | SQL değişikliği (idempotency) | ✅ Uygulandı (0012'nin kendi tetikleyicisi dahil) |

## Uygulanan Migration Düzeltmeleri

> Bu bölüm, §20'nin 11 maddesinin `supabase/migrations/0001`–`0021`'e nasıl uygulandığını dosya dosya belgeler. Hiçbir mevcut migration dosyası SİLİNMEDİ/yeniden numaralandırılmadı — yalnız içerikleri düzenlendi; `0021` tek yeni dosyadır. Hiçbir SQL çalıştırılmadı, hiçbir Supabase bağlantısı kurulmadı.

### `0001_extensions_and_helpers.sql`
- "Standart kolon kuralları" doküman bloğundaki `currency` örneği `'EUR'`yu da kapsayacak şekilde güncellendi (madde 6 ile tutarlılık).
- `set_updated_at()` fonksiyonuna açık `revoke all ... from public, anon, authenticated;` eklendi — yalnız tetikleyici bağlamında çağrılır, hiçbir client'a doğrudan grant gerekmiyor (madde 9).

### `0002_service_categories.sql`
- `trg_service_categories_set_updated_at` artık `drop trigger if exists ...` ile öncelleniyor (madde 10).

### `0003_profiles_and_provider_catalog.sql`
- **KRİTİK (madde 1):** `public.profiles` ve `public.provider_profiles`'a `grant select ... to authenticated;` eklendi — önceden HİÇBİR SELECT grant'i yoktu, RLS politikaları (0013) tablo-seviyesi izin olmadan hiç devreye giremiyordu. Yalnız `authenticated` (RLS politikaları de yalnız `to authenticated`, `anon` hiç kapsanmıyor — en dar kapsam).
- İki tetikleyici (`trg_profiles_set_updated_at`, `trg_provider_profiles_set_updated_at`) idempotent hale getirildi (madde 10).

### `0004_operations_jobs_photos.sql`
- 6 tetikleyicinin tamamı (`trg_operations_set_updated_at`, `trg_jobs_set_updated_at`, `trg_jobs_requester_is_hizmet_alan`, `trg_jobs_operation_requester_matches`, `trg_jobs_after_change_recompute_operation`) idempotent hale getirildi.
- 4 fonksiyona (`ensure_job_requester_is_hizmet_alan`, `ensure_job_operation_requester_matches`, `recompute_operation_terminal_state`, `trg_jobs_recompute_operation_terminal_state`) açık `revoke all ... from public, anon, authenticated;` eklendi — hepsi yalnız tetikleyiciler/owner-to-owner çağrılarla kullanılıyor, hiçbir client'a grant gerekmiyor.

### `0005_offers_and_status_history.sql`
- **KRİTİK (madde 2 ve 6):** `estimated_duration text not null check (2-100 karakter)` → `estimated_duration integer check (null veya 1-60 arası)`. `currency` CHECK'i `'EUR'`yu kapsayacak şekilde genişletildi. Kod tarafı: `app/_lib/offers.ts#MIN_COMMITTED_DAYS`/`MAX_COMMITTED_DAYS` (1/60) ve `money.ts#CURRENCY_VALUES` (TRY/USD/EUR) ile birebir doğrulandı.
- İki tetikleyici idempotent hale getirildi; `ensure_offer_provider_is_hizmet_veren()`'e tam kilitleme eklendi (madde 9/10).

### `0006_ratings.sql`
- İki tetikleyici idempotent hale getirildi; `ensure_rating_matches_completed_offer()`'e tam kilitleme eklendi.

### `0007_provider_documents_and_consents.sql`
- **KRİTİK (madde 3):** Yeni `record_provider_document_consent(p_statement_id text, p_statement_version text)` RPC'si eklendi — `SECURITY DEFINER`, `provider_id` her zaman sunucu tarafında `auth.uid()` ile belirlenir (parametre olarak alınmaz — başka bir kullanıcı adına kayıt oluşturulamaz), `auth.uid() is null` kontrolüyle oturumsuz çağrı reddedilir, `statement_id` CHECK listesine karşı doğrulanır, mevcut `provider_document_consents_no_duplicate` UNIQUE kısıtına `ON CONFLICT DO NOTHING` ile idempotent. Yalnız `authenticated`'e grant edildi (misafir belge onayı vermez).
- Tetikleyici idempotent hale getirildi.

### `0008_legal_consents.sql`
- **KRİTİK (madde 3):** Önceden hiçbir UNIQUE kısıtı yoktu (tablo yorumu "one row per user/doc/version" diyordu ama hiçbir şey bunu zorlamıyordu) — `legal_consents_one_per_user_document_version unique (user_id, document_id, version)` eklendi (NULL `user_id`'ler PostgreSQL'in doğal NULL-eşitsizlik kuralıyla birbirinden bağımsız kalır, anonim kayıtlar arasında istenmeyen bir tekilleştirme oluşmaz). Yeni `record_legal_consent(p_document_id text, p_version text)` RPC'si eklendi — `user_id` her zaman `auth.uid()` (misafir için NULL = anonim kabul, `sweep_stale_anonymous_legal_consents`'in zaten varsaydığı meşru senaryo), hem `authenticated` hem `anon`'a grant edildi.

### `0012_rls_helpers.sql`
- **Madde 9'un en hassas kısmı:** 21 fonksiyonun HER BİRİ, `0013_rls_policies.sql`'in politika ifadeleri VE `0017_views.sql`'in `security_invoker=true` view'ları tek tek taranarak (hangi fonksiyonun hangi politikadan/view'dan DOĞRUDAN çağrıldığı doğrulanarak) sınıflandırıldı:
  - **Dar kapsamlı grant alanlar (10):** `current_user_role()`, `is_admin()`, `provider_can_view_category()`, `is_job_listing_expired()` → `authenticated, anon` (RLS politikaları bu dördünü `to authenticated, anon` politikalardan doğrudan çağırıyor — ör. `jobs_select_visible`). `is_job_owner()`, `can_view_job_activity_event()`, `get_settled_offer_id_for_job()`, `is_job_closed_to_new_offers()`, `get_active_job_count()`, `get_active_job_limit()` → yalnız `authenticated` (yalnız `to authenticated` politikalardan/view'lardan çağrılıyor).
  - **Tam kilitlenen (11):** `is_offer_provider()`, `is_engaged_offer_status()`, `has_engaged_offer_access()`, `can_view_job_contact()`, `can_view_offer_contact()`, `get_engaged_offer_id_for_job()`, `get_completed_offer_id_for_job()`, `is_offer_pending_action_blocked()`, `has_reached_active_job_limit()`, `log_audit_event()` (zaten kilitliydi), `prevent_last_admin_loss()` — hiçbiri hiçbir RLS politikasından/view'dan doğrudan çağrılmıyor, yalnız aynı sahibin diğer SECURITY DEFINER fonksiyonlarından (owner-to-owner, grant gerektirmez).
  - **Neden bu kadar dikkatli:** SECURITY DEFINER, bir fonksiyonun kendi GÖVDESİNİN yetkisini değiştirir, ama fonksiyonu ÇAĞIRMAK için hâlâ EXECUTE izni gerekir. Bir RLS politikası kendi USING/WITH CHECK ifadesinde bir fonksiyon çağırdığında, bu çağrı SORGUYU ÇALIŞTIRAN rolün (authenticated/anon) EXECUTE izniyle değerlendirilir — SECURITY DEFINER bunu atlamaz. Yanlış kısıtlama, o fonksiyonu kullanan HER sorguyu "permission denied for function" ile kırardı.
- `prevent_last_admin_loss()` tetikleyicisi idempotent hale getirildi.

### `0013_rls_policies.sql`
- Tüm dosya, her `create policy`'nin önüne `drop policy if exists` eklenerek yeniden yazıldı (21 politika, madde 10).
- `provider_document_consents`/`legal_consents` bölümlerine, yazma yollarının artık yukarıdaki iki yeni RPC olduğunu belirten notlar eklendi (davranış değişmedi, yalnız dokümantasyon).

### `0014_rpc_job_functions.sql`
- **KRİTİK (madde 7):** Yeni `delete_job(p_job_id uuid)` RPC'si eklendi — yalnız ilan sahibi (`auth.uid() = requester_id`), `job.listing_status = 'tamamlandi' OR get_settled_offer_id_for_job(...) IS NOT NULL` ise reddedilir (kaynağın `deleteJobWithOffers`'ıyla birebir eşik), soft-delete (`deleted_at`), hâlâ `pending` kardeş teklifleri `close_job()`'daki AYNI compare-and-set deseniyle `rejected`'a çevirir. Operasyon bütünlüğü BOZULMAZ — mevcut `trg_jobs_after_change_recompute_operation` tetikleyicisi `deleted_at` UPDATE'ini zaten dinliyor, otomatik yeniden hesaplama yapılır, ek kod gerekmedi. Yeni hata kodu: `MLK92` (MLK50-59 tamamen dolu olduğu için).
- `get_job_closure_notification_message()`'a tam kilitleme eklendi (owner-to-owner çağrı, client grant gerekmiyor).

### `0015_rpc_offer_functions.sql`
- **KRİTİK (madde 2):** `create_offer()`'ın imzası `p_estimated_duration text` → `p_estimated_duration integer default null` oldu. Gövdeye `v_requires_estimated_duration := (v_job.category_id = 'nakliye')` kontrolü eklendi — yalnız Nakliye'de 1-60 arası zorunlu (aksi halde hata), Nakliye dışında her zaman `NULL` kaydedilir (gönderilen değer ne olursa olsun sessizce yok sayılır — kaynakla birebir). Boşalan `MLK66` kodu (aynı dosyada, günlük teklif kotası kaldırıldığı için zaten kullanılmıyordu) bu yeni doğrulama için YENİDEN KULLANILDI. `revoke`/`grant` satırları yeni imzaya (`uuid, numeric, text, text, integer`) güncellendi.

### `0016_rpc_document_notification_and_admin_functions.sql`
- **KRİTİK (madde 8):** `create_notification()` ve `append_job_activity_event()`'in `authenticated`'e verdiği DOĞRUDAN grant kaldırıldı — ikisi de artık `public, anon, authenticated`'in TAMAMINDAN `revoke all`. Gerçek her çağıran zaten başka bir SECURITY DEFINER RPC'nin (create_offer, accept_offer, close_job, ...) içinden `perform` ile çağırıyordu — bu, `log_audit_event()` (0012) ile birebir aynı, zaten var olan desen. Önceden herhangi bir authenticated kullanıcı bunları PostgREST üzerinden doğrudan çağırıp keyfi `recipient_id`/`type`/`message` ile başka bir kullanıcının bildirim akışına kayıt ekleyebilirdi.

### `0018_scheduled_jobs.sql`
- **Madde 9:** 4 sweep fonksiyonunun (`sweep_expired_job_listings`, `sweep_completion_auto_approvals`, `sweep_notification_retention`, `sweep_stale_anonymous_legal_consents`) HER BİRİNE açık `revoke all ... from public, anon, authenticated;` eklendi — hiçbir client grant'i yok, yalnız `pg_cron`'un zamanlanmış çağrıları (migration'ı çalıştıran/sahip rolün yetkileriyle, ayrı bir client grant'ına ihtiyaç duymadan) çalışabilir.

### `0019_storage_policies.sql`
- Tüm 10 `storage.objects` politikası, her birinin önüne `drop policy if exists` eklenerek idempotent hale getirildi (madde 10).

### `0020_seed_reference_data.sql`
- **KRİTİK (madde 4) — TAM YENİDEN YAZILDI:** Eski 40 satırlık VALUES listesi (birleştirme-öncesi Liman Hizmetleri kategorileri + 10 `REMOVED_CATEGORY_IDS` dahil) tamamen kaldırıldı. Yeni liste, `app/_lib/service-catalog.ts#SERVICE_CATEGORY_GROUPS`'un (doğrudan dosya okunarak) TAM kopyasıdır: **7 grup, 27 kategori**, `sort_order` kodun kendi `SERVICE_CATEGORY_ORDER_INDEX` mantığıyla (grup sırası → grup-içi sıra, 0'dan kesintisiz) birebir. `visibility_scope = 'isolated'` yalnız `nakliye`/`gumruk-musavirligi` için, kodun `ISOLATED_SERVICE_CATEGORY_IDS`'i ile birebir. Otomatik taramayla doğrulandı: 27/27 satır, sıfır eski/kaldırılmış id.

### `0021_contact_messages.sql` (YENİ DOSYA)
- **KRİTİK (madde 5):** `contact_messages` tablosu eklendi — `app/_lib/contact-messages.ts#StoredContactMessage`'ın alan alan karşılığı (`id`, `reference_number`, `user_id` nullable, `user_role` nullable, `name`, `email`/`phone` — en az biri zorunlu CHECK'i, `subject` 9-değerli CHECK, `message` 10-2000 karakter, `status` 5-değerli CHECK, `admin_note`, `reviewed_by_admin_id`, `created_at`/`updated_at`), artı görev tanımının açıkça değerlendirilmesini istediği iki ileriye-dönük nullable alan (`read_at`, `responded_at` — kaynakta karşılığı yok, hiçbir RPC otomatik doldurmuyor, yalnız şema tamlığı için). İki RPC: `submit_contact_message(...)` (hem `anon` hem `authenticated`, misafir gönderimi desteklenir, `user_id`/`user_role` her zaman sunucu tarafında belirlenir), `review_contact_message(...)` (yalnız `is_admin()`). RLS: yalnız `SELECT` politikası (`user_id = auth.uid() OR is_admin()`), INSERT/UPDATE için hiçbir policy/doğrudan grant yok — tüm yazımlar yukarıdaki iki RPC üzerinden.

### Değiştirilmeyenler (bilinçli, görev kapsamı dışı)
`docs/database/*.md` dosyalarının hiçbiri değiştirilmedi (görev yalnızca `supabase/migrations/**`'i kapsıyordu) — bu yüzden `schema-reference.md`/`rls-matrix.md`/vb. artık bu turdaki değişiklikleri YANSITMIYOR; ayrı bir dokümantasyon-senkronizasyon görevi gerekir. `0009`'un `NotificationType` CHECK listesi, `account_status` uygulaması, virüs taraması bilinçli olarak dokunulmadı (§19, madde 11-13).

## Yerel Migration Dry-Run Sonucu

> Bu bölüm, yukarıdaki tüm statik düzeltmelerden SONRA, tamamen yerel/izole bir Docker + Supabase CLI ortamına karşı GERÇEK bir `supabase db reset` dry-run'ının sonucunu belgeler — **hiçbir uzak/hosted Supabase projesine bağlanılmadı** (`supabase link`/`db push` hiç çalıştırılmadı, `supabase status` boyunca `.temp/project-ref` hiç oluşmadı), `.env`/`.env.local` hiç değiştirilmedi, uygulama kodu/`package.json`/lockfile hiç değiştirilmedi. Bu turda bulunan HER hata, ilgili migration dosyasının kendi içinde düzeltildi (0001–0021 sırası/numaralandırması korunarak) — hiçbir hata atlanmadı/`--ignore` edilmedi.

### Ortam
- **Docker Desktop:** 4.84.0 (Engine 29.6.2), WSL2 arka uç. Kurulum sırasında bu makineye özgü, migration setiyle İLGİSİZ bir Windows/WSL2 önkoşul sorunu (WSL Store paketinin eski/bozuk bir sürümü, `REGDB_E_CLASSNOTREG`) çözüldü — ayrıntı bu konuşmanın kendisinde, migration'larla bir ilgisi yok, bu belgeye dahil edilmedi.
- **Supabase CLI:** 2.111.0, `npx supabase` ile (proje `package.json`/lock dosyası hiç değişmedi — çalıştırma öncesi/sonrası hash'leri birebir aynı, doğrulandı).
- `supabase init` ile yalnız `supabase/config.toml` + `supabase/.gitignore` oluşturuldu (`project_id = "malsevk-2"`, Postgres 17) — mevcut hiçbir dosyaya dokunulmadı, hiçbir uzak proje referansı yok.

### Bulunan gerçek hatalar ve düzeltmeleri

Statik incelemenin YAKALAYAMAYACAĞI türden, yalnız gerçek `CREATE FUNCTION`/`GRANT` çalıştırmasıyla ortaya çıkan **4 bağımsız, gerçek hata sınıfı** bulundu:

1. **`0015_rpc_offer_functions.sql` — plpgsql "record variable cannot be part of multiple-item INTO list" (SQLSTATE 42601).** `accept_offer`/`reject_offer`/`start_work`/`record_agreement_failure`/`confirm_completion`/`dispute_completion`/`resolve_completion_dispute`/`submit_rating` (8 fonksiyon) hepsinde `select o[.*], j.diger_kolon into v_offer[, v_diger]` kalıbı vardı — plpgsql'in kesin kuralı: bir satır/record tipli değişken (`v_offer public.offers`) bir INTO listesinde ANCAK TEK BAŞINA yer alabilir, başka HERHANGİ bir hedefle birlikte olamaz. `confirm_completion`'da bu `supabase db reset`'i gerçekten durdurdu; diğer 7'sinde (tek INTO hedefi ama select listesi `o.*` + ekstra kolon içeriyordu) CREATE zamanında hata vermiyordu ama çalışma zamanında kolon-sayısı uyuşmazlığına yol açardı — üstelik 3'ünde (`reject_offer`/`start_work`/`record_agreement_failure`) o ekstra değer `returning * into v_offer` ile ÜZERİNE YAZILDIKTAN SONRA tekrar okunuyordu (sessizce kaybolurdu). **İlk düzeltme denemesi** (`o.*`'yi çıplak `o`'ya çevirmek) YETERSİZ çıktı — ikinci bir gerçek `db reset` denemesi AYNI hatayı `accept_offer`'da tekrar verdi, çünkü asıl kural INTO hedef listesinin KENDİSİYLE ilgili, select tarafındaki ifadeyle değil. **Gerçek düzeltme:** her fonksiyonda `v_offer`'ı tek başına dolduran bir `select o into v_offer ...` + hemen ardından `v_offer.job_id`'yi kullanan AYRI bir `select ... into v_diger_degisken ... from public.jobs ...`. Bu, statik SQL incelemesiyle asla yakalanamayacak, yalnız gerçek çalıştırmayla ortaya çıkan bir bulguydu.
2. **`0019_storage_policies.sql` — "must be owner of table buckets"/"must be owner of table objects" (SQLSTATE 42501).** `comment on table storage.buckets is ...` ve `alter table storage.objects enable row level security;` ikisi de `storage.buckets`/`storage.objects`'in gerçek sahibi olan `supabase_storage_admin`'i değil, migration'ı uygulayan `postgres` rolünü gerektiriyordu — Postgres'te COMMENT/ALTER TABLE için SAHİPLİK şart, superuser bile olsa. İkisi de kaldırıldı: yorum düz bir SQL yorumuna çevrildi (işlevsel kayıp yok), `ENABLE ROW LEVEL SECURITY` satırı tamamen gereksizdi çünkü Supabase, `storage.objects` üzerinde RLS'yi kendi proje bootstrap'inin bir parçası olarak zaten etkinleştiriyor (aşağıdaki CREATE POLICY'ler RLS açık/kapalı olmasından bağımsız çalışır). **Bu, yalnız yerel ortama özgü değil — gerçek/hosted bir Supabase projesinde de AYNEN aynı şekilde başarısız olurdu.**
3. **`0003_profiles_and_provider_catalog.sql` / `0004_operations_jobs_photos.sql` — eksik `revoke all` (gerçek yetki sızıntısı, statik incelemede görünmüyordu).** Canlı veritabanında (`information_schema.role_table_grants` ile doğrudan sorgulanarak) `public.profiles`, `public.provider_profiles`, `public.jobs` tablolarının `anon`/`authenticated`'e **`TRUNCATE`, `REFERENCES`, `TRIGGER`** yetkilerini (Supabase'in proje bootstrap'inin varsayılan/miras yetkileri üzerinden, hiçbir migration bunu açıkça vermemişken) taşıdığı bulundu — bu üç tablo, dosyalarında hiçbir zaman `revoke all ... from authenticated, anon;` almamıştı (aynı dosyalardaki `operations`/`job_photos`/`ratings`/`provider_services` gibi diğer tablolar bunu doğru şekilde alıyordu). **`TRUNCATE` RLS politikalarına TABİ DEĞİLDİR** — yani bu haliyle herhangi bir `authenticated` kullanıcı (ve `jobs` özelinde teorik olarak PUBLIC rolü üzerinden bile) tüm `profiles`/`provider_profiles`/`jobs` tablosunu tek komutla silebilirdi, RLS'in var olup olmaması hiç fark etmeksizin. Düzeltme: üç tabloya da `revoke all on ... from public, authenticated, anon;` eklendi, ardından yalnız gerekli `SELECT` açıkça geri verildi (`jobs` için `jobs_select_visible` politikasının kendi `to authenticated, anon` listesiyle birebir — misafir ilan gezinmesi kasıtlı korundu; `profiles`/`provider_profiles` için yalnız `authenticated`, `anon` hiç kapsanmıyor — politikalarının kendi `to authenticated` listesiyle birebir). **Bu bulgu, statik SQL dosyası incelemesiyle asla yakalanamazdı** — dosyaların kendisi bu yetkiyi hiç AÇIKÇA vermiyordu; eksiklik, olmayan bir "revoke all"dı ve yalnız gerçek bir Supabase projesinin kendi varsayılan yetki modeline karşı çalıştırılarak ortaya çıkabilirdi.
4. **Test metodolojisi notu (migration hatası DEĞİL):** İlk negatif güvenlik testi turunda, `set_config(..., true)` (yalnız o anki otomatik-commit edilen tek ifadeye özel) ile ayarlanan `request.jwt.claim.sub`, bir sonraki (ayrı) ifadeye taşınmadığı için `auth.uid()` bazı testlerde `NULL` döndü — bu da yanlışlıkla bir yetkisiz `delete_job()` çağrısının GERÇEKTEN başarılı olmasına (iş kuralı hatası değil, `IF NULL THEN` plpgsql'de false sayıldığı için) yol açtı. Kök neden teşhis edilip (`BEGIN; SET LOCAL; ...; ROLLBACK;` deseniyle) düzeltildikten sonra testler yeniden, temiz bir `db reset`'in ardından çalıştırıldı — bkz. aşağıdaki negatif test sonuçları.

### İlk `supabase db reset`/`start` sonucu

**BAŞARISIZ** (beklendiği gibi) — sırayla yukarıdaki 1-2 numaralı hata sınıflarına çarpıldı, her biri düzeltildi, yeniden denendi. Tam hata mesajları ve düzeltilen dosyalar yukarıda madde madde belgelendi.

### Düzeltmeler sonrası tam uygulama (ilk gerçek başarılı çalıştırma)

`supabase start` (temiz, boş bir Docker ortamından) **21 migrasyonun TAMAMINI hatasız uyguladı** (`0001`→`0021`), tam Supabase yığını (Postgres 17.6, GoTrue, PostgREST, Storage API, Realtime, pg_meta, Studio, Kong, vector, logflare) ayağa kalktı, `EXIT_CODE=0`.

### İkinci tam çalıştırma (idempotency doğrulaması)

`supabase db reset` (veritabanını sıfırdan yeniden oluşturup 21 migrasyonu baştan uygulayan gerçek bir ikinci tam-set çalıştırması) **hatasız tamamlandı**, `EXIT_CODE=0`. Her `DROP TRIGGER/POLICY IF EXISTS` beklenen, zararsız `NOTICE (00000): ... does not exist, skipping` çıktısını verdi (hata değil) — 15 tetikleyici + 32 politikanın (22 `public` + 10 `storage`) TAMAMI için. Madde 3'teki yetki düzeltmesinden sonra **üçüncü** bir tam çalıştırma da hatasız tamamlandı (`EXIT_CODE=0`) — toplamda migrasyon seti, düzeltmeler dahil, en az iki ardışık temiz `db reset` ile doğrulandı.

### Gerçek şema doğrulama sonuçları (canlı veritabanına karşı, salt-okunur sorgular)

| Kontrol | Sonuç |
|---|---|
| `public` şemasındaki temel tablo sayısı | 19 (beklenen — audit_logs, contact_messages, job_activity_events, job_photos, jobs, legal_consents, notifications, offer_status_history, offers, operations, profiles, provider_document_consents, provider_document_reviews, provider_documents, provider_profiles, provider_services, ratings, recently_viewed_jobs, service_categories) |
| View sayısı | 15 |
| RLS etkin tablo sayısı | 19/19 (tümü) |
| Toplam politika sayısı | 32 (22 `public` + 10 `storage.objects`) |
| Toplam tetikleyici sayısı | 15 |
| Toplam fonksiyon sayısı | 69 — hepsi `postgres` sahipli; GRANT/REVOKE durumu §"Uygulanan Migration Düzeltmeleri" → 0012 notunda belgelenen sınıflandırmayla BİREBİR eşleşti (10 dar-kapsamlı + 11 tam-kilitli + geri kalanı iş RPC'leri) |
| `offers.estimated_duration` tipi | `integer`, nullable — ✅ tasarımla eşleşiyor |
| `offers.currency` CHECK içeriği | `ANY (ARRAY['TRY','USD','EUR'])` — ✅ EUR dahil |
| `contact_messages` kolonları | 16/16 tasarlanan kolon (read_at/responded_at dahil) mevcut |
| `service_categories` satır sayısı | 27, `sort_order` 0-26, ilk 5 satır (nakliye/gumruk-musavirligi/lashing-unlashing/gozetim-hizmetleri/konteyner-dolum-bosaltim) beklenen sırada; eski/kaldırılmış 16 id'nin (birleştirme-öncesi 6 + REMOVED_CATEGORY_IDS 10) hiçbiri yok (0 satır) |
| `storage.buckets` | 3 bucket (job-photos public 10MB, provider-logos public 10MB, provider-documents private 15MB) — tasarımla birebir |
| `pg_cron` zamanlanmış görevler | 4/4 (`*/15 * * * *`, `0 * * * *`, `0 3 * * *`, `0 4 * * 0`) — dosyalarla birebir |
| Yüklü extension'lar | pgcrypto, pg_cron, pg_net, uuid-ossp, pg_stat_statements, supabase_vault, plpgsql — beklenenle tutarlı |
| `jobs`/`profiles`/`provider_profiles` yetki düzeltmesi sonrası | Üçü de yalnız tasarlanan SELECT'i taşıyor (`jobs`: anon+authenticated; `profiles`/`provider_profiles`: yalnız authenticated) — TRUNCATE/REFERENCES/TRIGGER tamamen temizlendi, diğer 16 temel tablonun tümü zaten temizdi |

### Negatif güvenlik testleri (9/9 doğru şekilde engellendi + 1 pozitif kontrol)

Gerçek test kullanıcıları (`auth.users`+`public.profiles`, 2 hizmet-alan + 1 hizmet-veren + 1 admin) ve gerçek bir Nakliye ilanı ile, `SET ROLE`/`SET LOCAL "request.jwt.claim.sub"` (Supabase'in yerel RLS test için kendi belgelediği yöntem — `auth.uid()`'in gerçek kaynak koduyla doğrulandı) kullanılarak:

| # | Test | Beklenen | Gerçek sonuç |
|---|---|---|---|
| 1 | `anon` doğrudan `INSERT INTO public.jobs` | Engellenmeli | ✅ `permission denied for table jobs` |
| 2 | `anon` `TRUNCATE public.jobs` | Engellenmeli | ✅ `permission denied for table jobs` (madde 3'teki düzeltmenin doğrudan doğrulaması) |
| 3 | `authenticated`, başka bir kullanıcı adına `legal_consents`'e doğrudan `INSERT` | Engellenmeli | ✅ `permission denied for table legal_consents` |
| 4 | `authenticated`, başka bir kullanıcı adına `notifications`'a doğrudan `INSERT` | Engellenmeli | ✅ `permission denied for table notifications` |
| 5 | `authenticated`, `create_notification()`'ı DOĞRUDAN çağırma | Engellenmeli | ✅ `permission denied for function create_notification` |
| 6 | Sahibi olmayan kullanıcının `delete_job()` çağırması | `MLK56` | ✅ `MLK56: not the owner of this job` |
| 7 | Admin olmayan kullanıcının `review_contact_message()` çağırması | `MLK50` | ✅ `MLK50: admin role required` (`is_admin()` doğrudan `false` döndüğü doğrulandı) |
| 8 | Nakliye teklifinde `estimated_duration` eksik | `MLK66` | ✅ `MLK66: estimated_duration must be an integer between 1 and 60 for Nakliye jobs` |
| 9 | Desteklenmeyen para birimi (`GBP`) ile teklif | CHECK ihlali | ✅ `offers_currency_check` CHECK kısıtı ihlali |
| Kontrol | Aynı sağlayıcı, geçerli parametrelerle (TRY, estimated_duration=5) teklif | BAŞARILI olmalı | ✅ `status='pending'` bir `offers` satırı döndü — 8/9 testin gerçekten doğru sebepten başarısız olduğunu (genel bir engelleme değil) kanıtlıyor |

Sağlık kontrolü: 9 testin hiçbiri paylaşılan test verisinde kalıcı bir yan etki bırakmadı (mutasyon içerenler `ROLLBACK` içinde çalıştırıldı; ilk, hatalı test turunda `set_config(...,true)`'nin bir sonraki ifadeye taşınmaması yüzünden yanlışlıkla gerçekleşen bir `delete_job()` yan etkisi, tam bir `db reset` ile temizlendi ve testler düzeltilmiş metodolojiyle sıfırdan tekrarlandı).

### Yerel/uzak (hosted) ortam farkları — bilinmesi gerekenler

- Bu dry-run, GoTrue üzerinden gerçek bir kayıt/login akışı ÇALIŞTIRMADI — `auth.uid()`'i `request.jwt.claim.sub` GUC'siyle doğrudan simüle etti (Supabase'in kendi belgelediği, PostgREST'in gerçek bir istekte AYNI GUC'leri doğrulanmış bir JWT'den nasıl ayarladığının birebir karşılığı) — bu nedenle GoTrue'nin kendi e-posta/parola/JWT üretim mantığı bu turun kapsamı dışında kaldı (migration setinin kendisi zaten Auth şemasına dokunmuyor).
- Supabase Storage API'nin kendisi (gerçek dosya yükleme/indirme HTTP akışı) test edilmedi — yalnız `storage.objects`/`storage.buckets` üzerindeki SQL politikaları/GRANT'lar doğrulandı (bu migration setinin kapsadığı tek katman).
- Edge Functions ve Realtime bu migration setinde hiç kullanılmıyor, bu yüzden test edilmedi (kapsam dışı, eksiklik değil).
- Madde 2'deki (`storage.buckets`/`storage.objects` sahiplik hatası) bulgu **yerel ortama özgü değil** — gerçek/hosted bir Supabase projesinde aynı `postgres` rolü aynı şekilde bu tabloların sahibi olmadığından, birebir aynı hatayla karşılaşılırdı. Madde 1 ve 3'teki bulgular da mimari olarak ortam-bağımsızdır (plpgsql'in kendi dil kuralı; Supabase'in kendi varsayılan yetki modeli, yerel VE hosted'da aynı).

## Dokümantasyon Senkronizasyonu

> Bu bölüm, `docs/database/**` altındaki tüm `.md` dosyalarının yerel dry-run ile doğrulanmış `supabase/migrations/0001`–`0021` şemasıyla senkronize edildiği ayrı bir turu belgeler (2026-08-03, aynı gün). Kaynak önceliği: (1) yerel dry-run ile doğrulanmış migration dosyaları, (2) bu belge, (3) mevcut uygulama kodu, (4) eski `docs/database` belgeleri — çelişki olduğunda eski belge asla doğru kabul edilmedi. Hiçbir migration dosyası, uygulama kodu, `.env`, `package.json`/lockfile değiştirilmedi; hiçbir uzak Supabase bağlantısı kurulmadı; bu tur salt dokümantasyon senkronizasyonudur.

**Sayısal doğrulama (bu turda migration dosyalarından yeniden sayılarak doğrulandı — önceki rapordan körü körüne kopyalanmadı):** `grep -c "create table if not exists public\."` → **19** temel tablo (Faz 1); `create view`/`create or replace view` → **15**; `create policy` → **32**; `create trigger` → **15**; `create (or replace) function public.` → **69**. Bu dört sayı, yerel dry-run'ın canlı veritabanı sorgularıyla bulduğu sayılarla BİREBİR eşleşti — statik dosya sayımı ile gerçek çalıştırma sonucu arasında hiçbir fark bulunmadı. Toplam tablo sayısı (Faz 1 + Faz 2 taslağı 9 + Faz 3 taslağı 7) = **35** (önceki `schema-reference.md`/`architecture.md`'nin "34" ve "38" değerleri YANLIŞTI — `contact_messages`'ın 0021'de eklenmesiyle Faz 1 18'den 19'a çıktı).

| Dosya | İncelendi mi? | Değiştirildi mi? | Hangi konular güncellendi? | Açık kalan çelişki var mı? |
|---|---|---|---|---|
| `schema-reference.md` | ✅ | ✅ | Tablo sayısı 34→35, Faz 1 18→19 tablo (`contact_messages` eklendi), `currency` CHECK'ine EUR, `estimated_duration` alan-tipi kararı satırı eklendi, `0001–0020`→`0001–0021` | Yok |
| `rls-matrix.md` | ✅ | ✅ | `contact_messages` bölümü eklendi, `jobs`/`profiles`/`provider_profiles`'daki gerçek TRUNCATE yetki sızıntısı bulgusu ve düzeltmesi eklendi | Yok |
| `rpc-reference.md` | ✅ | ✅ | `delete_job`, `record_provider_document_consent`, `record_legal_consent`, `submit_contact_message`, `review_contact_message` eklendi; `create_offer`'ın `estimated_duration` yeniden tasarımı; MLK66'nın yeniden kullanımı; MLK92–99 hata kodları eklendi | Yok |
| `architecture.md` | ✅ | ✅ | "Hiçbir migration hiç uygulanmadı" iddiası düzeltildi (yerel dry-run gerçekleşti, uzak hâlâ yok); tablo sayısı 34→35; §8'e yerel dry-run'da bulunan 4 hata eklendi; doküman indeksine bu validation belgesi eklendi | Yok |
| `storage-plan.md` | ✅ | ✅ | `has_admin_permission('documents.view')` (Faz 2 kavramı) → `is_admin()` (Faz 1 gerçeği) düzeltildi; 0019'un sahiplik hatası bulgusu eklendi; Storage HTTP akışının doğrulanmadığı açıkça belirtildi | Yok |
| `admin-permissions.md` | ✅ | ✅ | `review_contact_message()` admin yeteneği tablosuna eklendi | Yok |
| `migration-strategy.md` | ✅ | ✅ | `0001–0020`→`0001–0021`, `contact_messages`'ın veri göçü kapsamı dışında olma gerekçesi eklendi | Yok — "hiçbir gerçek kullanıcı verisi göçü hiç yapılmadı" iddiası hâlâ doğru (bu doküman şema dry-run'ından tamamen ayrı bir konuyu, kullanıcı VERİSİ göçünü kapsar) |
| `relationship-map.md` | ✅ | ✅ | `contact_messages`'ın FK ilişkileri (user_id, reviewed_by_admin_id, ikisi de nullable) grafiğe eklendi | Yok |
| `index-plan.md` | ✅ | ✅ | `contact_messages`'ın 2 index'i eklendi | Yok |
| `test-plan.md` | ✅ | ✅ | §1'in artık gerçekten çalıştırıldığı ve geçtiği belirtildi; hangi negatif testlerin gerçekten doğrulandığı işaretlendi; `contact_messages` için 2 yeni test satırı eklendi; `0001–0020`→`0001–0021` | Yok |
| `rollback-strategy.md` | ✅ | ✅ | Yerel dry-run'ın atılabilir/geçici olduğu netleştirildi (kalıcı bir dağıtım YOK); `contact_messages` (0021) rollback satırı eklendi; `0001–0020`→`0001–0021` | Yok |
| `future-escrow-architecture.md` | ✅ | ✅ | Yalnız `0001–0020`→`0001–0021` sürüm referansı (bu belgenin escrow tasarımı içeriği Faz 1'den tamamen bağımsız, başka değişiklik gerekmedi) | Yok |
| `subscriptions-and-quotas.md` | ✅ | ❌ (zaten doğru) | — | Yok — Faz 1'in `get_active_job_limit()` sabit-5 davranışı ve günlük-kota-yokluğu iddiaları hâlâ doğru, güncel `create_offer()`'daki `estimated_duration` değişikliğine hiç değinmiyordu (o zaten konusu değil) |
| `payment-readiness.md` | ✅ | ❌ (zaten doğru) | — | Yok — tamamen Faz 3 kapsamlı, Faz 1'in hiçbir tablosuna/RPC'sine referans vermiyor |
| `future-migrations/MANIFEST.md` | ❌ | ❌ | — | İncelenmedi — görev kapsamı `docs/database/**`'in `.md` dosyalarını kapsıyordu ama bu dosya Faz 2/3'ün devreye alma sırasını belgeler, Faz 1'in bugünkü şemasına dair bir iddiası yok; ayrı bir turda gözden geçirilebilir |
| `future-migrations/phase2/*.sql`, `phase3/*.sql` | — | ❌ | — | SQL dosyaları, `.md` değil — görev kapsamı dışında; zaten hiçbir zaman Faz 1'e uygulanmadılar |

## 21. Önerilen Nihai Migration Sırası

Dosya numaralandırması (0001–0020) zaten bağımlılık sırasına uygun ve değiştirilmemeli. Yukarıdaki düzeltmeler **var olan dosyaların içinde** yapılmalı (görev talimatı gereği bu belge onları değiştirmiyor) — yeni bir tablo gerekiyorsa (`contact_messages`) `0021` olarak eklenmeli, mevcut hiçbir dosyanın numarası değişmemeli. Düzeltmeler tamamlandıktan sonra sıralama aynen korunur: `0001→0020` (+varsa `0021`), her biri `supabase db reset` ile boş bir yerel/test projesine karşı sırayla denenmeli.

## 22. Uygulama Fazları

1. **Faz A (bu belge + düzeltmeler)**: §20'deki düzeltmeler taslak dosyalara uygulanır (Supabase'e HİÇBİR şey gönderilmeden, yalnız dosya içeriği). `package.json`'da henüz `@supabase/supabase-js` bağımlılığı yok — bu da eklenmeli (yalnız `@neondatabase/serverless`+`drizzle-orm` var, ikisi de bugün yalnız `/api/health` route'unda kullanılıyor, iş mantığına bağlı değil).
2. **Faz B (dry-run doğrulama)**: Yeni, boş bir Supabase projesine (veya yerel `supabase start`) karşı `0001`–`0020`(+`0021`) sırayla uygulanır; `test-plan.md`'nin §1–§2 statik/kısıt testleri çalıştırılır.
3. **Faz C (RLS/RPC fonksiyonel test)**: `test-plan.md`'nin §3–§10'u (rol matrisi, race condition, transaction rollback, storage, contact-leak, admin izin testleri) gerçek bağlantılarla çalıştırılır.
4. **Faz D (Auth kesimi)**: `migration-strategy.md §1-§2` — Auth-first yaklaşımı, zorunlu şifre-sıfırlama duyurusu.
5. **Faz E (veri geçişi)**: `migration-strategy.md §5`'in 10 adımlık sırası; `DEV_ACCOUNTS` taşınmaz, yeniden-seed edilir; `service_categories` düzeltilmiş `0020`'den seed edilir.
6. **Faz F (uygulama kodu kesimi)**: `app/_lib/*.ts`'in localStorage çağrılarının Supabase client çağrılarına geçirilmesi — **bu belgenin ve bu görevin kapsamı DIŞINDA**, talimat gereği hiç yapılmadı.
7. **Faz G (blob senkronizasyonu)**: `migration-strategy.md §6`'nın istemci-taraflı ilk-giriş senkronizasyonu.

## 23. Geri Dönüş Planı

`rollback-strategy.md`'nin planı (§4'te tam özetlendi) doğrudan kullanılabilir: ilk uygulama için en güvenli geri dönüş, uygulamadan hemen önce alınan bir Supabase PITR/`pg_dump` yedeğine dönmektir (boş proje için kayıpsız ve önemsizdir). Kısmi geri alma gerekirse, dosya grubu başına ters sırada (`0020→0002`) `DROP` uygulanır — bu belgenin kendisi hiçbir `DROP` içermiyor ve hiçbir migration dosyasını değiştirmediği için, bugünkü `pre-db-migration-baseline` etiketi zaten en güvenli geri dönüş noktasıdır (uygulama kodu ve migration taslakları o an itibarıyla tutarlı durumdaydı).

## 24. Kesin Sonraki Adım

**~~§20'deki düzeltmeleri mevcut migration dosyalarına uygulamak~~ — ✅ TAMAMLANDI.** **~~Boş, gerçek bir Supabase projesine karşı `supabase db reset` ile bir dry-run~~ — ✅ TAMAMLANDI** (bkz. "Yerel Migration Dry-Run Sonucu" bölümü) — tamamen yerel/izole bir ortamda, 4 gerçek hata bulunup düzeltildi, iki-üç ardışık `db reset` hatasız, 9/9 negatif güvenlik testi + 1 pozitif kontrol geçti.

Kesin sonraki adım artık bu görevin kapsamı dışında kalan şu ikisi: (1) bu yerel dry-run'ın kapsamadığı katmanların (GoTrue'nun gerçek kayıt/JWT akışı, Storage API'nin gerçek dosya yükleme HTTP akışı) ayrı bir turda doğrulanması — muhtemelen gerçek bir tarayıcı/`curl` ile GoTrue'ya karşı kayıt olup dönen JWT ile RLS'in uçtan uca çalıştığının teyidi; (2) `docs/database/*.md` dosyalarının (schema-reference.md, rls-matrix.md, vb.) bu turdaki tüm değişiklikleri yansıtacak şekilde güncellenmesi — bilinçli olarak bu turun kapsamı dışında bırakıldı (yalnız `supabase/migrations/**`). Bu iki adım tamamlanmadan önce migration seti yalnızca "yerel SQL/RPC katmanında doğrulanmış" sayılmalı, "production'a hazır" değil — asıl uzak/hosted bir Supabase projesine ilk gerçek uygulama (`supabase link`+`db push`) hâlâ ayrı, açıkça yetkilendirilmesi gereken bir adımdır.
