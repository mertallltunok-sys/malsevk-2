-- =============================================================================
-- MALSEVK — Faz 1 migration 0019: Storage buckets & policies
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0024_storage_policies.sql'i ile aynıdır — üç bucket (job-photos,
-- provider-logos, provider-documents) tamamen Faz 1 akışlarına ait, hiçbir
-- ödeme/abonelik/gelişmiş-admin bağımlılığı yok.
--
-- Bucket sayısı kararı: DÖRT DEĞİL, ÜÇ bucket. "Faaliyet Belgesi/Raporu"
-- provider_documents.document_type = 'genel' (0007) ile AYNI tablo/bucket
-- çiftidir — ayrı bir "activity-reports" bucket'ı bu ayrımı Storage
-- katmanında tekrar eder, gereksizdir.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('job-photos', 'job-photos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('provider-logos', 'provider-logos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp']),
  ('provider-documents', 'provider-documents', false, 15728640, array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff'
  ])
on conflict (id) do nothing;

comment on table storage.buckets is
  'job-photos/provider-logos are public=true (read): kaynak uygulamanın kendi EXIF/GPS-strip pipeline''ı korunuyor, PII taşımıyorlar. provider-documents public=false: iş-hassas, admin-incelemeli belgeler.';

-- -----------------------------------------------------------------------------
-- Object path convention & path-manipulation defense
-- -----------------------------------------------------------------------------
-- job-photos/{requester_id}/{job_id}/{photo_id}.{ext}
-- provider-logos/{provider_id}/{logo_id}.{ext}
-- provider-documents/{provider_id}/{document_id}.{ext}
--
-- Her politika `(storage.foldername(name))[1] = auth.uid()::text` kontrol
-- eder — bir çağıran, client kodunun kurduğu path string'i ne olursa olsun,
-- ilk path segmenti kendi auth.uid()'i olmayan bir objeye ASLA
-- yazamaz.
-- -----------------------------------------------------------------------------

alter table storage.objects enable row level security;

-- job-photos
create policy job_photos_bucket_read_public on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'job-photos');

create policy job_photos_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy job_photos_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- provider-logos
create policy provider_logos_bucket_read_public on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'provider-logos');

create policy provider_logos_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy provider_logos_bucket_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy provider_logos_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- provider-documents (private — owner + is_admin() admins only; Faz 2'de
-- has_admin_permission('documents.view')'a geçirilebilir)
create policy provider_documents_bucket_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'provider-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy provider_documents_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'provider-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy provider_documents_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'provider-documents' and (storage.foldername(name))[1] = auth.uid()::text);

comment on policy provider_documents_bucket_read_own_or_admin on storage.objects is
  'RLS burada Storage-seviyeli yetkilendirmeyi (bu çağıran objeyi görebilir/indirebilir mi) belirler; önerilen gerçek dosya-servis mekanizması hâlâ kısa ömürlü (~5 dakika) signed URL''lerdir (bkz. docs/database/storage-plan.md).';

-- -----------------------------------------------------------------------------
-- Processing pipeline (özet — tam detay için storage-plan.md)
-- -----------------------------------------------------------------------------
-- 1. Client-side pre-check (magic-number, boyut/sayı, SHA-256 hash) —
--    değişmedi.
-- 2. Processing Edge Function — EXIF/GPS strip (değişmedi); WebP
--    standardizasyonu KASITLI, İŞARETLİ bir sapma (bkz. storage-plan.md Open
--    Decisions).
-- 3. Storage'a yükle, SONRA RPC'yi çağır (asla tersi).
--
-- Watermarking ve virüs taraması İNŞA EDİLMEDİ (bkz. storage-plan.md'nin
-- kendi güvenlik notu — bu boşluk sessizce çözülmüş sayılmıyor).
-- =============================================================================
