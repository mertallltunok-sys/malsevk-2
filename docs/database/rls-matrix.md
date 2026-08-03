# MALSEVK — RLS Security Matrix (Faz 1)

`supabase/migrations/0013_rls_policies.sql`'deki her policy'yi, artı her tablonun kendi oluşturma dosyasındaki (`0002`–`0010`) tablo/kolon-seviyeli `GRANT`/`REVOKE` ifadelerini uygular. Roller: **anon** (kimliksiz), **hizmet-alan**/**hizmet-veren** (RLS grant seviyesinde çoğunlukla ayrışmaz — satır-seviyeli farklar satır içinde belirtilir), **admin** (`profiles.role = 'admin'`, yani `is_admin()` — Faz 1'in TEK admin katmanı), **service_role** (RLS'yi tamamen bypass eder).

Legend: **own** = yalnız çağıranın taraf olduğu satırlar; **visible** = job-visibility/contact-reveal kurallarına tabi; **public** = herkes, kısıtsız; **—** = hiç grant yok; **RPC only** = doğrudan tablo grant'ı yok, [rpc-reference.md](rpc-reference.md)'deki adlandırılmış bir fonksiyondan geçmeli.

**Faz 2 notu**: `has_admin_permission(code)` (ince taneli izin katmanı) Faz 1'de YOKTUR — bu tablodaki her "admin" sütunu `is_admin()`'i ifade eder. Faz 2 devreye alındığında, `docs/database/future-migrations/phase2/0005_views_and_rls_and_indexes.sql`'in kendi yorum bloğu, aşağıdaki hangi policy/view'ın hangi spesifik izin koduna geçirileceğini belgeler.

**Yerel dry-run bulgusu (`SUPABASE-MIGRATION-VALIDATION.md`'nin "Yerel Migration Dry-Run Sonucu" bölümü):** `jobs`/`profiles`/`provider_profiles` (0004/0003), diğer tüm tabloların (`operations`/`job_photos`/`ratings`/`provider_services` vb.) aksine, dosyalarında hiçbir zaman açık bir `revoke all ... from authenticated, anon;` almamıştı — canlı bir Supabase projesine karşı gerçek bir `db reset` çalıştırılana kadar bu, statik SQL incelemesiyle GÖRÜNMEYEN bir yetki sızıntısıydı: `anon`/`authenticated`, Supabase'in proje bootstrap'inin varsayılan yetkileri üzerinden bu üç tabloda `TRUNCATE`/`REFERENCES`/`TRIGGER`'a sahipti — **`TRUNCATE` RLS politikalarına tabi değildir**, yani bu haliyle herhangi bir `authenticated` kullanıcı tüm tabloyu tek komutla silebilirdi. Düzeltildi: üçüne de açık `revoke all` eklendi, yalnız aşağıdaki tabloda belgelenen SELECT açıkça geri verildi. Gerçek bir negatif güvenlik testiyle (`anon` → `TRUNCATE public.jobs` → `permission denied`) doğrulandı.

## Kimlik & profil

| Tablo | anon | authenticated (SELECT) | authenticated (INSERT/UPDATE/DELETE) | admin |
|---|---|---|---|---|
| `profiles` | — | own | UPDATE own, yalnız self-service kolonlar (`full_name`/`phone`/`company_name`/`company_type`/`province`/`district` — `role`/`account_status`/`onboarding_completed` DEĞİL) | SELECT all |
| `provider_profiles` | — | own | UPDATE own, self-service kolonlar (`verification_status` DEĞİL) | SELECT all |
| `provider_services` | — | own | RPC only (`set_provider_service_categories`) | SELECT all |
| `service_categories` | SELECT all | SELECT all | — | SELECT all |

## Operasyonlar & ilanlar

| Tablo | anon | hizmet-alan (sahip) | hizmet-veren | admin |
|---|---|---|---|---|
| `operations` | — | SELECT own + görünen ≥1 iş içeren her operasyon | SELECT görünen ≥1 iş içeren her operasyon (`provider_can_view_category`) | SELECT all |
| `jobs` (temel alanlar) | SELECT görünüyorsa | SELECT own + görünen; UPDATE own `update_job` grant'ı ile | SELECT görünen (`provider_can_view_category` — DOĞRULANMIŞ: izole kategori seçmemiş sağlayıcı HER ilanı görür) | SELECT all; `close_job_as_admin`/`delete_job_as_admin` ile moderasyon |
| `jobs` (`address_text`/`neighborhood`/`location_url`/`directions_note`) | — | — (kolon SELECT'i SAHİP DAHİL herkesten revoke edilmiş) | — | — |
| ↳ contact-gated okuma yolu | `get_job_address(job_id)` RPC only | | | |
| `job_photos` | SELECT üst ilan görünüyorsa | write yalnız RPC ile | aynı (okuma) | SELECT all |

## Teklifler

| Tablo | provider (kendi teklifi) | requester (kendi ilanının teklifleri) | aynı ilandaki diğer sağlayıcılar | admin |
|---|---|---|---|---|
| `offers` | SELECT own | SELECT kendi ilanlarındaki tüm teklifler | — (rakibin teklif satırını asla görmez) | SELECT all |
| ↳ yazımlar | RPC only: `create_offer`, `withdraw_offer` | RPC only: `accept_offer`, `reject_offer`, `start_work`, `record_agreement_failure`, `request_completion`(provider)/`confirm_completion`/`dispute_completion`/`resolve_completion_dispute` | — | — |
| ↳ kimlik-güvenli görüntüleme | `get_offer_provider_display(offer_id)` — `is_engaged_offer_status` VEYA `completed` olunca gerçek isim | | | |
| `offer_status_history` | SELECT (kendi teklifleri) | SELECT (kendi ilanlarının teklifleri) | — | SELECT all |

**GÜVENLİK NOTU**: `offers` tablosu ayrıca `offers_one_settled_per_job` partial unique index'ine sahiptir (`0005_offers_and_status_history.sql`) — bir job_id için en fazla bir "settled" (accepted..completed) satır, RLS'nin dışında, DB seviyesinde garanti edilir.

## Puanlamalar, belgeler, onaylar

| Tablo | Taraf görünürlüğü | admin |
|---|---|---|
| `ratings` | SELECT all (gönderildikten sonra public sayılır); INSERT yalnız `submit_rating` RPC ile | SELECT all |
| `provider_documents` | SELECT own | SELECT all |
| `provider_document_reviews` | SELECT own (incelenen sağlayıcı olarak) | SELECT all |
| `provider_document_consents` | SELECT own | SELECT all |
| `legal_consents` | SELECT own | SELECT all |

## Bildirimler & aktivite

| Tablo | authenticated | admin |
|---|---|---|
| `notifications` | SELECT own (`recipient_id = auth.uid()`) yalnız — `read_at`/`dismissed_at` DAHİL (bkz. `notification_states` birleştirme kararı) | — |
| `recently_viewed_jobs` | SELECT/write (RPC ile) yalnız own | — |
| `job_activity_events` | SELECT `visibility` kolonuna göre (`public`/`requester_only` — `offer_parties_only` KALDIRILDI, bkz. sadeleştirme) | SELECT all |
| `audit_logs` | — | `is_admin()` (Faz 2'de `has_admin_permission('audit_logs.view')`'a geçirilebilir, opt-in) |

## Bize Ulaşın (`contact_messages`, 0021)

| Tablo | anon | authenticated (own) | admin |
|---|---|---|---|
| `contact_messages` | — (yazma yalnız RPC ile, okuma hiç yok) | SELECT own (`user_id = auth.uid()`) — misafir gönderimlerin `user_id`'si NULL olduğu için misafir kendi mesajını bu şema üzerinden geri okuyamaz (kaynak uygulamada da böyle bir ekran yok) | SELECT all |
| ↳ yazımlar | RPC only: `submit_contact_message(...)` (hem `anon` hem `authenticated`'e açık — misafir gönderimi desteklenir; `user_id`/`user_role` her zaman sunucu tarafında `auth.uid()`/`current_user_role()` ile belirlenir) | | RPC only: `review_contact_message(...)` (yalnız `is_admin()`) |

`contact_messages` yerel dry-run'da eklendi (0021) — önceki 0001-0020 setinde hiç yoktu (SUPABASE-MIGRATION-VALIDATION.md §20 madde 5, KRİTİK).

## RLS recursion — nasıl önleniyor

`is_admin()`, `is_job_owner()`, ... dahil her helper fonksiyon `SECURITY DEFINER`, sabit `search_path` ile tanımlanmıştır — bu, örn. `profiles`'ın kendi SELECT politikasının `is_admin()`'i çağırdığı ve onun da `profiles`'ı sorguladığı durumda recursion'ı önler (fonksiyon, sahibi olarak çalıştığı için kendi içindeki sorgu RLS politikasını yeniden tetiklemez). Bkz. `0012_rls_helpers.sql`'in başlık yorumu.

## Faz 2 / Faz 3'e ayrılmış tablolar

Admin RBAC (`admin_permissions`/`admin_roles`/`admin_role_permissions`/`admin_user_roles`), abonelik/kota (`subscription_*`, `user_limit_overrides`) ve ödeme (`payment_*`, `outbox_events`) tablolarının RLS matrisi bu dokümanın kapsamı DIŞINDADIR (Faz 1'in bir parçası değiller) — bkz. `docs/database/future-migrations/phase2/0005_views_and_rls_and_indexes.sql` ve `phase3/0003_rls_and_views.sql`.
