-- =============================================================================
-- MALSEVK — Faz 1 migration 0013: Row Level Security policies
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DEĞİŞİKLİKLER (önceki tasarımın 0017_rls_policies.sql'ine göre):
--   * admin_roles/admin_permissions/admin_role_permissions/admin_user_roles
--     politikaları KALDIRILDI (bu tablolar Faz 2 — bkz. docs/database/
--     future-migrations/phase2/).
--   * subscription_*/payment_*/outbox_events politikaları KALDIRILDI (Faz
--     2/3 — bkz. docs/database/future-migrations/).
--   * notification_states politikası KALDIRILDI (0009'da notifications'a
--     birleştirildi).
--   * audit_logs politikası has_admin_permission('audit_logs.view') yerine
--     is_admin() kullanıyor (Faz 1'in tek admin kapısı — bkz. 0012).
--
-- Tablo/kolon-seviyeli GRANT/REVOKE'lar zaten her tablonun kendi
-- migration dosyasında (0002-0010) ayarlandı — burası yalnızca satır
-- filtresini ekler.
--
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 10 -
-- idempotency): PostgreSQL'de "CREATE POLICY IF NOT EXISTS" yoktur -- bu
-- dosyadaki HER "create policy" artik kendi "drop policy if exists"
-- satirindan sonra geliyor, boylece migration seti (kismen ya da tamamen)
-- ikinci kez calistirildiginda "policy already exists" hatasi vermez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

comment on policy profiles_select_own_or_admin on public.profiles is
  'Deliberately NOT broadened to "counterparty on an engaged offer" — a counterparty''s SAFE public info is served by get_offer_provider_display()/public_provider_profiles (0016/0017), never a direct profiles SELECT.';

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- provider_profiles / provider_services / service_categories
-- -----------------------------------------------------------------------------
alter table public.provider_profiles enable row level security;

drop policy if exists provider_profiles_select_own_or_admin on public.provider_profiles;
create policy provider_profiles_select_own_or_admin on public.provider_profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists provider_profiles_update_own on public.provider_profiles;
create policy provider_profiles_update_own on public.provider_profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.provider_services enable row level security;

drop policy if exists provider_services_select_own_or_admin on public.provider_services;
create policy provider_services_select_own_or_admin on public.provider_services
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

alter table public.service_categories enable row level security;

drop policy if exists service_categories_select_all on public.service_categories;
create policy service_categories_select_all on public.service_categories
  for select to authenticated, anon
  using (true);

-- -----------------------------------------------------------------------------
-- operations
-- -----------------------------------------------------------------------------
alter table public.operations enable row level security;

drop policy if exists operations_select_visible on public.operations;
create policy operations_select_visible on public.operations
  for select to authenticated
  using (
    requester_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.jobs j
      where j.operation_id = operations.id
        and j.deleted_at is null
        and (public.current_user_role() <> 'hizmet-veren' or public.provider_can_view_category(auth.uid(), j.category_id))
    )
  );

-- -----------------------------------------------------------------------------
-- jobs
-- -----------------------------------------------------------------------------
alter table public.jobs enable row level security;

drop policy if exists jobs_select_visible on public.jobs;
create policy jobs_select_visible on public.jobs
  for select to authenticated, anon
  using (
    deleted_at is null and (
      requester_id = auth.uid()
      or public.is_admin()
      or public.current_user_role() is distinct from 'hizmet-veren'
      or public.provider_can_view_category(auth.uid(), category_id)
    )
  );

comment on policy jobs_select_visible on public.jobs is
  'DOĞRULANMIŞ DAVRANIŞ: hizmet-veren, izole kategori (Nakliye/Gümrük Müşavirliği) seçmediği sürece HER ilanı görür — bkz. 0012''deki provider_can_view_category() notu.';

drop policy if exists jobs_update_own_editable on public.jobs;
create policy jobs_update_own_editable on public.jobs
  for update to authenticated
  using (requester_id = auth.uid())
  with check (requester_id = auth.uid());

grant select on public.jobs to authenticated, anon;
revoke select (address_text, neighborhood, location_url, directions_note) on public.jobs from authenticated, anon;

-- -----------------------------------------------------------------------------
-- job_photos
-- -----------------------------------------------------------------------------
alter table public.job_photos enable row level security;

drop policy if exists job_photos_select_if_job_visible on public.job_photos;
create policy job_photos_select_if_job_visible on public.job_photos
  for select to authenticated, anon
  using (
    deleted_at is null
    and exists (select 1 from public.jobs j where j.id = job_photos.job_id)
  );

-- -----------------------------------------------------------------------------
-- offers / offer_status_history
-- -----------------------------------------------------------------------------
alter table public.offers enable row level security;

drop policy if exists offers_select_parties_or_admin on public.offers;
create policy offers_select_parties_or_admin on public.offers
  for select to authenticated
  using (
    provider_id = auth.uid()
    or public.is_job_owner(job_id)
    or public.is_admin()
  );

comment on policy offers_select_parties_or_admin on public.offers is
  'A competing provider on the same job never sees another provider''s offer row via this table.';

alter table public.offer_status_history enable row level security;
drop policy if exists offer_status_history_select_parties_or_admin on public.offer_status_history;
create policy offer_status_history_select_parties_or_admin on public.offer_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.offers o
      where o.id = offer_status_history.offer_id
        and (o.provider_id = auth.uid() or public.is_job_owner(o.job_id))
    ) or public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- ratings
-- -----------------------------------------------------------------------------
alter table public.ratings enable row level security;

drop policy if exists ratings_select_relevant_or_public_summary on public.ratings;
create policy ratings_select_relevant_or_public_summary on public.ratings
  for select to authenticated, anon
  using (deleted_at is null);

comment on policy ratings_select_relevant_or_public_summary on public.ratings is
  'Individual ratings.stars/comment are treated as PUBLIC once submitted — provider_rating_summary (0017) is the aggregate most UI should actually read.';

-- -----------------------------------------------------------------------------
-- provider_documents / provider_document_reviews / provider_document_consents
-- -----------------------------------------------------------------------------
alter table public.provider_documents enable row level security;
drop policy if exists provider_documents_select_own_or_admin on public.provider_documents;
create policy provider_documents_select_own_or_admin on public.provider_documents
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

alter table public.provider_document_reviews enable row level security;
drop policy if exists provider_document_reviews_select_own_or_admin on public.provider_document_reviews;
create policy provider_document_reviews_select_own_or_admin on public.provider_document_reviews
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

alter table public.provider_document_consents enable row level security;
drop policy if exists provider_document_consents_select_own_or_admin on public.provider_document_consents;
create policy provider_document_consents_select_own_or_admin on public.provider_document_consents
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());
-- INSERT: bkz. record_provider_document_consent() (0007) -- policy'siz,
-- yalniz o SECURITY DEFINER RPC uzerinden.

-- -----------------------------------------------------------------------------
-- legal_consents
-- -----------------------------------------------------------------------------
alter table public.legal_consents enable row level security;
drop policy if exists legal_consents_select_own_or_admin on public.legal_consents;
create policy legal_consents_select_own_or_admin on public.legal_consents
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- INSERT: bkz. record_legal_consent() (0008) -- policy'siz, yalniz o
-- SECURITY DEFINER RPC uzerinden (anon dahil, misafir kabul icin).

-- -----------------------------------------------------------------------------
-- notifications / recently_viewed_jobs
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid() and deleted_at is null);

alter table public.recently_viewed_jobs enable row level security;
drop policy if exists recently_viewed_jobs_select_own on public.recently_viewed_jobs;
create policy recently_viewed_jobs_select_own on public.recently_viewed_jobs
  for select to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- job_activity_events / audit_logs
-- -----------------------------------------------------------------------------
alter table public.job_activity_events enable row level security;
drop policy if exists job_activity_events_select_visible on public.job_activity_events;
create policy job_activity_events_select_visible on public.job_activity_events
  for select to authenticated
  using (public.can_view_job_activity_event(id) or public.is_admin());

alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_select_admins_only on public.audit_logs;
create policy audit_logs_select_admins_only on public.audit_logs
  for select to authenticated
  using (public.is_admin());

comment on policy audit_logs_select_admins_only on public.audit_logs is
  'Faz 1: is_admin() (tek admin kapısı). Faz 2''nin has_admin_permission(''audit_logs.view'')''i (bugünkü admin hesaplarına audit_logs.view otomatik verilmeden önce, opt-in bir izin olarak) devreye aldığında bu policy, öncekinin daha ince taneli halini almak üzere ALTER POLICY ile güncellenir — bkz. docs/database/future-migrations/MANIFEST.md.';
-- =============================================================================
