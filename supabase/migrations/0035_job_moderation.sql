-- =============================================================================
-- MALSEVK — migration 0035: İlan Onayı (admin moderasyonu)
-- =============================================================================
-- STATUS: Hizmet Alan tarafından oluşturulan ilanlar artık admin onaylayana
-- kadar Hizmet Veren'e (ve diğer Hizmet Alan kullanıcılarına) görünmez.
-- `moderation_status`, `jobs.listing_status`den (operasyonel yaşam döngüsü:
-- yayinda/tamamlandi/iptal) KASITLI OLARAK AYRI, karıştırılmaması gereken
-- bir kavramdır — kaynak uygulamanın types.ts#Job.moderationStatus'un kendi
-- doc yorumuyla BİREBİR aynı ayrım (bkz. app/_lib/job-moderation.ts).
--
-- ÖNEMLİ MİMARİ SINIR (proje raporunda tam olarak belgelenmiştir, burada
-- yalnızca özetlenir): bugünkü CANLI Hizmet Veren/Hizmet Alan akışının
-- TAMAMI (provider-job-listing.tsx, job-detail-content.tsx, offers.ts#
-- createOffer) yalnızca localStorage okur, bu şemaya HİÇ dokunmaz (bkz.
-- CLAUDE.md "No real backend"). Bu migration'daki RLS/RPC katmanı GERÇEK
-- bir yetkilendirme sınırıdır — ama yalnızca (a) admin panelinin kendisi
-- (100% Supabase) ve (b) `NEXT_PUBLIC_ENABLE_SUPABASE_JOB_SYNC` açıkken
-- localStorage'dan Supabase'e giden best-effort ayna için. Canlı uygulamanın
-- kendi enforcement'ı ayrı olarak `app/_lib/job-moderation.ts`/`job-store.ts`/
-- `offers.ts`de (localStorage katmanı) uygulanmıştır — bu migration o
-- katmanı DEĞİŞTİRMEZ, yalnızca Supabase tarafını tamamlar.
--
-- GERİYE DÖNÜK VERİ (görev bölüm 15): kolonun DEFAULT'u `'approved'`dur —
-- bu, mevcut/geçmiş TÜM satırların (bu migration'dan önce oluşturulmuş)
-- otomatik olarak onaylı sayılmasını sağlar, hiçbir satır yanlışlıkla
-- yayından kalkmaz. Yeni ilanlar (`create_job`/`create_operation_with_jobs`)
-- bu varsayılanı AÇIKÇA `'pending_review'` ile geçersiz kılar.
--
-- `create_job`/`create_operation_with_jobs` AŞAĞIDA YENİDEN TANIMLANIYOR —
-- dış imzaları (parametre listesi/sıra/default'lar) 0031'deki (bugünkü
-- CANLI/tek geçerli) hâlleriyle BİREBİR AYNI kopyalandı, yalnızca INSERT
-- sütun/değer listesine `moderation_status` eklendi. Bu KRİTİK: 0032/0033/
-- 0034'ün bulduğu "stale overload" hatasının (bkz. o migration'ların kendi
-- notu) burada TEKRARLANMAMASI için imza harfiyen korunmalıdır — aksi halde
-- `create or replace function` bunu GERÇEKTEN değiştirmez, ikinci bir
-- overload olarak CREATE eder.
--
-- Hata kodu aralığı: ML115-ML119 (bu migration'a özel — önceki en yüksek
-- kod ML114'tü, 0029'da kendi notunda doğrulanmıştı; bu dosyada da
-- `grep -rn "ML11[5-9]" supabase/migrations/*.sql` ile çakışma olmadığı
-- doğrudan kontrol edildi). MLK kod ailesi (MLK50-99) 5-karakter SQLSTATE
-- sınırı yüzünden dolu (bkz. 0029'un kendi notu) — bu yüzden 0029'un
-- başlattığı "ML" + 3 haneli aile devam ettirilir, yeni bir aile İCAT
-- EDİLMEZ. create_offer'ın moderasyon kontrolü İSE yeni bir kod ALMAZ,
-- mevcut MLK60'ı ("job not found or not available for offers") genişletir
-- — aynı client-facing sonucun (Nakliye izolasyonuyla AYNI "bulunamadı"
-- mesajı) doğal bir uzantısıdır, ayrı bir anlam taşımaz.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs: moderasyon kolonları
-- -----------------------------------------------------------------------------
alter table public.jobs
  add column if not exists moderation_status text not null default 'approved'
    check (moderation_status in ('pending_review', 'approved', 'rejected')),
  add column if not exists moderation_reviewed_at timestamptz,
  add column if not exists moderation_reviewed_by uuid references public.profiles (id),
  add column if not exists moderation_rejection_reason text;

comment on column public.jobs.moderation_status is
  'İlan Onayı (admin moderasyonu) — jobs.listing_status (operasyonel yaşam döngüsü) ile KASITLI OLARAK AYRI bir kavram. DEFAULT ''approved'' yalnızca geriye dönük veri güvenliği içindir (görev bölüm 15) — create_job/create_operation_with_jobs bunu yeni ilanlar için her zaman AÇIKÇA ''pending_review'' ile geçersiz kılar.';
comment on column public.jobs.moderation_reviewed_by is
  'Kararı veren adminin profiles.id''si — yalnızca moderation_reviewed_at doluysa anlamlıdır.';

create index if not exists jobs_moderation_status_idx on public.jobs (moderation_status) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — RLS: jobs_select_visible — moderation_status='approved' olmayan
-- bir ilan, sahibi ya da admin DIŞINDA KİMSEYE görünmez. Nakliye/Gümrük
-- izolasyonu (provider_can_view_category) ve "hizmet-veren olmayan herkes
-- görür" dalı DEĞİŞMEDİ — yalnızca ikisinin de ÜZERİNE, moderasyon onayı
-- AND'lenerek eklendi (owner/admin bypass'ı hâlâ en üst seviyede, moderasyon
-- dahil HER şeyi atlar — görev bölüm 11).
-- -----------------------------------------------------------------------------
drop policy if exists jobs_select_visible on public.jobs;
create policy jobs_select_visible on public.jobs
  for select to authenticated, anon
  using (
    deleted_at is null and (
      requester_id = auth.uid()
      or public.is_admin()
      or (
        moderation_status = 'approved'
        and (
          public.current_user_role() is distinct from 'hizmet-veren'
          or public.provider_can_view_category(auth.uid(), category_id)
        )
      )
    )
  );

comment on policy jobs_select_visible on public.jobs is
  'İlan Onayı (0035) eklendi: moderation_status=''approved'' olmayan bir ilan, sahibi/admin DIŞINDA hiç kimseye (misafir/başka Hizmet Alan/Hizmet Veren) görünmez. Nakliye/Gümrük izolasyonu (provider_can_view_category, bkz. 0012) DEĞİŞMEDEN korunur.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2b — admin_job_list view (0017): `select j.*` bir view'ın kendi
-- kolon listesi CREATE anındaki tabloya göre SABİTLENİR, tablo sonradan yeni
-- kolon kazanınca view KENDİLİĞİNDEN güncellenmez — bu yüzden view 0017'den
-- beri hiç yeniden oluşturulmadıysa moderation_status'u (ve aslında 0028/
-- 0031'in product_*/delivery_* kolonlarını da) HİÇ döndürmüyordu (doğrudan
-- `grep -rn "admin_job_list" supabase/migrations/*.sql` ile doğrulandı —
-- 0017 dışında hiçbir migration bu view'ı DOKUNMAMIŞ). `create or replace
-- view` burada YETERSİZ — Postgres bunu yalnızca YENİ kolonların LİSTENİN
-- SONUNA eklenmesine izin verir; `jobs`e 0028/0031/bu migration'da eklenen
-- kolonlar tablonun kendi fiziksel sütun sırasında `j.*` genişlemesinin
-- ORTASINA düşüyor (offer_count'un önceki konumunu kaydırıyor), bu da
-- `create or replace view`'ın "cannot change name of view column" hatasıyla
-- REDDETTİĞİ bir kolon-yeniden-adlandırma gibi görünüyor (yerel Docker
-- dry-run'da gerçek CREATE hatasıyla doğrulandı). Bu yüzden DROP + CREATE
-- kullanılıyor — gövde 0017'deki ile BİREBİR AYNI, yalnızca `j.*` şimdi
-- bugünkü tam kolon kümesini (moderation_status dahil) yakalıyor.
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

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_job: imza 0031'deki (bugünkü canlı) 27 parametreyle
-- BİREBİR AYNI — yalnızca INSERT'e moderation_status='pending_review' eklendi.
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
  p_delivery_address_text text default null
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
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type, delivery_province, delivery_district, delivery_location_type,
    delivery_facility_id, delivery_facility_name, delivery_address_text, moderation_status
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text, 'pending_review'
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

-- İmza DEĞİŞMEDİ (0031 ile birebir aynı) — grant tekrarlanır, zararsız/idempotent.
revoke all on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_job(text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date, integer, numeric, text, text, uuid, text, text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — create_operation_with_jobs: imza 0030/0031'deki (bugünkü canlı)
-- 5 parametreyle BİREBİR AYNI — yalnızca INSERT'e moderation_status eklendi.
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
      delivery_facility_id, delivery_facility_name, delivery_address_text, moderation_status
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

-- İmza DEĞİŞMEDİ (0030/0031 ile birebir aynı) — grant tekrarlanır, zararsız/idempotent.
revoke all on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) from public, anon;
grant execute on function public.create_operation_with_jobs(text, text, jsonb, jsonb, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — create_offer: gövde 0015'teki (bugünkü canlı) hâliyle BİREBİR
-- AYNI kopyalandı — TEK değişiklik, job-lookup satırına (aşağıda işaretli)
-- moderasyon kontrolünün eklenmesi. İmza (uuid, numeric, text, text, integer)
-- DEĞİŞMEDİ. Görev bölüm 3 ("Pending/rejected ilana teklif gönderilemez"):
-- mevcut MLK60 ("job not found or not available for offers") genişletildi —
-- yeni bir hata kodu İCAT EDİLMEDİ, Nakliye izolasyonuyla (provider_can_view_category)
-- AYNI OR dalına eklendi, aynı client-facing sonucu üretir.
-- -----------------------------------------------------------------------------
create or replace function public.create_offer(
  p_job_id uuid, p_amount numeric, p_currency text, p_description text, p_estimated_duration integer default null
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_latest_offer public.offers;
  v_offer public.offers;
  v_requires_estimated_duration boolean;
  v_estimated_duration integer;
begin
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK50: only hizmet-veren accounts may create an offer' using errcode = 'MLK50';
  end if;

  -- Sağlayıcı-scoped advisory lock: aynı sağlayıcının eşzamanlı create_offer
  -- çağrılarını serileştirir (aşağıdaki latest-offer/cooldown kontrolü için).
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':create_offer'));

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  -- YENİ (0035, İlan Onayı): moderation_status <> 'approved' de AYNI MLK60
  -- ile reddedilir — Nakliye izolasyonuyla (provider_can_view_category)
  -- birebir aynı "ilan yok/erişilemez" mesajı, ayrı bir dal/kod DEĞİL.
  if v_job is null or not public.provider_can_view_category(auth.uid(), v_job.category_id) or v_job.moderation_status <> 'approved' then
    raise exception 'MLK60: job not found or not available for offers' using errcode = 'MLK60';
  end if;

  -- Gümrük Müşavirliği'ne özel ek kapı — mirrors
  -- customs-license.ts#canSubmitOffersAsCustomsBroker exactly (doğrulanmış).
  if exists (
    select 1 from public.provider_services ps
    join public.service_categories sc on sc.id = ps.service_category_id
    where ps.provider_id = auth.uid() and sc.id = 'gumruk-musavirligi'
  ) and not exists (
    select 1 from public.provider_documents
    where provider_id = auth.uid() and document_type = 'gumruk-musaviri-izin-belgesi' and current_review_status = 'approved'
  ) then
    raise exception 'MLK61: customs broker license must be approved before offering' using errcode = 'MLK61';
  end if;

  -- 3 günlük cooldown — doğrulanmış: app/_lib/job-requests.ts#
  -- REOFFER_COOLDOWN_DAYS = 3, REOFFER_COOLDOWN_OFFER_STATUSES =
  -- withdrawn/rejected/agreement_failed.
  select * into v_latest_offer from public.offers
    where job_id = p_job_id and provider_id = auth.uid()
    order by created_at desc limit 1;
  if v_latest_offer is not null then
    if v_latest_offer.status in ('withdrawn', 'rejected', 'agreement_failed') then
      if v_latest_offer.updated_at + interval '3 days' > now() then
        raise exception 'MLK62: re-offer cooldown still active for this job' using errcode = 'MLK62';
      end if;
    else
      raise exception 'MLK63: an offer for this job already exists and cannot be repeated' using errcode = 'MLK63';
    end if;
  end if;

  if v_job.listing_status <> 'yayinda'
     or public.is_job_closed_to_new_offers(p_job_id)
     or v_job.closed_at is not null
     or public.is_job_listing_expired(p_job_id) then
    raise exception 'MLK64: this job is not open for new offers' using errcode = 'MLK64';
  end if;

  if public.has_reached_active_job_limit(auth.uid()) then
    raise exception 'MLK65: active job capacity reached' using errcode = 'MLK65';
  end if;

  -- "Tamamlanması Taahhüt Edilen Gün" -- yalnizca Nakliye kategorisi icin
  -- zorunlu/kaydedilir, mirrors offers.ts#createOffer'in
  -- requiresEstimatedDuration = isTransportationCategory(job.category)
  -- mantigi birebir. Nakliye disinda p_estimated_duration ne gonderilirse
  -- gonderilsin sessizce yok sayilir (kaydedilmez) -- kaynakla ayni.
  v_requires_estimated_duration := (v_job.category_id = 'nakliye');
  if v_requires_estimated_duration and (
    p_estimated_duration is null or p_estimated_duration < 1 or p_estimated_duration > 60
  ) then
    raise exception 'MLK66: estimated_duration must be an integer between 1 and 60 for Nakliye jobs' using errcode = 'MLK66';
  end if;
  v_estimated_duration := case when v_requires_estimated_duration then p_estimated_duration else null end;

  insert into public.offers (job_id, provider_id, amount, currency, description, estimated_duration)
  values (p_job_id, auth.uid(), p_amount, p_currency, p_description, v_estimated_duration)
  returning * into v_offer;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (v_offer.id, null, 'pending', auth.uid());

  perform public.create_notification(v_job.requester_id, auth.uid(), 'yeni_teklif', p_job_id, v_offer.id, v_job.operation_id,
    null, 'İlanınıza yeni teklif geldi: ' || v_job.title, null);

  return v_offer;
end;
$$;

revoke all on function public.create_offer(uuid, numeric, text, text, integer) from public, anon;
grant execute on function public.create_offer(uuid, numeric, text, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — approve_job_as_admin / reject_job_as_admin / update_job_as_admin
-- — close_job_as_admin (0016) ile AYNI desen: is_admin() self-gate -> satır
-- kontrolü -> tek UPDATE ... RETURNING * -> log_audit_event. Görev bölüm 7
-- ("İşlem idempotent olmalı") — approve_job_as_admin zaten-onaylı bir ilanda
-- da başarıyla tekrar çalışır (compare-and-set YOK, düz UPDATE), veri
-- bozulmasına yol açmaz. Görev bölüm 14 (race condition) — opsiyonel
-- `p_expected_updated_at`: admin ilan detayını AÇTIĞI andaki `updated_at`
-- değerini gönderirse ve o andan beri ilan (sahibi tarafından) değiştiyse
-- ML118 ile reddedilir, admin yeniden inceleme sayfasına yönlendirilir
-- (bkz. admin-jobs.ts/admin-job-detail.tsx) — `null` gönderilirse (varsayılan)
-- bu kontrol hiç yapılmaz, geriye dönük uyumlu.
-- -----------------------------------------------------------------------------
create or replace function public.approve_job_as_admin(p_job_id uuid, p_expected_updated_at timestamptz default null)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
begin
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

  update public.jobs set
    moderation_status = 'approved',
    moderation_reviewed_at = now(),
    moderation_reviewed_by = auth.uid(),
    moderation_rejection_reason = null
  where id = p_job_id
  returning * into v_job;

  perform public.log_audit_event('approve_job_as_admin', 'jobs', p_job_id,
    jsonb_build_object('moderation_status', 'pending_review'), jsonb_build_object('moderation_status', 'approved'));

  return v_job;
end;
$$;

revoke all on function public.approve_job_as_admin(uuid, timestamptz) from public, anon;
grant execute on function public.approve_job_as_admin(uuid, timestamptz) to authenticated;

create or replace function public.reject_job_as_admin(p_job_id uuid, p_reason text, p_expected_updated_at timestamptz default null)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'ML115: admin role required' using errcode = 'ML115';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML117: a reason is required to reject a job' using errcode = 'ML117';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML116: job not found' using errcode = 'ML116';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for review, please re-review' using errcode = 'ML118';
  end if;

  update public.jobs set
    moderation_status = 'rejected',
    moderation_reviewed_at = now(),
    moderation_reviewed_by = auth.uid(),
    moderation_rejection_reason = v_trimmed_reason
  where id = p_job_id
  returning * into v_job;

  perform public.log_audit_event('reject_job_as_admin', 'jobs', p_job_id,
    jsonb_build_object('moderation_status', 'pending_review'), jsonb_build_object('moderation_status', 'rejected', 'reason', v_trimmed_reason));

  -- NOT: burada bilerek create_notification() ÇAĞRILMAZ — notifications.type
  -- (0009) 20 sabit değerle CHECK kısıtlıdır ve bunların hiçbiri "ilan
  -- reddedildi"yi kapsamaz; yeni bir enum değeri eklemek bu görevin
  -- kapsamını genişletirdi (ayrıca notifications.ts, canlı uygulamanın
  -- localStorage tarafında bildirimleri Job/Offer'dan CANLI TÜRETİR, bu
  -- Supabase satırını hiç okumaz — bkz. proje raporu). Red nedeni zaten (a)
  -- bu satırın kendisinde (RLS ile sahibine/admin'e görünür) ve (b)
  -- localStorage aynasında (job-store.ts#applyAdminModerationDecision,
  -- job-requests-panel.tsx'te gösterilir) mevcuttur.
  return v_job;
end;
$$;

revoke all on function public.reject_job_as_admin(uuid, text, timestamptz) from public, anon;
grant execute on function public.reject_job_as_admin(uuid, text, timestamptz) to authenticated;

-- update_job_as_admin — görev bölüm 6: admin, gerekli düzeltmeleri normal
-- kullanıcının update_job() (0014) RPC'si üzerinden SİMÜLE EDİLMEDEN,
-- kendi admin-only RPC'si üzerinden yapabilir. update_job'un sahiplik/
-- "teklif süreci başladıysa düzenlenemez" kontrollerini KASITLI OLARAK
-- atlar (admin düzeltmesi bu kurala tabi değildir) ama update_job'un fotoğraf
-- alanlarına HİÇ dokunmaz (görev bölüm 6'nın listelediği alan kümesiyle
-- sınırlıdır — bkz. admin-job-edit-form.tsx). didCriticalJobContentChange
-- yeniden-inceleme tetikleyicisi (localStorage tarafı, job-store.ts) burada
-- YOKTUR — admin zaten aynı akışın bir parçası olarak ayrı bir onay/red
-- kararı verecektir.
create or replace function public.update_job_as_admin(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
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
    product_quantity = p_product_quantity, product_tonnage = p_product_tonnage, product_type = p_product_type,
    customs_product_type = p_customs_product_type,
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

revoke all on function public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, timestamptz) to authenticated;
