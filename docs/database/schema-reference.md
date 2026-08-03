# MALSEVK — Schema Reference

Alan bazlı DDL, migration dosyalarının kendisinde yaşar (Faz 1: `supabase/migrations/0001`–`0020`; Faz 2/3 taslakları: `docs/database/future-migrations/`); bu doküman bir indeks + tasarlanırken ortaya çıkan her **Açık Karar**'ın tek toplandığı yerdir. Rehber ilkeler için [architecture.md](architecture.md)'ye bakın.

**Toplam tablo sayısı: 34** (önceki "38" ve ara-dönem "35" sayıları YANLIŞ — bkz. altta, `notification_states`'in birleştirilmesi bu sayıyı 35'ten 34'e indirdi).

## Tablo indeksi (faz sınıflandırmasıyla)

### Faz 1 — Çekirdek Pazaryeri (18 tablo, `supabase/migrations/`)

| Tablo | Migration | Kaynak eşlemesi | Not |
|---|---|---|---|
| `service_categories` | 0002 | `service-catalog.ts#SERVICE_CATEGORY_GROUPS` (kod, henüz depo değil) | Kod, ilk göçte hâlâ tek doğruluk kaynağı |
| `profiles` | 0003 | `StoredUser` (passwordHash/email hariç) | `account_status` Faz 1'in suspend_user() ihtiyacı için gerekli |
| `provider_profiles` | 0003 | `StoredUser.providerProfile` | Ayrı tablo — kaynağın iki-editör-yüzeyi ayrımı |
| `provider_services` | 0003 | `StoredProviderService` | Zaten ilişkiseldi, doğrudan taşındı |
| `operations` | 0004 | Kaynakta karşılığı yok (yalnız `Job.operationId`) | `total_service_count` YOK (bkz. Açık Karar #10 — kaldırıldı) |
| `jobs` | 0004 | `Job` (`types.ts`) | |
| `job_photos` | 0004 | `JobPhoto` + `photo-blob-store.ts` blob | |
| `offers` | 0005 | `Offer` (`types.ts`) | `offers_one_settled_per_job` GÜVENLİK index'i eklendi |
| `offer_status_history` | 0005 | Kaynakta karşılığı yok — yeni | Append-only |
| `ratings` | 0006 | `Rating` (`types.ts`) | |
| `provider_documents` | 0007 | `StoredProviderDocument` | |
| `provider_document_reviews` | 0007 | `StoredProviderDocumentReview` | Append-only |
| `provider_document_consents` | 0007 | `StoredProviderDocumentConsent` | |
| `legal_consents` | 0008 | `LegalConsentRecord` | |
| `notifications` | 0009 | Kaynakta canlı türetilir — şimdi kalıcı | `read_at`/`dismissed_at` BURADA (bkz. Açık Karar'lar altında birleştirme kararı) |
| `recently_viewed_jobs` | 0009 | `recently-viewed-jobs.ts` | Aktif yazma yolu doğrulandı, korundu |
| `job_activity_events` | 0010 | Kaynakta karşılığı yok — yeni, SADELEŞTİRİLMİŞ | Yalnız 5 ilan-seviyeli olay (teklif olayları YOK — bkz. offer_status_history ile tekrar önleme) |
| `audit_logs` | 0010 | Kaynakta karşılığı yok — yeni | Faz 1'in "Gerekli audit kaydı" ihtiyacı |

### Faz 2 — Gelişmiş Yönetim ve Abonelik (9 tablo, `docs/database/future-migrations/phase2/`)

| Tablo | Taslak dosya | Not |
|---|---|---|
| `admin_permissions` | `0001_admin_rbac.sql` | İnce taneli izin kataloğu |
| `admin_roles` | `0001_admin_rbac.sql` | 5 başlangıç rolü |
| `admin_role_permissions` | `0001_admin_rbac.sql` | Rol↔izin N:N |
| `admin_user_roles` | `0001_admin_rbac.sql` | Kullanıcı↔rol atamaları, C.4 son-admin koruması `revoke_admin_role()`'da |
| `subscription_plans` | `0003_subscriptions_and_quotas.sql` | `free` planı Faz 1 davranışını birebir yansıtır |
| `subscription_plan_limits` | `0003_subscriptions_and_quotas.sql` | |
| `user_subscriptions` | `0003_subscriptions_and_quotas.sql` | |
| `subscription_status_history` | `0003_subscriptions_and_quotas.sql` | Append-only |
| `user_limit_overrides` | `0003_subscriptions_and_quotas.sql` | |

### Faz 3 — Ödeme ve Finans (7 tablo, `docs/database/future-migrations/phase3/`)

| Tablo | Taslak dosya |
|---|---|
| `payment_customers` | `0001_payment_foundations.sql` |
| `payment_transactions` | `0001_payment_foundations.sql` |
| `payment_attempts` | `0001_payment_foundations.sql` |
| `payment_refunds` | `0001_payment_foundations.sql` |
| `invoices` | `0001_payment_foundations.sql` |
| `payment_webhook_events` | `0002_payment_webhook_events_and_outbox.sql` |
| `outbox_events` | `0002_payment_webhook_events_and_outbox.sql` |

**18 + 9 + 7 = 34.**

## Silinen/birleştirilen yapılar (Faz 1 sadeleştirmesinin sonucu)

- **`notification_states`** — TAMAMEN KALDIRILDI, `notifications.read_at`/`dismissed_at`'e birleştirildi (bkz. `0009_notifications.sql`'in başlığı). Gerekçe: `recipient_id` her zaman tekil; ayrı tablo doğrulanmamış bir çoklu-alıcı ihtiyacı için tasarlanmıştı.
- **`operations.total_service_count`** — KOLON KALDIRILDI. `operation_progress` view'ı artık `count(*) where operation_id=X and deleted_at is null` ile canlı hesaplıyor — bir kardeş ilan soft-delete edildiğinde sayı doğru şekilde küçülür (bkz. `0004_operations_jobs_photos.sql`'in başlığı).
- **`job_activity_events`** — TABLO KORUNDU ama olay tipi kümesi 13'ten 5'e düşürüldü (teklif olayları kaldırıldı, `offer_status_history` ile tekrar önlendi).

## Konsolide alan-tipi kararları

| Konu | Karar | Gerekçe |
|---|---|---|
| ID'ler | `uuid default gen_random_uuid()` | `crypto.randomUUID()` ile birebir eşleşir |
| Para | `numeric(12,2)`, asla `float`/`double` | `MAX_OFFER_AMOUNT = 999,999,999`'u rahatça kapsar (doğrulanmış) |
| Para birimi | `text check (in ('TRY','USD'))` | `types.ts#Currency` ile birebir |
| Telefon | `text check (phone ~ '^\+905\d{9}$')`, nullable | `phone.ts#normalizePhoneNumber` çıktısıyla birebir |
| Tarihler (`work_date`/`work_end_date`) | `date` | Kaynağın `<input type="date">`'i de zaman bileşeni taşımıyor |
| Diğer her zaman damgası | `timestamptz` | Asla naive/local timestamp değil |
| Status/reason/type kolonları | `text` + `CHECK`, native `ENUM` değil | Bkz. architecture.md §2 |

## Açık Kararlar (her migration dosyasının kendi notlarından konsolide edilmiş)

1. **`republished_from_job_id`/`republished_to_job_id` döngü önleme** (0004): iki partial unique index yaygın durumları önler; RPC katmanını tamamen bypass eden, elle hazırlanmış bir döngü kanıtlanabilir şekilde imkansız değildir. *Karar: bu artık risk, RLS'in bu kolonlara doğrudan client yazımını zaten engellemesi göz önüne alındığında kabul edilebilir mi?*
2. **İlan foto sayısı uygulama katmanı** (0004): 1–10 sınırı yalnız RPC katmanında (create_job/update_job/create_operation_with_jobs/republish_job — DÖRDÜ DE), tablo tetikleyicisi değil.
3. **`ratings.comment`** (0006): yeni alan, kaynakta uzunluk kuralı yok. *Karar: UI'ye çıkmadan önce maks uzunluk/moderasyon ihtiyacı.*
4. **`provider_profiles.verification_status`** (0003): kolon var, Faz 1'de hiçbir RPC/view bunu okumuyor/yazmıyor (verify_provider() Faz 2'ye taşındı). *Karar: "doğrulanmış" ne anlama gelmeli?*
5. **Günlük teklif kotası "geri çekme/reddedilmede iade"** (Faz 2): mevcut tasarım İADE ETMEZ (muhafazakâr varsayılan). *Karar subscriptions-and-quotas.md'ye göre.*
6. **`account_status = 'suspended'` uygulaması** (0003/0016): bugün yalnız bir bayrak — hiçbir Faz 1 RLS/RPC'si bunu okuyup bir kullanıcıyı gerçekten engellemiyor. *Karar: hangi eylemler (create_job, create_offer, giriş) gerçekten kontrol etmeli?*
7. **Bildirim/anonim-legal-consent saklama pencereleri** (0018): 180 gün / 90 gün makul muhafazakâr varsayılanlar, doğrulanmış bir ürün gereksinimi değil.
8. **WebP standardizasyonu** (0019, işlenmiş fotoğraflar için): kasıtlı, işaretli bir sapma — bkz. storage-plan.md.
9. **`operations.title`** (0004): kaynakta karşılığı yok, nullable, hiçbir sorgu tarafından kullanılmıyor. *Karar: nasıl doldurulmalı (varsa)?*
10. ~~**`operations.total_service_count` saklanmalı mı?**~~ **ÇÖZÜLDÜ bu turda**: kolon kaldırıldı, canlı hesaplamaya geçildi (bkz. yukarı, "Silinen/birleştirilen yapılar").
11. **`service_categories` için yazma RPC'si yok** (0002): yalnız ilk seed — bir kategoriyi deaktive etmek/adını düzeltmek için hiçbir client yolu yok. *Karar: bir `update_service_category()` admin RPC'si gerekli mi (Faz 2'nin settings.manage izniyle)?*
12. **`provider_documents.scan_status` yok** (0007): virüs taraması ne Faz 1'de ne de kaynak uygulamada var — bu boşluk `storage-plan.md`'de açıkça işaretli. *Karar: tarama eklendiğinde bir `scan_status`/`scanned_at` kolonu şimdiden mi eklenmeli?*
