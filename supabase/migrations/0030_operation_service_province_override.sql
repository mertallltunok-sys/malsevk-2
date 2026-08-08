-- =============================================================================
-- MALSEVK — Supabase Geçişi Faz 2 migration 0030: create_operation_with_jobs
-- per-service province override
-- =============================================================================
-- STATUS: Supabase Geçişi Faz 2 — "Gerçek İlan Oluşturma → Supabase" görevinin
-- TEK şema değişikliği. 0001-0029'un HİÇBİRİ değiştirilmedi/yeniden yazılmadı
-- (yerleşik ilke: uygulanmış bir migration asla geriye dönük düzenlenmez,
-- yalnızca yeni bir migration onu evrimleştirir — bkz. 0028'in kendi
-- başlığındaki AYNI ilke).
--
-- KÖKEN — GERÇEK BİR ALAN KAYBI BULUNDU (görev bölüm 6: "bir alan DB'de
-- yoksa sessizce kaybetme"): kaynağın job-store.ts#createJobsForOperation'ı,
-- bir Nakliye kardeş hizmetin KENDİ ilini (OperationServiceInput.province,
-- yalnızca isTransportationCategory iken anlamlı — bkz. CLAUDE.md "Nakliye
-- Güzergâh Yönetimi") operasyonun paylaşılan `province`sinden BAĞIMSIZ
-- tutar. 0028'in yazdığı create_operation_with_jobs ise HER zaman
-- `p_province`yi (paylaşılan değer) yazıyordu — p_services JSONB'sinin
-- içinde per-service bir `province` anahtarı hiç okunmuyordu. Bu, bir
-- Nakliye hizmetinin kendi ilini operasyonun paylaşılanından farklı seçtiği
-- bir çoklu-hizmet senkronunda YANLIŞ ile sessizce yazardı — doğrudan
-- kaynak kodu okunarak tespit edildi, varsayılmadı.
--
-- DÜZELTME: fonksiyonun DIŞ imzası DEĞİŞMEDİ (0028 ile birebir aynı 5
-- parametre) — yalnızca p_services JSONB gövdesinin içinden, VARSA, opsiyonel
-- bir `province` anahtarı okunuyor (job-store.ts#createJobsForOperation'ın
-- kendi `serviceProvince` hesaplamasıyla BİREBİR aynı öncelik: hizmetin
-- kendi province'i doluysa o, aksi halde paylaşılan p_province). Diğer
-- kardeş hizmetler bu anahtarı hiç göndermez (undefined/NULL) — bu durumda
-- davranış ÖNCEKİYLE (0028) birebir aynı kalır, geriye dönük tam uyumlu.
--
-- Hata kodu değişikliği yok — bu migration yeni bir doğrulama eklemiyor,
-- yalnızca hangi sütun değerinin yazıldığını düzeltiyor.
-- =============================================================================

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

  -- p_client_operation_id: bkz. 0028'in kendi dokümantasyonu — DEĞİŞMEDİ.
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

    -- YENİ (bu migration): hizmetin KENDİ province'i (yalnızca Nakliye
    -- gönderir, bkz. dosya başlığı) varsa o kullanılır, yoksa (diğer TÜM
    -- kardeş hizmetler ve mevcut/eski çağıranlar için) paylaşılan p_province
    -- — job-store.ts#createJobsForOperation'ın `serviceProvince` mantığıyla
    -- BİREBİR aynı öncelik sırası.
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, v_service_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type'
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

-- Grant değişmedi (aynı imza, 0028'de zaten grant edilmişti) — create or
-- replace bunu korur, yine de açıkça tekrarlanır (idempotent, zararsız).
revoke all on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) to authenticated;
