-- =============================================================================
-- MALSEVK — Faz 1 (Supabase Geçişi) migration 0028: jobs ürün bilgisi kolonları
-- + create_job/create_operation_with_jobs'a client-id kabulü
-- =============================================================================
-- STATUS: Supabase Geçişi Faz 1 — "Gerçek İlan Oluşturmayı Supabase'e Bağla"
-- görevinin TEK şema değişikliği. 0001-0027'nin HİÇBİRİ değiştirilmedi/yeniden
-- yazılmadı (yerleşik ilke: uygulanmış bir migration asla geriye dönük
-- düzenlenmez, yalnızca yeni bir migration onu evrimleştirir).
--
-- KÖKEN: Önceki mimari analiz görevi, `public.jobs` tablosunda (0004) Ürün
-- Bilgileri (Ürün Adedi/Tonaj/Ürün Cinsi, types.ts#Job.productQuantity/
-- productTonnage/productType) ve Gümrük Müşavirliği'nin ayrı productType
-- eşdeğeri (customsProductType) için HİÇBİR kolon karşılığı olmadığını tespit
-- etti. Bu migration YALNIZCA bu dört alanı ekler — görev tanımının kendi
-- kapsam sınırı gereği customsTransactionType/customsRequestedServices/
-- customsDocuments (Gümrük Müşavirliği'nin geri kalan "Operasyon Bilgileri"
-- alanları) ve Nakliye'nin 6 teslimat alanı (deliveryProvince/District/
-- LocationType/FacilityId/FacilityName/AddressText) BİLEREK bu migration'ın
-- DIŞINDA bırakıldı — bunlar da types.ts#Job'da var ama Supabase şemasında
-- YOK; Faz 1 CREATE senkronu bu alanları henüz Supabase'e YAZMAYACAK (bkz.
-- app/_lib/supabase-job-sync.ts'in kendi "bilinen kısmi senkron" notu ve
-- görev sonu raporundaki "kalan riskler" bölümü). Bu, "bir alan RPC'de/DB'de
-- yoksa sessizce kaybetme" ilkesinin SESSİZCE değil AÇIKÇA uygulanmış hâlidir.
--
-- Ayrıca bu migration create_job/create_operation_with_jobs'a OPSİYONEL bir
-- client-üretimli id kabul etme yeteneği ekliyor (p_client_id / per-service
-- client_id / p_client_operation_id) — localStorage'daki Job.id zaten
-- `crypto.randomUUID()` ile üretiliyor (bkz. job-store.ts#createJob), bu
-- yüzden aynı UUID'yi Supabase tarafında da birincil anahtar olarak kullanmak
-- (yeni bir eşleştirme/reconciliation tablosu icat etmek yerine) hem daha
-- basit hem de local/remote kimliklerin baştan hiç ayrışmamasını garanti
-- eder. Tamamen GERİYE UYUMLU: yeni parametreler mevcut imzaların SONUNA,
-- `default null` ile eklendi — eski (id belirtmeyen) çağrılar değişmeden
-- çalışmaya devam eder, id auto-generate edilir (gen_random_uuid()).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs: ürün bilgisi kolonları (additive, nullable, mevcut
-- kayıtları etkilemez)
-- -----------------------------------------------------------------------------
-- Kısıtlar gerçek UI doğrulamasının (product-catalog.ts#parseProductQuantity/
-- parseProductTonnage, job-form-validation.ts:110-117 "en fazla 100 karakter")
-- BİREBİR aynısı — daha katı değil, daha gevşek de değil.
alter table public.jobs add column if not exists product_quantity integer;
alter table public.jobs add column if not exists product_tonnage numeric(9, 2);
alter table public.jobs add column if not exists product_type text;
alter table public.jobs add column if not exists customs_product_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_product_quantity_range'
  ) then
    alter table public.jobs add constraint jobs_product_quantity_range
      check (product_quantity is null or (product_quantity > 0 and product_quantity <= 999999));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_product_tonnage_range'
  ) then
    alter table public.jobs add constraint jobs_product_tonnage_range
      check (product_tonnage is null or (product_tonnage > 0 and product_tonnage <= 999999));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_product_type_length'
  ) then
    alter table public.jobs add constraint jobs_product_type_length
      check (product_type is null or char_length(product_type) <= 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_customs_product_type_length'
  ) then
    alter table public.jobs add constraint jobs_customs_product_type_length
      check (customs_product_type is null or char_length(customs_product_type) <= 100);
  end if;
end $$;

comment on column public.jobs.product_quantity is
  'types.ts#Job.productQuantity ile birebir — yalnızca product-catalog.ts#requiresProductInfo kapsamındaki kategorilerde doldurulur. Kapsam kontrolü client tarafında yapılır (resolveProductInfoFields, job-store.ts), bu kolon kapsam-dışı bir kategori için client hiç göndermezse null kalır.';
comment on column public.jobs.product_tonnage is
  'types.ts#Job.productTonnage ile birebir. Ondalıklı (ör. 8.5) — bkz. product-catalog.ts#parseProductTonnage.';
comment on column public.jobs.product_type is
  'types.ts#Job.productType ile birebir. Her zaman düz metin — PRODUCT_TYPE_CUSTOM_VALUE sentinel''i burada asla saklanmaz (form katmanında zaten çözülmüş olarak gelir, bkz. önceki analiz raporu madde 5).';
comment on column public.jobs.customs_product_type is
  'types.ts#Job.customsProductType ile birebir — product_type''tan TAMAMEN BAĞIMSIZ bir alan (Gümrük Müşavirliği''ye özel, kategoriler asla kesişmez). Aynı sentinel-çözümleme ilkesi geçerlidir.';

-- Yeni kolonlar mevcut TABLO-seviyeli SELECT grant'ine (0004: `grant select
-- on public.jobs to authenticated, anon`) otomatik dahildir, ayrı bir grant
-- GEREKMEZ. UPDATE grant listesi (0004'ün "listing_status/closed_at/... RPC-
-- only" ayrımı) bu migration'da BİLEREK genişletilmedi — bu alanların
-- düzenleme (update_job) akışına bağlanması ayrı, daha sonraki bir fazın
-- konusu (bkz. bu görevin kapsam sınırı: yalnızca CREATE).

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: ürün bilgisi parametreleri + opsiyonel client-id
-- -----------------------------------------------------------------------------
create or replace function public.create_job(
  p_category_id text,
  p_title text,
  p_description text,
  p_operation_details text,
  p_province text,
  p_district text,
  p_work_location_type text,
  p_work_date date,
  p_photos jsonb,
  p_facility_id text default null,
  p_location_mode text default 'catalog',
  p_address_text text default '',
  p_neighborhood text default null,
  p_location_url text default null,
  p_directions_note text default null,
  p_work_end_date date default null,
  p_product_quantity integer default null,
  p_product_tonnage numeric default null,
  p_product_type text default null,
  p_customs_product_type text default null,
  p_client_id uuid default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
begin
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_photo_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_photo_count < 1 or v_photo_count > 10 then
    raise exception 'MLK51: a job requires between 1 and 10 photos (got %)', v_photo_count using errcode = 'MLK51';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;

  -- p_client_id: localStorage'daki Job.id (zaten crypto.randomUUID()) ile
  -- birebir aynı UUID'yi burada da birincil anahtar yapmak için — GÜVENLİ,
  -- çünkü (a) yalnızca auth.uid() = requester_id olarak yazılabiliyor (satır
  -- sahipliği id'den bağımsız, RLS/yetki id seçimiyle atlatılamaz), (b) bir
  -- çakışma (pratikte imkansız, 122 bit rastgelelik) yalnızca zararsız bir
  -- unique_violation (23505) üretir, güvenlik açığı değil. NULL ise (eski/
  -- id belirtmeyen çağrılar) tablo kendi varsayılanını (gen_random_uuid())
  -- kullanır — GERİYE UYUMLU.
  insert into public.jobs (
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type
  )
  returning * into v_job;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
    values (
      v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
      (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
      v_order, auth.uid()
    );
    v_order := v_order + 1;
  end loop;

  perform public.append_job_activity_event(v_job.id, null, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

  return v_job;
end;
$$;

-- Eski 16-parametreli imza artık mevcut değil (create or replace aynı isimle
-- yeni bir parametre listesiyle önceki fonksiyonu TAMAMEN değiştirir, eski
-- imza PostgreSQL'de ayrı bir overload OLARAK KALMAZ çünkü yalnızca sona
-- parametre eklendi — bu, Postgres'in "aynı isim farklı imza = farklı
-- fonksiyon" kuralına rağmen burada sorun değildir çünkü hiçbir çağıran eski
-- imzayı positional olarak TAM 16 argümanla çağırmıyordu; tüm mevcut/bilinen
-- çağıranlar (tmp-*.mjs seed script'leri) adlandırılmış (named) parametre
-- sözdizimi kullanıyor, bkz. scripts/tmp-admin-panel-phase2-seed-local.mjs).
revoke all on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid) from public, anon;
grant execute on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: per-service ürün bilgisi + opsiyonel
-- client-id (hem operasyon hem her bir hizmet için)
-- -----------------------------------------------------------------------------
-- Fonksiyonun KENDİ imzası DEĞİŞMEDİ (hâlâ 4 parametre) — yeni alanların
-- hepsi zaten var olan p_services/p_client_operation_id JSONB gövdesinin
-- İÇİNDEN okunuyor, bu yüzden PostgREST/istemci tarafında hiçbir eski
-- çağrının kırılma riski YOK. Tek gerçek imza değişikliği, yeni, sondaki
-- opsiyonel p_client_operation_id parametresi.
create or replace function public.create_operation_with_jobs(
  p_province text,
  p_operation_details text,
  p_services jsonb,
  p_photos_by_service_index jsonb,
  p_client_operation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.operations;
  v_service jsonb;
  v_index integer := 0;
  v_service_count integer;
  v_category_ids text[];
  v_job public.jobs;
  v_job_ids uuid[] := '{}';
  v_photo jsonb;
  v_photo_count integer;
  v_order integer;
  v_service_client_id uuid;
begin
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_service_count := jsonb_array_length(coalesce(p_services, '[]'::jsonb));
  if v_service_count < 2 then
    raise exception 'MLK53: an operation requires at least 2 services (got %)', v_service_count using errcode = 'MLK53';
  end if;

  select array_agg(s->>'category_id') into v_category_ids from jsonb_array_elements(p_services) s;
  if (select count(distinct x) from unnest(v_category_ids) x) <> v_service_count then
    raise exception 'MLK54: an operation cannot select the same category more than once' using errcode = 'MLK54';
  end if;

  -- p_client_operation_id: localStorage'daki job-store.ts#createOperationId()
  -- (crypto.randomUUID()) ile aynı UUID'yi operations.id olarak kullanmak
  -- için — create_job'daki p_client_id ile AYNI güvenlik gerekçesi (satır
  -- sahipliği id'den bağımsız, çakışma yalnızca zararsız unique_violation).
  insert into public.operations (id, requester_id)
  values (coalesce(p_client_operation_id, gen_random_uuid()), auth.uid())
  returning * into v_operation;

  for v_service in select * from jsonb_array_elements(p_services) loop
    if (v_service->>'work_end_date') is not null
       and (v_service->>'work_end_date')::date < (v_service->>'work_date')::date then
      raise exception 'MLK52: work_end_date cannot be before work_date (service %)', v_index using errcode = 'MLK52';
    end if;

    v_photo_count := jsonb_array_length(coalesce(p_photos_by_service_index -> v_index::text, '[]'::jsonb));
    if v_photo_count < 1 or v_photo_count > 10 then
      raise exception 'MLK51: a job requires between 1 and 10 photos (service %, got %)', v_index, v_photo_count using errcode = 'MLK51';
    end if;

    -- Her hizmet kendi client_id'sini taşıyabilir (localStorage'daki her
    -- kardeş Job'un kendi crypto.randomUUID() id'si var, tek bir üst-seviye
    -- id yeterli değil) — bkz. types.ts#Job.productQuantity dokümanı: "Çoklu
    -- Hizmet Operasyonu'nda her hizmet kendi ürün bilgisini bağımsız taşır."
    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, p_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type'
    )
    returning * into v_job;

    v_order := 0;
    for v_photo in select * from jsonb_array_elements(p_photos_by_service_index -> v_index::text) loop
      insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
      values (
        v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
        (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
        v_order, auth.uid()
      );
      v_order := v_order + 1;
    end loop;

    perform public.append_job_activity_event(v_job.id, v_operation.id, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

    v_job_ids := array_append(v_job_ids, v_job.id);
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('operation_id', v_operation.id, 'job_ids', v_job_ids);
end;
$$;

revoke all on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) to authenticated;

-- Eski 4-parametreli imza artık mevcut değil (create or replace ile
-- değiştirildi) — ama bu ZARARSIZ, çünkü PostgREST bir RPC'yi HER ZAMAN
-- adlandırılmış (named) JSON body parametreleriyle çağırır, pozisyonel
-- argüman sayısına duyarlı değildir; p_client_operation_id gönderilmezse
-- default null uygulanır, davranış eskisiyle BİREBİR aynıdır.
