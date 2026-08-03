-- =============================================================================
-- MALSEVK — Faz 2 TASLAK 0005: RLS, view'lar ve index'ler
-- =============================================================================
-- STATUS: FAZ 2 TASLAK — OTOMATİK ÇALIŞTIRILMAZ.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RLS — admin_* ve subscription_* tabloları
-- -----------------------------------------------------------------------------
alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_user_roles enable row level security;

create policy admin_catalog_select_admins_only on public.admin_roles
  for select to authenticated using (public.is_admin());
create policy admin_permissions_select_admins_only on public.admin_permissions
  for select to authenticated using (public.is_admin());
create policy admin_role_permissions_select_admins_only on public.admin_role_permissions
  for select to authenticated using (public.is_admin());
create policy admin_user_roles_select_permission_managers_only on public.admin_user_roles
  for select to authenticated using (public.has_admin_permission('admin_roles.manage'));

alter table public.subscription_plans enable row level security;
create policy subscription_plans_select_public_or_admin on public.subscription_plans
  for select to authenticated, anon
  using (is_public = true or public.is_admin());

alter table public.subscription_plan_limits enable row level security;
create policy subscription_plan_limits_select_via_public_plan_or_admin on public.subscription_plan_limits
  for select to authenticated, anon
  using (
    public.is_admin()
    or exists (select 1 from public.subscription_plans sp where sp.id = subscription_plan_limits.plan_id and sp.is_public = true)
  );

alter table public.user_subscriptions enable row level security;
create policy user_subscriptions_select_own_or_admin on public.user_subscriptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

alter table public.subscription_status_history enable row level security;
create policy subscription_status_history_select_own_or_admin on public.subscription_status_history
  for select to authenticated
  using (
    exists (select 1 from public.user_subscriptions us where us.id = subscription_status_history.subscription_id and us.user_id = auth.uid())
    or public.is_admin()
  );

alter table public.user_limit_overrides enable row level security;
create policy user_limit_overrides_select_own_or_admin on public.user_limit_overrides
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- -----------------------------------------------------------------------------
-- admin_dashboard_summary — Faz 1'in açık listesinde YOK ("Gelişmiş
-- operasyon raporlaması" Faz 2'dir).
-- -----------------------------------------------------------------------------
create or replace view public.admin_dashboard_summary
with (security_invoker = false)
as
select
  (select count(*) from public.profiles where role = 'hizmet-alan') as total_hizmet_alan,
  (select count(*) from public.profiles where role = 'hizmet-veren') as total_hizmet_veren,
  (select count(*) from public.jobs where deleted_at is null) as total_jobs,
  (select count(*) from public.active_job_listings) as total_active_jobs,
  (select count(*) from public.offers) as total_offers,
  (select count(*) from public.provider_documents where current_review_status = 'pending') as pending_document_reviews,
  (select count(*) from public.offers where status = 'completion_disputed') as open_disputes
where public.has_admin_permission('reports.view');

revoke all on public.admin_dashboard_summary from public;
grant select on public.admin_dashboard_summary to authenticated;

-- -----------------------------------------------------------------------------
-- Faz 1 -> Faz 2 admin view/RLS geçiş adımı (bkz. ../MANIFEST.md için tam
-- liste): aşağıdaki her ALTER POLICY / CREATE OR REPLACE VIEW, Faz 1'in
-- is_admin()-öz-kapılı halini has_admin_permission(code)-öz-kapılı hale
-- getirir. Faz 2 devreye alınana kadar YORUM olarak bırakılmıştır — Faz
-- 1'in supabase/migrations/0013_rls_policies.sql / 0017_views.sql'i
-- BAŞARIYLA ÇALIŞMAYA devam eder, bu blok atlanabilir.
-- -----------------------------------------------------------------------------
-- alter policy audit_logs_select_admins_only on public.audit_logs
--   using (public.has_admin_permission('audit_logs.view'));
-- create or replace view public.admin_user_list ... where public.has_admin_permission('users.view');
-- create or replace view public.admin_job_list ... where public.has_admin_permission('jobs.view');
-- create or replace view public.admin_offer_list ... where public.has_admin_permission('offers.view');
-- create or replace view public.admin_document_queue ... where public.has_admin_permission('documents.view');
-- create or replace view public.admin_dispute_queue ... where public.has_admin_permission('disputes.view');
-- create or replace function public.admin_audit_log_search(...) ... where public.has_admin_permission('audit_logs.view') ...
-- Not: close_job_as_admin/delete_job_as_admin/suspend_user/reinstate_user
-- (Faz 1: supabase/migrations/0016) da benzer şekilde has_admin_permission
-- ('jobs.close'/'jobs.delete'/'users.suspend') kontrollerine geçirilebilir —
-- review_provider_document() KASITLI OLARAK is_admin()'de kalır (bkz. Faz
-- 1 dosyasının kendi yorumu, "Layer 1, unchanged from today").
