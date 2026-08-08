-- =============================================================================
-- MALSEVK — Supabase Geçişi Faz 4 migration 0031: jobs Nakliye teslimat
-- (delivery) kolonları + create_job/create_operation_with_jobs genişletmesi
-- =============================================================================
-- STATUS: Supabase Geçişi Faz 4 — "Nakliye Eksik Alanlarının Supabase
-- Senkronu" görevinin TEK şema değişikliği. 0001-0030'un HİÇBİRİ
-- değiştirilmedi/yeniden yazılmadı (yerleşik ilke — bkz. 0028/0030'un kendi
-- başlıkları).
--
-- KÖKEN — GERÇEK 6 ALAN, TAHMİN EDİLMEDEN, KAYNAK KODDAN ÇIKARILDI:
-- types.ts#Job.deliveryProvince/deliveryDistrict/deliveryLocationType/
-- deliveryFacilityId/deliveryFacilityName/deliveryAddressText VE
-- job-store.ts#resolveDeliveryLocationFields (bu altı alanın TEK yazma
-- yolu) doğrudan okunarak doğrulandı — job-form-validation.ts#
-- validateNakliyeRouteSide ile birlikte. Bu altı alan yalnızca
-- nakliye-route.ts#isTransportationCategory(category) true iken (yani
-- yalnızca "nakliye" kategorisi) doldurulur, aksi halde job-store.ts
-- tarafından HER ZAMAN aktif olarak temizlenir (undefined). 0028/0030 bu
-- alanları BİLEREK kapsam dışı bırakmıştı (kendi başlıklarında dokümante
-- edildi) — bu migration o belgelenen boşluğu kapatır.
--
-- KOLON İSİMLERİ: mevcut naming convention ile birebir (work_location_type/
-- address_text/location_mode kalıbının "delivery_" önekli hâli):
--   delivery_province, delivery_district, delivery_location_type,
--   delivery_facility_id, delivery_facility_name, delivery_address_text
--
-- NULLABLE/REQUIRED: hepsi nullable. Form katmanı (validateNakliyeRouteSide)
-- Nakliye seçiliyken province/district/locationType/addressText'i zorunlu
-- kılıyor OLSA DA, iki nedenle DB'de NOT NULL/CHECK ile zorlanmıyor — (1)
-- yalnızca Nakliye kategorisinde anlamlı, diğer TÜM kategorilerde bu altı
-- alan hep null (bir NOT NULL, Nakliye-olmayan bir ilanın INSERT'ini
-- kırardı); (2) `location_mode`/`product_quantity` gibi diğer TÜM
-- kategori-kapsamlı alanlarda zaten kurulu olan "UI zorunlu kılar, DB
-- yalnızca TİP/DEĞER kısıtlar, VARLIK kısıtlamaz" ilkesiyle tutarlı (bkz.
-- 0028'in kendi "daha katı değil, daha gevşek de değil" notu).
-- `delivery_location_type` yalnızca `location_mode` (0004) ile AYNI 2-değerli
-- CHECK kalıbını alır (`facility`/`open_address`) — TİP güvenliği, VARLIK
-- zorunluluğu değil.
--
-- `delivery_facility_id` bir FK DEĞİL — pickup'ın kendi `facility_id`si
-- (0004) gibi düz `text`, çünkü tesis kataloğu (data/locations/locations.json)
-- Supabase'de hiç yok (bkz. facility_candidates migration 0029'un kendi AYNI
-- notu). Katalog-içi doğrulama (job-store.ts#verifyNakliyeFacility) zaten
-- İSTEMCİ tarafında, RPC çağrılmadan ÖNCE yapılıyor — pickup facility_id'nin
-- RPC'de hiç yeniden doğrulanmamasıyla AYNI ilke, yeni bir asimetri değil.
--
-- Hata kodu değişikliği yok — yeni bir doğrulama eklenmiyor, yalnızca yeni
-- kolonlar + onları taşıyan parametreler ekleniyor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs: Nakliye teslimat kolonları (additive, nullable, mevcut
-- kayıtları etkilemez)
-- -----------------------------------------------------------------------------
alter table public.jobs add column if not exists delivery_province text;
alter table public.jobs add column if not exists delivery_district text;
alter table public.jobs add column if not exists delivery_location_type text;
alter table public.jobs add column if not exists delivery_facility_id text;
alter table public.jobs add column if not exists delivery_facility_name text;
alter table public.jobs add column if not exists delivery_address_text text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_delivery_location_type_valid'
  ) then
    alter table public.jobs add constraint jobs_delivery_location_type_valid
      check (delivery_location_type is null or delivery_location_type in ('facility', 'open_address'));
  end if;
end $$;

comment on column public.jobs.delivery_province is
  'types.ts#Job.deliveryProvince ile birebir — yalnızca isTransportationCategory(category) (Nakliye) kapsamında dolu, diğer TÜM kategorilerde null (job-store.ts#resolveDeliveryLocationFields aktif olarak temizler).';
comment on column public.jobs.delivery_district is
  'types.ts#Job.deliveryDistrict ile birebir — bkz. delivery_province üstündeki not.';
comment on column public.jobs.delivery_location_type is
  'types.ts#Job.deliveryLocationType ile birebir ("facility" | "open_address") — location_mode (0004) ile AYNI CHECK kalıbı.';
comment on column public.jobs.delivery_facility_id is
  'types.ts#Job.deliveryFacilityId ile birebir — düz text, FK DEĞİL (bkz. jobs.facility_id, 0004 — tesis kataloğu Supabase''de yok). Katalog doğrulaması istemci tarafında (job-store.ts#verifyNakliyeFacility), RPC''den önce yapılır.';
comment on column public.jobs.delivery_facility_name is
  'types.ts#Job.deliveryFacilityName ile birebir — facilityId''nin denormalize görünen adı (facility modu) ya da kullanıcının serbestçe yazdığı ad (open_address modu).';
comment on column public.jobs.delivery_address_text is
  'types.ts#Job.deliveryAddressText ile birebir — yöntemden bağımsız her zaman taşınır (bkz. job-store.ts#resolveDeliveryLocationFields''in kendi dokümantasyonu, "eski karşılıklı dışlama kuralı kaldırıldı").';

-- Yeni kolonlar mevcut TABLO-seviyeli SELECT grant'ine (0004: `grant select
-- on public.jobs to authenticated, anon`) otomatik dahildir, ayrı bir grant
-- GEREKMEZ. UPDATE grant listesi (0004'ün "RPC-only" ayrımı) bu migration'da
-- BİLEREK genişletilmedi — düzenleme (update_job) akışına bağlanması ayrı,
-- daha sonraki bir fazın konusu (bu görevin kendi kapsam sınırı: "edit sync
-- bu fazın kapsamı değildir").

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: 6 opsiyonel delivery parametresi (0028'in 21
-- parametreli imzasının SONUNA, `default null` ile — geriye uyumlu)
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
  p_client_id uuid default null,
  p_delivery_province text default null,
  p_delivery_district text default null,
  p_delivery_location_type text default null,
  p_delivery_facility_id text default null,
  p_delivery_facility_name text default null,
  p_delivery_address_text text default null
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

  insert into public.jobs (
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type, delivery_province, delivery_district, delivery_location_type,
    delivery_facility_id, delivery_facility_name, delivery_address_text
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text
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

-- Eski 21-parametreli imza artık mevcut değil (create or replace ile
-- değiştirildi) — 0028'in kendi notundaki AYNI gerekçe: tüm gerçek çağıranlar
-- (supabase-job-sync.ts, tmp-*.mjs script'leri) adlandırılmış (named)
-- parametre sözdizimi kullanıyor, pozisyonel argüman sayısına duyarlı değil.
revoke all on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: per-service delivery alanları
-- (0030'un kendi per-service `province` deseniyle AYNI — fonksiyonun DIŞ
-- imzası DEĞİŞMEDİ, yeni alanlar zaten var olan p_services JSONB gövdesinin
-- İÇİNDEN okunuyor)
-- -----------------------------------------------------------------------------
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
  v_service_province text;
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

    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type, delivery_province, delivery_district, delivery_location_type,
      delivery_facility_id, delivery_facility_name, delivery_address_text
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, v_service_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type',
      -- YENİ (bu migration): yalnızca Nakliye kardeşi gönderir (bkz. dosya
      -- başlığı) — diğer TÜM kardeş hizmetler için bu anahtarlar hiç yoktur,
      -- ->> NULL döner, kolonlar null kalır (görev bölüm 5).
      v_service->>'delivery_province', v_service->>'delivery_district', v_service->>'delivery_location_type',
      v_service->>'delivery_facility_id', v_service->>'delivery_facility_name', v_service->>'delivery_address_text'
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

-- Grant değişmedi (aynı imza, 0030'da zaten grant edilmişti) — create or
-- replace bunu korur, yine de açıkça tekrarlanır (idempotent, zararsız).
revoke all on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) to authenticated;
