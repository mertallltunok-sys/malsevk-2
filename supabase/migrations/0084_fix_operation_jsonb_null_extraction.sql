-- =============================================================================
-- MALSEVK — migration 0084: create_operation_with_jobs — jsonb "null" (JSON
-- null literal) SQL NULL ile karıştırılması nedeniyle GERÇEK, kritik bir
-- çöküş düzeltildi
-- =============================================================================
-- GÖREV: "Development Kapanış Turu" — çoklu hizmet/operasyon akışının
-- GERÇEK, tarayıcı üzerinden çalıştırılan UI testinde (job-request-form.tsx
-- -> supabase-job-sync.ts#syncOperationToSupabase) bulunan, kod okumasıyla
-- asla yakalanamayacak bir çalışma-zamanı hatası:
--
--   PGRST/Postgres hatası: 22023 "cannot extract elements from a scalar"
--
-- KÖK NEDEN: `syncOperationToSupabase` her serviste (job-store.ts'in
-- "yalnızca ilgili kategoriye özel alanları doldur, diğerlerini undefined
-- bırak" ilkesinin gereği olarak) uygulanmayan HER alanı `job.alan ?? null`
-- ile BİLEREK ve HER ZAMAN açıkça `null` gönderir (bkz. o fonksiyonun kendi
-- kodu, DEĞİŞTİRİLMEDİ) — bu `p_services` (tek bir jsonb dizisi) İÇİNE
-- gömülü bir "JSON null" değeridir, gerçek bir SQL NULL DEĞİLDİR.
-- `v_service->'alan'` bu gömülü null'u "jsonb null" skaler değeri olarak
-- döner ('null'::jsonb) — ki bu `IS NULL` testini GEÇEMEZ (`'null'::jsonb IS
-- NULL` → false) ve `coalesce(v_service->'alan', '[]'::jsonb)` da onu
-- YAKALAYAMAZ (coalesce yalnızca GERÇEK SQL NULL'u değiştirir). Sonuç:
-- `jsonb_array_elements_text('null'::jsonb)` çağrısı "cannot extract
-- elements from a scalar" ile çöker — Nakliye/Depolama-risk/Geri Dönüşüm/
-- Gümrük alanlarını KULLANMAYAN (yani neredeyse HER) bir operasyon
-- servisinde tetiklenir. `create_job` (tekil ilan) bu hatadan ETKİLENMEZ
-- çünkü onun eşdeğer alanları AYRI, düz RPC parametreleridir (embedded
-- jsonb key değil) — PostgREST bir JS `null` RPC parametresini gerçek SQL
-- NULL'a çevirir, bu yüzden tekil ilan yolu hiç bu tuzağa düşmez; yalnızca
-- ÇOK SERVİSLİ operasyon yolu (tüm servisler TEK bir jsonb dizisi içinde
-- gönderilir) etkilenir.
--
-- DÜZELTME: her `v_service->'alan'` erişimi `nullif(v_service->'alan',
-- 'null'::jsonb)` ile sarmalanır — bu, gömülü JSON null'u GERÇEK SQL NULL'a
-- çevirir, ki `coalesce`/`is null` kontrollerinin İKİSİ de artık doğru
-- çalışır. Fonksiyonun geri kalanı (iş kuralları, hata kodları, INSERT
-- sütun sırası) BİREBİR AYNIDIR — yalnızca bu 9 erişim noktası düzeltildi.
-- Dış imza (parametre sayısı/tipleri) DEĞİŞMEDİĞİ için `create or replace
-- function` güvenle yerini alır, ikinci bir overload asla oluşmaz.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_operation_with_jobs(p_province text, p_operation_details text, p_services jsonb, p_photos_by_service_index jsonb, p_client_operation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    if v_photo_count < 1 or v_photo_count > 10 then
      raise exception 'MLK51: a job requires between 1 and 10 photos (service %, got %)', v_index, v_photo_count using errcode = 'MLK51';
    end if;

    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);
    -- DÜZELTME (0084) — aşağıdaki 9 erişim noktasının HEPSİ `nullif(..., 'null'::jsonb)`
    -- ile sarmalandı (bkz. bu migration'ın kendi başlığı).
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
$function$
;

comment on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) is
  '0014''ün çoklu hizmet/operasyon RPC''si. 0084 ile GERÇEK bir çalışma-zamanı hatası düzeltildi: `p_services` içindeki her serviste, kategoriye uygulanmayan alanlar için GERÇEK istemci kodunun (syncOperationToSupabase) her zaman açıkça gönderdiği gömülü JSON null değeri artık `nullif(..., ''null''::jsonb)` ile SQL NULL''a çevriliyor — önceden bu değer coalesce/is null kontrollerini atlayıp `jsonb_array_elements_text` çağrısında "cannot extract elements from a scalar" ile çöküyordu (22023), bu da Nakliye/Depolama-risk/Geri Dönüşüm/Gümrük alanlarını kullanmayan (neredeyse HER) çok-servisli operasyon oluşturma denemesini sunucu tarafında başarısız kılıyordu.';
