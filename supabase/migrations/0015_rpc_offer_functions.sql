-- =============================================================================
-- MALSEVK — Faz 1 migration 0015: offer lifecycle RPC functions + submit_rating
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DEĞİŞİKLİKLER (önceki tasarımın 0019_rpc_offer_functions.sql'ine göre):
--   * GÜVENLİK DÜZELTMESİ (önceki denetim B.1, KRİTİK): accept_offer()
--     artık offers_one_settled_per_job partial unique index'inin (0005)
--     unique_violation'ını YAKALAYIP MLK67'ye çeviriyor. Önceki tasarım
--     yalnızca is_offer_pending_action_blocked()'ın (TOCTOU'ya açık, kilit
--     ALINMADAN ÖNCE okunan bir MVCC anlık görüntüsü) ön-kontrolüne
--     güveniyordu — bu, İKİ FARKLI sağlayıcının aynı ilandaki tekliflerinin
--     EŞZAMANLI kabulünü DB seviyesinde ENGELLEMİYORDU (advisory lock
--     provider_id üzerindeydi, job_id üzerinde değil). Şimdi gerçek koruma
--     0005'teki unique index'tir; bu dosyadaki ön-kontrol yalnızca ERKEN,
--     DAHA DOSTÇA bir hata mesajı için kalmıştır.
--   * Günlük teklif kotası (MLK66, get_effective_limit('daily_offer_limit'))
--     TAMAMEN KALDIRILDI — doğrulanmış bugünkü davranışta HİÇBİR günlük kota
--     yok (app/_lib/offers.ts#createOffer'da böyle bir kontrol yok). Bu bir
--     "sabit değer verme" değil, mevcut davranışın BİREBİR korunmasıdır
--     (görev bölüm 4: "Teklif kotası: mevcut uygulamanın bugün uyguladığı
--     davranış" = sınırsız). Faz 2'nin abonelik sistemi devreye girdiğinde bu
--     kontrol create_offer()'a GERİ EKLENİR (bkz. docs/database/
--     future-migrations/MANIFEST.md) — bugün eklemek, olmayan bir özelliği
--     icat etmek olurdu.
--   * DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 2 -
--     KRITIK): create_offer()'in estimated_duration parametresi text'ten
--     nullable integer'a (1-60) degisti, yalniz Nakliye kategorisinde
--     zorunlu/kaydediliyor -- bkz. bu dosyadaki create_offer()'in kendi
--     basligi. Bosalan MLK66 kodu (yukaridaki madde) bu yeni dogrulama icin
--     YENIDEN KULLANILDI (yeni bir kod TAHSIS ETMEK yerine).
--   * has_reached_active_job_limit() artık get_effective_limit() yerine
--     get_active_job_limit()'i (0012, sabit 5) kullanıyor — davranış
--     değişmedi, yalnızca abonelik tablosuna bağımlılık kaldırıldı.
--   * MLK71 çakışması düzeltildi (önceki denetim C.9): resolve_completion_
--     dispute()'un "invalid resolution" hatası artık MLK78 (0016'daki
--     review_provider_document()'ın MLK71'i ile çakışmıyor).
--   * DUZELTME (yerel dry-run, gercek CREATE FUNCTION hatasi): accept_offer/
--     reject_offer/start_work/record_agreement_failure/confirm_completion/
--     dispute_completion/resolve_completion_dispute/submit_rating'in hepsinde
--     "select o[.*], j.diger_kolon into v_offer[, v_diger]" kalibi vardi --
--     yani v_offer (satir/record tipli degisken, public.offers) BASKA bir
--     hedefle AYNI INTO listesinde. plpgsql'in kendi kurali kesin: bir
--     record/row degisken bir INTO listesinde ANCAK TEK BASINA yer alabilir;
--     "o.*"yi cIplak "o"ya cevirmek YETMEDI (ilk denemede oyle sanildi) --
--     hata kaynagi ifadenin SELECT tarafinda degil, INTO hedef listesinin
--     KENDISINDE. confirm_completion'da bu, plpgsql derleyicisinin "record
--     variable cannot be part of multiple-item INTO list" (SQLSTATE 42601)
--     hatasiyla supabase db reset'i GERCEKTEN durdurdu -- statik analiz
--     bunu yakalayamazdi. Digerlerinde (tek INTO hedefi, v_offer public.
--     offers olarak sabit tipli, ama select listesi o.* + ekstra kolon(lar)
--     iceriyordu) ayni temel sorun CREATE zamaninda hata vermiyordu ama
--     calisma zamaninda kolon-sayisi uyusmazligina yol acardi, ustelik
--     reject_offer/start_work/record_agreement_failure'da o ekstra deger
--     "returning * into v_offer" ile v_offer'in UZERINE YAZILDIKTAN SONRA
--     tekrar okunuyordu (sessizce kaybolurdu). GERCEK duzeltme: v_offer'i
--     TEK BASINA dolduran bir "select o into v_offer ... where o.id = ..."
--     + hemen ardindan v_offer.job_id'yi kullanan AYRI bir "select ...
--     into v_job_requester_id[, v_job_operation_id] from public.jobs ...".
--
-- Hata kodu aralığı: MLK60-69, MLK72-74, MLK78 (bu dosya; MLK70-71/75-77
-- 0016'da).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_offer
--
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 2 - KRITIK):
-- p_estimated_duration artik `text` degil, nullable bir `integer` (1-60) --
-- bkz. 0005_offers_and_status_history.sql'in basligindaki ayni ad altindaki
-- not. Yalnizca Nakliye kategorisindeki (category_id = 'nakliye')
-- ilanlarda zorunlu/kaydedilir; MLK66 (eskiden gunluk teklif kotasi icin
-- kullaniliyordu, o kontrol TAMAMEN KALDIRILMISTI -- bkz. asagidaki not --
-- bu yuzden kod bu dosyanin kendi MLK60-69 araliginda YENIDEN KULLANILIYOR,
-- yeni bir aralik disi kod eklemek yerine).
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
  if v_job is null or not public.provider_can_view_category(auth.uid(), v_job.category_id) then
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
  -- NOT: job_activity_events'e YAZILMIYOR — 0010'daki sadeleştirme kararı
  -- gereği teklif olayları yalnızca offer_status_history'de tutulur (bkz.
  -- 0010_job_activity_and_audit.sql'in dosya başlığı, "tekrar önleme").

  return v_offer;
end;
$$;

-- NOT: parametre imzasi (uuid, numeric, text, text, integer) -- son
-- parametrenin tipi text'ten integer'a degisti (bkz. yukaridaki DUZELTME).
-- Bu migration seti HENUZ hicbir Supabase projesine uygulanmadigi icin
-- (dogrulanmis) bu, gercek bir "eski text-parametreli asiri yukleme kalir"
-- riski TASIMAZ; yalniz gelecekte bu dosya GERCEK bir veritabanina
-- uygulandiktan SONRA tekrar degistirilirse, CREATE OR REPLACE FUNCTION
-- imza degisikligini bir REPLACE olarak degil YENI bir asiri yukleme olarak
-- ele alacagi icin eski imzanin ayrica DROP FUNCTION ile kaldirilmasi
-- gerekecegi not edilir.
revoke all on function public.create_offer(uuid, numeric, text, text, integer) from public, anon;
grant execute on function public.create_offer(uuid, numeric, text, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- accept_offer / reject_offer
-- -----------------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
begin
  -- NOT: v_offer bir satir (record) tipli degisken oldugu icin plpgsql'in
  -- INTO listesinde TEK BASINA olmasi gerekir -- "select o, j.x into
  -- v_offer, v_baska_degisken" gibi bir satir-degisken + skaler karisimi
  -- CREATE zamaninda "record variable cannot be part of multiple-item INTO
  -- list" (SQLSTATE 42601) hatasi verir (bkz. bu dosyanin basligindaki yerel
  -- dry-run notu). Bu yuzden asagida iki ayri select var.
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

comment on function public.accept_offer(uuid) is
  'GÜVENLİK DÜZELTMESİ (önceki denetim B.1, KRİTİK): unique_violation yakalama eklendi. Bkz. 0005_offers_and_status_history.sql''deki offers_one_settled_per_job index yorumu.';

create or replace function public.reject_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

revoke all on function public.accept_offer(uuid) from public, anon;
revoke all on function public.reject_offer(uuid) from public, anon;
grant execute on function public.accept_offer(uuid) to authenticated;
grant execute on function public.reject_offer(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- withdraw_offer
-- -----------------------------------------------------------------------------
create or replace function public.withdraw_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
begin
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

revoke all on function public.withdraw_offer(uuid) from public, anon;
grant execute on function public.withdraw_offer(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- start_work
-- -----------------------------------------------------------------------------
create or replace function public.start_work(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

revoke all on function public.start_work(uuid) from public, anon;
grant execute on function public.start_work(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- record_agreement_failure
-- -----------------------------------------------------------------------------
create or replace function public.record_agreement_failure(p_offer_id uuid, p_reason text, p_note text default null)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

revoke all on function public.record_agreement_failure(uuid, text, text) from public, anon;
grant execute on function public.record_agreement_failure(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- request_completion / confirm_completion / dispute_completion /
-- resolve_completion_dispute
-- -----------------------------------------------------------------------------
create or replace function public.request_completion(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
begin
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

create or replace function public.confirm_completion(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

create or replace function public.dispute_completion(p_offer_id uuid, p_note text)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  if char_length(trim(p_note)) < 10 or char_length(trim(p_note)) > 1000 then
    raise exception 'MLK70: dispute note must be between 10 and 1000 characters' using errcode = 'MLK70';
  end if;
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

create or replace function public.resolve_completion_dispute(p_offer_id uuid, p_resolution text)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  if p_resolution not in ('completed', 'cancelled') then
    -- DÜZELTME (önceki denetim C.9): önceki tasarımda bu MLK71'di ve
    -- 0020_rpc_document_and_notification_functions.sql'deki
    -- review_provider_document()'ın "invalid review status" hatasıyla
    -- ÇAKIŞIYORDU (dosyanın kendi ilan ettiği MLK60-69 aralığının dışına
    -- taşıyordu). Şimdi MLK78 (bu dosyanın kendi aralığında, benzersiz).
    raise exception 'MLK78: resolution must be completed or cancelled' using errcode = 'MLK78';
  end if;
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

revoke all on function public.request_completion(uuid) from public, anon;
revoke all on function public.confirm_completion(uuid) from public, anon;
revoke all on function public.dispute_completion(uuid, text) from public, anon;
revoke all on function public.resolve_completion_dispute(uuid, text) from public, anon;
grant execute on function public.request_completion(uuid) to authenticated;
grant execute on function public.confirm_completion(uuid) to authenticated;
grant execute on function public.dispute_completion(uuid, text) to authenticated;
grant execute on function public.resolve_completion_dispute(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- submit_rating
-- -----------------------------------------------------------------------------
create or replace function public.submit_rating(p_offer_id uuid, p_stars integer, p_comment text default null)
returns public.ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
  v_rating public.ratings;
begin
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may submit a rating' using errcode = 'MLK50';
  end if;
  select o into v_offer from public.offers o where o.id = p_offer_id;
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

revoke all on function public.submit_rating(uuid, integer, text) from public, anon;
grant execute on function public.submit_rating(uuid, integer, text) to authenticated;
