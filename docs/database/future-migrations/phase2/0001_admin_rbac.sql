-- =============================================================================
-- MALSEVK — Faz 2 TASLAK 0001: admin_permissions, admin_roles,
--                                admin_role_permissions, admin_user_roles
-- =============================================================================
-- STATUS: FAZ 2 TASLAK — OTOMATİK ÇALIŞTIRILMAZ. Bu dosya supabase/migrations/
-- DIŞINDADIR; Supabase CLI yalnız supabase/migrations/*.sql'i tarar, bu klasörü
-- HİÇ görmez. Devreye alma sırası için ../MANIFEST.md'ye bakın.
--
-- İçerik, önceki (faz-ayrımından önceki) tasarımın
-- 0004_admin_roles_and_permissions.sql'i ile AYNIDIR — bu tablolar hiç
-- değiştirilmeden buraya taşındı. Faz 1'in supabase/migrations/0012_
-- rls_helpers.sql'i zaten TEK admin kapısı olarak is_admin()'i (profiles.role
-- = 'admin') kullanıyor; bu dosyadaki fonksiyon/tablolar YOKKEN de Faz 1'in
-- her admin RPC'si/view'ı (0016, 0017) tam çalışır durumdadır — Faz 2'nin bu
-- katmanı, bugünkü TEK-hesap admin modelini bozmadan, İNCE TANELİ izin
-- yönetimi eklemek içindir.
-- =============================================================================

create table if not exists public.admin_permissions (
  code text primary key,
  category text not null,
  description text not null,
  created_at timestamptz not null default now()
);

comment on table public.admin_permissions is
  'Fixed catalog of admin capability codes. Adding a new permission is a migration (INSERT here + wire the check into the relevant RPC/view); permissions are never created ad hoc by admins themselves.';

insert into public.admin_permissions (code, category, description) values
  ('users.view',          'users',       'View user profiles and account status.'),
  ('users.suspend',       'users',       'Suspend or reinstate a user account (profiles.account_status).'),
  ('users.verify',        'users',       'Mark a provider profile as verified (provider_profiles.verification_status).'),
  ('jobs.view',           'jobs',        'View any job listing regardless of ownership/visibility rules.'),
  ('jobs.close',          'jobs',        'Manually close a job listing on behalf of its owner (moderation).'),
  ('jobs.delete',         'jobs',        'Soft-delete a job listing (moderation, distinct from the owner''s own delete).'),
  ('offers.view',         'offers',      'View any offer regardless of party/status visibility rules.'),
  ('documents.view',      'documents',   'View provider-uploaded documents (Faaliyet Belgesi / Gumruk license).'),
  ('documents.review',    'documents',   'Approve, reject, or request revision on a provider document.'),
  ('disputes.view',       'disputes',    'View offers in a disputed state (completion_disputed) and their history.'),
  ('disputes.resolve',    'disputes',    'Resolve a completion dispute on behalf of the requester (moderation escalation path).'),
  ('payments.view',       'payments',    'View payment_transactions / invoices (Faz 3).'),
  ('payments.refund',     'payments',    'Initiate a refund against a payment_transaction (Faz 3).'),
  ('payouts.view',        'payments',    'View provider payout records (future escrow scope).'),
  ('reports.view',        'reports',     'View aggregate/reporting views (admin_dashboard_summary and similar).'),
  ('settings.manage',     'settings',    'Manage system_settings-style configuration (subscription plans, quota limits, etc.).'),
  ('audit_logs.view',     'audit',       'Read audit_logs — the only role permitted to do so besides service_role.'),
  ('admin_roles.manage',  'admin',       'Grant/revoke admin roles to other users. Required to bootstrap or extend the admin team.')
on conflict (code) do nothing;

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.admin_roles is
  'Named permission bundles ("Super Admin", "Document Officer", ...). A profiles row with role=''admin'' does not automatically hold any of these — see admin_user_roles below.';

create trigger trg_admin_roles_set_updated_at
  before update on public.admin_roles
  for each row execute function public.set_updated_at();

insert into public.admin_roles (code, name, description, is_system) values
  ('super_admin',        'Süper Admin',         'Full access to every admin permission, including granting admin roles to others.', true),
  ('document_officer',   'Evrak Yetkilisi',     'Reviews provider-uploaded activity documents and licenses.', true),
  ('finance_officer',    'Finans Yetkilisi',    'Views payments/invoices and initiates refunds.', true),
  ('support_officer',    'Destek Yetkilisi',    'Views users/jobs/offers and resolves disputes escalated by users.', true),
  ('operations_officer', 'Operasyon Yetkilisi', 'Moderates job listings (close/delete) and views operational reports.', true)
on conflict (code) do nothing;

create table if not exists public.admin_role_permissions (
  role_id uuid not null references public.admin_roles (id) on delete cascade,
  permission_code text not null references public.admin_permissions (code) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (role_id, permission_code)
);

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code from public.admin_roles r cross join public.admin_permissions p
where r.code = 'super_admin'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code from public.admin_roles r
join public.admin_permissions p on p.code in ('documents.view', 'documents.review')
where r.code = 'document_officer'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code from public.admin_roles r
join public.admin_permissions p on p.code in ('payments.view', 'payments.refund', 'payouts.view', 'reports.view')
where r.code = 'finance_officer'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code from public.admin_roles r
join public.admin_permissions p on p.code in ('users.view', 'jobs.view', 'offers.view', 'disputes.view', 'disputes.resolve')
where r.code = 'support_officer'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_code)
select r.id, p.code from public.admin_roles r
join public.admin_permissions p on p.code in ('jobs.view', 'jobs.close', 'jobs.delete', 'offers.view', 'reports.view')
where r.code = 'operations_officer'
on conflict do nothing;

create table if not exists public.admin_user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid not null references public.admin_roles (id) on delete restrict,
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id)
);

comment on table public.admin_user_roles is
  'Which admin roles a user currently (revoked_at is null) or previously held. NEVER writable directly by authenticated. GÜVENLİK DÜZELTMESİ (önceki denetim C.4, Yüksek): son admin_roles.manage sahibinin iptaline karşı koruma revoke_admin_role() RPC''sinde uygulanır (bkz. 0003_rpc_admin_and_subscription_functions.sql).';

create unique index if not exists admin_user_roles_active_unique
  on public.admin_user_roles (user_id, role_id)
  where revoked_at is null;

revoke all on public.admin_permissions from authenticated, anon;
revoke all on public.admin_roles from authenticated, anon;
revoke all on public.admin_role_permissions from authenticated, anon;
revoke all on public.admin_user_roles from authenticated, anon;

-- -----------------------------------------------------------------------------
-- Bootstrap: the FIRST super_admin grant (Faz 2 devreye alındığında).
-- -----------------------------------------------------------------------------
-- grant_admin_role() (0003) çağıranın zaten admin_roles.manage taşımasını
-- gerektirir — İLK grant için bu sağlanamaz. İlk super_admin, doğrudan DB
-- erişimiyle, YALNIZCA BİR KEZ, manuel olarak oluşturulmalıdır:
--   insert into public.admin_user_roles (user_id, role_id, granted_by)
--   select '<ilk adminin auth.users.id''si>'::uuid, id, null
--   from public.admin_roles where code = 'super_admin';
-- Bkz. docs/database/admin-permissions.md'nin tam bootstrap runbook'u.
-- =============================================================================
