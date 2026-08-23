-- =============================================================================
-- MALSEVK — migration 0066: Nakliye "Çoklu Yük Grubu"
-- =============================================================================
-- AMAÇ: Nakliye'nin "2 — Yük Bilgileri" kartı artık TEK değil, bağımsız bir
-- "Yük Grubu" dizisi taşıyabilir (ör. bir ilanda hem 1 adet 40' konteyner
-- HEM ayrı bir paletli yük). types.ts#Job.nakliyeCargoGroups üstündeki
-- doküman bu alanın uygulama-katmanı yapısını/geriye dönük uyumluluk
-- kuralını tam olarak açıklar — burada yalnızca DB tarafı özetlenir.
--
-- MİMARİ KARAR (0056/0063/0064 İLE AYNI): tek tek dağınık sütunlar AÇILMADI —
-- storage_container_groups/nakliye_measurement_info/nakliye_hazmat/
-- nakliye_container_transport İLE AYNI "yapılandırılmış/değişken şekilli alt
-- veri için TEK jsonb sütunu + minimal DB şekil kontrolü (dizi mi, her eleman
-- obje mi), derin doğrulama uygulama katmanında (nakliye-transport-
-- catalog.ts#sanitizeNakliyeCargoGroups)" deseni izlendi.
--
-- RPC GÜVENLİK DİSİPLİNİ (0032-0034/0054/0057/0058/0062/0063/0064 İLE AYNI):
-- imzası değişen HER RPC'nin ("create_job", "update_job_as_admin",
-- "update_job_as_requester") mevcut TAM imzası önce `drop function if
-- exists` ile silinir, SONRA yeni parametre eklenmiş hâli yazılır — imzalar
-- 0065'in BİZZAT KENDİ dosyasındaki (bu migration'dan hemen önceki canlı
-- durum — 0065 yalnızca gövde değiştirdi, imza 0064'ten BEri AYNI kaldı)
-- gövdelerinden alınmıştır. `create_operation_with_jobs`in imzası
-- DEĞİŞMİYOR (storage_container_groups/nakliye_* İLE AYNI gerekçe — yeni
-- alan her servis nesnesinin kendi `nakliye_cargo_groups` anahtarından
-- okunuyor).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs.nakliye_cargo_groups, kendi minimal şekil doğrulayıcısıyla.
-- -----------------------------------------------------------------------------
alter table public.jobs add column if not exists nakliye_cargo_groups jsonb;

comment on column public.jobs.nakliye_cargo_groups is
  'app/_lib/types.ts#NakliyeCargoGroup[] ile birebir — bağımsız "Yük Grubu" dizisi (her eleman kendi productQuantity/productTonnage/productType/productTonnageUnit/loadPreparationType/loadPreparationCustomText/measurementInfo/containerTransport''ını taşır). YALNIZCA Nakliye''de anlamlı; diğer kategorilerde her zaman null. Doluysa (length >= 1) bu ilanın "Yük Bilgileri"si için TEK doğruluk kaynağıdır — product_quantity/product_tonnage/product_type/product_tonnage_unit VE nakliye_load_preparation_type/nakliye_measurement_info/nakliye_container_transport bu durumda yalnızca grup 1''in bir KOPYASI (aynası) olarak yazılır, cargo-groups-farkında olmayan eski okuyucuların en azından ilk grubu doğru görmesi için. Derin doğrulama app tarafında (nakliye-transport-catalog.ts#sanitizeNakliyeCargoGroups).';

create or replace function public.validate_nakliye_cargo_groups(p_groups jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_element jsonb;
begin
  if p_groups is null then
    return;
  end if;
  if jsonb_typeof(p_groups) <> 'array' then
    raise exception 'MLK60: nakliye_cargo_groups must be a jsonb array' using errcode = 'MLK60';
  end if;
  for v_element in select * from jsonb_array_elements(p_groups) loop
    if jsonb_typeof(v_element) <> 'object' then
      raise exception 'MLK61: each nakliye_cargo_groups element must be a jsonb object' using errcode = 'MLK61';
    end if;
  end loop;
end;
$function$;

comment on function public.validate_nakliye_cargo_groups(jsonb) is
  '0066: create_job/create_operation_with_jobs/update_job_as_admin/update_job_as_requester tarafından paylaşılan TEK minimal şekil kontrolü — yalnızca jsonb bir DİZİ mi ve her elemanı bir OBJE mi diye bakar, alan bazlı doğrulama app tarafında (nakliye-transport-catalog.ts#sanitizeNakliyeCargoGroups).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: mevcut TAM 49 parametreli imza (0064, 0065'te
-- değişmedi) önce silinir.
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb
);

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
  p_delivery_address_text text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null
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
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);

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
    product_tonnage_unit, storage_container_groups,
    nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
    nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
    nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
    moderation_status
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
    p_product_tonnage_unit, p_storage_container_groups,
    p_nakliye_load_preparation_type, p_nakliye_load_preparation_custom_text,
    p_nakliye_loading_method, p_nakliye_loading_method_custom_text, p_nakliye_measurement_info,
    p_nakliye_hazmat, p_nakliye_container_transport, p_nakliye_cargo_groups,
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
$$;

comment on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) is
  '0066: p_nakliye_cargo_groups eklendi (Nakliye Çoklu Yük Grubu — TEK jsonb dizisi, storage_container_groups İLE AYNI desen) — imza 49''dan 50 parametreye çıktı, mevcut 49 parametreli overload BİLEREK drop edildi (stale-overload sınıfı hatayı önlemek için).';

revoke all on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: imza DEĞİŞMİYOR (storage_container_
-- groups/nakliye_* İLE AYNI gerekçe) — yeni alan her p_services elemanının
-- kendi `nakliye_cargo_groups` anahtarından okunuyor (yalnızca Nakliye
-- hizmet kartında dolu).
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
  v_service_container_groups jsonb;
  v_service_measurement_info jsonb;
  v_service_hazmat jsonb;
  v_service_container_transport jsonb;
  v_service_cargo_groups jsonb;
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
    v_service_container_groups := v_service->'storage_container_groups';
    v_service_measurement_info := v_service->'nakliye_measurement_info';
    v_service_hazmat := v_service->'nakliye_hazmat';
    v_service_container_transport := v_service->'nakliye_container_transport';
    v_service_cargo_groups := v_service->'nakliye_cargo_groups';
    perform public.validate_storage_container_groups(v_service_container_groups);
    perform public.validate_nakliye_measurement_info(v_service_measurement_info);
    perform public.validate_nakliye_hazmat(v_service_hazmat);
    perform public.validate_nakliye_container_transport(v_service_container_transport);
    perform public.validate_nakliye_cargo_groups(v_service_cargo_groups);

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
      product_tonnage_unit, storage_container_groups,
      nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
      nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
      nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
      moderation_status
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
      v_service->>'product_tonnage_unit', v_service_container_groups,
      v_service->>'nakliye_load_preparation_type', v_service->>'nakliye_load_preparation_custom_text',
      v_service->>'nakliye_loading_method', v_service->>'nakliye_loading_method_custom_text', v_service_measurement_info,
      v_service_hazmat, v_service_container_transport, v_service_cargo_groups,
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
$$;

comment on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) is
  '0066: her p_services elemanı artık nakliye_cargo_groups anahtarını da (yalnızca Nakliye hizmet kartında dolu) okuyup jobs''a yazıyor — imza DEĞİŞMEDİ, yalnızca gövde genişledi.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — update_job_as_admin: mevcut TAM 43 parametreli imza (0064, 0065'te
-- değişmedi) önce silinir, coalesce(p_x, x) disiplini AYNEN korunur (0065'in
-- container-mode-based null-clearing case'leri dahil, DEĞİŞMEDEN).
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
);

create or replace function public.update_job_as_admin(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
  p_operation_details text default null,
  p_neighborhood text default null, p_location_url text default null, p_directions_note text default null,
  p_delivery_province text default null, p_delivery_district text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
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
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
    product_tonnage = case when v_container_mode then null else coalesce(p_product_tonnage, product_tonnage) end,
    product_type = case when v_container_mode then null else coalesce(p_product_type, product_type) end,
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
    product_tonnage_unit = case when v_container_mode then null else coalesce(p_product_tonnage_unit, product_tonnage_unit) end,
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

comment on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) is
  '0066: p_nakliye_cargo_groups eklendi (Nakliye Çoklu Yük Grubu) — coalesce(p_x, x) disiplini korunur; 0065''in container-mode-based null-clearing case''leri DEĞİŞMEDEN kalır (grup dizisinin İLK elemanı zaten çağıran tarafından o alanların doğru aynası olarak gönderiliyor).';

revoke all on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — update_job_as_requester: mevcut TAM 43 parametreli imza (0064,
-- 0065'te değişmedi) önce silinir, AYNI coalesce disiplini ve AYNI yetki/
-- durum kısıtları (yalnızca ilan sahibi, yalnızca moderation_status='pending_review')
-- korunur.
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
);

create or replace function public.update_job_as_requester(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
  p_operation_details text default null,
  p_neighborhood text default null, p_location_url text default null, p_directions_note text default null,
  p_delivery_province text default null, p_delivery_district text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
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
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
    product_tonnage = case when v_container_mode then null else coalesce(p_product_tonnage, product_tonnage) end,
    product_type = case when v_container_mode then null else coalesce(p_product_type, product_type) end,
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
    product_tonnage_unit = case when v_container_mode then null else coalesce(p_product_tonnage_unit, product_tonnage_unit) end,
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan sahibi tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_requester', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

comment on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) is
  '0066: update_job_as_admin (0066) ile AYNI p_nakliye_cargo_groups eklendi, AYNI coalesce disipliniyle — sahiplik/moderation_status=pending_review kısıtları (0051) değişmedi.';

revoke all on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — admin_job_list view: `j.*` kullandığı için yeni kolonu otomatik
-- kapsar, ama 0035/0048/0053/0054/0062/0063/0064 İLE AYNI nedenle drop+create
-- gerekiyor.
-- -----------------------------------------------------------------------------
drop view if exists public.admin_job_list;
create view public.admin_job_list
with (security_invoker = false)
as
select j.*, (select count(*) from public.offers o where o.job_id = j.id) as offer_count
from public.jobs j
where public.is_admin();

revoke all on public.admin_job_list from public;
grant select on public.admin_job_list to authenticated;

comment on view public.admin_job_list is
  '0066: jobs''a nakliye_cargo_groups eklenmesi nedeniyle drop+recreate edildi — davranış/erişim değişmedi, yalnızca j.* artık bu yeni kolonu da kapsıyor.';
