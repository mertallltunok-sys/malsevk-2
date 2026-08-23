-- =============================================================================
-- MALSEVK — migration 0058: Konteyner Depolama "IMO Sınıfı" — kanonik kod
-- doğrulaması (backend)
-- =============================================================================
-- AMAÇ: app tarafında IMO Sınıfı artık serbest metin DEĞİL, yalnızca 20
-- kanonik IMO tehlike sınıfı kodundan biri (bkz. app/_lib/storage-container-
-- catalog.ts#IMO_CLASS_OPTIONS, TEK doğruluk kaynağı — bu migration'daki
-- kod listesi o dosyayla ELLE senkron tutulmalıdır, PL/pgSQL TypeScript'i
-- içe aktaramaz, AYNI 0057'nin StorageContainerGroup şekli için zaten kabul
-- ettiği kısıt). Frontend'de bir `<select>` olduğu için geçersiz bir kod
-- normal kullanıcı akışında ASLA gönderilemez — ama görev talimatı açıkça
-- "backend/RPC tarafında da yalnız izin verilen kanonik IMO kodları kabul
-- edilsin" diyor (savunma derinliği: doğrudan bir RPC çağrısı/bozuk istemci
-- geçersiz bir değer göndermeye çalışırsa yine reddedilmeli).
--
-- MİMARİ KARAR (görev talimatı: "mevcut doğrulama mimarisini kullan"): 0057
-- her 4 RPC'de (create_job/create_operation_with_jobs/update_job_as_admin/
-- update_job_as_requester) AYNI "dizi mi" (MLK55) kontrolünü TEKRAR TEKRAR
-- inline yazmıştı. Bu migration o dört kopyayı TEK paylaşılan bir yardımcı
-- fonksiyona (`validate_storage_container_groups`) çıkarır — 0042'nin
-- `assert_active_user()`ı BİRÇOK RPC'den çağırma deseniyle AYNI ilke. Yeni
-- kontrol (MLK56, imoClass kanonik kod değilse) bu TEK yerde eklenir, dört
-- RPC'nin HİÇBİRİNİN PARAMETRE İMZASI DEĞİŞMEZ (yalnızca gövde `create or
-- replace` edilir — 0032-0034/0046-0048/0051/0054/0056/0057'nin kurduğu
-- "yalnızca parametre SAYISI değişince drop+recreate gerekir" disiplini
-- burada GEÇERLİ DEĞİL, çünkü hiçbir parametre eklenmiyor/çıkarılmıyor).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — paylaşılan doğrulayıcı: dizi şekli (MLK55, 0057'den taşındı,
-- davranış DEĞİŞMEDİ) + her grubun imoClass alanı (varsa) kanonik bir IMO
-- kodu mu (YENİ, MLK56)
-- -----------------------------------------------------------------------------
create or replace function public.validate_storage_container_groups(p_groups jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_group jsonb;
  v_imo text;
begin
  if p_groups is null then
    return;
  end if;
  if jsonb_typeof(p_groups) <> 'array' then
    raise exception 'MLK55: storage_container_groups must be a jsonb array' using errcode = 'MLK55';
  end if;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_imo := v_group->>'imoClass';
    if v_imo is not null and v_imo <> '' and not (
      v_imo = any(array[
        '1.1','1.2','1.3','1.4','1.5','1.6',
        '2.1','2.2','2.3',
        '3',
        '4.1','4.2','4.3',
        '5.1','5.2',
        '6.1','6.2',
        '7','8','9'
      ])
    ) then
      raise exception 'MLK56: imoClass must be one of the canonical IMO hazard class codes (got %)', v_imo using errcode = 'MLK56';
    end if;
  end loop;
end;
$function$;

comment on function public.validate_storage_container_groups(jsonb) is
  'storage-container-catalog.ts#IMO_CLASS_OPTIONS ile ELLE senkron tutulan 20 kanonik IMO kodu listesi + jsonb dizi şekli kontrolü. create_job/create_operation_with_jobs/update_job_as_admin/update_job_as_requester tarafından paylaşılan TEK doğrulama noktası (assert_active_user() İLE AYNI "paylaşılan yardımcı" deseni).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: gövde-içi (yalnızca) — inline MLK55 kontrolü
-- paylaşılan doğrulayıcı çağrısıyla değiştirildi. İMZA DEĞİŞMEDİ.
-- -----------------------------------------------------------------------------
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
  p_storage_container_groups jsonb default null::jsonb
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
  perform public.validate_storage_container_groups(p_storage_container_groups);

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
    product_tonnage_unit, storage_container_groups, moderation_status
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
    p_product_tonnage_unit, p_storage_container_groups, 'pending_review'
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
-- BÖLÜM 3 — create_operation_with_jobs: gövde-içi (yalnızca) — İMZA DEĞİŞMEDİ.
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
  v_service_container_groups jsonb;
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
    perform public.validate_storage_container_groups(v_service_container_groups);

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
      product_tonnage_unit, storage_container_groups, moderation_status
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
      v_service->>'product_tonnage_unit', v_service_container_groups, 'pending_review'
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
-- BÖLÜM 4 — update_job_as_admin: gövde-içi (yalnızca) — İMZA DEĞİŞMEDİ.
-- -----------------------------------------------------------------------------
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
  p_storage_container_groups jsonb default null::jsonb
)
returns jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs;
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
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — update_job_as_requester: gövde-içi (yalnızca) — İMZA DEĞİŞMEDİ.
-- -----------------------------------------------------------------------------
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
  p_storage_container_groups jsonb default null::jsonb
)
returns jobs
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_job public.jobs;
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
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan sahibi tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_requester', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$function$;
