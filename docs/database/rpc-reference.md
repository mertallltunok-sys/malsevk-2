# MALSEVK — RPC Reference

Tam parametre listeleri, transaction/kilit notları ve yan-etki detayları her fonksiyonun kendi migration dosyasındaki yorumunda yaşar — bu doküman konsolide bir indeks + tam hata-kodu tablosudur. Her fonksiyon `SECURITY DEFINER`, sabit `search_path` ile ([rls-matrix.md](rls-matrix.md)'nin kapanış notuna bakın).

**Faz yapısı**: bu dokümandaki HER fonksiyon Faz 1'dedir (`supabase/migrations/0012`–`0016`, `0018`), gerçek ilk göçte çalışır. Faz 2'nin admin/abonelik RPC'leri (`grant_admin_role`, `revoke_admin_role`, `verify_provider`, `assign_subscription_plan`, `cancel_subscription`, `grant_user_limit_override`, `update_subscription_plan_limit`) `docs/database/future-migrations/phase2/0004_rpc_admin_and_subscription_functions.sql`'dedir — bkz. [admin-permissions.md](admin-permissions.md).

## Job & operation fonksiyonları (`0014_rpc_job_functions.sql`)

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `create_job(...)` | `hizmet-alan` | Hayır | `job_activity_events(job_created)` |
| `create_operation_with_jobs(...)` | `hizmet-alan` | Hayır | ≥2 iş satırı + 1 operasyon satırı, tek transaction; `total_service_count` ARTIK YOK (canlı hesaplanıyor) |
| `update_job(job_id, ...)` | ilan sahibi | Evet (tam-alan üzerine yazma) | Düzenlenebilirliği canlı yeniden kontrol eder; `job_activity_events(job_updated)` |
| `close_job(job_id, reason)` | ilan sahibi | Hayır (2. çağrı `MLK55` hatası verir) | GÜVENLİK DÜZELTMESİ: pending tekliflerin `rejected`'a çevrilmesi artık compare-and-set (`AND status='pending'`) |
| `republish_job(job_id, ...)` | ilan sahibi | Hayır (2. çağrı `MLK58` hatası verir) | GÜVENLİK DÜZELTMESİ: artık `create_job()` ile aynı foto sayısı (1-10, MLK51) kontrolü |
| `get_job_address(job_id)` | herkes (öz-kapılı) | — (yalnız okuma) | Contact-gated ilan kolonlarının TEK okuma yolu |
| `delete_job_photo(job_id, photo_id)` | ilan sahibi | Hayır (2. çağrı `MLK59` hatası verir) | Soft-delete + yoğun yeniden-sıralama |
| `set_provider_service_categories(category_ids)` | `hizmet-veren` | Evet (tam değiştirme) | — |

## Offer fonksiyonları (`0015_rpc_offer_functions.sql`)

| Fonksiyon | Yetki | Idempotent mi | Anahtar yan etkiler |
|---|---|---|---|
| `create_offer(job_id, ...)` | `hizmet-veren` | Hayır (unique index'e takılarak engellenir) | Provider'a advisory lock; kapasite+cooldown kontrolleri; GÜNLÜK KOTA YOK (bkz. altta) |
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
| MLK60–66 | 0015 | `create_offer` kapı zinciri (görünürlük, gümrük müşaviri, cooldown, kalıcı engel, ilan kapalı, kapasite) — MLK66 (günlük kota) Faz 1'de KULLANILMIYOR |
| MLK67 | 0015 | Bu ilanda başka bir teklif zaten meşgul (unique_violation yakalama dahil) |
| MLK68 | 0015 | Teklif bu geçiş için gereken durumda değil (her double-submit yarışını kapsar) |
| MLK69 | 0015 | Kendi tamamlanma talebinizi onaylayamaz/itiraz edemezsiniz |
| MLK70 | 0015 | İtiraz notu uzunluğu (10–1000 karakter) |
| MLK71 | 0016 | `review_provider_document`: geçersiz inceleme durumu (ARTIK YALNIZ burada — 0015'teki eski çakışma MLK78'e taşındı) |
| MLK72 | 0015 | Otomatik-tamamlanan puanlama penceresi doldu |
| MLK73–74 | 0015 | Teklif tamamlanmadı / zaten puanlanmış |
| MLK75–77 | 0016 | Eksik inceleme notu / belge ya da bildirim bulunamadı |
| MLK78 | 0015 | `resolve_completion_dispute`: geçersiz resolution değeri (eski MLK71, çakışma nedeniyle taşındı) |
| MLK82 | 0016 | `suspend_user`/`reinstate_user`: admin rolü gerekli |
| MLK84–85 | 0016 | `close_job_as_admin`/`delete_job_as_admin`: admin rolü gerekli |
| MLK89 | Faz 2 taslağı | `revoke_admin_role`: son `admin_roles.manage` sahibi iptal edilemez |
| MLK90 | 0012 | `profiles` tetikleyicisi: son admin hesabı kaldırılamaz (rol/soft-delete) |
| MLK91 | 0016 | `suspend_user`: son AKTİF admin askıya alınamaz |
