-- =============================================================================
-- MALSEVK — migration 0090: fotoğraf sayısı sınırı DB tarafında da 1-10'dan
-- 1-15'e çıkarıldı
-- =============================================================================
-- GÖREV: "Production Fotoğraf Yükleme Hatası ve Minimum 1 Fotoğraf Kuralı" —
-- app tarafında (photo-validation.ts#MIN_PHOTOS/MAX_PHOTOS) sınır artık TÜM
-- kategoriler için 1-15'tir (eski Depo Hizmetleri/Nakliye'ye özel 4-15
-- istisnası da kaldırıldı). Bu, DB/RPC katmanındaki AYNI (bağımsız, ayrıca
-- doğrulanan) MLK51 kontrolüyle tutarsız kalmıştı — üç fonksiyon hâlâ eski
-- "1-10" sınırını uyguluyordu: create_job, create_operation_with_jobs,
-- update_job (bkz. docs/database/architecture.md §6'nın "job photo min/max
-- is 1-10" notu — bu doğruydu, şimdi 1-15 olarak güncelleniyor).
--
-- KAPSAM DOĞRULAMASI: hangi fonksiyonların GERÇEKTEN bu kontrolü taşıdığı,
-- migration geçmişini elle takip etmek yerine, tüm 89 migration'ın zaten
-- uygulanmış olduğu yerel Docker Postgres'in KENDİSİNDEN
-- (pg_get_functiondef) doğrudan sorgulanarak doğrulandı — update_job_as_admin
-- ve update_job_as_requester'ın hiçbirinde fotoğraf sayısı kontrolü YOK
-- (ikisi de yalnızca alan güncellemesi yapar, p_photos/p_new_photos parametresi
-- taşımaz), bu yüzden bu migration'da DEĞİŞTİRİLMEZLER.
--
-- DEĞİŞİKLİK: üç fonksiyonun HER birinde yalnızca iki nokta değişti — sayısal
-- karşılaştırma (`> 10` -> `> 15`) ve hata mesajı metni ("1 and 10" ->
-- "1 and 15"). Gövdenin geri kalanı (iş kuralları, sütun sırası, en son
-- eklenen storage_hazardous/recycling_* alanları dahil) BİREBİR AYNIDIR —
-- imza hiçbirinde değişmediği için `drop function if exists` GEREKMEZ,
-- `create or replace function` güvenle yerini alır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_job
-- -----------------------------------------------------------------------------
create or replace function public.create_job(p_category_id text, p_title text, p_description text, p_operation_details text, p_province text, p_district text, p_work_location_type text, p_work_date date, p_photos jsonb, p_facility_id text DEFAULT NULL::text, p_location_mode text DEFAULT 'catalog'::text, p_address_text text DEFAULT ''::text, p_neighborhood text DEFAULT NULL::text, p_location_url text DEFAULT NULL::text, p_directions_note text DEFAULT NULL::text, p_work_end_date date DEFAULT NULL::date, p_product_quantity integer DEFAULT NULL::integer, p_product_tonnage numeric DEFAULT NULL::numeric, p_product_type text DEFAULT NULL::text, p_customs_product_type text DEFAULT NULL::text, p_client_id uuid DEFAULT NULL::uuid, p_delivery_province text DEFAULT NULL::text, p_delivery_district text DEFAULT NULL::text, p_delivery_location_type text DEFAULT NULL::text, p_delivery_facility_id text DEFAULT NULL::text, p_delivery_facility_name text DEFAULT NULL::text, p_delivery_address_text text DEFAULT NULL::text, p_recycling_material_category_id text DEFAULT NULL::text, p_recycling_material_subtype_id text DEFAULT NULL::text, p_recycling_quantity numeric DEFAULT NULL::numeric, p_recycling_unit text DEFAULT NULL::text, p_recycling_material_condition text DEFAULT NULL::text, p_recycling_material_condition_note text DEFAULT NULL::text, p_recycling_scope_of_work text[] DEFAULT NULL::text[], p_customs_transaction_type text DEFAULT NULL::text, p_customs_requested_services text[] DEFAULT NULL::text[], p_storage_product_type text DEFAULT NULL::text, p_storage_product_quantity numeric DEFAULT NULL::numeric, p_storage_product_unit text DEFAULT NULL::text, p_storage_product_tonnage numeric DEFAULT NULL::numeric, p_product_tonnage_unit text DEFAULT NULL::text, p_storage_container_groups jsonb DEFAULT NULL::jsonb, p_nakliye_load_preparation_type text DEFAULT NULL::text, p_nakliye_load_preparation_custom_text text DEFAULT NULL::text, p_nakliye_loading_method text DEFAULT NULL::text, p_nakliye_loading_method_custom_text text DEFAULT NULL::text, p_nakliye_measurement_info jsonb DEFAULT NULL::jsonb, p_nakliye_hazmat jsonb DEFAULT NULL::jsonb, p_nakliye_container_transport jsonb DEFAULT NULL::jsonb, p_nakliye_cargo_groups jsonb DEFAULT NULL::jsonb, p_storage_hazardous boolean DEFAULT NULL::boolean, p_storage_risk_groups text[] DEFAULT NULL::text[], p_recycling_requested_operation text DEFAULT NULL::text, p_recycling_waste_code text DEFAULT NULL::text, p_recycling_waste_code_unknown boolean DEFAULT NULL::boolean, p_recycling_hazard_properties text[] DEFAULT NULL::text[])
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
  v_storage_hazardous boolean;
  v_recycling_hazardous boolean;
  v_recycling_hazard_properties text[];
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_photo_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_photo_count < 1 or v_photo_count > 15 then
    raise exception 'MLK51: a job requires between 1 and 15 photos (got %)', v_photo_count using errcode = 'MLK51';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);
  perform public.assert_valid_recycling_requested_operation(p_recycling_requested_operation);
  perform public.assert_valid_recycling_waste_code(p_recycling_waste_code, p_recycling_waste_code_unknown);
  perform public.assert_valid_recycling_hazard_properties(p_recycling_hazard_properties);

  v_storage_hazardous := case when p_category_id = 'tehlikeli-madde-depolama' then true else p_storage_hazardous end;
  v_recycling_hazardous := case
    when coalesce(p_recycling_waste_code_unknown, false) then null
    else public.derive_recycling_hazardous(p_recycling_waste_code)
  end;
  v_recycling_hazard_properties := case when v_recycling_hazardous then p_recycling_hazard_properties else null end;

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
    storage_hazardous, storage_risk_groups,
    recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown,
    recycling_hazardous, recycling_hazard_properties,
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
    v_storage_hazardous, p_storage_risk_groups,
    p_recycling_requested_operation, p_recycling_waste_code, coalesce(p_recycling_waste_code_unknown, false),
    v_recycling_hazardous, v_recycling_hazard_properties,
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

comment on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text,
  date, integer, numeric, text, text, uuid, text, text, text, text, text, text, text, text,
  numeric, text, text, text, text[], text, text[], text, numeric, text, numeric, text, jsonb,
  text, text, text, text, jsonb, jsonb, jsonb, jsonb, boolean, text[], text, text, boolean, text[]
) is
  '0090: fotoğraf sayısı sınırı 1-10''dan 1-15''e çıkarıldı (MLK51) — gövdenin geri kalanı değişmedi, imza aynı kaldığı için ikinci bir overload oluşmadı.';

-- -----------------------------------------------------------------------------
-- create_operation_with_jobs
-- -----------------------------------------------------------------------------
create or replace function public.create_operation_with_jobs(p_province text, p_operation_details text, p_services jsonb, p_photos_by_service_index jsonb, p_client_operation_id uuid DEFAULT NULL::uuid)
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
  v_service_container_groups jsonb;
  v_service_measurement_info jsonb;
  v_service_hazmat jsonb;
  v_service_container_transport jsonb;
  v_service_cargo_groups jsonb;
  v_service_storage_risk_groups text[];
  v_service_storage_hazardous boolean;
  v_service_recycling_waste_code text;
  v_service_recycling_waste_code_unknown boolean;
  v_service_recycling_hazardous boolean;
  v_service_recycling_hazard_properties text[];
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
    if v_photo_count < 1 or v_photo_count > 15 then
      raise exception 'MLK51: a job requires between 1 and 15 photos (service %, got %)', v_index, v_photo_count using errcode = 'MLK51';
    end if;

    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);
    v_service_container_groups := nullif(v_service->'storage_container_groups', 'null'::jsonb);
    v_service_measurement_info := nullif(v_service->'nakliye_measurement_info', 'null'::jsonb);
    v_service_hazmat := nullif(v_service->'nakliye_hazmat', 'null'::jsonb);
    v_service_container_transport := nullif(v_service->'nakliye_container_transport', 'null'::jsonb);
    v_service_cargo_groups := nullif(v_service->'nakliye_cargo_groups', 'null'::jsonb);
    v_service_storage_risk_groups := (select array_agg(x) from jsonb_array_elements_text(coalesce(nullif(v_service->'storage_risk_groups', 'null'::jsonb), '[]'::jsonb)) x);
    perform public.validate_storage_container_groups(v_service_container_groups);
    perform public.validate_nakliye_measurement_info(v_service_measurement_info);
    perform public.validate_nakliye_hazmat(v_service_hazmat);
    perform public.validate_nakliye_container_transport(v_service_container_transport);
    perform public.validate_nakliye_cargo_groups(v_service_cargo_groups);
    perform public.assert_valid_storage_risk_groups(v_service_storage_risk_groups);
    perform public.assert_valid_recycling_requested_operation(v_service->>'recycling_requested_operation');
    v_service_recycling_waste_code := v_service->>'recycling_waste_code';
    v_service_recycling_waste_code_unknown := coalesce((v_service->>'recycling_waste_code_unknown')::boolean, false);
    perform public.assert_valid_recycling_waste_code(v_service_recycling_waste_code, v_service_recycling_waste_code_unknown);
    v_service_recycling_hazard_properties := (select array_agg(x) from jsonb_array_elements_text(coalesce(nullif(v_service->'recycling_hazard_properties', 'null'::jsonb), '[]'::jsonb)) x);
    perform public.assert_valid_recycling_hazard_properties(v_service_recycling_hazard_properties);

    v_service_storage_hazardous := case
      when v_service->>'category_id' = 'tehlikeli-madde-depolama' then true
      else nullif(v_service->>'storage_hazardous', '')::boolean
    end;
    v_service_recycling_hazardous := case
      when v_service_recycling_waste_code_unknown then null
      else public.derive_recycling_hazardous(v_service_recycling_waste_code)
    end;
    v_service_recycling_hazard_properties := case when v_service_recycling_hazardous then v_service_recycling_hazard_properties else null end;

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
      storage_hazardous, storage_risk_groups,
      recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown,
      recycling_hazardous, recycling_hazard_properties,
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
      (select array_agg(x) from jsonb_array_elements_text(coalesce(nullif(v_service->'recycling_scope_of_work', 'null'::jsonb), '[]'::jsonb)) x),
      v_service->>'customs_transaction_type',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(nullif(v_service->'customs_requested_services', 'null'::jsonb), '[]'::jsonb)) x),
      v_service->>'storage_product_type', nullif(v_service->>'storage_product_quantity', '')::numeric,
      v_service->>'storage_product_unit', nullif(v_service->>'storage_product_tonnage', '')::numeric,
      v_service->>'product_tonnage_unit', v_service_container_groups,
      v_service->>'nakliye_load_preparation_type', v_service->>'nakliye_load_preparation_custom_text',
      v_service->>'nakliye_loading_method', v_service->>'nakliye_loading_method_custom_text', v_service_measurement_info,
      v_service_hazmat, v_service_container_transport, v_service_cargo_groups,
      v_service_storage_hazardous, v_service_storage_risk_groups,
      v_service->>'recycling_requested_operation', v_service_recycling_waste_code, v_service_recycling_waste_code_unknown,
      v_service_recycling_hazardous, v_service_recycling_hazard_properties,
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

comment on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) is
  '0090: fotoğraf sayısı sınırı (her servis için ayrı ayrı) 1-10''dan 1-15''e çıkarıldı (MLK51) — gövdenin geri kalanı (0084''ün jsonb-null düzeltmesi dahil) değişmedi.';

-- -----------------------------------------------------------------------------
-- update_job
-- -----------------------------------------------------------------------------
create or replace function public.update_job(p_job_id uuid, p_title text, p_description text, p_operation_details text, p_province text, p_district text, p_work_location_type text, p_facility_id text, p_location_mode text, p_address_text text, p_neighborhood text, p_location_url text, p_directions_note text, p_work_date date, p_work_end_date date, p_kept_photo_ids uuid[], p_new_photos jsonb)
 returns jobs
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_kept_count integer;
  v_new_count integer;
  v_order integer;
  v_photo jsonb;
begin
  perform public.assert_active_user();
  select * into v_job from public.jobs where id = p_job_id;
  if v_job is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;

  if public.is_job_closed_to_new_offers(p_job_id)
     or exists (select 1 from public.offers where job_id = p_job_id and status in ('completed', 'cancelled'))
     or v_job.closed_at is not null then
    raise exception 'MLK55: this job can no longer be edited (offer process has started)' using errcode = 'MLK55';
  end if;

  select count(*) into v_kept_count from public.job_photos
    where job_id = p_job_id and id = any(p_kept_photo_ids) and deleted_at is null;
  v_new_count := jsonb_array_length(coalesce(p_new_photos, '[]'::jsonb));
  if v_kept_count + v_new_count < 1 or v_kept_count + v_new_count > 15 then
    raise exception 'MLK51: a job requires between 1 and 15 photos (got %)', v_kept_count + v_new_count using errcode = 'MLK51';
  end if;

  update public.jobs set
    title = p_title, description = p_description, operation_details = p_operation_details,
    province = p_province, district = p_district, work_location_type = p_work_location_type,
    facility_id = p_facility_id, location_mode = coalesce(p_location_mode, 'catalog'),
    address_text = coalesce(p_address_text, ''), neighborhood = p_neighborhood,
    location_url = p_location_url, directions_note = p_directions_note,
    work_date = p_work_date, work_end_date = p_work_end_date
  where id = p_job_id
  returning * into v_job;

  update public.job_photos set deleted_at = now()
    where job_id = p_job_id and not (id = any(p_kept_photo_ids)) and deleted_at is null;

  v_order := v_kept_count;
  for v_photo in select * from jsonb_array_elements(coalesce(p_new_photos, '[]'::jsonb)) loop
    insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
    values (
      p_job_id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
      (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
      v_order, auth.uid()
    );
    v_order := v_order + 1;
  end loop;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan güncellendi', null, null, 'requester_only');

  return v_job;
end;
$function$;

comment on function public.update_job(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, date, uuid[], jsonb
) is
  '0090: fotoğraf sayısı sınırı 1-10''dan 1-15''e çıkarıldı (MLK51) — gövdenin geri kalanı değişmedi. Not: bu fonksiyon şu an app tarafında hiçbir çağıran tarafından kullanılmıyor (update_job_as_admin/update_job_as_requester tarafından fiilen ikame edildi), tutarlılık için yine de güncellendi.';
