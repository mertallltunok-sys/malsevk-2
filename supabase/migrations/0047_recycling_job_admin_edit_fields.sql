-- =============================================================================
-- MALSEVK — migration 0047: update_job_as_admin alan kapsamı — Geri Dönüşüm & Atık Tahliye
-- =============================================================================
-- AMAÇ: admin-job-edit-form.tsx'e eklenen "Geri Dönüşüm & Atık Tahliye
-- Bilgileri" düzenleme bloğunun `update_job_as_admin` (0035, alan kapsamı
-- 0037'de genişletildi) karşılığı — 0037'nin kendi disiplini BİREBİR
-- korunuyor: her yeni alan `coalesce(p_x, x)` ile güncellenir (formda
-- gösterilmeyen/dokunulmamış bir alan asla mevcut değeri NULL'a EZMEZ).
--
-- Kategori kendisi (görev bölüm 6/9'un kendi kapsam sınırı gereği) hâlâ
-- düzenlenemez — bu migration'daki hiçbir parametre `category_id`'ye
-- dokunmaz.
--
-- RPC GÜVENLİK DİSİPLİNİ (0046'nın kendi başlığındaki AYNI gerekçe): mevcut
-- TAM 22 parametreli imza (0037'nin kendi kayıtlı hali) önce `drop function
-- if exists` ile silinir, SONRA 7 yeni parametre eklenmiş (29 parametreli)
-- hali yazılır — 0037'nin kendisinin (16 -> 22 parametre genişlerken) zaten
-- uyguladığı AYNI "önce drop, sonra create" deseni.
-- =============================================================================

drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text, timestamptz
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
  p_expected_updated_at timestamptz default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
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

  -- NOT: title/description/province/district/work_location_type/address_text/
  -- work_date her zaman doğrudan atanır (0037'deki AYNI gerekçe). Aşağıdaki
  -- TÜM opsiyonel/kategoriye-göre-koşullu alanlar (recycling_* dahil)
  -- `coalesce(p_x, x)` ile korunur.
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
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work)
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
  text, text, numeric, text, text, text, text[], timestamptz
) is
  '0047: 0037''nin kapsamına Geri Dönüşüm & Atık Tahliye''nin 7 alanı (recycling_*) eklendi, AYNI coalesce(p_x, x) disipliniyle — formda gösterilmeyen/dokunulmayan bir alan asla NULL''a ezilmez. Kategori (category_id) hâlâ bu RPC''nin kapsamı dışında.';

revoke all on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], timestamptz
) from public, anon;
grant execute on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], timestamptz
) to authenticated;
