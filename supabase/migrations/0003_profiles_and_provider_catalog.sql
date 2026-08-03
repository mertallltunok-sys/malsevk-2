-- =============================================================================
-- MALSEVK — Faz 1 migration 0003: profiles, provider_profiles, provider_services
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0003_profiles_and_provider_catalog.sql'i ile aynıdır; TEK fark,
-- `profiles.account_status` ve `onboarding_completed` kolonlarının Faz 1'de
-- de tutulmasıdır — `account_status`, Faz 1'in "Kullanıcı hesabını askıya
-- almak" admin ihtiyacı için zaten gerekli (bkz. 0016_rpc_document_
-- notification_and_admin_functions.sql'deki suspend_user/reinstate_user).
--
-- Maps StoredUser + (gömülü) ProviderProfile + provider-services.ts'nin
-- StoredProviderService'ini üç gerçek tabloya. Alan bazlı eşleme için
-- docs/database/schema-reference.md'ye bakın.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
-- profiles.id is NOT `default gen_random_uuid()` — it is always set equal to
-- the corresponding auth.users.id (never generated independently).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Nullable by design: a profiles row is created automatically the instant
  -- a Supabase Auth user is created, before the multi-step registration form
  -- (mirroring today's login-form.tsx) has been submitted.
  -- `onboarding_completed` (below) is the authoritative "is this profile
  -- ready to use" flag; role/phone being NULL is the expected, valid state
  -- in between auth signup and registration completion.
  role text check (role in ('hizmet-alan', 'hizmet-veren', 'admin')),

  full_name text,
  phone text check (phone is null or phone ~ '^\+905\d{9}$'),
  phone_verified_at timestamptz,

  -- StoredUser.companyName / companyType / province / district — collected
  -- once at registration for BOTH roles.
  company_name text check (company_name is null or char_length(company_name) <= 150),
  company_type text check (company_type is null or company_type in
    ('bireysel', 'sahis-isletmesi', 'limited-sirket', 'anonim-sirket', 'diger')),
  province text,
  district text,

  -- Faz 1 admin ihtiyacı ("Kullanıcı hesabını askıya almak") için gerekli —
  -- bkz. 0016'daki suspend_user()/reinstate_user(). Suspension'ın hangi
  -- eylemleri fiilen engelleyeceği (create_job/create_offer/vb.) önceki
  -- denetim raporunda Açık Karar olarak bırakılmıştı; bu göç onu
  -- ÇÖZMEZ, yalnızca bayrağı ve admin RPC'sini taşır.
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended', 'banned')),

  onboarding_completed boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Soft delete: her diğer tablonun profiles.id'ye FK'si (jobs.requester_id,
  -- offers.provider_id, ...) hard-delete anında bir "on delete" davranışı
  -- gerektirirdi — soft delete bunu tamamen ortadan kaldırır.
  deleted_at timestamptz
);

comment on table public.profiles is
  'One row per auth.users row (1:1, id shared). Maps StoredUser minus passwordHash/email (both owned by Supabase Auth) minus providerProfile (see provider_profiles).';
comment on column public.profiles.role is
  'NULL until registration completes. Never client-writable after being set once by the completion RPC — see column-level GRANT/REVOKE below.';

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 10 — idempotency):
-- DROP IF EXISTS + CREATE.
drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- DUZELTME (yerel dry-run, gercek bulgu): asagidaki "grant select"/"grant
-- update (...)" ifadeleri hicbir zaman public.profiles uzerinde acik bir
-- "revoke all" ile ONCELENMEMISTI -- Supabase'in kendi proje bootstrap'i
-- (yerel VEYA hosted, ikisi de ayni) anon+authenticated'e (PUBLIC rolu
-- uzerinden) TRUNCATE/REFERENCES/TRIGGER dahil genis varsayilan yetkiler
-- verir; bu dosya hicbir zaman bunlari geri almiyordu. Sonuc: canli
-- veritabaninda authenticated (ve TRUNCATE ozelinde hatta anon bile)
-- public.profiles uzerinde TRUNCATE yetkisine sahipti -- TRUNCATE RLS
-- politikalarina TABI DEGILDIR, yani herhangi bir kullanici (giris yapmis
-- olmasi bile sart degil, cunku TRUNCATE PUBLIC rolunden miras aliniyordu)
-- TUM profiles tablosunu tek komutla silebilirdi. Bu, statik SQL
-- incelemesiyle degil yalniz gercek bir Supabase projesine karsi calistirarak
-- yakalanabilecek bir bulguydu (migration dosyalari bu yetkiyi ACIKCA hic
-- vermiyordu -- eksiklik, olmayan bir "revoke all"din). Duzeltme: en dar
-- kapsam icin once TUM yetkiler geri alinir, sonra yalniz gerekenler
-- (asagidaki select/update) acikca geri verilir.
revoke all on public.profiles from public, authenticated, anon;

-- Column-level privilege split: `authenticated` may update their own
-- "self-service" fields, but role/account_status/onboarding_completed are
-- NEVER grantable to `authenticated` at all — only a SECURITY DEFINER RPC
-- can change them. This is a second, independent layer under RLS.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, company_name, company_type, province, district)
  on public.profiles to authenticated;
-- role / account_status / onboarding_completed / phone_verified_at /
-- created_at / updated_at / deleted_at are deliberately NOT in the grant
-- above — see 0016_rpc_document_notification_and_admin_functions.sql
-- (suspend_user/reinstate_user, account_status only) for the only Faz 1
-- write path to these columns. A future complete_registration() RPC
-- (role/onboarding_completed) 1:1 mirrors provider-registration.ts's
-- existing, unchanged validation rules and is out of scope for this pass.

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 1 — KRİTİK): bu
-- dosyada daha önce `public.profiles`e HİÇBİR `grant select` verilmiyordu —
-- `profiles_select_own_or_admin` RLS politikası (0013_rls_policies.sql) satır
-- filtrelemesi tanımlıyordu, ama tablo-seviyesi SELECT izni olmadan RLS'e
-- hiç ulaşılamıyordu (authenticated bir SELECT * FROM profiles denemesi
-- doğrudan "permission denied for table profiles" ile başarısız oluyordu —
-- kullanıcı kendi profilini bile okuyamıyordu). En dar kapsam: yalnızca
-- `authenticated` (RLS politikası de yalnızca `to authenticated`, `anon`
-- hiç kapsanmıyor — bkz. 0013).
grant select on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- provider_profiles
-- -----------------------------------------------------------------------------
-- Deliberately a SEPARATE table from `profiles`, not extra columns on it —
-- mirrors the source app's own separation (two independent edit surfaces:
-- Hesap Ayarları > Firma Profili vs. Panel > Profilim > Hizmet Bilgilerim).
create table if not exists public.provider_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bio text check (bio is null or char_length(bio) between 50 and 500),
  founded_year integer check (
    founded_year is null or
    (founded_year >= 1900 and founded_year <= extract(year from now())::integer)
  ),
  experience_range text check (experience_range is null or experience_range in
    ('0-1', '1-3', '3-5', '5-10', '10+')),

  -- Array-vs-junction-table decision: regions/service_features stay text[]
  -- (bounded, never relationally queried today); provider_services (below)
  -- IS a real junction table because it already is one in the source app
  -- and because job-visibility.ts's isolation rule needs to query it
  -- independently.
  regions text[] not null default '{}',
  service_features text[] not null default '{}'
    check (service_features <@ array['operatorlu', 'operatorsuz', '7-24', 'acil-hizmet', 'faturali']),

  logo_path text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.provider_profiles is
  'Optional, hizmet-veren-only extended profile. 1:1 with profiles via user_id (not id) to make the "may not exist" relationship explicit at the FK level.';
comment on column public.provider_profiles.logo_path is
  'Supabase Storage object path in the provider-logos bucket (see docs/database/storage-plan.md), not a raw IndexedDB key. NULL = no logo uploaded; UI falls back to initials avatar exactly as today (profile.ts#getInitials).';
comment on column public.provider_profiles.verification_status is
  'Not read/written by any Faz 1 RPC today — a future admin verify_provider() capability was designed but deferred (no verified UI need). See docs/database/schema-reference.md Open Decisions.';

drop trigger if exists trg_provider_profiles_set_updated_at on public.provider_profiles;
create trigger trg_provider_profiles_set_updated_at
  before update on public.provider_profiles
  for each row execute function public.set_updated_at();

-- DUZELTME (yerel dry-run, gercek bulgu): profiles ile birebir ayni
-- eksiklik/gerekce -- bkz. yukaridaki profiles notu. En dar kapsam icin
-- once tum yetkiler geri alinir.
revoke all on public.provider_profiles from public, authenticated, anon;

revoke update on public.provider_profiles from authenticated;
grant update (bio, founded_year, experience_range, regions, service_features, logo_path)
  on public.provider_profiles to authenticated;
-- verification_status is intentionally excluded — no Faz 1 write path exists
-- for it at all (see comment above).

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 1 — KRİTİK): aynı
-- eksiklik `provider_profiles` için de vardı — bkz. yukarıdaki `profiles`
-- notu, birebir aynı gerekçe. `provider_profiles_select_own_or_admin`
-- politikası da yalnız `to authenticated`.
grant select on public.provider_profiles to authenticated;

-- -----------------------------------------------------------------------------
-- provider_services
-- -----------------------------------------------------------------------------
create table if not exists public.provider_services (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id) on delete cascade,
  service_category_id text not null references public.service_categories (id),
  created_at timestamptz not null default now(),
  unique (provider_id, service_category_id)
);

comment on table public.provider_services is
  'A provider''s current service-category selection. Full-replace semantics expected at the RPC layer (delete-then-insert per call, mirroring provider-services.ts#setProviderServiceCategoryIds), not incremental add/remove from the client.';

-- No updated_at: rows are never updated in place, only deleted and
-- re-inserted as a set — matches the source module's own "full replace"
-- write pattern exactly.

revoke all on public.provider_services from authenticated, anon;
grant select on public.provider_services to authenticated;
-- INSERT/DELETE only via set_provider_service_categories()
-- (0014_rpc_job_functions.sql).
