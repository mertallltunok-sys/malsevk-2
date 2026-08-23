-- =============================================================================
-- MALSEVK — migration 0042: assert_active_user() — merkezi askıya-alma (suspend)
-- backend enforcement mekanizması
-- =============================================================================
-- KOK NEDEN (gercek testte dogrulandi -- gecerli bir JWT ile dogrudan RPC
-- cagrisi yapan askiya alinmis bir hesap, create_job/create_offer/vb. cagirip
-- gercek veri yazabiliyordu): profiles.account_status ('active'/'suspended',
-- 0003) yalnizca bir bayrakti -- suspend_user()/reinstate_user() (0016) bu
-- bayragi yaziyordu ama Faz 1'in HICBIR RLS politikasi/RPC'si bunu okuyup bir
-- islemi gercekten reddetmiyordu. Bu, onceki denetim raporlarinda tekrar tekrar
-- "Acik Karar" olarak birakilmis, bilinen ve belgelenmis bir bosluktu (bkz.
-- docs/database/schema-reference.md Acik Karar #6, admin-permissions.md,
-- suspend_user()'in (0016) kendi yorumu) -- simdi kapatiliyor.
--
-- MEVCUT MIMARIYE UYGUNLUK: yeni bir yetkilendirme paradigmasi ICAT EDILMEDI.
-- is_admin()/current_user_role() (0012) ile AYNI kalip izlendi -- SECURITY
-- DEFINER, set search_path = public, stable, owner-to-owner cagri icin
-- authenticated/anon/public'ten REVOKE ALL. Farki: is_admin() bir boolean
-- PREDICATE'tir (cagiran kendi if/raise'ini yazar) -- assert_active_user() ise
-- KASITLI OLARAK kendi icinde raise exception yapan bir ASSERTION'dir, tipki
-- her mutation RPC'sinin 'perform public.log_audit_event(...)' ile paylasilan
-- bir yan-etkiyi TEK bir cagriyla kullanmasi gibi -- "her RPC'ye kopyala-yapistir
-- account_status if'i" YERINE, her RPC'nin govdesine TEK SATIRLIK
-- 'perform public.assert_active_user();' eklenir (ilk yurutulebilir ifade
-- olarak, 'begin'den hemen sonra).
--
-- KAPSAM -- KASITLI SINIR CIZGILERI (gorev bolum "HANGI BACKEND ISLEMLERINDE
-- ZORLANMALI" ve "READ DAVRANISINI AYRI ELE AL"):
--   1. Yalnizca MUTATION RPC'leri kapsanir (asagidaki 41 fonksiyon) -- hicbir
--      RLS SELECT politikasi, hicbir is_*/get_*/can_*/has_* okuma-yardimcisi
--      DEGISMEDI. Bir askiya alinmis hesabin kendi verisini SELECT etmesi
--      (orn. jobs_select_visible RLS'i) bu migration'in kapsami DISINDA
--      birakilmistir -- gorev talimatinin kendisi bunu acikca istiyor
--      ("READ islemlerini otomatik olarak engelleme").
--   2. Admin RPC'leri de DAHIL edildi (suspend_user/reinstate_user'in KENDISI
--      dahil, 18 admin RPC'si) -- bu KASITLI bir karardir: bir hesap
--      askiya alindiginda (ki role='admin' da olabilir, suspend_user() zaten
--      son AKTIF admin'in askiya alinmasini ayrica engelliyor, bkz. 0012#
--      prevent_last_admin_loss ve 0016#suspend_user'in kendi last-admin
--      kontrolu) o hesabin HICBIR mutation'i gecmemeli -- yalnizca hizmet-alan/
--      hizmet-veren'e ozel bir kural degil, "askiya alinmis = hicbir yazma
--      islemi yapamaz" GENEL kurali. Aktif bir adminin suspend/reinstate/
--      onayla/reddet akislari bu yuzden ETKILENMEZ (kendi hesabi active
--      oldugu surece assert_active_user() sessizce gecer) -- bkz. bu
--      migration'in gercek testinde "Admin moduleri E2E" bolumu.
--   3. KASITLI OLARAK DISARIDA BIRAKILANLAR (dort ayri gerekce):
--      a) record_legal_consent, submit_contact_message -- IKISI DE anon'a da
--         grant edilmis (0008/0021): kayit formu tamamlanmadan/oturum
--         acilmadan da cagrilabilmeleri gerekiyor; assert_active_user()
--         auth.uid() is null'da zaten reddederdi, bu da anonim kullanim
--         senaryosunu KIRARDI.
--      b) complete_registration (0022) -- kayit akisinin kendisi; bir hesap
--         daha role atanmadan/tamamlanmadan once "askiya alinmis" durumuna
--         hicbir zaman gercekci bicimde ULASAMAZ (suspend_user() zaten yalniz
--         var olan bir profile satirini gunceller), bu kirilgan bootstrap
--         akisina (0022'nin kendi gecmisi -- gercek canli testte bulunan
--         profiles bootstrap hatasi) gereksiz bir ek risk katmamak icin
--         disarida birakildi.
--      c) mark_notification_read, dismiss_notification, record_job_viewed --
--         bunlar "yeni bir islem yapma/mevcut operasyonu manipule etme"
--         DEGIL, salt kullanici-yerel UI durumu (bildirim okundu/kapatildi
--         isareti, goruntulenme kaydi) -- gorev talimatinin "okuma davranisini
--         ayri ele al" ilkesiyle ayni ruhta, bu ucu de KASITLI OLARAK
--         kapsam disi birakildi.
--      d) submit_facility_candidate_entry -- belgelenmis sekilde "fire-and-
--         forget, best-effort, hicbir UI durumu asla bunun hatasini
--         gostermiyor" (bkz. bu dosyanin "Supabase Gecisi Faz 2-4" CLAUDE.md
--         aciklamasi) -- gercek bir "islem"i temsil etmiyor (yalnizca bir
--         tesis adi onerisi), dusuk guvenlik degeri nedeniyle kapsam disi.
--   4. Sweep/trigger fonksiyonlari (sweep_*, ensure_*, handle_new_auth_user,
--      prevent_last_admin_loss, set_updated_at, trg_jobs_recompute_*,
--      rls_auto_enable) hicbir zaman dogrudan client tarafindan cagrilmaz --
--      kapsam disi, dokunulmadi.
--
-- UYGULAMA YONTEMI: asagidaki 41 fonksiyonun HER BIRI, gelistirme projesinden
-- (trfnmpihcnriqgikglpu) alinan GERCEK CANLI TANIMLARIYLA (pg_dump, "supabase
-- db dump --linked") birebir aynidir -- hicbir davranis satiri elle yeniden
-- yazilmadi/tahmin edilmedi, yalnizca TEK bir satir ('perform public.
-- assert_active_user();') her fonksiyonun 'begin'inden hemen sonra, ilk
-- yurutulebilir ifade olarak eklendi. 'create or replace function' AYNI
-- imzayla cagrildigi icin mevcut GRANT'ler (yalnizca authenticated'e, hicbiri
-- anon'a) OTOMATIK OLARAK korunur -- bu migration'da tek bir yeni/tekrar
-- GRANT satiri yoktur, cunku hicbirine ihtiyac yoktur.
--
-- HATA KODLARI (yeni, oncekilerle CAKISMAYAN sira -- ML100-ML124 zaten
-- kullaniliyor, MLK10-MLK99 araligi da dolu; ML1xx ailesi bu migration'a en
-- yakin onceki genisleme oldugu icin (0038'in service-authorization'i) AYNI
-- ailede devam edildi, yeni bir aile ICAT EDILMEDI):
--   ML125 -- auth.uid() NULL (kimlik dogrulama gerekli)
--   ML126 -- profiles satiri bulunamadi (beklenmeyen durum, 0022'nin bootstrap
--           trigger'i normalde bunu garanti eder)
--   ML127 -- account_status <> 'active' (hesap askiya alinmis)
-- Uygulama tarafi (app/_lib/supabase-mutation-errors.ts, bu migration'la
-- birlikte eklendi) bu uc kodu "Hesabiniz askiya alindigi icin bu islemi
-- gerceklestiremezsiniz." gibi Turkce, teknik-detaysiz mesajlara cevirir.
-- =============================================================================

create or replace function public.assert_active_user()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'ML125: authentication required' using errcode = 'ML125';
  end if;

  select account_status into v_status from public.profiles where id = auth.uid();

  if v_status is null then
    raise exception 'ML126: profile not found' using errcode = 'ML126';
  end if;

  if v_status <> 'active' then
    raise exception 'ML127: account is suspended' using errcode = 'ML127';
  end if;
end;
$$;

comment on function public.assert_active_user() is
  'Merkezi, tek noktadan askiya-alma (suspend) enforcement -- her mutation RPC''sinin govdesine perform public.assert_active_user(); olarak, ilk ifade halinde eklenir (bkz. bu migration''in dosya basligi, kapsam disi birakilan istisnalar dahil). is_admin() ile AYNI SECURITY DEFINER + owner-to-owner cagri kalibini izler, ama bir predicate degil bir assertion''dir (kendi icinde raise exception yapar) -- tipki log_audit_event''in paylasilan yan-etki kalibi gibi. auth.uid() NULL => ML125; profiles satiri yok => ML126 (0022''nin bootstrap trigger''i altinda normalde imkansiz, savunma-derinligi); account_status <> ''active'' => ML127. Yalnizca MUTATION RPC''lerinden cagrilir -- hicbir RLS SELECT politikasi/okuma-yardimcisi fonksiyon bunu cagirmaz (gorev talimati: READ islemlerini otomatik olarak engelleme).';

-- Yalnizca ayni sahibin diger SECURITY DEFINER fonksiyonlarindan (owner-to-
-- owner) cagrilir -- is_offer_pending_action_blocked/log_audit_event ile AYNI
-- desen. Hicbir client'a (authenticated/anon/public) dogrudan EXECUTE grant
-- edilmez; PostgREST uzerinden bagimsiz bir RPC uc noktasi olarak asla
-- cagrilamaz.
revoke all on function public.assert_active_user() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Asagidaki 41 fonksiyon: gelistirme projesinin GERCEK CANLI tanimi (pg_dump),
-- yalnizca yukarida aciklanan tek satirlik ekleme ile. Alfabetik siraya,
-- pg_dump'in kendi cikti sirasiyla birebir aynidir.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."accept_offer"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
begin
  perform public.assert_active_user();
  -- DÜZELTME (0022, MLK-yok — bkz. bu dosyanın Bölüm 1 başlığı): "select o
  -- into v_offer from public.offers o where o.id = ..." yerine, v_offer'ı
  -- doğru dolduran "select * into v_offer ... where id = ...".
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester_id from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_offer.provider_id::text || ':accept_offer'));
  if public.has_reached_active_job_limit(v_offer.provider_id) then
    raise exception 'MLK65: provider has reached active job capacity' using errcode = 'MLK65';
  end if;

  -- GÜVENLİK: gerçek "job başına tek settled teklif" garantisi
  -- offers_one_settled_per_job partial unique index'idir (0005). Yukarıdaki
  -- is_offer_pending_action_blocked() kontrolü yalnızca ERKEN/dostça bir
  -- hata için vardır — iki farklı sağlayıcının aynı ilana eşzamanlı kabulü
  -- durumunda GERÇEK engel burada, unique_violation'ı yakalayarak sağlanır.
  begin
    update public.offers set status = 'accepted', accepted_at = now()
      where id = p_offer_id and status = 'pending'
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end;
  if v_offer is null then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;

  select * into v_job from public.jobs where id = v_offer.job_id;
  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'accepted', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_kabul_edildi', v_offer.job_id, p_offer_id, v_job.operation_id,
    null, 'Hizmet Alan teklifinizi kabul etti.', null);
  -- NOT: job_activity_events'e YAZILMIYOR — teklif olayları yalnız
  -- offer_status_history'de (bkz. 0010'un sadeleştirme kararı).

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."approve_facility_candidate"("p_candidate_id" "uuid", "p_name" "text", "p_province" "text", "p_district" "text", "p_types" "text"[]) RETURNS "public"."facility_candidates"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
  v_normalized text;
  v_sibling record;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if p_types is not null and not (p_types <@ array['LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI']::text[]) then
    raise exception 'ML111: invalid facility type' using errcode = 'ML111';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'ML112: facility name is required' using errcode = 'ML112';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  v_normalized := public.normalize_facility_text(p_name);

  -- Sibling-merge (bkz. dosya başlığı) — aynı ilde, onaylanan son ada
  -- benzerliği eşik (0.28) üstü olan diğer TÜM pending grupları bu gruba
  -- katlar. raw_entries FK''si CASCADE değil, bilinçli olarak UPDATE ile
  -- taşınıyor (tarihçe kaybolmasın), boş kalan pending satır sonra silinir.
  for v_sibling in
    select id from public.facility_candidates
    where id <> p_candidate_id
      and status = 'pending'
      and suggested_province = p_province
      and similarity(suggested_normalized_name, v_normalized) >= 0.28
  loop
    update public.facility_candidate_raw_entries set candidate_id = p_candidate_id where candidate_id = v_sibling.id;
    delete from public.facility_candidates where id = v_sibling.id;
  end loop;

  update public.facility_candidates
    set suggested_name = trim(p_name),
        suggested_normalized_name = v_normalized,
        suggested_province = p_province,
        suggested_district = nullif(trim(coalesce(p_district, '')), ''),
        suggested_types = coalesce(p_types, suggested_types),
        status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        rejection_reason = null,
        usage_count = (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id),
        confidence = case
          when (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id) >= 5 then 'high'
          when (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id) >= 2 then 'medium'
          else 'low'
        end
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('approve_facility_candidate', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."approve_job_as_admin"("p_job_id" "uuid", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


CREATE OR REPLACE FUNCTION "public"."authorize_provider_service"("p_provider_id" "uuid", "p_service_category_id" "text", "p_source_document_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."provider_service_authorizations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_service_authorizations;
  v_existing public.provider_service_authorizations;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if not exists (select 1 from public.service_categories where id = p_service_category_id) then
    raise exception 'MLK94: unknown service_category_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_service_authorizations.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.provider_documents where id = p_source_document_id and provider_id = p_provider_id
  ) then
    raise exception 'MLK76: source document not found for this provider' using errcode = 'MLK76';
  end if;

  select * into v_existing from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null;

  if v_existing is not null then
    update public.provider_service_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_service_authorizations
      (provider_id, service_category_id, authorized_by, source_document_id, authorize_reason)
    values
      (p_provider_id, p_service_category_id, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_authorized', null, null, null,
    'Hizmet Yetkiniz Onaylandı',
    (select name from public.service_categories where id = p_service_category_id) ||
      ' hizmetiniz onaylandı. Artık bu hizmete ait ilanları görüntüleyebilir ve teklif verebilirsiniz.',
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('authorize_provider_service', 'provider_service_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."close_job"("p_job_id" "uuid", "p_reason" "text") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."close_job_as_admin"("p_job_id" "uuid", "p_reason" "text") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK84: admin role required' using errcode = 'MLK84';
  end if;
  select * into v_job from public.jobs where id = p_job_id;
  if v_job is null then
    raise exception 'MLK76: job not found' using errcode = 'MLK76';
  end if;
  if v_job.closed_at is not null then
    raise exception 'MLK55: this job is already closed' using errcode = 'MLK55';
  end if;
  if public.is_job_closed_to_new_offers(p_job_id) then
    raise exception 'MLK55: this job has an in-progress or further offer and cannot be closed' using errcode = 'MLK55';
  end if;

  update public.jobs set closed_at = now(), closure_reason = coalesce(p_reason, 'diger') where id = p_job_id returning * into v_job;

  for v_offer in select * from public.offers where job_id = p_job_id and status = 'pending' loop
    update public.offers set status = 'rejected', rejected_at = now() where id = v_offer.id and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
        values (v_offer.id, 'pending', 'rejected', auth.uid(), 'admin_closed:' || coalesce(p_reason, 'diger'));
      perform public.create_notification(v_offer.provider_id, auth.uid(), 'ilan_kapatildi', p_job_id, v_offer.id, v_job.operation_id,
        'İlan Kapatıldı', public.get_job_closure_notification_message(p_reason), null);
    end if;
  end loop;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_closed', 'İlan yönetici tarafından kapatıldı', p_reason, null, 'requester_only');
  perform public.log_audit_event('close_job_as_admin', 'jobs', p_job_id, jsonb_build_object('closed_at', null), jsonb_build_object('closed_at', v_job.closed_at, 'reason', p_reason));
  return v_job;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."confirm_completion"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.completion_requested_by = auth.uid() then
    raise exception 'MLK69: cannot confirm your own completion request' using errcode = 'MLK69';
  end if;

  update public.offers set status = 'completed', completed_at = now()
    where id = p_offer_id and status = 'completion_requested'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not awaiting completion confirmation' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'completion_requested', 'completed', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'tamamlanma_onaylandi', v_offer.job_id, p_offer_id, null,
    null, 'Hizmet Alan işin tamamlandığını onayladı.', null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."create_job"("p_category_id" "text", "p_title" "text", "p_description" "text", "p_operation_details" "text", "p_province" "text", "p_district" "text", "p_work_location_type" "text", "p_work_date" "date", "p_photos" "jsonb", "p_facility_id" "text" DEFAULT NULL::"text", "p_location_mode" "text" DEFAULT 'catalog'::"text", "p_address_text" "text" DEFAULT ''::"text", "p_neighborhood" "text" DEFAULT NULL::"text", "p_location_url" "text" DEFAULT NULL::"text", "p_directions_note" "text" DEFAULT NULL::"text", "p_work_end_date" "date" DEFAULT NULL::"date", "p_product_quantity" integer DEFAULT NULL::integer, "p_product_tonnage" numeric DEFAULT NULL::numeric, "p_product_type" "text" DEFAULT NULL::"text", "p_customs_product_type" "text" DEFAULT NULL::"text", "p_client_id" "uuid" DEFAULT NULL::"uuid", "p_delivery_province" "text" DEFAULT NULL::"text", "p_delivery_district" "text" DEFAULT NULL::"text", "p_delivery_location_type" "text" DEFAULT NULL::"text", "p_delivery_facility_id" "text" DEFAULT NULL::"text", "p_delivery_facility_name" "text" DEFAULT NULL::"text", "p_delivery_address_text" "text" DEFAULT NULL::"text") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


CREATE OR REPLACE FUNCTION "public"."create_offer"("p_job_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_description" "text", "p_estimated_duration" integer DEFAULT NULL::integer) RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_latest_offer public.offers;
  v_offer public.offers;
  v_requires_estimated_duration boolean;
  v_estimated_duration integer;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."create_operation_with_jobs"("p_province" "text", "p_operation_details" "text", "p_services" "jsonb", "p_photos_by_service_index" "jsonb", "p_client_operation_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


CREATE OR REPLACE FUNCTION "public"."create_provider_document"("p_document_type" "text", "p_storage_path" "text", "p_original_file_name" "text", "p_mime_type" "text", "p_extension" "text", "p_size_bytes" bigint, "p_service_category_id" "text" DEFAULT NULL::"text") RETURNS "public"."provider_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_documents;
begin
  perform public.assert_active_user();
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to upload a document' using errcode = 'MLK93';
  end if;
  if p_document_type not in ('genel', 'gumruk-musaviri-izin-belgesi') then
    raise exception 'MLK94: invalid document_type' using errcode = 'MLK94';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;
  -- Görev bölüm 6/41: bir belge yalnızca ÇAĞIRANIN KENDİ seçtiği bir
  -- hizmetle ilişkilendirilebilir — başka bir provider'ın hizmetine ya da
  -- kataloğun kendisinde olmayan bir kategoriye sahte bağlama girişimini
  -- engeller.
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id)
  returning * into v_row;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."delete_job"("p_job_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."delete_job_as_admin"("p_job_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_offer record;
  v_updated integer;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK85: admin role required' using errcode = 'MLK85';
  end if;
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'MLK76: job not found' using errcode = 'MLK76';
  end if;

  update public.jobs set deleted_at = now() where id = p_job_id and deleted_at is null;

  for v_offer in select * from public.offers where job_id = p_job_id and status = 'pending' loop
    update public.offers set status = 'rejected', rejected_at = now() where id = v_offer.id and status = 'pending';
    get diagnostics v_updated = row_count;
    if v_updated > 0 then
      insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
        values (v_offer.id, 'pending', 'rejected', auth.uid(), 'admin_deleted:' || coalesce(p_reason, 'diger'));
      perform public.create_notification(v_offer.provider_id, auth.uid(), 'hizmet_kalemi_kaldirildi', p_job_id, v_offer.id, v_job.operation_id,
        'Hizmet Talebi Kaldırıldı', 'İlan sahibi ilgili hizmet talebini yayından kaldırdı.', null);
    end if;
  end loop;

  perform public.log_audit_event('delete_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('reason', p_reason));
end;
$$;


CREATE OR REPLACE FUNCTION "public"."delete_job_photo"("p_job_id" "uuid", "p_photo_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_removed_order integer;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."dispute_completion"("p_offer_id" "uuid", "p_note" "text") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  perform public.assert_active_user();
  if char_length(trim(p_note)) < 10 or char_length(trim(p_note)) > 1000 then
    raise exception 'MLK70: dispute note must be between 10 and 1000 characters' using errcode = 'MLK70';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.completion_requested_by = auth.uid() then
    raise exception 'MLK69: cannot dispute your own completion request' using errcode = 'MLK69';
  end if;

  update public.offers set status = 'completion_disputed', completion_dispute_note = trim(p_note)
    where id = p_offer_id and status = 'completion_requested'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not awaiting completion confirmation' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
    values (p_offer_id, 'completion_requested', 'completion_disputed', auth.uid(), trim(p_note));
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'tamamlanma_itiraz_edildi', v_offer.job_id, p_offer_id, null,
    null, 'Hizmet Alan, işin tamamlanma talebine itiraz etti. İtiraz açıklamasını kontrol edin.', null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."grant_provider_badge"("p_provider_id" "uuid", "p_badge_type_id" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."provider_badges"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_badges;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  -- record_provider_document_consent'in (0007) "invalid statement_id" ile AYNI
  -- kod: MLK94, farkli parametre ama ayni anlam ("gecersiz/bilinmeyen
  -- kategorik id").
  if not exists (select 1 from public.badge_types where id = p_badge_type_id) then
    raise exception 'MLK94: unknown badge_type_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_badges.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;

  begin
    insert into public.provider_badges (provider_id, badge_type_id, granted_by, grant_reason)
    values (p_provider_id, p_badge_type_id, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  exception when unique_violation then
    -- provider_badges_one_active_per_type ihlali (yukarıda) — create_provider_
    -- document'in (0024) MLK81'i ile AYNI kod (ayni "bu turden zaten aktif bir
    -- kayit var" durumu, farkli tablo).
    raise exception 'MLK81: this provider already has an active badge of this type' using errcode = 'MLK81';
  end;

  perform public.log_audit_event('grant_provider_badge', 'provider_badges', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'badge_type_id', p_badge_type_id));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."record_agreement_failure"("p_offer_id" "uuid", "p_reason" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  update public.offers set
    status = 'agreement_failed', agreement_failed_at = now(),
    disagreement_reason = p_reason,
    disagreement_note = case when p_reason = 'diger' then p_note else null end
  where id = p_offer_id and status = 'accepted'
  returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in an acceptable state' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
    values (p_offer_id, 'accepted', 'agreement_failed', auth.uid(), p_reason);
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'anlasma_saglanamadi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Teklifinizin kabul edildiği ilan için anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.', null);
  perform public.create_notification(v_job_requester_id, auth.uid(), 'ilan_yeniden_yayinda', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Anlaşma sağlanamadığı için ilanınız yeniden yayına alındı ve yeni teklifler almaya hazır.', null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."record_provider_document_consent"("p_statement_id" "text", "p_statement_version" "text") RETURNS "public"."provider_document_consents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_document_consents;
begin
  perform public.assert_active_user();
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to record a document consent' using errcode = 'MLK93';
  end if;
  if p_statement_id not in ('belge-dogruluk-beyani', 'gumruk-musaviri-belge-beyani') then
    raise exception 'MLK94: invalid statement_id' using errcode = 'MLK94';
  end if;
  if p_statement_version is null or char_length(trim(p_statement_version)) = 0 then
    raise exception 'MLK94: statement_version is required' using errcode = 'MLK94';
  end if;

  -- provider_id HER ZAMAN auth.uid() -- cagiran hicbir sekilde baska bir
  -- kullanici adina onay kaydi olusturamaz (parametre olarak alinmiyor).
  insert into public.provider_document_consents (provider_id, statement_id, statement_version)
  values (auth.uid(), p_statement_id, trim(p_statement_version))
  on conflict on constraint provider_document_consents_no_duplicate do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.provider_document_consents
      where provider_id = auth.uid() and statement_id = p_statement_id and statement_version = trim(p_statement_version);
  end if;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."reinstate_user"("p_user_id" "uuid") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_profile public.profiles;
  v_previous text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK82: admin role required' using errcode = 'MLK82';
  end if;
  select account_status into v_previous from public.profiles where id = p_user_id;
  if v_previous is null then
    raise exception 'MLK76: user not found' using errcode = 'MLK76';
  end if;
  update public.profiles set account_status = 'active' where id = p_user_id returning * into v_profile;
  perform public.log_audit_event('reinstate_user', 'profiles', p_user_id, jsonb_build_object('account_status', v_previous), jsonb_build_object('account_status', 'active'));
  return v_profile;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."reject_facility_candidate"("p_candidate_id" "uuid", "p_reason" "text") RETURNS "public"."facility_candidates"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML114: a reason is required to reject a facility candidate' using errcode = 'ML114';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  update public.facility_candidates
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = v_trimmed_reason
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('reject_facility_candidate', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."reject_job_as_admin"("p_job_id" "uuid", "p_reason" "text", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."reject_offer"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end if;

  update public.offers set status = 'rejected', rejected_at = now()
    where id = p_offer_id and status = 'pending'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'rejected', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_reddedildi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Hizmet Alan teklifinizi kabul etmedi.', null);
  -- NOT: job_activity_events'e YAZILMIYOR — teklif olayları yalnız
  -- offer_status_history'de (bkz. 0010'un sadeleştirme kararı).

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."republish_job"("p_job_id" "uuid", "p_work_date" "date", "p_work_end_date" "date", "p_photos" "jsonb") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_old public.jobs;
  v_new public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."request_completion"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id and provider_id = auth.uid();
  if v_offer is null then
    raise exception 'MLK56: not the provider of this offer' using errcode = 'MLK56';
  end if;

  update public.offers set status = 'completion_requested', completion_requested_by = auth.uid(), completion_requested_at = now()
    where id = p_offer_id and status = 'in_progress'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in progress' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'in_progress', 'completion_requested', auth.uid());
  perform public.create_notification(
    (select requester_id from public.jobs where id = v_offer.job_id), auth.uid(), 'tamamlanma_onayi_bekleniyor',
    v_offer.job_id, p_offer_id, (select operation_id from public.jobs where id = v_offer.job_id),
    null, 'Hizmet Veren işin tamamlandığını bildirdi. Lütfen işi kontrol ederek onaylayın veya itiraz edin.', null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."request_provider_document"("p_provider_id" "uuid", "p_service_category_id" "text", "p_message" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_category_name text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  select name into v_category_name from public.service_categories where id = p_service_category_id;
  if v_category_name is null then
    raise exception 'MLK94: unknown service_category_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_document_required', null, null, null,
    'Belge Yüklemeniz Gerekiyor',
    v_category_name || ' hizmeti için faaliyet belgenizi yüklemeniz gerekiyor.' ||
      case when nullif(trim(coalesce(p_message, '')), '') is not null then ' ' || trim(p_message) else '' end,
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('request_provider_document', 'profiles', p_provider_id,
    null, jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id));
end;
$$;


CREATE OR REPLACE FUNCTION "public"."resolve_completion_dispute"("p_offer_id" "uuid", "p_resolution" "text") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  perform public.assert_active_user();
  if p_resolution not in ('completed', 'cancelled') then
    -- DÜZELTME (önceki denetim C.9): önceki tasarımda bu MLK71'di ve
    -- 0016'daki review_provider_document()'ın "invalid review status"
    -- hatasıyla ÇAKIŞIYORDU. Şimdi MLK78 (bu dosyanın kendi aralığında,
    -- benzersiz) — 0022 bu davranışı DEĞİŞTİRMEDİ.
    raise exception 'MLK78: resolution must be completed or cancelled' using errcode = 'MLK78';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  if p_resolution = 'completed' then
    update public.offers set status = 'completed', completed_at = now() where id = p_offer_id and status = 'completion_disputed' returning * into v_offer;
  else
    update public.offers set status = 'cancelled', cancelled_at = now() where id = p_offer_id and status = 'completion_disputed' returning * into v_offer;
  end if;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in a disputed state' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'completion_disputed', p_resolution, auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(),
    case when p_resolution = 'completed' then 'tamamlanma_onaylandi' else 'is_iptal_edildi' end,
    v_offer.job_id, p_offer_id, null, null,
    case when p_resolution = 'completed' then 'Hizmet Alan işin tamamlandığını onayladı.' else 'Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı.' end,
    null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."review_contact_message"("p_id" "uuid", "p_status" "text", "p_admin_note" "text" DEFAULT NULL::"text") RETURNS "public"."contact_messages"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.contact_messages;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('yeni', 'inceleniyor', 'yanit-bekliyor', 'cozuldu', 'arsivlendi') then
    raise exception 'MLK99: invalid status' using errcode = 'MLK99';
  end if;

  select * into v_row from public.contact_messages where id = p_id;
  if v_row is null then
    raise exception 'MLK76: message not found' using errcode = 'MLK76';
  end if;

  -- p_admin_note NULL = mevcut notu koru; boş/dolu metin = notu güncelle
  -- (kaynağın `adminNote !== undefined ? ... : target.adminNote` deseninin
  -- en yakın SQL karşılığı — bkz. contact-messages.ts#reviewContactMessage).
  update public.contact_messages set
    status = p_status,
    admin_note = case when p_admin_note is null then admin_note else nullif(trim(p_admin_note), '') end,
    reviewed_by_admin_id = auth.uid()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."review_provider_document"("p_document_id" "uuid", "p_status" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "public"."provider_documents"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'MLK71: invalid review status' using errcode = 'MLK71';
  end if;
  if p_status in ('rejected', 'revision_requested') and v_trimmed_note is null then
    raise exception 'MLK75: a note is required for rejection or revision requests' using errcode = 'MLK75';
  end if;

  select * into v_document from public.provider_documents where id = p_document_id;
  if v_document is null then
    raise exception 'MLK76: document not found' using errcode = 'MLK76';
  end if;

  update public.provider_documents set
    current_review_status = p_status, current_review_note = v_trimmed_note,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_document_id
  returning * into v_document;

  insert into public.provider_document_reviews (document_id, provider_id, admin_id, action, note)
    values (p_document_id, v_document.provider_id, auth.uid(), p_status, v_trimmed_note);

  perform public.create_notification(
    v_document.provider_id, auth.uid(),
    case p_status when 'approved' then 'belge_onaylandi' when 'rejected' then 'belge_reddedildi' else 'belge_revizyon_istendi' end,
    null, null, null,
    case p_status when 'approved' then 'Belgeniz Onaylandı' when 'rejected' then 'Belgeniz Reddedildi' else 'Belge Güncellemesi Gerekiyor' end,
    coalesce('"' || v_document.original_file_name || '" belgeniz ' ||
      case p_status when 'approved' then 'onaylandı.' when 'rejected' then 'reddedildi: ' || v_trimmed_note else 'için yeniden yükleme isteniyor: ' || v_trimmed_note end,
      ''),
    null
  );

  perform public.log_audit_event('review_provider_document', 'provider_documents', p_document_id,
    jsonb_build_object('current_review_status', 'pending'),
    jsonb_build_object('current_review_status', p_status));

  -- 0041: belge onaylandığında, desteklediği hizmet(ler) için OTOMATİK
  -- olarak authorize_provider_service (0038) çağrılır — bu çağrı AYNI
  -- (zaten is_admin() doğrulanmış) admin oturumu bağlamında çalıştığı için
  -- authorize_provider_service'in kendi is_admin() kontrolü de doğal olarak
  -- geçer, ikinci bir yetki kontrolü İCAT EDİLMEDİ. BEST-EFFORT: bu blok
  -- başarısız olursa (ör. beklenmeyen veri durumu) yalnızca bir WARNING
  -- loglanır, asıl belge onayı (yukarıdaki tüm yazmalar) ASLA geri alınmaz.
  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      elsif v_document.document_type = 'gumruk-musaviri-izin-belgesi' then
        perform public.authorize_provider_service(
          v_document.provider_id, 'gumruk-musavirligi', p_document_id,
          'Gümrük Müşaviri İzin Belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      else
        -- Yalnızca service_category_id'siz ESKİ genel belgeler (yeni
        -- /panel/belge-yukleme akışı artık her zaman gönderir) — provider'ın
        -- o anda seçili gümrük-dışı TÜM kategorilerini yetkilendir (eski
        -- "tek genel belge = tüm seçili hizmetler" örtük varsayımı).
        for v_target_category_id in
          select service_category_id from public.provider_services
          where provider_id = v_document.provider_id and service_category_id <> 'gumruk-musavirligi'
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."revoke_provider_badge"("p_provider_id" "uuid", "p_badge_type_id" "text", "p_reason" "text" DEFAULT NULL::"text") RETURNS "public"."provider_badges"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_badges;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML107: a reason is required to revoke a badge' using errcode = 'ML107';
  end if;

  update public.provider_badges
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
    where provider_id = p_provider_id and badge_type_id = p_badge_type_id and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'ML105: no active badge of this type to revoke' using errcode = 'ML105';
  end if;

  perform public.log_audit_event('revoke_provider_badge', 'provider_badges', v_row.id,
    jsonb_build_object('revoked_at', null), jsonb_build_object('provider_id', p_provider_id, 'badge_type_id', p_badge_type_id));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."revoke_provider_service_authorization"("p_provider_id" "uuid", "p_service_category_id" "text", "p_reason" "text") RETURNS "public"."provider_service_authorizations"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_service_authorizations;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML107: a reason is required to revoke a service authorization' using errcode = 'ML107';
  end if;

  update public.provider_service_authorizations
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'ML105: no active service authorization of this type to revoke' using errcode = 'ML105';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_authorization_revoked', null, null, null,
    'Hizmet Yetkiniz Kaldırıldı',
    (select name from public.service_categories where id = p_service_category_id) || ' hizmeti erişiminiz durduruldu: ' || v_trimmed_reason,
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('revoke_provider_service_authorization', 'provider_service_authorizations', v_row.id,
    jsonb_build_object('revoked_at', null), jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id, 'reason', v_trimmed_reason));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."set_provider_profile_logo_path"("p_logo_path" "text") RETURNS "public"."provider_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_profiles;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK79: only hizmet-veren accounts may edit a provider profile' using errcode = 'MLK79';
  end if;

  insert into public.provider_profiles (user_id, logo_path)
  values (auth.uid(), p_logo_path)
  on conflict (user_id) do update set logo_path = excluded.logo_path
  returning * into v_row;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."set_provider_service_categories"("p_category_ids" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."start_work"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  update public.offers set status = 'in_progress', started_at = now()
    where id = p_offer_id and status = 'accepted'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in an acceptable state to start work' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'accepted', 'in_progress', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'is_basladi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Hizmet Alan, işin başladığını onayladı.', null);

  return v_offer;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."submit_rating"("p_offer_id" "uuid", "p_stars" integer, "p_comment" "text" DEFAULT NULL::"text") RETURNS "public"."ratings"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job_requester uuid;
  v_rating public.ratings;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may submit a rating' using errcode = 'MLK50';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'completed' then
    raise exception 'MLK73: only a completed offer can be rated' using errcode = 'MLK73';
  end if;
  if exists (select 1 from public.ratings where offer_id = p_offer_id) then
    raise exception 'MLK74: this offer has already been rated' using errcode = 'MLK74';
  end if;
  if v_offer.auto_completed and v_offer.updated_at + interval '30 days' < now() then
    raise exception 'MLK72: the rating window for this auto-completed offer has expired' using errcode = 'MLK72';
  end if;

  insert into public.ratings (offer_id, job_id, provider_id, rater_id, stars, comment)
  values (p_offer_id, v_offer.job_id, v_offer.provider_id, auth.uid(), p_stars, p_comment)
  returning * into v_rating;

  return v_rating;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."suspend_user"("p_user_id" "uuid", "p_reason" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_target public.profiles;
  v_profile public.profiles;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK82: admin role required' using errcode = 'MLK82';
  end if;
  select * into v_target from public.profiles where id = p_user_id;
  if v_target is null then
    raise exception 'MLK76: user not found' using errcode = 'MLK76';
  end if;

  -- YENİ (görev bölüm 3, "son admin korunmalı"): hedef, sistemdeki SON
  -- aktif (account_status='active', deleted_at is null) admin ise askıya
  -- alma reddedilir.
  if v_target.role = 'admin' and v_target.account_status = 'active' and not exists (
    select 1 from public.profiles
    where role = 'admin' and account_status = 'active' and deleted_at is null and id <> p_user_id
  ) then
    raise exception 'MLK91: cannot suspend the last active admin' using errcode = 'MLK91';
  end if;

  update public.profiles set account_status = 'suspended' where id = p_user_id returning * into v_profile;
  perform public.log_audit_event('suspend_user', 'profiles', p_user_id,
    jsonb_build_object('account_status', v_target.account_status), jsonb_build_object('account_status', 'suspended', 'reason', p_reason));
  return v_profile;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."update_facility_candidate_suggestion"("p_candidate_id" "uuid", "p_name" "text", "p_province" "text", "p_district" "text", "p_types" "text"[]) RETURNS "public"."facility_candidates"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if p_types is not null and not (p_types <@ array['LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI']::text[]) then
    raise exception 'ML111: invalid facility type' using errcode = 'ML111';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'ML112: facility name is required' using errcode = 'ML112';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  update public.facility_candidates
    set suggested_name = trim(p_name),
        suggested_normalized_name = public.normalize_facility_text(p_name),
        suggested_province = p_province,
        suggested_district = nullif(trim(coalesce(p_district, '')), ''),
        suggested_types = coalesce(p_types, suggested_types)
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('update_facility_candidate_suggestion', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."update_job"("p_job_id" "uuid", "p_title" "text", "p_description" "text", "p_operation_details" "text", "p_province" "text", "p_district" "text", "p_work_location_type" "text", "p_facility_id" "text", "p_location_mode" "text", "p_address_text" "text", "p_neighborhood" "text", "p_location_url" "text", "p_directions_note" "text", "p_work_date" "date", "p_work_end_date" "date", "p_kept_photo_ids" "uuid"[], "p_new_photos" "jsonb") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_job public.jobs;
  v_kept_count integer;
  v_new_count integer;
  v_order integer;
  v_photo jsonb;
begin
  perform public.assert_active_user();
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


CREATE OR REPLACE FUNCTION "public"."update_job_as_admin"("p_job_id" "uuid", "p_title" "text", "p_description" "text", "p_province" "text", "p_district" "text", "p_work_location_type" "text", "p_address_text" "text", "p_work_date" "date", "p_work_end_date" "date" DEFAULT NULL::"date", "p_product_quantity" integer DEFAULT NULL::integer, "p_product_tonnage" numeric DEFAULT NULL::numeric, "p_product_type" "text" DEFAULT NULL::"text", "p_customs_product_type" "text" DEFAULT NULL::"text", "p_delivery_facility_name" "text" DEFAULT NULL::"text", "p_delivery_address_text" "text" DEFAULT NULL::"text", "p_operation_details" "text" DEFAULT NULL::"text", "p_neighborhood" "text" DEFAULT NULL::"text", "p_location_url" "text" DEFAULT NULL::"text", "p_directions_note" "text" DEFAULT NULL::"text", "p_delivery_province" "text" DEFAULT NULL::"text", "p_delivery_district" "text" DEFAULT NULL::"text", "p_expected_updated_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  -- work_date her zaman doğrudan atanır — bunlar formun `isValid` kontrolüyle
  -- HER gönderimde zorunlu ve dolu, coalesce'e gerek yok (ve yanlışlıkla
  -- "asla temizlenemez" davranışı da İSTENMEZ, admin bunları gerçekten
  -- düzeltmek için buradadır). work_end_date de İSTEĞE BAĞLI ama formda HER
  -- ZAMAN görünür (kategoriye bağlı gizlenmez) — admin onu bilerek
  -- temizleyebilmeli, bu yüzden o da doğrudan atanır.
  --
  -- Aşağıdaki TÜMÜ ise hem opsiyonel HEM DE kategoriye/moda göre formda
  -- KOŞULLU görünür (bu tam olarak tonaj bug'ının sınıfı) — bu yüzden HEPSİ
  -- `coalesce(p_x, x)` ile GÜVENLİ birleştirilir: form bu alanı hiç
  -- göstermediyse (p_x = null gelir) mevcut değer AYNEN korunur; form
  -- gösterip admin gerçekten yeni bir değer girdiyse o değer yazılır. Bilinen
  -- ve kabul edilen sınır: bu semantikle admin, DOLU bir opsiyonel alanı
  -- tamamen BOŞA döndüremez (yalnızca BAŞKA bir değerle değiştirebilir) —
  -- görev bölüm 5'in "hiçbir koşulda kaybolmamalı" gereksinimini KESİN
  -- garanti etmek için kasıtlı bir ödünleşim (bkz. proje raporu §E).
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
    delivery_district = coalesce(p_delivery_district, delivery_district)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."update_profile_as_admin"("p_user_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_company_name" "text", "p_company_type" "text", "p_province" "text", "p_district" "text") RETURNS "public"."profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_old public.profiles;
  v_new public.profiles;
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_company_name text := trim(coalesce(p_company_name, ''));
  v_province text := trim(coalesce(p_province, ''));
  v_district text := trim(coalesce(p_district, ''));
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML119: admin role required' using errcode = 'ML119';
  end if;

  select * into v_old from public.profiles where id = p_user_id and deleted_at is null;
  if v_old is null then
    raise exception 'ML120: profile not found' using errcode = 'ML120';
  end if;

  if v_full_name = '' then
    raise exception 'ML102: full name is required' using errcode = 'ML102';
  end if;
  if p_phone is not null and p_phone !~ '^\+905\d{9}$' then
    raise exception 'ML121: phone must be in +905XXXXXXXXX format' using errcode = 'ML121';
  end if;
  if p_company_type is not null and p_company_type not in ('bireysel', 'sahis-isletmesi', 'limited-sirket', 'anonim-sirket', 'diger') then
    raise exception 'ML123: invalid company type' using errcode = 'ML123';
  end if;
  if v_company_name = '' or v_province = '' or v_district = '' then
    raise exception 'ML102: company name, province and district are required' using errcode = 'ML102';
  end if;
  if char_length(v_company_name) > 150 then
    raise exception 'ML122: company name must be at most 150 characters' using errcode = 'ML122';
  end if;

  update public.profiles set
    full_name = v_full_name,
    phone = p_phone,
    company_name = v_company_name,
    company_type = p_company_type,
    province = v_province,
    district = v_district
  where id = p_user_id
  returning * into v_new;

  perform public.log_audit_event('update_profile_as_admin', 'profiles', p_user_id,
    jsonb_build_object('full_name', v_old.full_name, 'company_name', v_old.company_name, 'company_type', v_old.company_type, 'province', v_old.province, 'district', v_old.district, 'phone_changed', v_old.phone is distinct from p_phone),
    jsonb_build_object('full_name', v_new.full_name, 'company_name', v_new.company_name, 'company_type', v_new.company_type, 'province', v_new.province, 'district', v_new.district, 'phone_changed', v_old.phone is distinct from p_phone));

  return v_new;
end;
$_$;


ALTER FUNCTION "public"."update_profile_as_admin"("p_user_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_company_name" "text", "p_company_type" "text", "p_province" "text", "p_district" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_profile_as_admin"("p_user_id" "uuid", "p_full_name" "text", "p_phone" "text", "p_company_name" "text", "p_company_type" "text", "p_province" "text", "p_district" "text") IS 'Admin-only — profiles_update_own RLS politikası (id = auth.uid()) admin dahil kimsenin başka bir satırı doğrudan UPDATE etmesine izin vermez; bu SECURITY DEFINER RPC o sınırı, is_admin() kendi kontrolüyle, KASITLI olarak aşar. role/account_status/onboarding_completed/email bu fonksiyonun kapsamı DIŞINDADIR (suspend_user/reinstate_user ve Supabase Auth''un kendi yönetim alanı).';



CREATE OR REPLACE FUNCTION "public"."upsert_provider_profile"("p_bio" "text", "p_founded_year" integer, "p_experience_range" "text", "p_regions" "text"[], "p_service_features" "text"[]) RETURNS "public"."provider_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_profiles;
begin
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK79: only hizmet-veren accounts may edit a provider profile' using errcode = 'MLK79';
  end if;

  insert into public.provider_profiles (user_id, bio, founded_year, experience_range, regions, service_features)
  values (auth.uid(), p_bio, p_founded_year, p_experience_range, coalesce(p_regions, '{}'), coalesce(p_service_features, '{}'))
  on conflict (user_id) do update set
    bio = excluded.bio,
    founded_year = excluded.founded_year,
    experience_range = excluded.experience_range,
    regions = excluded.regions,
    service_features = excluded.service_features
  returning * into v_row;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."upsert_provider_profile"("p_bio" "text", "p_founded_year" integer, "p_experience_range" "text", "p_regions" "text"[], "p_service_features" "text"[]) RETURNS "public"."provider_profiles"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.provider_profiles;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK79: only hizmet-veren accounts may edit a provider profile' using errcode = 'MLK79';
  end if;

  insert into public.provider_profiles (user_id, bio, founded_year, experience_range, regions, service_features)
  values (auth.uid(), p_bio, p_founded_year, p_experience_range, coalesce(p_regions, '{}'), coalesce(p_service_features, '{}'))
  on conflict (user_id) do update set
    bio = excluded.bio,
    founded_year = excluded.founded_year,
    experience_range = excluded.experience_range,
    regions = excluded.regions,
    service_features = excluded.service_features
  returning * into v_row;

  return v_row;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."withdraw_offer"("p_offer_id" "uuid") RETURNS "public"."offers"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_offer public.offers;
  v_job public.jobs;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id and provider_id = auth.uid();
  if v_offer is null then
    raise exception 'MLK56: not the provider of this offer' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer can no longer be withdrawn' using errcode = 'MLK68';
  end if;

  update public.offers set status = 'withdrawn', withdrawn_at = now()
    where id = p_offer_id returning * into v_offer;
  select * into v_job from public.jobs where id = v_offer.job_id;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'withdrawn', auth.uid());
  perform public.create_notification(v_job.requester_id, auth.uid(), 'teklif_geri_cekildi', v_offer.job_id, p_offer_id, v_job.operation_id,
    'Bir teklif geri çekildi', 'Bir hizmet veren "' || v_job.title || '" ilanına verdiği teklifi geri çekti.', null);

  return v_offer;
end;
$$;
-- =============================================================================
-- Not: yukaridaki 41 fonksiyonun HICBIRINDE grant/revoke satiri YOK -- "create
-- or replace function" ayni imzayla cagrildiginda Postgres mevcut ACL'yi
-- (GRANT'leri) ve sahipligi OLDUGU GIBI korur; bu migration'da hicbir
-- fonksiyonun grant'i degismiyor, yalnizca govdesi (tek satir eklenerek).
-- =============================================================================
