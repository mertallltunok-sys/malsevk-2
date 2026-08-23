-- =============================================================================
-- MALSEVK — migration 0046: Geri Dönüşüm & Atık Tahliye "Malzeme Bilgileri" alanları
-- =============================================================================
-- AMAÇ: app/_lib/types.ts#Job'a eklenen 7 yeni, kategoriye-özel opsiyonel
-- alanın (recyclingMaterialCategoryId/recyclingMaterialSubtypeId/
-- recyclingQuantity/recyclingUnit/recyclingMaterialCondition/
-- recyclingMaterialConditionNote/recyclingScopeOfWork) Supabase karşılığı —
-- Gümrük Müşavirliği'nin `customs_*` (0023) ve Nakliye'nin `delivery_*`
-- (0031) kolonlarıyla BİREBİR AYNI desen: nullable, kategori kapsam
-- dışındaysa hep NULL (client-side resolveRecyclingFields zaten temizliyor,
-- burada AYRICA bir CHECK ile "kategori X ise Y dolu olmalı" gibi bir
-- çapraz-kolon kısıtı İCAT EDİLMEDİ — mevcut customs_*/delivery_* kolonların
-- HİÇBİRİ de böyle bir kısıta sahip değil, aynı ilke korunuyor).
--
-- KASITLI OLARAK YOK: bir "işlem türü" (recycling_transaction_type gibi)
-- kolonu ve `offers` tablosunda HİÇBİR değişiklik — görev geçmişinde
-- planlanan "hurda alım teklifi" (tersine fiyatlandırma) modeli TAMAMEN
-- İPTAL EDİLDİ; bu hizmet de her diğer hizmet gibi normal, tek-toplam-bedelli
-- MALSEVK hizmet teklifini kullanır (bkz. 0045'in kendi başlığı).
--
-- recycling_scope_of_work text[] — "Hizmet Kapsamı" çoklu seçimi
-- (customsRequestedServices'in Supabase'de HİÇ karşılığı olmadığı hatırlanarak
-- burada BİLEREK YENİ bir array kolon eklendi, mevcut modelde buna uygun bir
-- alan yoktu) — CHECK kısıtı her elemanın 4 sabit değerden biri olduğunu
-- doğrular (`<@`, array-subset operatörü).
--
-- RPC GÜVENLİK DİSİPLİNİ (bu repo'nun kendi, üç kez tekrar etmiş hatası —
-- bkz. 0028→0032/0033, 0031 sonrası): `create or replace function` yalnızca
-- TAM AYNI imzada gerçek bir "replace" yapar; parametre listesi (ekleme dahil)
-- değiştiğinde Postgres eski imzayı YENİ bir overload olarak canlı bırakır.
-- Bu yüzden `create_job`'ın mevcut TAM 27 parametreli imzası önce açıkça
-- `drop function if exists` ile silinir, SONRA 7 yeni parametre eklenmiş
-- (34 parametreli) hali yazılır. `create_operation_with_jobs`in imzası
-- DEĞİŞMİYOR (parametreler zaten `jsonb` — yeni alanlar `p_services`'in
-- içindeki her servis nesnesinin yeni anahtarlarından okunuyor), bu yüzden
-- onun için `drop function` GEREKMİYOR, düz `create or replace` güvenli.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs.recycling_* kolonları
-- -----------------------------------------------------------------------------
alter table public.jobs add column if not exists recycling_material_category_id text;
alter table public.jobs add column if not exists recycling_material_subtype_id text;
alter table public.jobs add column if not exists recycling_quantity numeric;
alter table public.jobs add column if not exists recycling_unit text;
alter table public.jobs add column if not exists recycling_material_condition text;
alter table public.jobs add column if not exists recycling_material_condition_note text;
alter table public.jobs add column if not exists recycling_scope_of_work text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_recycling_unit_valid'
  ) then
    alter table public.jobs add constraint jobs_recycling_unit_valid
      check (recycling_unit is null or recycling_unit in ('kg', 'ton', 'adet'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_recycling_material_condition_valid'
  ) then
    alter table public.jobs add constraint jobs_recycling_material_condition_valid
      check (recycling_material_condition is null or recycling_material_condition in ('ayristirilmis', 'karisik', 'diger'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_recycling_scope_of_work_valid'
  ) then
    alter table public.jobs add constraint jobs_recycling_scope_of_work_valid
      check (
        recycling_scope_of_work is null
        or recycling_scope_of_work <@ array['sahadan-toplama', 'yukleme', 'tesisten-tahliye', 'tasima']::text[]
      );
  end if;
end $$;

comment on column public.jobs.recycling_material_category_id is
  'types.ts#Job.recyclingMaterialCategoryId ile birebir — yalnızca isRecyclingCategory(category) (Geri Dönüşüm & Atık Tahliye) kapsamında dolu, diğer TÜM kategorilerde null.';
comment on column public.jobs.recycling_material_subtype_id is
  'types.ts#Job.recyclingMaterialSubtypeId ile birebir — bkz. recycling_material_category_id üstündeki not.';
comment on column public.jobs.recycling_quantity is
  'types.ts#Job.recyclingQuantity ile birebir — ondalıklı olabilir (product_tonnage ile AYNI tip kararı).';
comment on column public.jobs.recycling_unit is
  'types.ts#Job.recyclingUnit ile birebir ("kg" | "ton" | "adet").';
comment on column public.jobs.recycling_material_condition is
  'types.ts#Job.recyclingMaterialCondition ile birebir ("ayristirilmis" | "karisik" | "diger").';
comment on column public.jobs.recycling_material_condition_note is
  'types.ts#Job.recyclingMaterialConditionNote ile birebir — yalnızca recycling_material_condition = ''diger'' iken anlamlı.';
comment on column public.jobs.recycling_scope_of_work is
  'types.ts#Job.recyclingScopeOfWork ile birebir — "Hizmet Kapsamı" çoklu seçimi (Sahadan toplama/Yükleme/Tesisten tahliye/Taşıma). Hiçbir seçenek ayrı bir ilan/iş OLUŞTURMAZ, yalnızca bu TEK ilanın kapsamını kaydeder.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: mevcut TAM 27 parametreli imza önce silinir
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text
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
  p_recycling_scope_of_work text[] default null
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

  insert into public.jobs (
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type, delivery_province, delivery_district, delivery_location_type,
    delivery_facility_id, delivery_facility_name, delivery_address_text,
    recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
    recycling_unit, recycling_material_condition, recycling_material_condition_note,
    recycling_scope_of_work, moderation_status
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text,
    p_recycling_material_category_id, p_recycling_material_subtype_id, p_recycling_quantity,
    p_recycling_unit, p_recycling_material_condition, p_recycling_material_condition_note,
    p_recycling_scope_of_work, 'pending_review'
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

revoke all on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[]
) from public, anon;
grant execute on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[]
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: imza DEĞİŞMİYOR (jsonb parametreler),
-- yalnızca gövde her hizmet için 7 yeni anahtarı okuyup INSERT'e ekliyor.
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

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type, delivery_province, delivery_district, delivery_location_type,
      delivery_facility_id, delivery_facility_name, delivery_address_text,
      recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
      recycling_unit, recycling_material_condition, recycling_material_condition_note,
      recycling_scope_of_work, moderation_status
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
  '0046: her p_services elemanı artık 7 yeni recycling_* anahtarını (yalnızca Geri Dönüşüm & Atık Tahliye hizmet kartında dolu) okuyup ilgili jobs kolonlarına yazıyor — imza DEĞİŞMEDİ, yalnızca gövde genişledi. recycling_scope_of_work bir jsonb dizisinden text[]''e çevrilir (jsonb_array_elements_text + array_agg).';
