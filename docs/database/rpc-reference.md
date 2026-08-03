# MALSEVK — RPC Reference

Tam parametre listeleri, transaction/kilit notları ve yan-etki detayları her fonksiyonun kendi migration dosyasındaki yorumunda yaşar — bu doküman konsolide bir indeks + tam hata-kodu tablosudur. Her fonksiyon `SECURITY DEFINER`, sabit `search_path` ile ([rls-matrix.md](rls-matrix.md)'nin kapanış notuna bakın).

**Faz yapısı**: bu dokümandaki HER fonksiyon Faz 1'dedir (`supabase/migrations/0007`, `0008`, `0012`–`0016`, `0018`, `0021`), gerçek ilk göçte çalışır — ve artık tamamen yerel, izole bir Docker + Supabase CLI ortamına karşı gerçek bir `supabase db reset` ile de doğrulanmıştır (bkz. [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md)'in "Yerel Migration Dry-Run Sonucu" bölümü — hiçbir uzak/hosted Supabase projesine hâlâ bağlanılmadı). Faz 2'nin admin/abonelik RPC'leri (`grant_admin_role`, `revoke_admin_role`, `verify_provider`, `assign_subscription_plan`, `cancel_subscription`, `grant_user_limit_override`, `update_subscription_plan_limit`) `docs/database/future-migrations/phase2/0004_rpc_admin_and_subscription_functions.sql`'dedir — bkz. [admin-permissions.md](admin-permissions.md).

## Belge & yasal onay fonksiyonları (`0007_provider_documents_and_consents.sql`, `0008_legal_consents.sql`)

**Yerel dry-run'da EKLENDİ** (SUPABASE-MIGRATION-VALIDATION.md §20 madde 3, KRİTİK) — önceki 0001-0020 setinde bu iki tablo için hiçbir yazma RPC'si/INSERT grant'i yoktu, kayıt akışını kilitliyordu.

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `record_provider_document_consent(statement_id, statement_version)` | `authenticated` | Evet (`ON CONFLICT DO NOTHING`, `provider_document_consents_no_duplicate` kısıtı üzerinden) | `provider_id` her zaman sunucu tarafında `auth.uid()` — parametre olarak alınmaz, başka bir kullanıcı adına kayıt oluşturulamaz |
| `record_legal_consent(document_id, version)` | `authenticated` VE `anon` (misafir kabulü desteklenir) | Evet (`ON CONFLICT DO NOTHING`, `legal_consents_one_per_user_document_version` kısıtı üzerinden — bu kısıt da yerel dry-run'da eklendi, önceden hiç yoktu) | `user_id` her zaman sunucu tarafında `auth.uid()` (misafir için `NULL` = anonim kabul) |

## Job & operation fonksiyonları (`0014_rpc_job_functions.sql`)

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `create_job(...)` | `hizmet-alan` | Hayır | `job_activity_events(job_created)` |
| `create_operation_with_jobs(...)` | `hizmet-alan` | Hayır | ≥2 iş satırı + 1 operasyon satırı, tek transaction; `total_service_count` ARTIK YOK (canlı hesaplanıyor) |
| `update_job(job_id, ...)` | ilan sahibi | Evet (tam-alan üzerine yazma) | Düzenlenebilirliği canlı yeniden kontrol eder; `job_activity_events(job_updated)` |
| `close_job(job_id, reason)` | ilan sahibi | Hayır (2. çağrı `MLK55` hatası verir) | GÜVENLİK DÜZELTMESİ: pending tekliflerin `rejected`'a çevrilmesi artık compare-and-set (`AND status='pending'`) |
| `republish_job(job_id, ...)` | ilan sahibi | Hayır (2. çağrı `MLK58` hatası verir) | GÜVENLİK DÜZELTMESİ: artık `create_job()` ile aynı foto sayısı (1-10, MLK51) kontrolü |
| `get_job_address(job_id)` | herkes (öz-kapılı) | — (yalnız okuma) | Contact-gated ilan kolonlarının TEK okuma yolu |
| `delete_job(job_id)` | ilan sahibi | Hayır (ilan zaten silinmişse `MLK56`) | **Yerel dry-run'da EKLENDİ** (SUPABASE-MIGRATION-VALIDATION.md §20 madde 7, KRİTİK) — önceki 0001-0020 setinde sıradan kullanıcı için hiç yoktu, yalnız `delete_job_as_admin` vardı. Kaynağın `deleteJobWithOffers`'ının SQL karşılığı: `listing_status='tamamlandi'` VEYA `get_settled_offer_id_for_job(...)` doluysa reddedilir (`MLK92`), soft-delete, hâlâ `pending` kardeş teklifleri compare-and-set ile `rejected`'a çevirip bildirir |
| `delete_job_photo(job_id, photo_id)` | ilan sahibi | Hayır (2. çağrı `MLK59` hatası verir) | Soft-delete + yoğun yeniden-sıralama |
| `set_provider_service_categories(category_ids)` | `hizmet-veren` | Evet (tam değiştirme) | — |

## Offer fonksiyonları (`0015_rpc_offer_functions.sql`)

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `create_offer(job_id, amount, currency, description, estimated_duration?)` | `hizmet-veren` | Hayır (unique index'e takılarak engellenir) | Provider'a advisory lock; kapasite+cooldown kontrolleri; GÜNLÜK KOTA YOK (bkz. altta). `estimated_duration` **yerel dry-run'da yeniden tasarlandı**: `text not null`den nullable `integer`e (1-60) — yalnız Nakliye kategorisinde zorunlu (`MLK66`), diğer kategorilerde her zaman `NULL` yazılır (SUPABASE-MIGRATION-VALIDATION.md §20 madde 2, KRİTİK) |
| `accept_offer(offer_id)` | ilan sahibi | Hayır (2. çağrı `MLK68`) | GÜVENLİK DÜZELTMESİ: `offers_one_settled_per_job` unique_violation'ını yakalayıp `MLK67`'ye çevirir |
| `reject_offer(offer_id)` | ilan sahibi | Hayır | |
| `withdraw_offer(offer_id)` | teklifin sağlayıcısı | Hayır | |
| `start_work(offer_id)` | ilan sahibi | Hayır | |
| `record_agreement_failure(offer_id, reason, note?)` | ilan sahibi | Hayır | Her iki tarafa da bildirim |
| `request_completion(offer_id)` | teklifin sağlayıcısı | Hayır | |
| `confirm_completion(offer_id)` | ilan sahibi, ≠ tamamlanma talebini başlatan | Hayır | |
| `dispute_completion(offer_id, note)` | ilan sahibi, ≠ tamamlanma talebini başlatan | Hayır | |
| `resolve_completion_dispute(offer_id, resolution)` | ilan sahibi | Hayır | GÜVENLİK/TUTARLILIK DÜZELTMESİ: geçersiz `resolution` artık `MLK78` (eski `MLK71`, 0016'daki `review_provider_document`'ın kodu ile ÇAKIŞIYORDU) |
| `submit_rating(offer_id, stars, comment?)` | `hizmet-alan`, ilan sahibi | Hayır (unique kısıt engeller) | |

**Faz 1'de günlük teklif kotası YOK**: doğrulanmış bugünkü uygulama davranışı (`app/_lib/offers.ts#createOffer`'da hiçbir günlük sayaç kontrolü yok) — Faz 2'nin abonelik sistemi devreye girdiğinde bu kontrol `create_offer()`'a geri eklenir (bkz. `docs/database/future-migrations/MANIFEST.md`).

## Document & notification fonksiyonları + Faz 1 minimum admin RPC'leri (`0016_rpc_document_notification_and_admin_functions.sql`)

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `create_notification(...)` | internal | **Evet** — `ON CONFLICT DO NOTHING` | Kendi exception'ını yutar |
| `append_job_activity_event(...)` | internal | Hayır (tekrarı zararsız) | Artık 8 parametreli (`p_offer_id` KALDIRILDI — bkz. `0010`'daki sadeleştirme) |
| `review_provider_document(document_id, status, note?)` | `is_admin()` (Layer 1, kaynaktan DEĞİŞMEDEN) | Hayır | `provider_document_reviews` satırı + bildirim + `log_audit_event` |
| `mark_notification_read(id)` / `dismiss_notification(id)` | yalnız kendi bildirimi | Evet | ARTIK `notifications.read_at`/`dismissed_at`'i doğrudan günceller (`notification_states` YOK) |
| `record_job_viewed(job_id)` | herhangi authenticated | Evet (upsert) | |
| `get_offer_provider_display(offer_id)` | teklif tarafı veya admin | — (yalnız okuma) | GÜVENLİK DÜZELTMESİ: reveal koşulu artık `'completed'`'i de kapsıyor |
| `close_job_as_admin(job_id, reason)` | `is_admin()` (Faz 1 basitleştirmesi) | Hayır | GÜVENLİK DÜZELTMELERİ: compare-and-set + `is_job_closed_to_new_offers()` kontrolü eklendi |
| `delete_job_as_admin(job_id, reason)` | `is_admin()` (Faz 1 basitleştirmesi) | Evet | GÜVENLİK DÜZELTMESİ: artık pending teklifleri `rejected`'a çevirip bildirir (önceden atlanıyordu) |
| `suspend_user(user_id, reason)` / `reinstate_user(user_id)` | `is_admin()` (Faz 1 basitleştirmesi) | Evet | YENİ: son AKTİF admin'in askıya alınmasını reddeder (`MLK91`) |

## Bize Ulaşın fonksiyonları (`0021_contact_messages.sql`)

**Yerel dry-run'da EKLENDİ** (SUPABASE-MIGRATION-VALIDATION.md §20 madde 5, KRİTİK) — önceki 0001-0020 setinde `contact_messages` tablosu ve bu iki RPC hiç yoktu.

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `submit_contact_message(name, email, phone, subject, message)` | `authenticated` VE `anon` (misafir gönderimi desteklenir) | Hayır | `user_id`/`user_role` her zaman sunucu tarafında `auth.uid()`/`current_user_role()`; `reference_number` (`BU-<yıl>-<sıra>`) sunucu tarafında üretilir |
| `review_contact_message(id, status, admin_note?)` | `is_admin()` | Hayır | `admin_note is null` mevcut notu korur, dolu/boş metin notu günceller (kaynağın `adminNote !== undefined ? ... : target.adminNote` deseninin SQL karşılığı) |

## Zamanlanmış fonksiyonlar (`0018_scheduled_jobs.sql`)

`sweep_expired_job_listings()`, `sweep_completion_auto_approvals()`, `sweep_notification_retention()`, `sweep_stale_anonymous_legal_consents()` — hepsi `pg_cron` ile zamanlanmış, hepsi manuel tekrar çalıştırmaya idempotent.

## Read models (`0017_views.sql`)

`admin_audit_log_search(...)` bir fonksiyondur (view değil); `admin_user_list`/`admin_job_list`/`admin_offer_list`/`admin_document_queue`/`admin_dispute_queue` `is_admin()` ile öz-kapılı view'lardır (Faz 1 basitleştirmesi — Faz 2'de `has_admin_permission(code)`'a geçirilebilir). GÜVENLİK DÜZELTMESİ: HER view artık açık `GRANT SELECT` içeriyor (önceki tasarımda view katmanının tamamında hiç grant yoktu).

## Konsolide hata kodu tablosu

| Kod aralığı | Dosya | Anlam |
|---|---|---|
| MLK10–11 | 0004 (tetikleyiciler) | Job requester-rolü / operation-requester-uyuşmazlığı ihlalleri |
| MLK20–22 | 0005 (tetikleyiciler) | Offer provider-rolü / kendi-kendine-teklif ihlalleri |
| MLK30–33 | 0006 (tetikleyici) | Rating uygunluk ihlalleri |
| MLK50 | 0014/0015/0016 | Bu eylem için yanlış rol |
| MLK51 | 0014 | Foto sayısı sınır dışı (1–10) — `create_job`, `create_operation_with_jobs`, `update_job`, `republish_job` DÖRDÜNDE de |
| MLK52 | 0014 | `work_end_date`, `work_date`'ten önce |
| MLK53–54 | 0014 | Operasyon hizmet-sayısı / tekrar-kategori ihlalleri |
| MLK55 | 0014/0016 | İlan düzenlenemez / zaten kapalı / işe başlanmış bir teklifle engellenmiş |
| MLK56 | 0014/0015/0016 | Bu eylem için sahip/taraf değil |
| MLK57–58 | 0014 | Yeniden yayınlama: süresi dolmamış / zaten yeniden yayınlanmış |
| MLK59 | 0014 | Foto bulunamadı |
| MLK60–65 | 0015 | `create_offer` kapı zinciri (görünürlük, gümrük müşaviri, cooldown, kalıcı engel, ilan kapalı, kapasite) |
| MLK66 | 0015 | **YENİDEN KULLANILDI** (yerel dry-run) — eski anlamı (günlük teklif kotası, Faz 1'de hiç kullanılmıyordu) boşta kalmıştı; şimdi `create_offer`'ın `estimated_duration` doğrulaması için (Nakliye'de eksik/aralık-dışı değer) — SUPABASE-MIGRATION-VALIDATION.md §20 madde 2 |
| MLK67 | 0015 | Bu ilanda başka bir teklif zaten meşgul (unique_violation yakalama dahil) |
| MLK68 | 0015 | Teklif bu geçiş için gereken durumda değil (her double-submit yarışını kapsar) |
| MLK69 | 0015 | Kendi tamamlanma talebinizi onaylayamaz/itiraz edemezsiniz |
| MLK70 | 0015 | İtiraz notu uzunluğu (10–1000 karakter) |
| MLK71 | 0016 | `review_provider_document`: geçersiz inceleme durumu (ARTIK YALNIZ burada — 0015'teki eski çakışma MLK78'e taşındı) |
| MLK72 | 0015 | Otomatik-tamamlanan puanlama penceresi doldu |
| MLK73–74 | 0015 | Teklif tamamlanmadı / zaten puanlanmış |
| MLK75–77 | 0016 | Eksik inceleme notu / belge ya da bildirim bulunamadı — MLK76 ("bulunamadı"), 0021'in `review_contact_message`'ında da AYNI anlamla (mesaj bulunamadı) tekrar kullanılıyor, çakışan bir kod tahsisi değil |
| MLK78 | 0015 | `resolve_completion_dispute`: geçersiz resolution değeri (eski MLK71, çakışma nedeniyle taşındı) |
| MLK82 | 0016 | `suspend_user`/`reinstate_user`: admin rolü gerekli |
| MLK84–85 | 0016 | `close_job_as_admin`/`delete_job_as_admin`: admin rolü gerekli |
| MLK89 | Faz 2 taslağı | `revoke_admin_role`: son `admin_roles.manage` sahibi iptal edilemez |
| MLK90 | 0012 | `profiles` tetikleyicisi: son admin hesabı kaldırılamaz (rol/soft-delete) |
| MLK91 | 0016 | `suspend_user`: son AKTİF admin askıya alınamaz |
| MLK92 | 0014 | **YENİ** (yerel dry-run) — `delete_job`: aktif veya tamamlanmış bir teklifi olan ilan silinemez |
| MLK93–94 | 0007 | **YENİ** (yerel dry-run) — `record_provider_document_consent`: oturumsuz çağrı / geçersiz `statement_id`/`statement_version` |
| MLK95–98 | 0021 | **YENİ** (yerel dry-run) — `submit_contact_message`: eksik ad / geçersiz konu / mesaj uzunluğu (10-2000) / ne e-posta ne telefon verilmiş |
| MLK99 | 0021 | **YENİ** (yerel dry-run) — `review_contact_message`: geçersiz `status` değeri |
