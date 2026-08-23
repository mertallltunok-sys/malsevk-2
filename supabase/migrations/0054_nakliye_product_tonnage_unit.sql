-- =============================================================================
-- MALSEVK — migration 0054: Nakliye "Toplam Ağırlık" birimi (Ton/Kg)
-- =============================================================================
-- AMAÇ: "MALSEVK projesinde yalnızca Nakliye ilan oluşturma, admin düzenleme/
-- onaylama ve Nakliye ilan detay sayfasındaki ürün bilgileri akışını
-- geliştir" görev talimatı. Nakliye'nin (service-catalog.ts#isTransportationCategory
-- — TEK doğruluk kaynağı, kategori metniyle eşleştirme YOK) mevcut "Tonaj"
-- alanı (product_tonnage, zaten var) artık Nakliye'de "Toplam Ağırlık"
-- olarak adlandırılıyor ve iki birimden (Ton varsayılan/Kg) biriyle
-- girilebiliyor — Liman Hizmetleri (lashing-unlashing/gozetim-hizmetleri/
-- vb.) sabit "ton" gösterimini AYNEN korur, bu migration onlara HİÇ dokunmaz.
--
-- İKİNCİ BİR ÜRÜN/AĞIRLIK ALANI YOK: mevcut `product_tonnage` (numeric)
-- kolonunun kendisi DEĞİŞMİYOR — yalnızca onun birimini taşıyan TEK yeni,
-- nullable bir kolon (`product_tonnage_unit`) ekleniyor. Bu, Depolama'nın
-- kendi ayrı `storage_product_unit` kolonuna sahip olmasından FARKLI bir
-- durum — orada "Birim" 3 değerli (kg/ton/adet) ve tamamen ayrı bir alan
-- grubuna aitti (bkz. 0053); burada yalnızca Nakliye'nin ZATEN var olan
-- Tonaj alanının birimini (yalnızca ton/kg, adet YOK) etiketliyoruz.
--
-- GERİYE DÖNÜK UYUMLULUK: bu alandan ÖNCE oluşturulmuş TÜM Nakliye
-- ilanlarında `product_tonnage_unit` NULL kalır — bu KASITLI olarak bir hata
-- durumu DEĞİLDİR, "Ton" varsayımıyla eşdeğerdir (bkz. app kodu,
-- product-catalog.ts#formatProductTonnage'ın ikinci parametresi verilmediğinde
-- zaten "ton" varsayılanına döner — bu migration'dan ÖNCE de tüm Nakliye
-- tonaj değerleri örtük olarak "ton" birimindeydi, bu yüzden varsayılan
-- doğru ve veri kaybı YOK).
--
-- RPC GÜVENLİK DİSİPLİNİ (0032/0033/0034/0046/0047/0048/0053'ün AYNI dersi):
-- imzası değişen HER RPC'nin ("create_job", "update_job_as_admin",
-- "update_job_as_requester") mevcut TAM imzası önce `drop function if
-- exists` ile silinir, SONRA yeni parametre eklenmiş hâli yazılır — imzalar
-- 0053'ün BİZZAT KENDİ dosyasındaki (bu migration'dan hemen önceki canlı
-- durum) `comment on function`/`revoke`/`grant` bloklarından alınmıştır.
-- `create_operation_with_jobs`in imzası DEĞİŞMİYOR (0046/0048/0053 ile AYNI
-- gerekçe — parametreler zaten jsonb, yeni alan p_services'in içindeki her
-- servis nesnesinin `product_tonnage_unit` anahtarından okunuyor).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs.product_tonnage_unit
-- -----------------------------------------------------------------------------
alter table public.jobs add column if not exists product_tonnage_unit text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_product_tonnage_unit_valid'
  ) then
    alter table public.jobs add constraint jobs_product_tonnage_unit_valid
      check (product_tonnage_unit is null or product_tonnage_unit in ('ton', 'kg'));
  end if;
end $$;

comment on column public.jobs.product_tonnage_unit is
  'types.ts#Job.productTonnageUnit ile birebir — YALNIZCA Nakliye''de (isTransportationCategory) anlamlı ve yazılır; Liman Hizmetleri''nde her zaman null kalır (sabit "ton" gösterimi, bkz. product-catalog.ts#formatProductTonnage). NULL = "Ton" (bu alandan önce oluşturulmuş her Nakliye ilanının geriye dönük varsayımıyla birebir aynı) — asla undefined/tire gösterilmez, yalnızca app kodunda formatProductTonnage''ın kendi varsayılanı ile çözümlenir.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — create_job: mevcut TAM 40 parametreli imza (0053) önce silinir.
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric
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
  p_product_tonnage_unit text default null
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
    recycling_scope_of_work, customs_transaction_type, customs_requested_services,
    storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
    product_tonnage_unit, moderation_status
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
    p_product_tonnage_unit, 'pending_review'
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
  text, numeric, text, numeric, text
) is
  '0054: p_product_tonnage_unit eklendi (Nakliye''nin "Toplam Ağırlık" birimi, ton/kg) — imza 40''tan 41 parametreye çıktı, mevcut 40 parametreli overload BİLEREK drop edildi (stale-overload sınıfı hatayı önlemek için, bkz. 0032/0033/0034/0053 dersi).';

revoke all on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text
) from public, anon;
grant execute on function public.create_job(
  text, text, text, text, text, text, text, date, jsonb,
  text, text, text, text, text, text, date, integer, numeric, text, text,
  uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_operation_with_jobs: imza DEĞİŞMİYOR (0046/0048/0053 ile
-- AYNI gerekçe) — yeni alan p_services'in içindeki her servis nesnesinin
-- `product_tonnage_unit` anahtarından okunuyor (yalnızca Nakliye hizmet
-- kartında dolu — çağıran taraf, job-request-form.tsx#resolveProductInfoPayload,
-- zaten yalnızca isTransportationCategory kapsamındaki servise bu anahtarı
-- yazar; kardeş servislere hiç kopyalanmaz).
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
      recycling_scope_of_work, customs_transaction_type, customs_requested_services,
      storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
      product_tonnage_unit, moderation_status
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
      v_service->>'product_tonnage_unit', 'pending_review'
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
  '0054: her p_services elemanı artık product_tonnage_unit anahtarını da (yalnızca Nakliye hizmet kartında dolu) okuyup jobs.product_tonnage_unit''e yazıyor — imza DEĞİŞMEDİ, yalnızca gövde genişledi (0048/0053''ün AYNI izlediği desen).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — update_job_as_admin: mevcut TAM 35 parametreli imza (0053) önce
-- silinir, coalesce(p_x, x) disiplini AYNEN korunur. Yeni parametre
-- p_expected_updated_at'ten HEMEN ÖNCE eklenir (0053'ün storage_product_*
-- alanlarını p_expected_updated_at'ten önce eklediği AYNI konvansiyon —
-- optimistic-concurrency token her zaman GERÇEKTEN son parametre kalır).
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, timestamptz
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
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit)
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
  text, numeric, text, numeric, text, timestamptz
) is
  '0054: 0053''ün kapsamına Nakliye''nin product_tonnage_unit alanı eklendi, AYNI coalesce(p_x, x) disipliniyle — p_expected_updated_at HÂLÂ gerçek son parametre. Kategori (category_id)/fotoğraflar hâlâ bu RPC''nin kapsamı dışında (bkz. 0037''nin kendi gerekçesi).';

revoke all on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz
) from public, anon;
grant execute on function public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — update_job_as_requester: mevcut TAM 35 parametreli imza (0053)
-- önce silinir, AYNI coalesce disiplini ve AYNI yetki/durum kısıtları
-- (yalnızca ilan sahibi, yalnızca moderation_status='pending_review')
-- korunur.
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, timestamptz
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
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit)
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
  text, numeric, text, numeric, text, timestamptz
) is
  '0054: update_job_as_admin (0054) ile AYNI yeni alan (product_tonnage_unit) eklendi, AYNI coalesce disipliniyle — sahiplik/moderation_status=pending_review kısıtları (0051) değişmedi.';

revoke all on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz
) from public, anon;
grant execute on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz
) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — admin_job_list view: `j.*` kullandığı için yeni kolonu otomatik
-- kapsar, ama 0035/0048/0053 ile AYNI nedenle (yeni kolon fiziksel sırada
-- ORTAYA düşüyor, `create or replace view` bunu reddeder) drop+create
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
  '0054: jobs''a product_tonnage_unit eklenmesi nedeniyle drop+recreate edildi (0035/0048/0053 ile AYNI gerekçe) — davranış/erişim değişmedi, yalnızca j.* artık bu yeni kolonu da kapsıyor.';
