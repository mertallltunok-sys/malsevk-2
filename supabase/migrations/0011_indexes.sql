-- =============================================================================
-- MALSEVK — Faz 1 migration 0011: indexes
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. Yalnızca Faz 1 tabloları için index'ler
-- — abonelik/ödeme/gelişmiş-admin index'leri docs/database/future-migrations/
-- altına taşındı (bkz. o klasörün MANIFEST.md'si).
--
-- SADELEŞTİRME: `idx_job_photos_job_id_sort_order` KALDIRILDI — önceki
-- tasarımda bu index, 0004 (o zamanki 0005) içinde zaten oluşturulan
-- `job_photos_job_id_sort_order_unique` (job_id, sort_order) WHERE
-- deleted_at is null ile TAMAMEN AYNI kolonlar/koşul üzerindeydi. Bir unique
-- index zaten tam kullanılabilir bir btree index'tir (aynı mantık, orijinal
-- tasarımın kendisinin jobs.republished_from/to_job_id için zaten
-- uyguladığı mantık) — bu, gereksiz/tekrarlı bir index'in düzeltilmesidir.
--
-- OPERASYONEL NOT: her CREATE INDEX aşağıda plain (CONCURRENTLY değil)
-- yazılmıştır çünkü hedef BOŞ bir veritabanıdır (ilk uygulama senaryosu).
-- Canlı veri üzerinde yeniden uygulanacaksa, CREATE INDEX CONCURRENTLY
-- (transaction dışında, tek tek) kullanılmalıdır.
-- =============================================================================

create index if not exists idx_jobs_requester_id
  on public.jobs (requester_id)
  where deleted_at is null;

create index if not exists idx_jobs_operation_id
  on public.jobs (operation_id)
  where operation_id is not null and deleted_at is null;

create index if not exists idx_jobs_category_province_district
  on public.jobs (category_id, province, district)
  where deleted_at is null and listing_status = 'yayinda';

create index if not exists idx_jobs_publish_end_at
  on public.jobs (publish_end_at)
  where listing_status = 'yayinda' and closed_at is null and deleted_at is null;

create index if not exists idx_jobs_listing_status_publish_end_at
  on public.jobs (listing_status, publish_end_at)
  where deleted_at is null;

create index if not exists idx_offers_provider_id
  on public.offers (provider_id)
  where deleted_at is null;

create index if not exists idx_offers_job_id
  on public.offers (job_id)
  where deleted_at is null;

-- "provider_id + status ile aktif iş kapasitesini hesaplama"
-- (get_active_job_count(), 0012_rls_helpers.sql).
create index if not exists idx_offers_provider_id_status_engaged
  on public.offers (provider_id, status)
  where status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed');

-- "job_id + status ile aktif/kabul edilmiş teklifi bulma"
-- (get_settled_offer_id_for_job(), 0012_rls_helpers.sql).
create index if not exists idx_offers_job_id_status
  on public.offers (job_id, status);

-- "provider_id + created_at ile en yeni teklif önce" (offers.ts#
-- getOffersByProvider'ın sıralaması). Faz 1'de günlük teklif kotası
-- olmadığı için (bkz. 0015_rpc_offer_functions.sql'in create_offer()
-- notu) bu index artık YALNIZCA sıralama için kullanılıyor.
create index if not exists idx_offers_provider_id_created_at
  on public.offers (provider_id, created_at desc);

create index if not exists idx_notifications_recipient_id_created_at
  on public.notifications (recipient_id, created_at desc)
  where deleted_at is null;

-- "okunmamış bildirim sayısı" — notification_states birleştirme kararının
-- (0009_notifications.sql) doğal sonucu: read_at artık notifications
-- üzerinde olduğu için, "recipient_id + read_at is null" sorgusu kendi
-- partial index'ini hak ediyor (unread_notification_counts view, 0017).
create index if not exists idx_notifications_recipient_unread
  on public.notifications (recipient_id)
  where read_at is null and deleted_at is null;

create index if not exists idx_provider_documents_provider_id
  on public.provider_documents (provider_id)
  where deleted_at is null;

create index if not exists idx_provider_document_reviews_document_id_created_at
  on public.provider_document_reviews (document_id, created_at desc);

create index if not exists idx_job_activity_events_job_id_created_at
  on public.job_activity_events (job_id, created_at desc)
  include (visibility);

create index if not exists idx_audit_logs_entity_type_entity_id_created_at
  on public.audit_logs (entity_type, entity_id, created_at desc);

create index if not exists idx_audit_logs_actor_id_created_at
  on public.audit_logs (actor_id, created_at desc);

-- jobs.republished_from_job_id / republished_to_job_id zaten 0004'te partial
-- UNIQUE index olarak oluşturuldu — ayrı bir index gerekmiyor.

create index if not exists idx_recently_viewed_jobs_user_id_viewed_at
  on public.recently_viewed_jobs (user_id, viewed_at desc);

create index if not exists idx_ratings_provider_id
  on public.ratings (provider_id)
  where deleted_at is null;

-- provider_services(provider_id) zaten UNIQUE(provider_id, service_category_id)
-- kısıtının arka planındaki index tarafından prefix olarak karşılanıyor —
-- ayrı bir index gerekmiyor.
