-- =============================================================================
-- MALSEVK — Faz 1 migration 0002: service_categories catalog
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0002_service_catalog.sql'i ile birebir aynıdır (faz ayrımı bu tabloyu
-- etkilemez — Faz 1'in "Hizmet kategorileri" ve "Hizmet Veren hizmet
-- kategorileri" akışlarının doğrudan temeli).
--
-- Bugün (app/_lib/service-catalog.ts) hizmet kategorisi taksonomisi yalnızca
-- koddaki bir sabittir (`SERVICE_CATEGORY_GROUPS`), hiç depodan okunmaz.
-- Bu migration görevin istediği tabloyu oluşturur, ama uygulamanın ilk göçte
-- buradan okumaya geçmesi ZORUNLU değildir — "Code-first vs DB-first
-- catalog" notuna bakın.
-- =============================================================================

create table if not exists public.service_categories (
  id text primary key,
  slug text not null unique,
  name text not null,
  group_slug text not null,
  group_name text not null,
  is_active boolean not null default true,
  -- Mirrors job-visibility.ts#ISOLATED_SERVICE_CATEGORY_IDS: a category with
  -- visibility_scope = 'isolated' means a provider who has selected it can
  -- ONLY see jobs in isolated categories they've selected (union, not
  -- intersection — see provider_visible_jobs view, 0017_views.sql).
  visibility_scope text not null default 'standard'
    check (visibility_scope in ('standard', 'isolated')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.service_categories is
  'Service taxonomy catalog. Source of truth is still app/_lib/service-catalog.ts (code) at cutover time — see "Code-first vs DB-first" note below. Table exists so provider_services/jobs.category_id can FK something real from day one.';
comment on column public.service_categories.visibility_scope is
  'standard = visible to every hizmet-veren (subject to their own selected categories); isolated = a provider who selects this category can ONLY see isolated-category jobs matching their own selection (job-visibility.ts rule, currently: nakliye + gumruk-musavirligi).';

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 10 — idempotency):
-- DROP IF EXISTS + CREATE, ikinci çalıştırmada "trigger already exists"
-- hatasını önler (PostgreSQL'de CREATE TRIGGER IF NOT EXISTS yoktur).
drop trigger if exists trg_service_categories_set_updated_at on public.service_categories;
create trigger trg_service_categories_set_updated_at
  before update on public.service_categories
  for each row execute function public.set_updated_at();

revoke all on public.service_categories from authenticated, anon;
grant select on public.service_categories to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Code-first vs DB-first catalog: transition strategy
-- -----------------------------------------------------------------------------
-- Phase 1 (this migration): keep service-catalog.ts as the single source of
-- truth in application code, exactly as today. This table is populated by a
-- one-time seed (see 0019_seed_reference_data.sql) that copies
-- SERVICE_CATEGORY_GROUPS verbatim into rows here. provider_services and
-- jobs.category_id both FK this table, giving a real referential-integrity
-- backstop even while the app still treats the code constant as canonical.
-- A future flip to reading this table instead of the code constant is an
-- application-code change only (no schema change required), and is
-- explicitly out of scope for the Faz 1 cutover.
-- =============================================================================
