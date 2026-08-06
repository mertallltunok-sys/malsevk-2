-- =============================================================================
-- MALSEVK — Faz 1 migration 0026: job-customs-documents Storage bucket & policies
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri, 0025'in Storage karşılığı. 0001-0025'in
-- hiçbiri değiştirilmedi.
--
-- Karar #1/#7 (bkz. 0025 dosya başlığı): dördüncü, TAMAMEN AYRI bir bucket —
-- ne job-photos (public) ne provider-documents (private ama farklı sahiplik
-- modeli: provider_id klasörü) ile paylaşılmaz. 0019'un kendi "provider-
-- documents public=false: iş-hassas, admin-incelemeli belgeler" gerekçesiyle
-- AYNI ruh, ama klasör sahipliği job.requester_id'dir (provider_id DEĞİL) —
-- bkz. aşağıdaki path convention.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-customs-documents', 'job-customs-documents', false, 15728640, array[
    'application/pdf',
    'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- DUZELTME (0019'daki AYNI gercek bulgu tekrarlanmasin diye onceden
-- uygulanan duzeltme): "comment on table storage.buckets" hic YAZILMADI --
-- o tablo supabase_storage_admin'e ait, migration rolu (postgres) COMMENT
-- ON icin sahiplik gerektirir (bkz. 0019'un kendi notu, SQLSTATE 42501).
-- Ayni sebeple "alter table storage.objects enable row level security" da
-- hic YOK -- Supabase bunu proje bootstrap'inin bir parcasi olarak zaten
-- etkinlestirir.

-- -----------------------------------------------------------------------------
-- Object path convention & path-manipulation defense
-- -----------------------------------------------------------------------------
-- job-customs-documents/{job_owner_id}/{job_id}/{document_id}.{ext}
--
-- job-photos (0019)'daki path convention ile AYNI ŞEKİLDE ilk segment her
-- zaman auth.uid()'dir — ama burada "job'un sahibi" (yalnız hizmet-alan
-- ilan sahibi bu belgeleri yükleyebilir, bkz. 0025#create_job_customs_document
-- MLK56/MLK80 kontrolleri), provider-documents'daki gibi bir "provider_id"
-- DEĞİL. `(storage.foldername(name))[1] = auth.uid()::text` kontrolü, bir
-- çağıranın client kodunun kurduğu path string'i ne olursa olsun kendi
-- auth.uid()'i olmayan bir objeye ASLA yazamamasını garanti eder.
-- -----------------------------------------------------------------------------

-- job-customs-documents (private — yalnız ilan sahibi + is_admin(); Karar #1
-- gereği ANON YOK, offer taraflarına özel bir "engaged" dalı da YOK —
-- provider-documents'ın (0019) provider_documents_bucket_read_own_or_admin
-- politikasıyla YAPISAL olarak aynı, yalnız klasör sahipliği farklı).
drop policy if exists job_customs_documents_bucket_read_own_or_admin on storage.objects;
create policy job_customs_documents_bucket_read_own_or_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-customs-documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists job_customs_documents_bucket_write_own_folder on storage.objects;
create policy job_customs_documents_bucket_write_own_folder on storage.objects
  for insert to authenticated
  with check (bucket_id = 'job-customs-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists job_customs_documents_bucket_delete_own_folder on storage.objects;
create policy job_customs_documents_bucket_delete_own_folder on storage.objects
  for delete to authenticated
  using (bucket_id = 'job-customs-documents' and (storage.foldername(name))[1] = auth.uid()::text);

comment on policy job_customs_documents_bucket_read_own_or_admin on storage.objects is
  'Karar #1''in Storage-seviyeli karşılığı: teklif veren/işi alan hizmet veren dahil hiçbir üçüncü taraf, hangi yoldan denerse denesin (doğrudan Storage API dahil) bu bucket''taki bir objeyi ASLA okuyamaz — yalnızca ilanın kendi sahibi veya is_admin(). Önerilen gerçek dosya-servis mekanizması provider-documents (0019/storage-plan.md) ile AYNI: kısa ömürlü (~5 dakika) signed URL''ler.';

-- -----------------------------------------------------------------------------
-- Processing pipeline (özet — provider-documents/0019 ile AYNI)
-- -----------------------------------------------------------------------------
-- 1. Client-side pre-check (magic-number, boyut/uzantı — document-validation.ts
--    + customs-brokerage-catalog.ts#CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS).
-- 2. Storage'a yükle, SONRA create_job_customs_document() RPC'sini çağır
--    (asla tersi — 0019'un "Storage'a yükle, SONRA RPC'yi çağır" ilkesi).
-- 3. RPC başarısız olursa Storage'daki obje yetim kalır — mevcut
--    uploadAndRegisterProviderDocument'in (app/_lib/supabase-provider-
--    documents.ts) yetim-temizleme deseniyle AYNI şekilde ele alınmalıdır
--    (bu migration'ın kapsamı dışı — istemci kodu henüz yazılmadı).
--
-- Watermarking ve virüs taraması İNŞA EDİLMEDİ (provider-documents ile AYNI
-- bilinen boşluk, storage-plan.md'nin güvenlik notu burada da geçerlidir).
-- =============================================================================
