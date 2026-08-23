-- 0065_nakliye_container_mode_field_clearing.sql
--
-- "Yük Bilgileri ve Konteyner Taşıması Birleştirmesi" görevi — Nakliye'nin
-- "Yük konteyner olarak mı taşınacak?" sorusu artık YALNIZCA Hayır/Evet'ten
-- oluşan, birbirinden BAĞIMSIZ iki form dalı: Evet iken normal Yük
-- Bilgileri dalı (Ürün Adedi/Tonaj/Cinsi/Ağırlık Birimi/Yükün Hazırlanış
-- Biçimi/Ölçü ve Yerleşim) TAMAMEN gizlenir, yerine yalnızca Konteyner
-- Bilgileri (nakliye_container_transport) kullanılır.
--
-- KANIT/GEREKÇE (görev talimatının "kanıt olmadan migration oluşturma"
-- kısıtı gereği burada açıkça belgelenir): update_job_as_admin/
-- update_job_as_requester (0064) HER sütun için `coalesce(p_x, x)` deseni
-- kullanır — istemci bir alanı NULL/undefined gönderdiğinde bu HER ZAMAN
-- "değiştirme, olduğu gibi bırak" anlamına gelir, ASLA "temizle" anlamına
-- gelmez. Uygulama katmanı (job-request-form.tsx/job-edit-form.tsx/
-- admin-job-edit-form.tsx) artık Konteyner Taşıması=Evet iken normal Yük
-- Bilgileri alanlarını payload'a hiç dahil ETMİYOR (undefined gönderiyor) —
-- ama coalesce deseni bu undefined'ı "eskisini koru" olarak yorumladığı
-- için, bir ilan Hayır'dan Evet'e admin/senkron-yeniden-deneme yoluyla
-- geçirildiğinde eski product_quantity/product_tonnage/product_type/
-- product_tonnage_unit/nakliye_load_preparation_type/
-- nakliye_load_preparation_custom_text/nakliye_measurement_info değerleri
-- veritabanında SESSİZCE KALIRDI — bu, görev talimatının "artık kullanılmayan
-- dalın güncel kayıttaki değerleri güvenli biçimde temizlenmeli/null
-- yapılmalı" kuralını doğrudan ihlal ederdi ve `hasProductInfo`/detay
-- sayfaları normal VE konteyner bilgilerini AYNI ANDA göstermeye devam
-- ederdi (görev talimatının yasakladığı durum).
--
-- ÇÖZÜM: HER İKİ RPC'nin de SET ifadesine, yalnızca bu yedi sütun için,
-- `p_nakliye_container_transport->>'status' = 'evet'` olduğunda coalesce'i
-- BYPASS EDİP doğrudan NULL yazan bir `case` eklendi — bu, gönderenin
-- (istemci) "şu an container modundayım" dediği HER çağrıda GEÇERLİ bir
-- DEĞİŞMEZ (invariant) kurar, yalnızca "gerçekten değişti mi" anına bağlı
-- kalmaz (kendi kendini onaran, daha sağlam bir tasarım). Diğer yönde
-- (Evet'ten Hayır'a) hiçbir ek işleme gerek YOK — nakliye_container_transport
-- zaten HER ZAMAN istemcinin o anki TAM durumunu taşıyan bütün bir jsonb
-- değeri olarak gönderilir (asla kısmi değil), coalesce(p_x, x) bu sütun
-- için zaten doğru şekilde ESKİ tüm alt-alanları YENİ bütün değerle
-- DEĞİŞTİRİR.
--
-- Parametre imzası (sayı/tip) DEĞİŞMİYOR — yalnızca gövde (SET ifadesi)
-- güncelleniyor, bu yüzden 0032-0034/0054/0057/0058/0062/0063'ün "stale
-- overload" disiplini burada gerekmez (create or replace function AYNI
-- imzayı gerçekten DEĞİŞTİRİR, ikinci bir overload YARATMAZ).
--
-- Yalnızca Development ortamına uygulanır — Production'a dokunulmaz.

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
  p_nakliye_container_transport jsonb default null
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
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport)
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
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) is
  '0065: 0064''ün AYNI imzası — Konteyner Taşıması=Evet iken (p_nakliye_container_transport->>status=evet) normal Yük Bilgileri alanları (product_quantity/tonnage/type/tonnage_unit, nakliye_load_preparation_type/custom_text, nakliye_measurement_info) coalesce yerine DOĞRUDAN null yazılır — coalesce-only desen bu yedi alanı asla temizleyemiyordu (görev kanıtı: bu yorumun üstündeki gerekçe).';

-- Parametre imzası değişmedi, GRANT'lar da yeniden beyan edilir (idempotent).
revoke all on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated;

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
  p_nakliye_container_transport jsonb default null
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
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport)
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
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) is
  '0065: update_job_as_admin (0065) ile AYNI Konteyner Taşıması=Evet iken normal Yük Bilgileri alanlarını doğrudan null yazma davranışı — sahiplik/moderation_status=pending_review kısıtları (0051) değişmedi.';

revoke all on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb
) to authenticated;
