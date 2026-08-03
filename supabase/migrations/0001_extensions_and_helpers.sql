-- =============================================================================
-- MALSEVK — Faz 1 migration 0001: extensions & shared primitives
-- =============================================================================
-- STATUS: FAZ 1 (ÇEKİRDEK PAZARYERİ) — bu klasördeki her dosya, ilk gerçek
-- Supabase göçünde uygulanması amaçlanan setin parçasıdır. Faz 2 (gelişmiş
-- admin RBAC + abonelik/kota) ve Faz 3 (ödeme/finans) taslakları bilerek bu
-- klasörün DIŞINDA, docs/database/future-migrations/ altında tutulur — bkz.
-- o klasörün MANIFEST.md dosyası. Bu, önceki denetim raporunun (bkz.
-- docs/database/migration-strategy.md ve mevcut sohbet geçmişindeki teknik
-- denetim) "ilk göç için gereksiz erken kapsam" bulgusunun doğrudan
-- karşılığıdır.
--
-- Bu dosyanın içeriği, önceki tasarımın 0001_extensions_and_types.sql'i ile
-- birebir aynıdır — Faz ayrımı bu dosyayı etkilemez (her üç fazın da ortak
-- ihtiyacı).
-- =============================================================================

-- pgcrypto provides gen_random_uuid(), used as the default for every primary
-- key in this schema (matches the app's existing crypto.randomUUID() id
-- generation 1:1 — no id-format translation needed during data migration).
create extension if not exists pgcrypto;

-- pg_trgm is not required by any query designed in this pass (no free-text
-- search feature exists in the current app). Deliberately NOT enabled here —
-- add it in a dedicated migration if/when a search feature is designed,
-- rather than enabling an unused extension "just in case".

-- -----------------------------------------------------------------------------
-- Design decision: CHECK constraints instead of native PostgreSQL ENUM types
-- -----------------------------------------------------------------------------
-- Every "status"/"reason"/"type" column in this schema is `text` with a
-- CHECK (col in (...)) constraint, not a native `CREATE TYPE ... AS ENUM`.
-- Rationale: the application's own status vocabularies have grown
-- incrementally (offer_status alone has 10 values, added in stages — see
-- CLAUDE.md's "Offer.status" narrative); native enums require
-- `ALTER TYPE ... ADD VALUE`, which cannot run inside the same transaction as
-- other DDL on older PostgreSQL and cannot remove/rename a value at all.
-- Supabase's PostgREST/JS client already returns enum-like columns as plain
-- strings, so there is no client-side benefit a CHECK constraint doesn't
-- already provide.
--
-- Design decision: existing Turkish status/reason VALUES are kept verbatim
-- -----------------------------------------------------------------------------
-- Column and table NAMES are English throughout this schema. Enum-like
-- VALUES are kept as their existing Turkish strings wherever the TypeScript
-- source already treats them as stable, machine-read codes:
--   - job closure reasons: 'baska-hizmet-verenle-anlasildi',
--     'hizmete-ihtiyac-kalmadi', 'yanlislikla-olusturuldu', 'diger'
--     (app/_lib/job-closure.ts#JobClosureReason)
--   - offer disagreement reasons: 'telefona_ulasilamadi',
--     'epostaya_donus_olmadi', 'fiyatta_anlasilamadi',
--     'tarih_planinda_anlasilamadi', 'hizmet_veren_yapamayacagini_bildirdi',
--     'hizmet_alan_vazgecti', 'diger' (app/_lib/types.ts#DisagreementReason)
--   - job listing_status: 'yayinda', 'tamamlandi', 'iptal'
--     (app/_lib/types.ts#JobStatus)
--   - service_categories.id / provider_services.service_category_id slugs
--     (e.g. 'nakliye', 'gumruk-musavirligi') (app/_lib/service-catalog.ts)
--   - offer_status's 10 values (pending/accepted/rejected/withdrawn/
--     in_progress/agreement_failed/completion_requested/completion_disputed/
--     completed/cancelled) — already English in the source app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger function
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Shared BEFORE UPDATE trigger: stamps updated_at := now() on every row update. Attached per-table; never call directly.';

-- -----------------------------------------------------------------------------
-- Standard column conventions (documentation only — nothing to execute)
-- -----------------------------------------------------------------------------
-- id            uuid primary key default gen_random_uuid()
-- created_at    timestamptz not null default now()
-- updated_at    timestamptz not null default now()  (mutable tables only)
-- deleted_at    timestamptz null                     (soft-delete tables only)
-- money amounts numeric(12,2)  — see 0005_offers_and_status_history.sql
-- currency      text not null check (currency in ('TRY','USD','EUR'))
--               (EUR eklendi — bkz. 0005 başlığı ve SUPABASE-MIGRATION-
--               VALIDATION.md §6.3: app/_lib/money.ts#CURRENCY_VALUES üç
--               değeri de destekliyor, önceki taslak yalnızca ikisini
--               kabul ediyordu.)
-- phone         text check (phone ~ '^\+905\d{9}$')
-- =============================================================================

-- -----------------------------------------------------------------------------
-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 9 — EXECUTE
-- izinleri): set_updated_at() yalnızca bir BEFORE UPDATE tetikleyicisi
-- olarak çağrılmak üzere tasarlanmıştır (NEW/OLD, yalnızca tetikleyici
-- bağlamında var olur) — hiçbir client/RPC bunu doğrudan çağırmamalıdır.
-- PostgreSQL, fonksiyonlara varsayılan olarak PUBLIC'e EXECUTE verdiği için
-- bu, en dar kapsamlı düzeltme olarak açıkça geri alınır.
-- -----------------------------------------------------------------------------
revoke all on function public.set_updated_at() from public, anon, authenticated;
