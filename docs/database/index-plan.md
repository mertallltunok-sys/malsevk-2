# MALSEVK — Index Plan (Faz 1)

Her index'in tam gerekçesi `supabase/migrations/0011_indexes.sql`'de, kendi `CREATE INDEX`'inin hemen üstünde yaşar; bu, konsolide tablo görünümüdür. Faz 2/Faz 3'e özel index'ler (`admin_*`/`subscription_*`/`payment_*` tabloları için) bu dokümanın kapsamı DIŞINDADIR — bkz. `docs/database/future-migrations/phase2/0005_views_and_rls_and_indexes.sql` ve `phase3/0003_rls_and_views.sql`.

**SADELEŞTİRME**: `idx_job_photos_job_id_sort_order` KALDIRILDI — `job_photos_job_id_sort_order_unique` (`0004_operations_jobs_photos.sql`) ile TAMAMEN AYNI kolonlar/koşul üzerindeydi, gereksiz bir tekrardı (bir unique index zaten tam kullanılabilir bir btree index'tir).

| Index | Tablo | Kolonlar (sıra) | Partial koşul | Include | Hizmet ettiği |
|---|---|---|---|---|---|
| `idx_jobs_requester_id` | jobs | requester_id | `deleted_at is null` | — | "requester_id ile kullanıcının ilanlarını listeleme" |
| `idx_jobs_operation_id` | jobs | operation_id | `operation_id is not null and deleted_at is null` | — | "operation_id ile operasyon kardeşlerini listeleme" |
| `idx_jobs_category_province_district` | jobs | category_id, province, district | `deleted_at is null and listing_status = 'yayinda'` | — | "category_id + province + district ile ilan filtreleme" |
| `idx_jobs_publish_end_at` | jobs | publish_end_at | `listing_status = 'yayinda' and closed_at is null and deleted_at is null` | — | Zamanlanmış süre-dolma taraması |
| `idx_jobs_listing_status_publish_end_at` | jobs | listing_status, publish_end_at | `deleted_at is null` | — | `active_job_listings` view |
| `idx_offers_provider_id` | offers | provider_id | `deleted_at is null` | — | "provider_id ile hizmet verenin tekliflerini listeleme" |
| `idx_offers_job_id` | offers | job_id | `deleted_at is null` | — | "job_id ile ilana gelen teklifleri listeleme" |
| `idx_offers_provider_id_status_engaged` | offers | provider_id, status | `status in (engaged 4 değer)` | — | `get_active_job_count()` |
| `idx_offers_job_id_status` | offers | job_id, status | — | — | `get_settled_offer_id_for_job()` |
| `idx_offers_provider_id_created_at` | offers | provider_id, created_at desc | — | — | "en yeni teklif önce" sıralaması (Faz 1'de günlük kota YOK) |
| `idx_notifications_recipient_id_created_at` | notifications | recipient_id, created_at desc | `deleted_at is null` | — | "recipient_id + created_at ile bildirim listeleme" |
| `idx_notifications_recipient_unread` | notifications | recipient_id | `read_at is null and deleted_at is null` | — | YENİ — `notification_states` birleştirme kararının doğal sonucu, `unread_notification_counts` view |
| `idx_provider_documents_provider_id` | provider_documents | provider_id | `deleted_at is null` | — | "provider_id ile belge listeleme" |
| `idx_provider_document_reviews_document_id_created_at` | provider_document_reviews | document_id, created_at desc | — | — | "belge inceleme geçmişi" |
| `idx_job_activity_events_job_id_created_at` | job_activity_events | job_id, created_at desc | — | visibility | "job_id + created_at ile activity timeline" |
| `idx_audit_logs_entity_type_entity_id_created_at` | audit_logs | entity_type, entity_id, created_at desc | — | — | "audit sorgusu" |
| `idx_audit_logs_actor_id_created_at` | audit_logs | actor_id, created_at desc | — | — | "bu admin ne yaptı" |
| — (unique index'ler, 0004) | jobs | republished_to_job_id / republished_from_job_id | `... is not null` | — | Republish sorguları — unique index zaten lookup index'idir |
| `idx_recently_viewed_jobs_user_id_viewed_at` | recently_viewed_jobs | user_id, viewed_at desc | — | — | Top-15 okuma |
| `idx_ratings_provider_id` | ratings | provider_id | `deleted_at is null` | — | `provider_rating_summary` view |
| — (unique kısıt) | provider_services | provider_id, service_category_id | — | — | `provider_id`-only lookup zaten prefix olarak karşılanıyor |

## Kasıtlı olarak inşa edilmeyenler

- **Genel amaçlı tam-metin arama index'i** — kaynak uygulamada hiçbir serbest-metin arama özelliği yok; `pg_trgm` bile etkinleştirilmedi.
- **Materialized view'lar / onların refresh-tetikleyici index'leri** — `0017_views.sql`'deki her view düz (materialized olmayan) bir view.
- **`notifications.read_at`/`dismissed_at` için ayrı bir index** — yalnız `idx_notifications_recipient_unread` (yukarı) yeterli; bunlar `recipient_id`'den bağımsız filtrelenmiyor.

## `CREATE INDEX CONCURRENTLY` notu

`0011`'deki her ifade düz `CREATE INDEX IF NOT EXISTS`'tir — bu, BOŞ bir veritabanına (ilk uygulama hedefi) karşı doğru ve hızlıdır. Bu migration seti canlı veri üzerinde yeniden uygulanacaksa, `0011`'i tek tek `CREATE INDEX CONCURRENTLY` ifadelerine (transaction dışında) bölün.
