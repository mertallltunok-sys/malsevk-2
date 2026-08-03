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

-- DUZELTME (yerel dry-run, gercek "must be owner of table buckets" hatasi,
-- SQLSTATE 42501): "comment on table storage.buckets is ..." kaldirildi.
-- storage.buckets, migration'i uygulayan role (postgres) tarafindan degil,
-- Supabase'in kendi storage servisi/rolu (supabase_storage_admin)
-- tarafindan sahiplenilen bir tablodur -- COMMENT ON TABLE, tablo
-- SAHIBI olmayi gerektirir (superuser bile olsa; bu Postgres'in COMMENT
-- icin kendi kurali). Bu satir hem yerelde HEM gercek/hosted bir Supabase
-- projesinde AYNI SEKILDE basarisiz olurdu -- yalniz statik analizle degil,
-- gercek calistirma ile yakalanabilecek bir hataydi. Aciklama asagida sade
-- bir SQL yorumu olarak korunuyor (islevsel bir kayip yok):
-- job-photos/provider-logos are public=true (read): kaynak uygulamanın
-- kendi EXIF/GPS-strip pipeline'ı korunuyor, PII taşımıyorlar.
-- provider-documents public=false: iş-hassas, admin-incelemeli belgeler.

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

-- DUZELTME (yerel dry-run, gercek "must be owner of table objects" hatasi,
-- SQLSTATE 42501): "alter table storage.objects enable row level security"
-- kaldirildi. storage.objects, supabase_storage_admin tarafindan
-- sahiplenilir (postgres/migration rolu degil) -- ALTER TABLE de COMMENT ON
-- TABLE gibi tablo SAHIBI olmayi gerektirir. Bu satir zaten GEREKSIZDI:
-- Supabase, storage.objects uzerinde RLS'yi kendi proje bootstrap'inin bir
-- parcasi olarak, HERHANGI bir kullanici migration'i calismadan once zaten
-- ETKINLESTIRIR (Storage servisinin temel guvenlik varsayimi budur) --
-- yalniz yerelde degil, gercek/hosted bir projede de aynen boyle. Asagidaki
-- CREATE POLICY'ler RLS'nin ETKIN olup olmamasindan BAGIMSIZ calisir (bir
-- politika RLS kapaliyken de tanimlanabilir, yalniz RLS acikken
-- uygulanir) -- yani bu satirin kaldirilmasi asagidaki politikalarin
-- olusturulmasini veya calisma zamanindaki etkinligini degistirmez.

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 10 -
-- idempotency): asagidaki HER "create policy", ikinci calistirmada "policy
-- already exists" hatasini onlemek icin kendi "drop policy if exists"
-- satirindan sonra geliyor.

-- job-photos
drop policy if exists job_photos_bucket_read_public on storage.objects;
create policy job_photos_bucket_read_public on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'job-photos');

drop policy if exists job_photos_bucket_write_own_folder on storage.objects;
create policy job_photos_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists job_photos_bucket_delete_own_folder on storage.objects;
create policy job_photos_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- provider-logos
drop policy if exists provider_logos_bucket_read_public on storage.objects;
create policy provider_logos_bucket_read_public on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'provider-logos');

drop policy if exists provider_logos_bucket_write_own_folder on storage.objects;
create policy provider_logos_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists provider_logos_bucket_update_own_folder on storage.objects;
create policy provider_logos_bucket_update_own_folder on storage.objects
  for update to authenticated
  using (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists provider_logos_bucket_delete_own_folder on storage.objects;
create policy provider_logos_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'provider-logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- provider-documents (private — owner + is_admin() admins only; Faz 2'de
-- has_admin_permission('documents.view')'a geçirilebilir)
drop policy if exists provider_documents_bucket_read_own_or_admin on storage.objects;
create policy provider_documents_bucket_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'provider-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists provider_documents_bucket_write_own_folder on storage.objects;
create policy provider_documents_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'provider-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists provider_documents_bucket_delete_own_folder on storage.objects;
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
