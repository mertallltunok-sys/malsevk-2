# MALSEVK — Supabase/PostgreSQL Database Architecture

**Status: design draft, faz ayrımına tabi — ama artık gerçek, yerel bir ortamda doğrulanmış.** `supabase/migrations/` (Faz 1, `0001`–`0021`) tamamen izole, yerel bir Docker + Supabase CLI ortamına karşı gerçek bir `supabase db reset` ile baştan sona uygulandı, idempotency için ardışık kez tekrarlandı, ve 9 negatif güvenlik testi + 1 pozitif kontrolle doğrulandı — bkz. [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md)'in "Yerel Migration Dry-Run Sonucu" bölümü. **Hiçbir uzak/hosted Supabase projesine hâlâ hiç bağlanılmadı** (`supabase link`/`db push` hiç çalıştırılmadı) — bu, gerçek bir production/staging uygulamasından tamamen farklıdır ve o adım hâlâ ayrı, açıkça yetkilendirilmesi gereken bir sonraki iştir. **Faz 2 (Gelişmiş Yönetim ve Abonelik)** ve **Faz 3 (Ödeme ve Finans)** taslakları bilinçli olarak `docs/database/future-migrations/` altında, otomatik taranmayan bir konumda tutulur — hiçbiri hiçbir ortama (yerel dahil) hiç uygulanmadı. Bkz. [migration-strategy.md](migration-strategy.md) (veri göçü) ve `docs/database/future-migrations/MANIFEST.md` (faz devreye alma sırası).

**Tablo sayısı: 35** (34/38 değil — bkz. §8, `notification_states`'in `notifications`'a birleştirilmesi 35'i 34'e indirmişti, `0021_contact_messages.sql`'in yerel dry-run'da eklenmesi Faz 1'i 19 tabloya çıkarıp toplamı tekrar 35'e getirdi).

## 1. Kapsam ve faz yapısı

Bu doküman seti, MALSEVK'in bugün çalışan localStorage/IndexedDB veri katmanının yerini almak üzere üretime hazır bir PostgreSQL şeması (Supabase üzerinden) tasarlar — `app/_lib/` canlı kodunun doğrudan denetiminden alınmıştır ("kaynak uygulama" olarak anılır). Bir önceki teknik denetim raporunun (bu sohbet geçmişi) "ilk göç için gereksiz erken kapsam" bulgusu doğrultusunda, kapsam ÜÇ faza ayrılmıştır:

| Faz | Konum | Otomatik çalışır mı | İçerik |
|---|---|---|---|
| **Faz 1 — Çekirdek Pazaryeri** | `supabase/migrations/0001`–`0021` | **Evet** (yerel olarak gerçek çalıştırıldı ve doğrulandı — bkz. SUPABASE-MIGRATION-VALIDATION.md) | Kullanıcı hesapları, ilan/teklif/operasyon yaşam döngüsü, bildirimler, belgeler, puanlama, minimum admin, temel audit, Bize Ulaşın (`contact_messages`, 0021) |
| **Faz 2 — Gelişmiş Yönetim ve Abonelik** | `docs/database/future-migrations/phase2/` | **Hayır** | İnce taneli admin RBAC (4 tablo), abonelik/kota sistemi (5 tablo) |
| **Faz 3 — Ödeme ve Finans** | `docs/database/future-migrations/phase3/` | **Hayır** | Ödeme sağlayıcı-agnostik altyapı (7 tablo) |
| **Escrow/emanet** | `future-escrow-architecture.md` | — | Yalnız dokümantasyon, hiçbir fazda SQL yok |

Faz 1'in HİÇBİR tablosu/RPC'si/view'ı Faz 2 veya Faz 3'teki herhangi bir yapıya bağımlı DEĞİLDİR — bu, `future-migrations/MANIFEST.md`'nin sonundaki `grep` komutuyla doğrulanabilir bir iddiadır, varsayım değil.

## 2. Her migration dosyasında taşınan ortak ilkeler

- **PostgreSQL yerel tipleri**: her yerde `uuid` id, her an için `timestamptz`, `work_date`/`work_end_date` için `date`, her para tutarı için `numeric(12,2)` (asla `float`/`double`).
- **Yerel `ENUM` yerine CHECK kısıtları** — bkz. [0001_extensions_and_helpers.sql](../../supabase/migrations/0001_extensions_and_helpers.sql)'in başlığı.
- **Mevcut Türkçe status/reason DEĞERLERİ birebir korunur** — tablo/kolon *adları* İngilizce, ama bu değerler kaynak uygulamanın TypeScript union'larıyla kopyala-yapıştır uyumludur.
- **RLS + SECURITY DEFINER RPC'ler gerçek yetkilendirme sınırıdır**, client UPDATE'ler değil. Faz 1'in her durum geçişi `0014`–`0016`'da özel bir fonksiyondur; altındaki tablolarda o kolonlar için doğrudan client `UPDATE`/`INSERT`/`DELETE` grant'ı yoktur.
- **Append-only geçmiş tabloları hiç client yazımı kabul etmez** — `offer_status_history`, `provider_document_reviews`, `audit_logs` (Faz 1); `subscription_status_history` (Faz 2).
- **Soft delete (`deleted_at`)** discovery yüzeyinden kaybolması gereken her yerde — `profiles`, `jobs`, `job_photos`, `offers`, `ratings`, `provider_documents`, `notifications`. Bu şemadaki TEK hard delete, sahipsiz anonim `legal_consents` satırları için (bkz. [0018_scheduled_jobs.sql](../../supabase/migrations/0018_scheduled_jobs.sql)).
- **`updated_at`** tek paylaşılan tetikleyici fonksiyonuyla (`set_updated_at()`, `0001`) standardize edilir.
- **Her `SECURITY DEFINER` fonksiyon `search_path = public`'i sabitler** — bkz. `0012_rls_helpers.sql`'in başlık yorumu.

## 3. Bildirimler: türetilmiş vs. kalıcı — tek kasıtlı mimari değişiklik

Kaynak uygulama her bildirimi her okumada `Job`/`Offer` durumundan CANLI türetir (`notifications.ts#getNotificationsForSession`) — bugün bir notifications tablosu yok. Bu tasarım gerçek, kalıcı bir `notifications` tablosu (`0009_notifications.sql`) getirir — gerçek bir mimari değişikliktir, düz bir port değil:

1. Kaynak uygulamanın her okumada "bedava" elde ettiği tek-seferlik yazımı artık BİR ŞEY yapmalı — her durum-değiştiren RPC `create_notification()`'ı olayın tam anında çağırır; tek zaman-tetiklemeli, kullanıcı-eylemsiz bildirim (`ilan_yayin_suresi_doldu`) yerine `sweep_expired_job_listings()` zamanlanmış işi (`0018_scheduled_jobs.sql`) tarafından üretilir.
2. `notifications.event_key` + `UNIQUE(recipient_id, event_key)` (`0009`), `create_notification()`'ı iki kez çağırmayı zararsız bir no-op yapan idempotency mekanizmasıdır.

**Faz 1 kararı (görev bölüm 6):** `notification_states` AYRI tablosu **birleştirildi** — `read_at`/`dismissed_at` doğrudan `notifications` üzerinde iki nullable kolon. Gerekçe: `notifications.recipient_id` her zaman tekildir (doğrulanmamış bir çoklu-alıcı ihtiyacı için ayrı tablo tutmak spekülatif tasarımdır) — bkz. `0009_notifications.sql`'in başlık notu.

## 4. Faz 1'in minimum admin modeli

Faz 1, `is_admin()` (`profiles.role = 'admin'`, `0012_rls_helpers.sql`) TEK admin kapısını kullanır — kaynak uygulamanın bugünkü, tek düz admin rolü modelinin birebir aynısı. Bu kapı üzerinden Faz 1'de mevcut olan yetenekler: kullanıcıları görüntülemek, hesap askıya almak (son AKTİF admin'i askıya almaya karşı korumalı), ilanları görüntülemek/kapatmak, teklifleri incelemek, sağlayıcı belgelerini/faaliyet raporlarını incelemek, itiraz kayıtlarını incelemek, audit log görüntülemek. Bkz. `0016_rpc_document_notification_and_admin_functions.sql` ve `0017_views.sql`.

İnce taneli izin matrisi (`has_admin_permission(code)`, `admin_permissions`/`admin_roles`/`admin_role_permissions`/`admin_user_roles`) **Faz 2'ye taşındı** — bu, o dört tablonun ilk göç için erken olduğu değerlendirmesinin doğrudan sonucudur (bir önceki teknik denetim raporu). Faz 2 devreye alındığında Faz 1'in `is_admin()`-öz-kapılı view/RPC'leri, imzaları DEĞİŞMEDEN, `has_admin_permission(code)`-öz-kapılı hale getirilir — bkz. `docs/database/future-migrations/MANIFEST.md`.

## 5. Faz 1'in sabit kapasite/kota modeli

Kaynak uygulamanın bugün doğrulanmış tek gerçek kısıtı — `provider-capacity.ts#MAX_ACTIVE_JOBS = 5` — Faz 1'de `get_active_job_limit()` (`0012_rls_helpers.sql`) adlı TEK, merkezi, sabit-döndüren bir fonksiyonla korunur; abonelik tablolarına HİÇ bağımlı değildir. Günlük teklif kotası Faz 1'de YOKTUR çünkü kaynak uygulamada da yoktur (doğrulanmış — `app/_lib/offers.ts#createOffer`'da böyle bir kontrol yok).

Faz 2'nin abonelik/kota sistemi (`subscription_plans`, `subscription_plan_limits`, `user_subscriptions`, `subscription_status_history`, `user_limit_overrides`, `get_effective_limit()`) devreye alındığında, TEK yapılması gereken `get_active_job_limit()`'i `get_effective_limit(auth.uid(), 'max_active_jobs')`'i çağıracak şekilde `CREATE OR REPLACE` etmek ve `create_offer()`'a günlük kota kontrolünü geri eklemektir — hiçbir başka RPC değişmez. Bkz. [subscriptions-and-quotas.md](subscriptions-and-quotas.md) ve `future-migrations/MANIFEST.md`.

## 6. Ödeme ve escrow: Faz 3'e tamamen ayrıldı

**Ödemeler** (`docs/database/future-migrations/phase3/`) sağlayıcı-agnostik bir şemadır (7 tablo, idempotency anahtarları, webhook dedup, kart-verisi güvenlik ağı tetikleyicisi) — ama sıfır sağlayıcı-özel kod ve hiçbir canlı bağlantı yok. Bir önceki denetimin "ilk göç için erken" değerlendirmesi doğrultusunda bu tüm tablo grubu Faz 1'in DIŞINDA tutulur. Bkz. [payment-readiness.md](payment-readiness.md).

**Escrow/emanet fonlar yalnızca dokümantasyondur** — hiçbir fazda `escrow_holds`/`ledger_entries`/vb. için SQL yoktur. Bkz. [future-escrow-architecture.md](future-escrow-architecture.md).

## 7. Bu tasarımın görevin kendi "mevcut kurallar" iddialarıyla ayrıştığı yerler

1. **İlan foto sayısı**: talimat "en az 4, en fazla 15" varsayıyor; `app/_lib/photo-validation.ts` `MIN_PHOTOS = 1`, `MAX_PHOTOS = 10` olarak doğrular. Bu şema doğrulanmış 1–10'u kullanır (`create_job`/`update_job`/`create_operation_with_jobs`/`republish_job`, `0014_rpc_job_functions.sql`).
2. **Sağlayıcı kategori görünürlüğü**: talimat diğer sağlayıcıların yalnız kendi seçili kategorilerini görmesi gerektiğini varsayıyor. `app/_lib/job-visibility.ts#resolveVisibility` tersini gösterir: hiç izole kategori (Nakliye/Gümrük Müşavirliği) seçmemiş bir sağlayıcı HER ilanı görür. `provider_can_view_category()` (`0012_rls_helpers.sql`) doğrulanmış kuralı uygular.

## 8. Bu turda (Faz 1 sadeleştirmesi) yapılan somut değişiklikler

Bir önceki teknik denetim raporunun bulgularına dayanarak:

- **Kritik güvenlik düzeltmesi**: `offers` üzerinde `offers_one_settled_per_job` partial unique index eklendi (`0005_offers_and_status_history.sql`) — bir ilanda en fazla bir "settled" teklif olabileceğini DB seviyesinde garanti eder (önceden yalnızca uygulama-seviyeli bir ön-kontrole güveniliyordu).
- **Kritik güvenlik düzeltmesi**: her view artık açık `GRANT`/`REVOKE` bloğuna sahip (`0017_views.sql`) — önceki view katmanı hiç grant içermiyordu.
- **Yüksek öncelikli düzeltmeler**: `close_job()`/`close_job_as_admin()`'in teklif-reddetme döngüsü artık compare-and-set kullanıyor; `republish_job()` artık foto sayısı kontrolü yapıyor; `log_audit_event()` artık `authenticated`'e doğrudan açık değil; son admin'in kaybolmasına karşı koruma eklendi.
- **`operations.total_service_count` kolonu KALDIRILDI** — canlı hesaplamaya geçildi (`operation_progress` view, `0017_views.sql`) — bkz. §9.
- **`job_activity_events` sadeleştirildi** — yalnız ilan-seviyeli 5 olay tipi kaldı, teklif olaylarıyla `offer_status_history` arasındaki tekrar giderildi (`0010_job_activity_and_audit.sql`).
- **`notification_states` `notifications`'a birleştirildi** (§3).
- **`recently_viewed_jobs` KORUNDU** — kaynak kodda hâlâ aktif bir yazma yolu olduğu doğrulandı (`provider-job-listing.tsx#handleJobClick`).
- **Yerel dry-run'da bulunan ve düzeltilen 4 gerçek hata** (statik incelemenin YAKALAYAMAYACAĞI türden — yalnız gerçek `supabase db reset` ile ortaya çıktı): (1) `0015`'teki 8 fonksiyonda plpgsql'in "record değişken INTO listesinde tek başına olmalı" kuralı ihlali; (2) `0019`'da `storage.buckets`/`storage.objects` üzerinde tablo sahipliği gerektiren `COMMENT`/`ALTER TABLE` ifadeleri (hosted bir projede de aynı şekilde başarısız olurdu); (3) `jobs`/`profiles`/`provider_profiles`'da eksik `revoke all` — `anon`/`authenticated`'in RLS'e hiç tabi olmayan `TRUNCATE` yetkisine sahip olduğu gerçek bir yetki sızıntısı. Tam ayrıntı: [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md).

## 9. Document index

| Document | Covers |
|---|---|
| [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md) | Faz 1'in kod-karşı-SQL statik doğrulaması + tamamen yerel, izole bir ortamda gerçek `supabase db reset` dry-run sonucu (bulunan gerçek hatalar, düzeltmeleri, negatif güvenlik testleri) — bu belge setinin GEÇERLİLİK kaynağı |
| [schema-reference.md](schema-reference.md) | Her tablo, alan bazlı, faz sınıflandırmasıyla birlikte |
| [relationship-map.md](relationship-map.md) | FK grafiği, kardinaliteler, cross-table tetikleyiciler |
| [rls-matrix.md](rls-matrix.md) | Faz 1'in tablo × rol SELECT/INSERT/UPDATE/DELETE matrisi |
| [rpc-reference.md](rpc-reference.md) | Her RPC fonksiyonu: parametreler, yetki, kilitler, yan etkiler, hata kodları |
| [index-plan.md](index-plan.md) | Her index: kolonlar, partial koşul, hizmet ettiği sorgu |
| [storage-plan.md](storage-plan.md) | Bucket tasarımı, path kuralı, işleme hattı |
| [migration-strategy.md](migration-strategy.md) | localStorage/IndexedDB → Supabase veri göçü planı, Auth stratejisi |
| [rollback-strategy.md](rollback-strategy.md) | Bunun herhangi bir parçasını güvenle geri almak |
| [test-plan.md](test-plan.md) | Uygulama-öncesi doğrulama planı |
| [admin-permissions.md](admin-permissions.md) | Faz 1 minimum admin + Faz 2 tam RBAC tasarımı |
| [subscriptions-and-quotas.md](subscriptions-and-quotas.md) | Faz 2 kota tasarımı, Faz 1 sabit-helper köprüsü |
| [payment-readiness.md](payment-readiness.md) | Faz 3 ödeme temeli tasarımı |
| [future-escrow-architecture.md](future-escrow-architecture.md) | Yalnız dokümantasyon havuzlu-fon/escrow tasarımı |
| [future-migrations/MANIFEST.md](future-migrations/MANIFEST.md) | Faz 2/Faz 3 taslaklarının devreye alma sırası ve bağımlılıkları |
