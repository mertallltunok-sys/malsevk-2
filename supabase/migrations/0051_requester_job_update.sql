-- 0051: update_job_as_requester — "Kritik İlan Senkronizasyonu" görevi,
-- Bölüm 2 takip düzeltmesi ("Onay bekleyen ilan düzenlemeleri de Supabase'e
-- yazılmalı"). update_job_as_admin (0048) admin'in ilan içeriğini
-- düzeltmesini kapsar; ilan SAHİBİNİN kendi düzenleme akışının (job-edit-form.tsx
-- -> job-store.ts#updateJob) hiçbir Supabase karşılığı yoktu — bir Hizmet
-- Alan, admin karar vermeden ÖNCE ilanını düzenlediğinde bu değişiklik
-- yalnızca localStorage'a yazılıyordu, Supabase'teki (varsa) kayıt eski
-- hâliyle kalıyordu. Bu, use-jobs.ts#remoteWinsOverLocal'ın "ilan pending
-- iken local kazanır" kuralının GEREKÇESİYDİ (düzenlemeler hiç
-- senkronlanmadığı için remote'un kazanması düzenlemeyi görünmez kılardı) —
-- artık düzenlemeler de senkronlandığı için bu asimetri kapanıyor.
--
-- "En dar RPC çözümü" (görev gereksinimi) — update_job_as_admin (0048) İLE
-- BİREBİR AYNI alan kapsamı/coalesce disiplini kopyalanır (title/description/
-- province/district/work_location_type/address_text/work_date/work_end_date/
-- product_*/customs_product_type/customs_transaction_type/
-- customs_requested_services/delivery_facility_name/delivery_address_text/
-- operation_details/neighborhood/location_url/directions_note/
-- delivery_province/delivery_district/recycling_*) — İKİNCİ bir ilan sistemi
-- İCAT EDİLMEZ, aynı `jobs` tablosu, aynı satır. Tek fark yetkilendirme:
-- is_admin() yerine auth.uid() = requester_id VE moderation_status =
-- 'pending_review' zorunluluğu. update_job_as_admin İLE AYNI, BİLEREK
-- KAPSAM DIŞI bırakılan alanlar: category_id, facility_id, location_mode,
-- delivery_facility_id, delivery_location_type, photos, customsDocuments —
-- bunlar job-edit-form.tsx'te değiştirilebilir olsa da bu RPC'ye hiç
-- parametre olarak alınmaz; requester bunları değiştirirse o değişiklik
-- yalnızca yerel kalır (update_job_as_admin'in KENDİ zaten kabul ettiği aynı
-- sınır, yeni bir kısıtlama değil).
--
-- moderation_status = 'pending_review' zorunluluğu BİLEREK dar tutulur:
-- zaten onaylanmış/reddedilmiş bir ilanı düzenlemek (job-store.ts#updateJob
-- içindeki didCriticalJobContentChange dalı, ilanı yerel olarak yeniden
-- "pending_review"a döndürür) bu görevin kapsamı DIŞINDADIR — bu RPC o anda
-- SUNUCUDAKİ durumu kontrol eder (henüz 'approved'/'rejected'), bu yüzden
-- ML131 ile reddeder; app kodu (job-edit-form.tsx) bu RPC'yi yalnızca
-- düzenlemeden ÖNCEKİ (auth.uid() ile aynı requester'ın kendi bildiği) ilan
-- zaten 'pending_review' iken çağırır, bu yüzden normal akışta bu ret hiç
-- tetiklenmez — yalnızca RPC'ye doğrudan/yetkisiz bir çağrı (ör. başka bir
-- kullanıcı, ya da zaten karara bağlanmış bir ilan için) bu kodu görür.

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
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services)
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
  text, text, numeric, text, text, text, text[], text, text[], timestamptz
) is
  '0051: update_job_as_admin (0048) ile AYNI alan kapsamı/coalesce disiplini, ama auth.uid() = requester_id VE moderation_status = ''pending_review'' zorunluluğuyla — ilan sahibinin admin kararından ÖNCEki kendi düzenlemesi artık Supabase''e yazılabiliyor. category_id/facility_id/location_mode/delivery_facility_id/delivery_location_type/photos/customsDocuments update_job_as_admin İLE AYNI nedenle kapsam dışı.';

revoke all on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[], timestamptz
) from public, anon;
grant execute on function public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[], timestamptz
) to authenticated;
