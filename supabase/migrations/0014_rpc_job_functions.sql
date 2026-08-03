-- =============================================================================
-- MALSEVK — Faz 1 migration 0014: job/operation RPC functions
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DEĞİŞİKLİKLER (önceki tasarımın 0018_rpc_job_functions.sql'ine göre):
--   * GÜVENLİK DÜZELTMESİ (önceki denetim C.1, Yüksek): close_job()'un
--     pending-teklif döngüsündeki UPDATE artık `AND status = 'pending'`
--     compare-and-set içeriyor (TOCTOU riski kapatıldı).
--   * GÜVENLİK DÜZELTMESİ (önceki denetim C.2, Yüksek): republish_job()'a
--     create_job() ile birebir aynı foto sayısı (1-10, MLK51) kontrolü
--     eklendi.
--   * create_operation_with_jobs(), operations.total_service_count'u artık
--     INSERT etmiyor (bkz. 0004_operations_jobs_photos.sql — kolon
--     kaldırıldı, canlı hesaplamaya geçildi).
--
-- Her fonksiyon tek bir PostgreSQL fonksiyon çağrısı olduğu için zaten tek
-- bir transaction içinde çalışır — kaynak uygulamanın elle yazdığı
-- rollback-on-partial-failure kodu burada ücretsizdir.
--
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 7 - KRITIK):
-- delete_job(p_job_id uuid) RPC'si EKLENDI -- sirradan Hizmet Alan
-- kullanicinin kendi ilanini silmesi icin (mevcut delete_job_as_admin,
-- 0016, yalniz admin icindir). Kaynagin deleteJobWithOffers'i ile birebir.
--
-- Hata kodu aralığı: MLK50-59, MLK92 (bu dosya, delete_job icin -- MLK50-59
-- zaten tamamen dolu, bkz. rpc-reference.md'nin kod tablosu).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_job
-- -----------------------------------------------------------------------------
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
  p_work_end_date date default null
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
    requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date
  ) values (
    auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date
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

revoke all on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date) from public, anon;
grant execute on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- create_operation_with_jobs
-- -----------------------------------------------------------------------------
-- p_photos_by_service_index: jsonb keyed by service index ({"0": [...], "1": [...]}) —
-- see docs/database/rpc-reference.md for the exact expected shape.
create or replace function public.create_operation_with_jobs(
  p_province text,
  p_operation_details text,
  p_services jsonb,
  p_photos_by_service_index jsonb
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

  -- total_service_count ARTIK YOK (bkz. 0004) — operations yalnızca başlık
  -- satırıdır, üye sayısı her zaman operation_progress view'ından canlı
  -- okunur.
  insert into public.operations (requester_id)
  values (auth.uid())
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

    insert into public.jobs (
      operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date
    ) values (
      v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, p_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date
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

revoke all on function public.create_operation_with_jobs(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_operation_with_jobs(text, text, jsonb, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- update_job
-- -----------------------------------------------------------------------------
create or replace function public.update_job(
  p_job_id uuid,
  p_title text, p_description text, p_operation_details text,
  p_province text, p_district text, p_work_location_type text,
  p_facility_id text, p_location_mode text, p_address_text text,
  p_neighborhood text, p_location_url text, p_directions_note text,
  p_work_date date, p_work_end_date date,
  p_kept_photo_ids uuid[], p_new_photos jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_kept_count integer;
  v_new_count integer;
  v_order integer;
  v_photo jsonb;
begin
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
  if v_kept_count + v_new_count < 1 or v_kept_count + v_new_count > 10 then
    raise exception 'MLK51: a job requires between 1 and 10 photos (got %)', v_kept_count + v_new_count using errcode = 'MLK51';
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
$$;

revoke all on function public.update_job(uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, date, uuid[], jsonb) from public, anon;
grant execute on function public.update_job(uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, date, uuid[], jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- close_job
-- -----------------------------------------------------------------------------
create or replace function public.close_job(p_job_id uuid, p_reason text)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if v_job is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;
  if v_job.closed_at is not null then
    raise exception 'MLK55: this job is already closed' using errcode = 'MLK55';
  end if;
  if public.is_job_closed_to_new_offers(p_job_id) then
    raise exception 'MLK55: this job has an in-progress or further offer and cannot be closed' using errcode = 'MLK55';
  end if;

  update public.jobs set closed_at = now(), closure_reason = p_reason where id = p_job_id returning * into v_job;

  -- GÜVENLİK DÜZELTMESİ (önceki denetim C.1, Yüksek): her satırın UPDATE'i
  -- artık `and status = 'pending'` compare-and-set içeriyor — SELECT ile bu
  -- UPDATE arasında eşzamanlı bir accept_offer() çağrısı bu teklifi
  -- 'accepted' yaptıysa, bu satır artık sessizce ezilmez (0 satır etkilenir,
  -- history/bildirim atlanır).
  for v_offer in select * from public.offers where job_id = p_job_id and status = 'pending' loop
    update public.offers set status = 'rejected', rejected_at = now()
      where id = v_offer.id and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
        values (v_offer.id, 'pending', 'rejected', auth.uid(), 'job_closed:' || p_reason);
      perform public.create_notification(v_offer.provider_id, auth.uid(), 'ilan_kapatildi', p_job_id, v_offer.id, v_job.operation_id,
        'İlan Kapatıldı', public.get_job_closure_notification_message(p_reason), null);
    end if;
  end loop;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_closed', 'İlan kapatıldı', p_reason, null, 'requester_only');

  return v_job;
end;
$$;

revoke all on function public.close_job(uuid, text) from public, anon;
grant execute on function public.close_job(uuid, text) to authenticated;

create or replace function public.get_job_closure_notification_message(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason
    when 'baska-hizmet-verenle-anlasildi' then 'Hizmet Alan başka bir hizmet verenle anlaştı.'
    when 'hizmete-ihtiyac-kalmadi' then 'İlan sahibi bu hizmete artık ihtiyaç duymadığı için ilanı kapattı.'
    when 'yanlislikla-olusturuldu' then 'İlan sahibi, ilanın yanlışlıkla oluşturulduğunu belirterek ilanı kapattı.'
    else 'İlan sahibi ilanı kapattı.'
  end;
$$;

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 9): yalniz
-- close_job()/close_job_as_admin() (owner-to-owner) kullaniyor -- hicbir
-- client'a dogrudan grant gerekmiyor.
revoke all on function public.get_job_closure_notification_message(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- republish_job
-- -----------------------------------------------------------------------------
create or replace function public.republish_job(
  p_job_id uuid, p_work_date date, p_work_end_date date, p_photos jsonb
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.jobs;
  v_new public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
begin
  select * into v_old from public.jobs where id = p_job_id;
  if v_old is null or v_old.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;
  if not public.is_job_listing_expired(p_job_id) then
    raise exception 'MLK57: this job has not expired and cannot be republished' using errcode = 'MLK57';
  end if;
  if v_old.republished_to_job_id is not null then
    raise exception 'MLK58: this job has already been republished' using errcode = 'MLK58';
  end if;
  if p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;

  -- GÜVENLİK DÜZELTMESİ (önceki denetim C.2, Yüksek): create_job() ile
  -- birebir aynı foto sayısı kontrolü — önceki tasarımda bu kontrol
  -- YOKTU, 0 veya 10'dan fazla fotoğraflı bir yeniden-yayın işi
  -- oluşturulabiliyordu.
  v_photo_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_photo_count < 1 or v_photo_count > 10 then
    raise exception 'MLK51: a job requires between 1 and 10 photos (got %)', v_photo_count using errcode = 'MLK51';
  end if;

  insert into public.jobs (
    operation_id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url, directions_note,
    work_date, work_end_date, republished_from_job_id
  )
  select operation_id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url, directions_note,
    p_work_date, p_work_end_date, v_old.id
  from public.jobs where id = p_job_id
  returning * into v_new;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
    values (v_new.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
      (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer, v_order, auth.uid());
    v_order := v_order + 1;
  end loop;

  update public.jobs set republished_to_job_id = v_new.id where id = v_old.id;

  -- Parametre sırası: (job_id, operation_id, actor_id, event_type, title,
  -- description text, metadata jsonb, visibility) — description/metadata
  -- burada BİLEREK null/jsonb sırasıyla, ters değil.
  perform public.append_job_activity_event(v_old.id, v_old.operation_id, auth.uid(), 'job_republished', 'İlan yeniden yayınlandı', null, jsonb_build_object('new_job_id', v_new.id), 'requester_only');
  perform public.append_job_activity_event(v_new.id, v_new.operation_id, auth.uid(), 'job_republished', 'Bu ilan, süresi dolan bir ilanın yerine yayınlandı', null, jsonb_build_object('old_job_id', v_old.id), 'requester_only');

  return v_new;
end;
$$;

revoke all on function public.republish_job(uuid, date, date, jsonb) from public, anon;
grant execute on function public.republish_job(uuid, date, date, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_job — DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20,
-- madde 7 - KRITIK): sirradan bir kullanicinin KENDI ilanini silmesi icin
-- hicbir RPC yoktu -- yalniz admin-only delete_job_as_admin() (0016) vardi.
-- Kaynagin app/_lib/offers.ts#deleteJobWithOffers'i (Hizmet Alan'in kendi
-- ilanini, "aktif/tamamlanmis isi yoksa" kosuluyla silmesi) burada
-- karsiligini buluyor: fiziksel DELETE degil, semanin geri kalaniyla ayni
-- soft-delete deseni (deleted_at). Operasyon altindaki kardes ilanlarin
-- butunlugu BOZULMAZ -- deleted_at UPDATE'i zaten var olan
-- trg_jobs_after_change_recompute_operation tetikleyicisini (0004) otomatik
-- tetikler, bu yuzden operations.closed_at/completed_at kalan kardesler
-- uzerinden dogru sekilde yeniden hesaplanir; digerlerine hicbir dogrudan
-- yazim yapilmaz (kaynaktaki "sibling jobs are fully independent" ilkesiyle
-- birebir).
-- -----------------------------------------------------------------------------
create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;

  -- Mirrors offers.ts#deleteJobWithOffers'in koruma esigi: `job.status ===
  -- "tamamlandi" || getSettledOfferForJob(...) !== null`.
  if v_job.listing_status = 'tamamlandi' or public.get_settled_offer_id_for_job(p_job_id) is not null then
    raise exception 'MLK92: a job with an active or completed offer cannot be deleted' using errcode = 'MLK92';
  end if;

  update public.jobs set deleted_at = now() where id = p_job_id and deleted_at is null;

  -- Kaynak uygulamanin deleteJobWithOffers'i ile ayni desen: hala pending
  -- olan kardes teklifler reddedilir (silinmez), zaten terminal durumdaki
  -- teklifler dokunulmadan kalir. close_job()'daki compare-and-set ile ayni
  -- desen (TOCTOU'ya karsi korumali).
  for v_offer in select * from public.offers where job_id = p_job_id and status = 'pending' loop
    update public.offers set status = 'rejected', rejected_at = now() where id = v_offer.id and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
        values (v_offer.id, 'pending', 'rejected', auth.uid(), 'job_deleted_by_owner');
      perform public.create_notification(v_offer.provider_id, auth.uid(), 'hizmet_kalemi_kaldirildi', p_job_id, v_offer.id, v_job.operation_id,
        'Hizmet Talebi Kaldırıldı', 'İlan sahibi ilgili hizmet talebini yayından kaldırdı.', null);
    end if;
  end loop;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_closed', 'İlan sahibi tarafından silindi', null, null, 'requester_only');
end;
$$;

revoke all on function public.delete_job(uuid) from public, anon;
grant execute on function public.delete_job(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- get_job_address — the sole read path for jobs' contact-gated columns
-- -----------------------------------------------------------------------------
create or replace function public.get_job_address(p_job_id uuid)
returns table (address_text text, neighborhood text, location_url text, directions_note text)
language sql
stable
security definer
set search_path = public
as $$
  select j.address_text, j.neighborhood, j.location_url, j.directions_note
  from public.jobs j
  where j.id = p_job_id and public.can_view_job_contact(p_job_id);
$$;

revoke all on function public.get_job_address(uuid) from public, anon;
grant execute on function public.get_job_address(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_job_photo
-- -----------------------------------------------------------------------------
create or replace function public.delete_job_photo(p_job_id uuid, p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_removed_order integer;
begin
  select requester_id into v_owner from public.jobs where id = p_job_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;

  select sort_order into v_removed_order from public.job_photos where id = p_photo_id and job_id = p_job_id and deleted_at is null;
  if v_removed_order is null then
    raise exception 'MLK59: photo not found' using errcode = 'MLK59';
  end if;

  update public.job_photos set deleted_at = now() where id = p_photo_id;
  update public.job_photos set sort_order = sort_order - 1
    where job_id = p_job_id and sort_order > v_removed_order and deleted_at is null;
end;
$$;

revoke all on function public.delete_job_photo(uuid, uuid) from public, anon;
grant execute on function public.delete_job_photo(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- set_provider_service_categories
-- -----------------------------------------------------------------------------
create or replace function public.set_provider_service_categories(p_category_ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK50: only hizmet-veren accounts may select service categories' using errcode = 'MLK50';
  end if;

  delete from public.provider_services where provider_id = auth.uid();
  insert into public.provider_services (provider_id, service_category_id)
  select distinct auth.uid(), cat
  from unnest(p_category_ids) as cat
  where exists (select 1 from public.service_categories sc where sc.id = cat);
end;
$$;

revoke all on function public.set_provider_service_categories(text[]) from public, anon;
grant execute on function public.set_provider_service_categories(text[]) to authenticated;
