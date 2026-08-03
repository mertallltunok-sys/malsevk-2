-- =============================================================================
-- MALSEVK — Faz 1 migration 0018: scheduled jobs
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. Mantık önceki tasarımın
-- 0023_scheduled_jobs.sql'i ile aynıdır (notification_states/job_
-- activity_events sadeleştirmeleri bu dosyanın hiçbir sweep'ini etkilemedi).
-- pg_cron kayıt ifadeleri gerçek, çalıştırılabilir sözdizimidir ama bu tüm
-- migrasyon seti gerçekten uygulanana kadar tetiklenmesi amaçlanmamıştır.
-- =============================================================================

create extension if not exists pg_cron;

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 9): asagidaki
-- 4 sweep fonksiyonunun hicbirinde acik REVOKE/GRANT yoktu -- PostgreSQL
-- varsayilan olarak fonksiyonlara PUBLIC'e EXECUTE verir, bu yuzden
-- (0001-0020'nin geri kalaninda ayri bir varsayilan-ayricalik degisikligi
-- olmadigi surece) herhangi bir authenticated/anon cagiran bunlari
-- PostgREST uzerinden DOGRUDAN cagirabilirdi -- oysa bunlar yalniz
-- pg_cron'un zamanlanmis gorevleri tarafindan cagrilmak uzere
-- tasarlanmistir (cron.schedule() bunlari, migration'i calistiran/sahip
-- rolun yetkileriyle cagirir, ayri bir client grant'ina ihtiyac duymadan).
-- Her dordu de asagida acikca kilitlenir -- hicbir role dogrudan grant yok.

-- -----------------------------------------------------------------------------
-- sweep_expired_job_listings
-- -----------------------------------------------------------------------------
create or replace function public.sweep_expired_job_listings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
begin
  for v_job in
    select j.* from public.jobs j
    where j.deleted_at is null
      and j.republished_to_job_id is null
      and public.is_job_listing_expired(j.id)
  loop
    perform public.create_notification(
      v_job.requester_id, null, 'ilan_yayin_suresi_doldu', v_job.id, null, v_job.operation_id,
      'İlan Süresi Doldu',
      'İlanınızın yayın süresi doldu. İlan yeni tekliflere kapatıldı ve Süresi Dolan İlanlar bölümüne taşındı.',
      null
    );
    perform public.append_job_activity_event(v_job.id, v_job.operation_id, null, 'job_expired', 'İlan süresi doldu', null, null, 'public');
  end loop;
end;
$$;

revoke all on function public.sweep_expired_job_listings() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- sweep_completion_auto_approvals — mirrors
-- offers.ts#applyExpiredCompletionAutoApprovals (COMPLETION_AUTO_APPROVE_DAYS
-- = 7, doğrulanmış).
-- -----------------------------------------------------------------------------
create or replace function public.sweep_completion_auto_approvals()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  for v_offer in
    select * from public.offers
    where status = 'completion_requested'
      and completion_requested_at is not null
      and completion_requested_at + interval '7 days' <= now()
  loop
    update public.offers set status = 'completed', completed_at = now(), auto_completed = true
      where id = v_offer.id and status = 'completion_requested';
    insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
      values (v_offer.id, 'completion_requested', 'completed', null, 'auto_approved_after_7_days');
    perform public.create_notification(v_offer.provider_id, null, 'tamamlanma_onaylandi', v_offer.job_id, v_offer.id, null,
      null, 'Hizmet Alan işin tamamlandığını onayladı.', jsonb_build_object('auto_completed', true));
  end loop;
end;
$$;

revoke all on function public.sweep_completion_auto_approvals() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- sweep_notification_retention — soft-delete only, 180 gün (muhafazakâr
-- varsayılan, doğrulanmış bir ürün gereksinimi değil).
-- -----------------------------------------------------------------------------
create or replace function public.sweep_notification_retention()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
    set deleted_at = now()
    where deleted_at is null and created_at < now() - interval '180 days';
$$;

revoke all on function public.sweep_notification_retention() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- sweep_stale_anonymous_legal_consents — tek HARD delete (bkz. yorum).
-- -----------------------------------------------------------------------------
create or replace function public.sweep_stale_anonymous_legal_consents()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.legal_consents
    where user_id is null and accepted_at < now() - interval '90 days';
$$;

comment on function public.sweep_stale_anonymous_legal_consents() is
  'Bu şemadaki TEK hard delete: anonim (user_id null) bir consent kaydı gerçek bir kullanıcının hesabına hiç bağlanmadıysa, "kalıcı saklanmalıdır" gereksinimi gerçek kullanıcı kararlarına uygulanır, sahipsiz anonim satırlara değil.';

revoke all on function public.sweep_stale_anonymous_legal_consents() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Storage-orphan cleanup — TANIMLANDI, SQL olarak İNŞA EDİLMEDİ (Postgres,
-- pg_net + service_role Vault secret olmadan Storage HTTP API'sini
-- çağıramaz — bkz. docs/database/storage-plan.md).
-- -----------------------------------------------------------------------------

select cron.schedule('malsevk-sweep-expired-job-listings', '*/15 * * * *', $$select public.sweep_expired_job_listings();$$);
select cron.schedule('malsevk-sweep-completion-auto-approvals', '0 * * * *', $$select public.sweep_completion_auto_approvals();$$);
select cron.schedule('malsevk-sweep-notification-retention', '0 3 * * *', $$select public.sweep_notification_retention();$$);
select cron.schedule('malsevk-sweep-stale-anonymous-legal-consents', '0 4 * * 0', $$select public.sweep_stale_anonymous_legal_consents();$$);
