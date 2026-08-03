-- =============================================================================
-- MALSEVK — Faz 1 migration 0016: notification/activity helpers,
--                                    review_provider_document,
--                                    mark_notification_read, dismiss_notification,
--                                    record_job_viewed, get_offer_provider_display,
--                                    minimal admin RPC'leri
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- Bu dosya önceki tasarımın 0020_rpc_document_and_notification_functions.sql
-- + 0021_rpc_admin_and_subscription_functions.sql'inin İLGİLİ KISIMLARINI
-- BİRLEŞTİRİR:
--   * 0020'nin TAMAMI (document/notification RPC'leri) — değişikliklerle:
--     - append_job_activity_event() artık 8 parametreli (p_offer_id
--       kaldırıldı — bkz. 0010'daki job_activity_events sadeleştirmesi).
--     - mark_notification_read()/dismiss_notification() artık
--       notification_states yerine notifications.read_at/dismissed_at'i
--       doğrudan günceller (bkz. 0009'daki birleştirme kararı).
--     - GÜVENLİK DÜZELTMESİ (önceki denetim C.8, Orta): get_offer_provider_
--       display()'in reveal koşulu artık 'completed' durumunu da içeriyor —
--       kaynak fonksiyon (isOfferProviderIdentityRevealed) yalnızca "Gelen
--       Teklifler" bağlamında çağrıldığı için 'completed' hiç görmüyordu
--       (o ekrandan zaten filtreleniyor); bu RPC GENEL bir görüntüleme
--       fonksiyonu olduğu için, tamamlanmış bir iş ekranında kullanılırsa
--       kimliği yanlışlıkla anonimleştirmemesi gerekir (puanlama modalı
--       kimliği tamamlanan işlerde HER ZAMAN doğrudan gösterir, bkz.
--       CLAUDE.md).
--   * 0021'in YALNIZ Faz 1'in "Minimum admin erişimi" listesine giren 4
--     fonksiyonu — is_admin()'e (has_admin_permission() değil) uyarlanmış:
--     close_job_as_admin, delete_job_as_admin, suspend_user, reinstate_user.
--     - GÜVENLİK DÜZELTMESİ (önceki denetim C.1 deseni): close_job_as_admin
--       artık compare-and-set (AND status='pending') kullanıyor.
--     - GÜVENLİK DÜZELTMESİ (önceki denetim C.7): close_job_as_admin artık
--       is_job_closed_to_new_offers() kontrolü yapıyor (sahibin close_job()'u
--       ile aynı kural).
--     - GÜVENLİK DÜZELTMESİ (önceki denetim C.6): delete_job_as_admin artık
--       still-pending teklifleri rejected'a çevirip bildirim üretiyor
--       (kaynak uygulamanın deleteJobWithOffers'ı ile aynı desen).
--     - YENİ: suspend_user, son AKTİF admin'i askıya almayı reddeder (görev
--       bölüm 3, "son admin korunmalı").
--     grant_admin_role/revoke_admin_role/verify_provider (admin_user_roles'a
--     bağımlı Layer 2 fonksiyonları) ve assign_subscription_plan/
--     cancel_subscription/grant_user_limit_override/update_subscription_
--     plan_limit (abonelik tablolarına bağımlı) Faz 2'ye taşındı — bkz.
--     docs/database/future-migrations/phase2/.
--
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 8 - KRITIK):
-- create_notification()/append_job_activity_event() artik `authenticated`e
-- DOGRUDAN grant edilmiyor -- log_audit_event() (0012) ile AYNI desen,
-- yalniz ayni sahibin diger SECURITY DEFINER fonksiyonlari icinden
-- cagrilabilirler. Bkz. asagidaki iki fonksiyonun kendi notlari.
--
-- Hata kodu aralığı: MLK71, MLK75-77 (0020'den, değişmedi), MLK82, MLK84-85,
-- MLK91 (yeni — son admin koruması).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_notification — the ONLY INSERT path into notifications
-- -----------------------------------------------------------------------------
create or replace function public.create_notification(
  p_recipient_id uuid, p_actor_id uuid, p_type text,
  p_job_id uuid, p_offer_id uuid, p_operation_id uuid,
  p_title text, p_message text, p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_key text;
begin
  v_event_key := p_type || ':' || coalesce(p_offer_id::text, p_job_id::text, p_operation_id::text, gen_random_uuid()::text);
  begin
    insert into public.notifications (recipient_id, actor_id, type, job_id, offer_id, operation_id, title, message, metadata, event_key)
    values (p_recipient_id, p_actor_id, p_type, p_job_id, p_offer_id, p_operation_id, p_title, p_message, p_metadata, v_event_key)
    on conflict (recipient_id, event_key) do nothing;
  exception when others then
    raise warning 'create_notification failed for recipient % type %: %', p_recipient_id, p_type, sqlerrm;
  end;
end;
$$;

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 8 - KRITIK):
-- onceki taslak bunu DOGRUDAN `authenticated`e grant ediyordu, ic govdede
-- HICBIR yetki/sahiplik kontrolu olmadan -- herhangi bir authenticated
-- kullanici, PostgREST uzerinden bunu dogrudan cagirip keyfi bir
-- recipient_id/type/message ile baska bir kullanicinin bildirim akisina
-- kayit ekleyebilirdi. Gercek her cagiran zaten baska bir SECURITY DEFINER
-- RPC'nin (create_offer, accept_offer, close_job, ...) GOVDESINDEN
-- `perform` ile cagiriyor -- bu, log_audit_event() (0012) ile AYNI desen:
-- ayni sahibin fonksiyonlari birbirini cagirmak icin ayrica bir client
-- grant'ina ihtiyac duymaz. Client'a hicbir dogrudan grant YOK.
revoke all on function public.create_notification(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- append_job_activity_event — the ONLY INSERT path into job_activity_events
-- -----------------------------------------------------------------------------
-- 8 parametre (p_offer_id KALDIRILDI — bkz. 0010'daki sadeleştirme).
create or replace function public.append_job_activity_event(
  p_job_id uuid, p_operation_id uuid, p_actor_id uuid,
  p_event_type text, p_title text, p_description text, p_metadata jsonb, p_visibility text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.job_activity_events (job_id, operation_id, actor_id, event_type, title, description, metadata, visibility)
    values (p_job_id, p_operation_id, p_actor_id, p_event_type, p_title, p_description, p_metadata, p_visibility);
  exception when others then
    raise warning 'append_job_activity_event failed for job % type %: %', p_job_id, p_event_type, sqlerrm;
  end;
end;
$$;

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 8 - KRITIK):
-- create_notification() ile AYNI gerekce/duzeltme -- bkz. yukaridaki not.
revoke all on function public.append_job_activity_event(uuid, uuid, uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- review_provider_document
-- -----------------------------------------------------------------------------
create or replace function public.review_provider_document(p_document_id uuid, p_status text, p_note text default null)
returns public.provider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
begin
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

  return v_document;
end;
$$;

revoke all on function public.review_provider_document(uuid, text, text) from public, anon;
grant execute on function public.review_provider_document(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- mark_notification_read / dismiss_notification
-- -----------------------------------------------------------------------------
-- notification_states YOK (bkz. 0009) — read_at/dismissed_at doğrudan
-- notifications üzerinde. "İlk okuma" semantiği korunuyor: yalnız hâlâ
-- read_at IS NULL ise güncellenir (ikinci bir mark-read çağrısı ilk gerçek
-- okuma zamanını ezmez).
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
    set read_at = now()
    where id = p_notification_id and recipient_id = auth.uid() and read_at is null;
  if not found and not exists (
    select 1 from public.notifications where id = p_notification_id and recipient_id = auth.uid()
  ) then
    raise exception 'MLK77: notification not found for this recipient' using errcode = 'MLK77';
  end if;
end;
$$;

create or replace function public.dismiss_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
    set dismissed_at = now()
    where id = p_notification_id and recipient_id = auth.uid() and dismissed_at is null;
  if not found and not exists (
    select 1 from public.notifications where id = p_notification_id and recipient_id = auth.uid()
  ) then
    raise exception 'MLK77: notification not found for this recipient' using errcode = 'MLK77';
  end if;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.dismiss_notification(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.dismiss_notification(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- record_job_viewed
-- -----------------------------------------------------------------------------
create or replace function public.record_job_viewed(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.recently_viewed_jobs (user_id, job_id, viewed_at)
  values (auth.uid(), p_job_id, now())
  on conflict (user_id, job_id) do update set viewed_at = excluded.viewed_at;
end;
$$;

revoke all on function public.record_job_viewed(uuid) from public, anon;
grant execute on function public.record_job_viewed(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- get_offer_provider_display — the identity-reveal-aware read path
-- -----------------------------------------------------------------------------
create or replace function public.get_offer_provider_display(p_offer_id uuid)
returns table (revealed boolean, display_name text, logo_path text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_is_revealed boolean;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  if v_offer is null then
    raise exception 'MLK76: offer not found' using errcode = 'MLK76';
  end if;
  if not (public.is_job_owner(v_offer.job_id) or v_offer.provider_id = auth.uid() or public.is_admin()) then
    raise exception 'MLK56: not authorized to view this offer''s provider display' using errcode = 'MLK56';
  end if;

  -- GÜVENLİK DÜZELTMESİ (önceki denetim C.8, Orta): 'completed' de dahil —
  -- bkz. dosya başlığı.
  v_is_revealed := public.is_engaged_offer_status(v_offer.status) or v_offer.status = 'completed';

  if v_is_revealed or auth.uid() = v_offer.provider_id or public.is_admin() then
    return query
      select true, coalesce(p.company_name, p.full_name, 'Hizmet Veren'), pp.logo_path
      from public.profiles p
      left join public.provider_profiles pp on pp.user_id = p.id
      where p.id = v_offer.provider_id;
  else
    return query
      select false,
        'Hizmet Veren #' || lpad((abs(hashtext(v_offer.provider_id::text)) % 10000)::text, 4, '0'),
        null::text;
  end if;
end;
$$;

revoke all on function public.get_offer_provider_display(uuid) from public, anon;
grant execute on function public.get_offer_provider_display(uuid) to authenticated;

-- =============================================================================
-- Faz 1 minimum admin RPC'leri (görev bölüm 3) — is_admin() (Layer 1) ile
-- kapılı. Faz 2'nin has_admin_permission(code) (Layer 2) katmanı devreye
-- girdiğinde bu fonksiyonlar Layer-2-gated versiyonlarla DEĞİŞTİRİLİR
-- (CREATE OR REPLACE), imza değişmez — bkz. docs/database/future-migrations/
-- MANIFEST.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- close_job_as_admin — owner-only close_job()'dan (0014) BAĞIMSIZ, admin
-- moderasyon yolu.
-- -----------------------------------------------------------------------------
create or replace function public.close_job_as_admin(p_job_id uuid, p_reason text)
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

comment on function public.close_job_as_admin(uuid, text) is
  'GÜVENLİK DÜZELTMELERİ (önceki denetim C.1 deseni ve C.7): compare-and-set + is_job_closed_to_new_offers kontrolü eklendi — sahibin close_job()''u (0014) ile artık tutarlı.';

-- -----------------------------------------------------------------------------
-- delete_job_as_admin — soft-delete, GÜVENLİK DÜZELTMESİ (C.6): teklifleri
-- artık ele alıyor.
-- -----------------------------------------------------------------------------
create or replace function public.delete_job_as_admin(p_job_id uuid, p_reason text)
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

comment on function public.delete_job_as_admin(uuid, text) is
  'GÜVENLİK DÜZELTMESİ (önceki denetim C.6, Orta): önceki tasarım yalnızca deleted_at''i işaretliyordu, tekliflere hiç dokunmuyordu — bir sağlayıcının pending teklifi artık görünmeyen bir iş üzerinde sonsuza dek pending kalabiliyordu. Şimdi close_job() ile aynı desen (kaynak uygulamanın deleteJobWithOffers''ı ile birebir).';

revoke all on function public.close_job_as_admin(uuid, text) from public, anon;
revoke all on function public.delete_job_as_admin(uuid, text) from public, anon;
grant execute on function public.close_job_as_admin(uuid, text) to authenticated;
grant execute on function public.delete_job_as_admin(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- suspend_user / reinstate_user — GÜVENLİK: son AKTİF admin korunur.
-- -----------------------------------------------------------------------------
create or replace function public.suspend_user(p_user_id uuid, p_reason text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles;
  v_profile public.profiles;
begin
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

create or replace function public.reinstate_user(p_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_previous text;
begin
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

comment on function public.suspend_user(uuid, text) is
  'account_status alone does not block an already-issued Supabase Auth session/JWT from authenticating, ve bugün hiçbir Faz 1 RLS/RPC''si bunu okumuyor (create_job/create_offer/vb. suspend edilmiş bir kullanıcıyı engellemiyor) — bu, önceki denetim raporunun Açık Karar #4/#5''i, bu göçte ÇÖZÜLMÜYOR, yalnızca bayrak+RPC taşınıyor. Son AKTİF admin''in askıya alınması engellenir (yukarı bkz.) — bu, "son admin korunmalı" gereksinimidir.';

revoke all on function public.suspend_user(uuid, text) from public, anon;
revoke all on function public.reinstate_user(uuid) from public, anon;
grant execute on function public.suspend_user(uuid, text) to authenticated;
grant execute on function public.reinstate_user(uuid) to authenticated;
