-- =============================================================================
-- MALSEVK — Faz 1 migration 0017: views (reporting + minimum admin read models)
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- GÜVENLİK DÜZELTMESİ (önceki denetim B.2, KRİTİK): önceki tasarımın
-- 0022_views.sql'i HİÇBİR view için GRANT/REVOKE içermiyordu — her tablo
-- (0002-0010) ve her fonksiyon (0012, 0014-0016) `revoke all ... from
-- authenticated, anon; grant select/execute ...` deseniyle özenle
-- sınırlandırılırken, view katmanı bu savunma-derinliği disiplininin
-- TAMAMEN dışında kalmıştı (yalnızca iç `security_invoker=true` RLS devrine
-- veya admin view'lar için `WHERE is_admin()` özdenetimine güveniliyordu).
-- Bu dosyadaki HER view artık tablolarla BİREBİR AYNI revoke-then-grant
-- bloğuna sahip.
--
-- DEĞİŞİKLİKLER (önceki tasarımın 0022_views.sql'ine göre):
--   * operation_progress artık total_service_count'u operations tablosundan
--     OKUMUYOR (kolon kaldırıldı, bkz. 0004) — count(j.id) ile CANLI
--     hesaplıyor (yalnız deleted_at is null olan üyeler — bkz. 0004'ün
--     dosya başlığı, "toplam" ve "kalan" kavramlarının karıştırılmaması).
--   * provider_active_job_count artık get_effective_limit() yerine
--     get_active_job_limit()'i (0012, sabit 5) kullanıyor.
--   * unread_notification_counts artık notification_states'e JOIN
--     YAPMIYOR — read_at doğrudan notifications üzerinde (bkz. 0009).
--   * admin_user_list/admin_job_list/admin_offer_list/admin_document_queue/
--     admin_dispute_queue/admin_audit_log_search artık has_admin_permission
--     (code) yerine is_admin() ile öz-kapılı (Faz 1'in tek admin katmanı).
--   * admin_dashboard_summary VE admin_payment_summary Faz 2/3'e taşındı
--     (bkz. docs/database/future-migrations/) — bunlar Faz 1'in açık
--     listesinde yok ("Gelişmiş operasyon raporlaması" Faz 2'dir).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- active_job_listings
-- -----------------------------------------------------------------------------
create or replace view public.active_job_listings
with (security_invoker = true)
as
select j.*
from public.jobs j
where j.deleted_at is null
  and j.listing_status = 'yayinda'
  and j.closed_at is null
  and not public.is_job_listing_expired(j.id)
  and (
    j.operation_id is null
    and not exists (select 1 from public.offers o where o.job_id = j.id and o.status = 'completed')
    or j.operation_id is not null
    and not exists (select 1 from public.operations op where op.id = j.operation_id and op.closed_at is not null)
  );

revoke all on public.active_job_listings from public;
grant select on public.active_job_listings to authenticated, anon;

-- -----------------------------------------------------------------------------
-- provider_visible_jobs
-- -----------------------------------------------------------------------------
create or replace view public.provider_visible_jobs
with (security_invoker = true)
as
select ajl.*
from public.active_job_listings ajl
where public.current_user_role() <> 'hizmet-veren'
   or public.provider_can_view_category(auth.uid(), ajl.category_id);

revoke all on public.provider_visible_jobs from public;
grant select on public.provider_visible_jobs to authenticated;

-- -----------------------------------------------------------------------------
-- requester_job_summary
-- -----------------------------------------------------------------------------
create or replace view public.requester_job_summary
with (security_invoker = true)
as
select
  j.id as job_id, j.requester_id, j.title, j.listing_status, j.category_id,
  j.created_at, j.publish_end_at, j.closed_at,
  count(o.id) filter (where o.status <> 'withdrawn') as visible_offer_count,
  count(o.id) filter (where o.status = 'pending') as pending_offer_count,
  public.get_settled_offer_id_for_job(j.id) as settled_offer_id
from public.jobs j
left join public.offers o on o.job_id = j.id
where j.requester_id = auth.uid() and j.deleted_at is null
group by j.id;

revoke all on public.requester_job_summary from public;
grant select on public.requester_job_summary to authenticated;

-- -----------------------------------------------------------------------------
-- provider_active_job_count
-- -----------------------------------------------------------------------------
create or replace view public.provider_active_job_count
with (security_invoker = true)
as
select
  p.id as provider_id,
  public.get_active_job_count(p.id) as active_job_count,
  public.get_active_job_limit() as active_job_limit
from public.profiles p
where p.role = 'hizmet-veren' and p.id = auth.uid();

revoke all on public.provider_active_job_count from public;
grant select on public.provider_active_job_count to authenticated;

-- -----------------------------------------------------------------------------
-- operation_progress — total_service_count artık CANLI hesaplanıyor (bkz.
-- dosya başlığı ve 0004'ün "total_service_count kaldırıldı" notu).
-- -----------------------------------------------------------------------------
create or replace view public.operation_progress
with (security_invoker = true)
as
select
  op.id as operation_id, op.requester_id, op.title,
  count(j.id) as total_service_count,
  op.created_at, op.closed_at, op.completed_at,
  count(j.id) filter (where j.listing_status = 'tamamlandi' or exists (select 1 from public.offers o where o.job_id = j.id and o.status = 'completed')) as completed_count,
  count(j.id) filter (where public.is_job_closed_to_new_offers(j.id) and not exists (select 1 from public.offers o where o.job_id = j.id and o.status = 'completed')) as in_progress_count,
  count(j.id) filter (where j.closed_at is not null) as manually_closed_count,
  count(j.id) filter (where public.is_job_listing_expired(j.id)) as expired_count
from public.operations op
join public.jobs j on j.operation_id = op.id and j.deleted_at is null
group by op.id;

comment on view public.operation_progress is
  'total_service_count = count(*) where operation_id = X AND deleted_at is null — soft-delete edilmiş bir kardeş ilan bu sayıya DAHİL DEĞİLDİR (kaynak uygulamanın hard-delete davranışını doğru yansıtır: silinen bir kardeş "Operasyon X Hizmet Arıyor" rozetinin toplamından düşer). Tek doğruluk kaynağı budur (bkz. 0004).';

revoke all on public.operation_progress from public;
grant select on public.operation_progress to authenticated;

-- -----------------------------------------------------------------------------
-- job_offer_summary
-- -----------------------------------------------------------------------------
create or replace view public.job_offer_summary
with (security_invoker = true)
as
select
  j.id as job_id,
  count(o.id) as total_offer_count,
  count(o.id) filter (where o.status = 'pending') as pending_count,
  public.get_settled_offer_id_for_job(j.id) as settled_offer_id,
  public.is_job_closed_to_new_offers(j.id) as closed_to_new_offers
from public.jobs j
left join public.offers o on o.job_id = j.id and o.status <> 'withdrawn'
group by j.id;

revoke all on public.job_offer_summary from public;
grant select on public.job_offer_summary to authenticated;

-- -----------------------------------------------------------------------------
-- provider_rating_summary
-- -----------------------------------------------------------------------------
create or replace view public.provider_rating_summary
with (security_invoker = true)
as
select
  p.id as provider_id,
  round(avg(r.stars)::numeric, 1) as average_stars,
  count(r.id) as rating_count,
  count(o.id) filter (where o.status = 'completed') as completed_job_count
from public.profiles p
left join public.ratings r on r.provider_id = p.id and r.deleted_at is null
left join public.offers o on o.provider_id = p.id
where p.role = 'hizmet-veren'
group by p.id;

revoke all on public.provider_rating_summary from public;
grant select on public.provider_rating_summary to authenticated, anon;

-- -----------------------------------------------------------------------------
-- public_provider_profiles
-- -----------------------------------------------------------------------------
create or replace view public.public_provider_profiles
with (security_invoker = true)
as
select
  pp.user_id as provider_id, pp.bio, pp.founded_year, pp.experience_range,
  pp.regions, pp.service_features, pp.logo_path, pp.verification_status,
  prs.average_stars, prs.rating_count, prs.completed_job_count
from public.provider_profiles pp
join public.provider_rating_summary prs on prs.provider_id = pp.user_id;

comment on view public.public_provider_profiles is
  'security_invoker = true, provider_profiles_select_own_or_admin (0013) satır görünürlüğünü belirler — bu view bugün yalnızca sağlayıcının KENDİ profilini görüntülemesi için işlevseldir (o politikanın bir "counterparty" dalı yok). Gerçek bir genel-görüntüleme özelliği ileride istenirse, önce provider_profiles''ın SELECT politikası genişletilmelidir.';

revoke all on public.public_provider_profiles from public;
grant select on public.public_provider_profiles to authenticated;

-- -----------------------------------------------------------------------------
-- unread_notification_counts — notification_states YOK (bkz. 0009), read_at
-- doğrudan notifications üzerinde.
-- -----------------------------------------------------------------------------
create or replace view public.unread_notification_counts
with (security_invoker = true)
as
select
  n.recipient_id,
  count(*) filter (where n.read_at is null) as unread_count
from public.notifications n
where n.deleted_at is null and n.recipient_id = auth.uid()
group by n.recipient_id;

revoke all on public.unread_notification_counts from public;
grant select on public.unread_notification_counts to authenticated;

-- -----------------------------------------------------------------------------
-- provider_document_status_summary
-- -----------------------------------------------------------------------------
create or replace view public.provider_document_status_summary
with (security_invoker = true)
as
select
  provider_id,
  count(*) filter (where current_review_status = 'pending') as pending_count,
  count(*) filter (where current_review_status = 'approved') as approved_count,
  count(*) filter (where current_review_status = 'rejected') as rejected_count,
  count(*) filter (where current_review_status = 'revision_requested') as revision_requested_count
from public.provider_documents
where deleted_at is null
group by provider_id;

revoke all on public.provider_document_status_summary from public;
grant select on public.provider_document_status_summary to authenticated;

-- =============================================================================
-- Faz 1 minimum admin read models — is_admin() ile öz-kapılı (security_
-- invoker = false, sahibin geniş tablo erişimiyle çalışır, kendi WHERE
-- is_admin() koşuluyla filtreler — Faz 2'nin has_admin_permission(code)
-- katmanı devreye girdiğinde bu WHERE koşulu ilgili izin koduna
-- güncellenir, view'ın kendisi/adı değişmez).
-- =============================================================================

create or replace view public.admin_user_list
with (security_invoker = false)
as
select p.id, p.role, p.full_name, p.phone, p.company_name, p.account_status, p.onboarding_completed, p.created_at,
  (select count(*) from public.jobs j where j.requester_id = p.id and j.deleted_at is null) as job_count,
  (select public.get_active_job_count(p.id)) as active_offer_count
from public.profiles p
where public.is_admin();

comment on view public.admin_user_list is
  'p.phone dahil — Faz 1''in "Kullanıcıları görüntülemek" ihtiyacı için. Yalnız is_admin() taşıyan hesaplarca görülebilir (Faz 2''de daha ince taneli bir users.view iznine geçirilebilir).';

revoke all on public.admin_user_list from public;
grant select on public.admin_user_list to authenticated;

create or replace view public.admin_job_list
with (security_invoker = false)
as
select j.*, (select count(*) from public.offers o where o.job_id = j.id) as offer_count
from public.jobs j
where public.is_admin();

revoke all on public.admin_job_list from public;
grant select on public.admin_job_list to authenticated;

create or replace view public.admin_offer_list
with (security_invoker = false)
as
select o.*
from public.offers o
where public.is_admin();

revoke all on public.admin_offer_list from public;
grant select on public.admin_offer_list to authenticated;

create or replace view public.admin_document_queue
with (security_invoker = false)
as
select pd.*
from public.provider_documents pd
where public.is_admin() and pd.deleted_at is null
order by pd.uploaded_at desc;

comment on view public.admin_document_queue is
  'Faz 1''in "Hizmet Veren belgelerini incelemek" VE "Faaliyet raporlarını incelemek" ihtiyaçlarının İKİSİNİ de karşılar — provider_documents.document_type (''genel'' = Faaliyet Belgesi/Raporu, ''gumruk-musaviri-izin-belgesi'') aynı tablo/view''dan, uygulama tarafında filtrelenir (kaynak admin panelinin kendi deseni).';

revoke all on public.admin_document_queue from public;
grant select on public.admin_document_queue to authenticated;

create or replace view public.admin_dispute_queue
with (security_invoker = false)
as
select o.id as offer_id, o.job_id, o.provider_id, j.requester_id, o.completion_dispute_note, o.updated_at
from public.offers o
join public.jobs j on j.id = o.job_id
where public.is_admin() and o.status = 'completion_disputed';

comment on view public.admin_dispute_queue is
  'Faz 1''in "Şikâyet/itiraz kayıtlarını incelemek" ihtiyacı.';

revoke all on public.admin_dispute_queue from public;
grant select on public.admin_dispute_queue to authenticated;

-- admin_audit_log_search bir FONKSİYONDUR (view değil) çünkü "arama"
-- çağıran-taraflı filtre parametreleri gerektirir.
create or replace function public.admin_audit_log_search(
  p_entity_type text default null, p_entity_id uuid default null,
  p_actor_id uuid default null, p_from timestamptz default null, p_to timestamptz default null,
  p_limit integer default 100
)
returns setof public.audit_logs
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.audit_logs
  where public.is_admin()
    and (p_entity_type is null or entity_type = p_entity_type)
    and (p_entity_id is null or entity_id = p_entity_id)
    and (p_actor_id is null or actor_id = p_actor_id)
    and (p_from is null or created_at >= p_from)
    and (p_to is null or created_at <= p_to)
  order by created_at desc
  limit least(coalesce(p_limit, 100), 500);
$$;

comment on function public.admin_audit_log_search(text, uuid, uuid, timestamptz, timestamptz, integer) is
  'SECURITY DEFINER (audit_logs''e hiç doğrudan grant yok, bkz. 0010) ama is_admin() ile öz-kapılı — yetkisiz bir çağrı boş sonuç döner, hata değil. limit her zaman 500 ile sınırlıdır.';

revoke all on function public.admin_audit_log_search(text, uuid, uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.admin_audit_log_search(text, uuid, uuid, timestamptz, timestamptz, integer) to authenticated;
