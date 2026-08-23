-- =============================================================================
-- MALSEVK — migration 0056: Depolama "Konteyner Bilgileri" (4 düz alan)
-- =============================================================================
-- AMAÇ: "Konteyner Depolama" alt kategorisine özel, TAMAMEN isteğe bağlı 4
-- düz (skaler) alan — Konteyner Adedi/Ölçüsü/Durumu/İçeriği.
--
-- KÖK NEDEN / TASARIM GEÇMİŞİ (bu migration'ın İLK taslağı hiç push
-- EDİLMEDİ, gerçek kullanıcı testinde bulunan bir hata üzerine baştan
-- yazıldı — bkz. storage-container-catalog.ts'in kendi başlık dokümanı):
-- ilk taslak, tekrarlanabilir satırlardan oluşan TEK bir `jsonb` sütunu
-- (storage_container_details) VE tetikleme kuralı olarak "kategori Konteyner
-- Depolama VE Depolanacak Ürün = Konteyner" (İKİ koşul) varsayıyordu. Gerçek
-- kullanıcı testinde, yalnızca kategori seçildiğinde (Depolanacak Ürün'e
-- AYRICA "Konteyner" yazılmadan) hiçbir özel alan görünmediği bulundu — kök
-- neden buydu. Düzeltme sonrası SADELEŞTİRİLMİŞ tasarım: tetikleme kuralı
-- YALNIZCA kategori id'sine bağlıdır (storage-container-catalog.ts#
-- isContainerStorageCategory, TEK doğruluk kaynağı), tekrarlanabilir
-- satırlar yerine 4 SABİT, düz skaler sütun kullanılır (Adet/Ölçü/Durum/
-- İçerik) — reefer/ağırlık/çoklu-satır kapsamı TAMAMEN kaldırıldı.
--
-- storage_container_content İÇİN İKİNCİ BİR GÜVENLİK AĞI: görev tanımı
-- "İçerik yalnızca Durum='dolu' iken anlamlıdır, Durum='boş' iken KESİNLİKLE
-- gösterilmemeli/saklanmamalı" kuralını hem RPC gövdesinde (INSERT/UPDATE'te
-- durumla eşleşmeyen içerik asla yazılmaz) HEM DE bir CHECK kısıtıyla (bkz.
-- jobs_storage_container_content_requires_dolu) İKİ KATMANDA uygular — bu,
-- storage-container-catalog.ts#isContainerContentApplicable'ın zaten
-- uyguladığı AYNI kuralın veritabanı tarafındaki yansımasıdır, YENİ/İKİNCİ
-- bir iş kuralı İCAT EDİLMEDİ. UPDATE RPC'lerinde bu yüzden düz
-- `coalesce(p_x, x)` YERİNE `storage_container_content`'in kendi SET ifadesi
-- nihai durumu kontrol eder — aksi halde bir admin Dolu'dan Boş'a geçirip
-- kaydettiğinde, `coalesce(null, eski_içerik)` eski içeriği SESSİZCE geri
-- getirirdi (bu repo'nun daha önce 0037'de düzelttiği "coalesce bir alanı
-- ASLA sıfırlayamaz" tuzağının BİREBİR AYNISI, burada tam tersi yönde ele
-- alınıyor: bu TEK alan için "atla" değil "durumla eşleşmiyorsa sıfırla"
-- davranışı isteniyor).
--
-- RPC GÜVENLİK DİSİPLİNİ (0032-0034/0046-0048/0051/0054'ün kurduğu, tekrar
-- eden desen): `create or replace function` yalnızca TAM AYNI imzada gerçek
-- bir "replace" yapar; yeni parametre eklendiğinde eski imza PostgREST'e
-- İKİNCİ bir canlı overload olarak görünür ve PGRST203 hatası verir. Bu
-- yüzden `create_job`/`update_job_as_admin`/`update_job_as_requester`
-- güncel TAM imzalarıyla önce `drop function if exists` edilir, SONRA 4 yeni
-- parametre eklenmiş hâlleri yazılır (imzalar doğrudan pg_get_function_
-- identity_arguments ile canlı veritabanından doğrulanmıştır).
-- `create_operation_with_jobs`ın imzası DEĞİŞMEZ (5 parametre) — p_services
-- zaten serbest biçimli bir jsonb dizisi olduğu için yeni alanlar yalnızca
-- o dizinin her elemanının İÇİNDEN okunur (0030'un per-service province
-- override'ı EKLEDİĞİ AYNI desen), bu yüzden yalnızca gövde create or
-- replace edilir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs.storage_container_* kolonları
-- -----------------------------------------------------------------------------
alter table public.jobs add column if not exists storage_container_count integer;
alter table public.jobs add column if not exists storage_container_size text;
alter table public.jobs add column if not exists storage_container_status text;
alter table public.jobs add column if not exists storage_container_content text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_storage_container_size_valid'
  ) then
    alter table public.jobs add constraint jobs_storage_container_size_valid
      check (storage_container_size is null or storage_container_size in ('20', '40', '45'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_storage_container_status_valid'
  ) then
    alter table public.jobs add constraint jobs_storage_container_status_valid
      check (storage_container_status is null or storage_container_status in ('dolu', 'bos'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_storage_container_count_positive'
  ) then
    alter table public.jobs add constraint jobs_storage_container_count_positive
      check (storage_container_count is null or storage_container_count > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_storage_container_content_requires_dolu'
  ) then
    alter table public.jobs add constraint jobs_storage_container_content_requires_dolu
      check (storage_container_content is null or storage_container_status = 'dolu');
  end if;
end $$;

comment on column public.jobs.storage_container_count is
  'types.ts#Job.storageContainerCount ile birebir — yalnızca isContainerStorageCategory(category) ("Konteyner Depolama") kapsamında anlamlı, pozitif tam sayı, isteğe bağlı.';
comment on column public.jobs.storage_container_size is
  'types.ts#Job.storageContainerSize ile birebir — "20" | "40" | "45" (ft), isteğe bağlı.';
comment on column public.jobs.storage_container_status is
  'types.ts#Job.storageContainerStatus ile birebir — "dolu" | "bos", isteğe bağlı.';
comment on column public.jobs.storage_container_content is
  'types.ts#Job.storageContainerContent ile birebir — YALNIZCA storage_container_status = ''dolu'' iken dolu olabilir (bkz. jobs_storage_container_content_requires_dolu CHECK''i), ''dolu'' iken bile ZORUNLU DEĞİLDİR.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: 4 yeni parametre (42-45)
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date,
  integer, numeric, text, text, uuid, text, text, text, text, text, text, text, text, numeric, text,
  text, text, text[], text, text[], text, numeric, text, numeric, text
);

create or replace function public.create_job(
  p_category_id text, p_title text, p_description text, p_operation_details text, p_province text,
  p_district text, p_work_location_type text, p_work_date date, p_photos jsonb,
  p_facility_id text default null::text, p_location_mode text default 'catalog'::text,
  p_address_text text default ''::text, p_neighborhood text default null::text,
  p_location_url text default null::text, p_directions_note text default null::text,
  p_work_end_date date default null::date, p_product_quantity integer default null::integer,
  p_product_tonnage numeric default null::numeric, p_product_type text default null::text,
  p_customs_product_type text default null::text, p_client_id uuid default null::uuid,
  p_delivery_province text default null::text, p_delivery_district text default null::text,
  p_delivery_location_type text default null::text, p_delivery_facility_id text default null::text,
  p_delivery_facility_name text default null::text, p_delivery_address_text text default null::text,
  p_recycling_material_category_id text default null::text, p_recycling_material_subtype_id text default null::text,
  p_recycling_quantity numeric default null::numeric, p_recycling_unit text default null::text,
  p_recycling_material_condition text default null::text, p_recycling_material_condition_note text default null::text,
  p_recycling_scope_of_work text[] default null::text[], p_customs_transaction_type text default null::text,
  p_customs_requested_services text[] default null::text[], p_storage_product_type text default null::text,
  p_storage_product_quantity numeric default null::numeric, p_storage_product_unit text default null::text,
  p_storage_product_tonnage numeric default null::numeric, p_product_tonnage_unit text default null::text,
  p_storage_container_count integer default null::integer, p_storage_container_size text default null::text,
  p_storage_container_status text default null::text, p_storage_container_content text default null::text
)
returns jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
begin
  perform public.assert_active_user();
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
    delivery_facility_id, delivery_facility_name, delivery_address_text,
    recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
    recycling_unit, recycling_material_condition, recycling_material_condition_note,
    recycling_scope_of_work, customs_transaction_type, customs_requested_services,
    storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
    product_tonnage_unit, storage_container_count, storage_container_size, storage_container_status,
    storage_container_content, moderation_status
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text,
    p_recycling_material_category_id, p_recycling_material_subtype_id, p_recycling_quantity,
    p_recycling_unit, p_recycling_material_condition, p_recycling_material_condition_note,
    p_recycling_scope_of_work, p_customs_transaction_type, p_customs_requested_services,
    p_storage_product_type, p_storage_product_quantity, p_storage_product_unit, p_storage_product_tonnage,
    p_product_tonnage_unit, p_storage_container_count, p_storage_container_size, p_storage_container_status,
    case when p_storage_container_status = 'dolu' then p_storage_container_content else null end,
    'pending_review'
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
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: İMZA DEĞİŞMEDİ (5 parametre) —
-- yalnızca gövde, p_services'in her elemanının içinden 4 yeni anahtar okunur.
-- -----------------------------------------------------------------------------
create or replace function public.create_operation_with_jobs(
  p_province text, p_operation_details text, p_services jsonb, p_photos_by_service_index jsonb,
  p_client_operation_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_service_container_status text;
begin
  perform public.assert_active_user();
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
    v_service_container_status := v_service->>'storage_container_status';

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type, delivery_province, delivery_district, delivery_location_type,
      delivery_facility_id, delivery_facility_name, delivery_address_text,
      recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
      recycling_unit, recycling_material_condition, recycling_material_condition_note,
      recycling_scope_of_work, customs_transaction_type, customs_requested_services,
      storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
      product_tonnage_unit, storage_container_count, storage_container_size, storage_container_status,
      storage_container_content, moderation_status
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, v_service_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type',
      v_service->>'delivery_province', v_service->>'delivery_district', v_service->>'delivery_location_type',
      v_service->>'delivery_facility_id', v_service->>'delivery_facility_name', v_service->>'delivery_address_text',
      v_service->>'recycling_material_category_id', v_service->>'recycling_material_subtype_id',
      nullif(v_service->>'recycling_quantity', '')::numeric, v_service->>'recycling_unit',
      v_service->>'recycling_material_condition', v_service->>'recycling_material_condition_note',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'recycling_scope_of_work', '[]'::jsonb)) x),
      v_service->>'customs_transaction_type',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'customs_requested_services', '[]'::jsonb)) x),
      v_service->>'storage_product_type', nullif(v_service->>'storage_product_quantity', '')::numeric,
      v_service->>'storage_product_unit', nullif(v_service->>'storage_product_tonnage', '')::numeric,
      v_service->>'product_tonnage_unit', nullif(v_service->>'storage_container_count', '')::integer,
      v_service->>'storage_container_size', v_service_container_status,
      case when v_service_container_status = 'dolu' then v_service->>'storage_container_content' else null end,
      'pending_review'
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
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — update_job_as_admin: 4 yeni parametre (37-40)
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, text,
  text, text, text, text, text, text, text, numeric, text, text, text, text[], text, text[], text,
  numeric, text, numeric, text, timestamp with time zone
);

create or replace function public.update_job_as_admin(
  p_job_id uuid, p_title text, p_description text, p_province text, p_district text,
  p_work_location_type text, p_address_text text, p_work_date date, p_work_end_date date default null::date,
  p_product_quantity integer default null::integer, p_product_tonnage numeric default null::numeric,
  p_product_type text default null::text, p_customs_product_type text default null::text,
  p_delivery_facility_name text default null::text, p_delivery_address_text text default null::text,
  p_operation_details text default null::text, p_neighborhood text default null::text,
  p_location_url text default null::text, p_directions_note text default null::text,
  p_delivery_province text default null::text, p_delivery_district text default null::text,
  p_recycling_material_category_id text default null::text, p_recycling_material_subtype_id text default null::text,
  p_recycling_quantity numeric default null::numeric, p_recycling_unit text default null::text,
  p_recycling_material_condition text default null::text, p_recycling_material_condition_note text default null::text,
  p_recycling_scope_of_work text[] default null::text[], p_customs_transaction_type text default null::text,
  p_customs_requested_services text[] default null::text[], p_storage_product_type text default null::text,
  p_storage_product_quantity numeric default null::numeric, p_storage_product_unit text default null::text,
  p_storage_product_tonnage numeric default null::numeric, p_product_tonnage_unit text default null::text,
  p_expected_updated_at timestamp with time zone default null::timestamp with time zone,
  p_storage_container_count integer default null::integer, p_storage_container_size text default null::text,
  p_storage_container_status text default null::text, p_storage_container_content text default null::text
)
returns jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_next_container_status text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML115: admin role required' using errcode = 'ML115';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML116: job not found' using errcode = 'ML116';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for review, please re-review' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;

  v_next_container_status := coalesce(p_storage_container_status, v_job.storage_container_status);

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = coalesce(p_product_quantity, product_quantity),
    product_tonnage = coalesce(p_product_tonnage, product_tonnage),
    product_type = coalesce(p_product_type, product_type),
    customs_product_type = coalesce(p_customs_product_type, customs_product_type),
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text),
    operation_details = coalesce(p_operation_details, operation_details),
    neighborhood = coalesce(p_neighborhood, neighborhood),
    location_url = coalesce(p_location_url, location_url),
    directions_note = coalesce(p_directions_note, directions_note),
    delivery_province = coalesce(p_delivery_province, delivery_province),
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_count = coalesce(p_storage_container_count, storage_container_count),
    storage_container_size = coalesce(p_storage_container_size, storage_container_size),
    storage_container_status = v_next_container_status,
    -- coalesce(p_x, x) BİLEREK kullanılmaz: durum "dolu" DEĞİLSE içerik her
    -- zaman null'a döner (aksi hâlde bir Dolu->Boş kaydından SONRA eski
    -- içerik coalesce ile sessizce geri gelirdi) — bkz. migration başlığı.
    storage_container_content = case
      when v_next_container_status = 'dolu' then coalesce(p_storage_container_content, storage_container_content)
      else null
    end
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — update_job_as_requester: 4 yeni parametre (37-40)
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, text,
  text, text, text, text, text, text, text, numeric, text, text, text, text[], text, text[], text,
  numeric, text, numeric, text, timestamp with time zone
);

create or replace function public.update_job_as_requester(
  p_job_id uuid, p_title text, p_description text, p_province text, p_district text,
  p_work_location_type text, p_address_text text, p_work_date date, p_work_end_date date default null::date,
  p_product_quantity integer default null::integer, p_product_tonnage numeric default null::numeric,
  p_product_type text default null::text, p_customs_product_type text default null::text,
  p_delivery_facility_name text default null::text, p_delivery_address_text text default null::text,
  p_operation_details text default null::text, p_neighborhood text default null::text,
  p_location_url text default null::text, p_directions_note text default null::text,
  p_delivery_province text default null::text, p_delivery_district text default null::text,
  p_recycling_material_category_id text default null::text, p_recycling_material_subtype_id text default null::text,
  p_recycling_quantity numeric default null::numeric, p_recycling_unit text default null::text,
  p_recycling_material_condition text default null::text, p_recycling_material_condition_note text default null::text,
  p_recycling_scope_of_work text[] default null::text[], p_customs_transaction_type text default null::text,
  p_customs_requested_services text[] default null::text[], p_storage_product_type text default null::text,
  p_storage_product_quantity numeric default null::numeric, p_storage_product_unit text default null::text,
  p_storage_product_tonnage numeric default null::numeric, p_product_tonnage_unit text default null::text,
  p_expected_updated_at timestamp with time zone default null::timestamp with time zone,
  p_storage_container_count integer default null::integer, p_storage_container_size text default null::text,
  p_storage_container_status text default null::text, p_storage_container_content text default null::text
)
returns jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_next_container_status text;
begin
  perform public.assert_active_user();

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML129: job not found' using errcode = 'ML129';
  end if;
  if v_job.requester_id <> auth.uid() then
    raise exception 'ML130: only the job owner may edit this job' using errcode = 'ML130';
  end if;
  if v_job.moderation_status <> 'pending_review' then
    raise exception 'ML131: only a job awaiting review can be edited this way' using errcode = 'ML131';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for editing, please reload' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;

  v_next_container_status := coalesce(p_storage_container_status, v_job.storage_container_status);

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = coalesce(p_product_quantity, product_quantity),
    product_tonnage = coalesce(p_product_tonnage, product_tonnage),
    product_type = coalesce(p_product_type, product_type),
    customs_product_type = coalesce(p_customs_product_type, customs_product_type),
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text),
    operation_details = coalesce(p_operation_details, operation_details),
    neighborhood = coalesce(p_neighborhood, neighborhood),
    location_url = coalesce(p_location_url, location_url),
    directions_note = coalesce(p_directions_note, directions_note),
    delivery_province = coalesce(p_delivery_province, delivery_province),
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_count = coalesce(p_storage_container_count, storage_container_count),
    storage_container_size = coalesce(p_storage_container_size, storage_container_size),
    storage_container_status = v_next_container_status,
    -- update_job_as_admin ile AYNI gerekçe — bkz. migration başlığı.
    storage_container_content = case
      when v_next_container_status = 'dolu' then coalesce(p_storage_container_content, storage_container_content)
      else null
    end
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan sahibi tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_requester', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$function$;
