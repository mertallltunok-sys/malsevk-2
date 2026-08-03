-- =============================================================================
-- MALSEVK — Faz 1 migration 0004: operations, jobs, job_photos
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DEĞİŞİKLİK (önceki tasarımın 0005_operations_and_jobs.sql'ine göre):
-- `operations.total_service_count` STORED KOLONU KALDIRILDI. Önceki tasarım
-- bu kolonu "hiçbir doğrulanmış özellik bir operasyondan hizmet
-- eklemez/çıkarmaz" varsayımıyla oluşturmuş bekleniyordu, ama mevcut
-- uygulamada bir operasyonun TEK bir kardeş ilanı bağımsız olarak
-- silinebilir/kapatılabilir (bkz. CLAUDE.md "Sibling jobs are fully
-- independent after creation" — deleteJobWithOffers herhangi bir job'a
-- operasyon-seviyeli kısıt olmadan uygulanır). Kaynak uygulamada silme HARD
-- delete'tir (job dizi elemanı tamamen kaldırılır), bu şemada ise
-- `deleted_at` ile SOFT delete'tir — "toplam" ve "kalan" sayılarının
-- birbirine karışmaması için STORED bir kolon yerine CANLI hesaplama tercih
-- edildi (bkz. operation_progress view, 0017_views.sql): "Operasyon X Hizmet
-- Arıyor" rozetinin kullandığı sayı her zaman
-- `count(*) where operation_id = X and deleted_at is null` olmalı — bu,
-- kaynak uygulamanın "silinen kardeş artık dizide yok, dolayısıyla toplam
-- zaten ona göre küçülür" davranışını soft-delete modelinde birebir
-- yeniden üretir. Tek doğruluk kaynağı operation_progress view'ıdır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- operations
-- -----------------------------------------------------------------------------
-- Bugün gerçek bir "operation" kaydı yok — Job.operationId yalnızca paylaşılan
-- bir gruplama UUID'si, "operasyon durumu" tamamen üye ilanların
-- tekliflerinden canlı türetiliyor (job-requests.ts#getOperationStatusBucket
-- / accumulateOperationStatusCounts). Bu tablo, sorgu kolaylığı ve iki
-- sistem-yönetimli terminal zaman damgası için var olan, kasıtlı olarak
-- ince bir başlık satırıdır — "bu operasyon ne durumda" sorusunun ikinci,
-- rakip bir doğruluk kaynağı HALİNE GELMEZ.
create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id),
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Sistem-yönetimli (tetikleyici ile, aşağıda), client tarafından
  -- YAZILAMAZ: her üye ilan bağımsız olarak "resolved" (tamamlandı, manuel
  -- kapatıldı veya süresi doldu) hale geldiği anda damgalanır — mirrors
  -- job-completion.ts#isJobFullyCompletedForListing's all-siblings-resolved
  -- rule exactly.
  closed_at timestamptz,
  completed_at timestamptz
);

comment on table public.operations is
  'Thin header row grouping a Coklu Hizmet Operasyonu''s sibling jobs. NOT a source of truth for per-member or aggregate status, and NOT a source of truth for member count either (bkz. dosya başlığı) — see operation_progress view (0017_views.sql) for the live-derived equivalent of job-requests.ts#getOperationStatusBucket/getPublicOperationStatusSummary, INCLUDING the total/remaining service count.';
comment on column public.operations.closed_at is
  'Set by trg_operations_recompute_terminal_state (below) once every NON-DELETED member job independently resolved. Distinct from completed_at — see that trigger''s body. Never set directly by client code.';

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 10 — idempotency):
-- bu dosyadaki TÜM CREATE TRIGGER ifadeleri artık DROP IF EXISTS ile
-- öncelenmiştir.
drop trigger if exists trg_operations_set_updated_at on public.operations;
create trigger trg_operations_set_updated_at
  before update on public.operations
  for each row execute function public.set_updated_at();

-- No `status` column, no stored count column: every "what state / how many
-- services" question is answered by the operation_progress view
-- (0017_views.sql), computed live from member jobs/offers on every read,
-- exactly like the source app does today.

revoke all on public.operations from authenticated, anon;
grant select on public.operations to authenticated;
-- INSERT happens only via create_operation_with_jobs() (SECURITY DEFINER,
-- 0014_rpc_job_functions.sql); closed_at/completed_at are trigger-set, never
-- client-writable under any grant. The RPC itself still enforces "at least
-- 2 services" (MLK53) — this was never expressible as a table CHECK anyway
-- once services live in a separate `jobs` table.

-- -----------------------------------------------------------------------------
-- jobs
-- -----------------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.operations (id) on delete restrict,
  requester_id uuid not null references public.profiles (id),
  category_id text not null references public.service_categories (id),

  title text not null,
  description text not null,
  operation_details text not null,

  -- MALSEVK is Kocaeli-only today, kept as a real unconstrained text column
  -- for a future nationwide rollout without a schema change.
  province text not null,
  district text not null,
  work_location_type text not null,
  facility_id text,
  location_mode text not null default 'catalog'
    check (location_mode in ('catalog', 'custom')),
  address_text text not null default '',
  neighborhood text,
  location_url text,
  directions_note text,
  -- company_or_factory_name intentionally NOT included: legacy/removed from
  -- both job-creation and job-edit forms in the current app.

  work_date date not null,
  work_end_date date,
  constraint jobs_work_end_date_after_start
    check (work_end_date is null or work_end_date >= work_date),

  listing_status text not null default 'yayinda'
    check (listing_status in ('yayinda', 'tamamlandi', 'iptal')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  publish_end_at timestamptz not null default (now() + interval '14 days'),

  closed_at timestamptz,
  closure_reason text
    check (closure_reason is null or closure_reason in
      ('baska-hizmet-verenle-anlasildi', 'hizmete-ihtiyac-kalmadi', 'yanlislikla-olusturuldu', 'diger')),
  constraint jobs_closure_reason_requires_closed_at
    check (closure_reason is null or closed_at is not null),

  completed_at timestamptz,

  republished_from_job_id uuid references public.jobs (id),
  republished_to_job_id uuid references public.jobs (id),
  constraint jobs_not_self_republished_from check (republished_from_job_id is null or republished_from_job_id <> id),
  constraint jobs_not_self_republished_to check (republished_to_job_id is null or republished_to_job_id <> id),

  deleted_at timestamptz
);

comment on table public.jobs is
  'One row per Job, whether standalone (operation_id null) or one member of a Coklu Hizmet Operasyonu. Maps app/_lib/types.ts#Job field-for-field — see docs/database/schema-reference.md.';
comment on column public.jobs.listing_status is
  'Mirrors today''s Job.status EXACTLY: 3 values, set to ''yayinda'' once at creation and never transitioned again for a real job — every "is this listing open for new offers / has work started / is it closed" question is answered by offers.status + closed_at/publish_end_at instead (see active_job_listings/job_offer_summary views), never by this column.';
comment on column public.jobs.operation_id is
  'Nullable — most jobs are standalone. When set, must belong to an operation owned by the SAME requester as this job (enforced by trg_jobs_operation_requester_matches below).';
comment on column public.jobs.republished_from_job_id is
  'Self-referencing FK, matches types.ts#Job.republishedFromJobId/republishedToJobId''s two-way link exactly. Partial unique indexes below enforce "each old job republishes to at most one new job" and vice versa.';

drop trigger if exists trg_jobs_set_updated_at on public.jobs;
create trigger trg_jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create unique index if not exists jobs_republished_to_job_id_unique
  on public.jobs (republished_to_job_id)
  where republished_to_job_id is not null;
create unique index if not exists jobs_republished_from_job_id_unique
  on public.jobs (republished_from_job_id)
  where republished_from_job_id is not null;

create or replace function public.ensure_job_requester_is_hizmet_alan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = new.requester_id and role = 'hizmet-alan'
  ) then
    raise exception 'MLK10: jobs.requester_id must belong to a hizmet-alan profile' using errcode = 'MLK10';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_requester_is_hizmet_alan on public.jobs;
create trigger trg_jobs_requester_is_hizmet_alan
  before insert or update of requester_id on public.jobs
  for each row execute function public.ensure_job_requester_is_hizmet_alan();

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 9 — EXECUTE
-- izinleri): tetikleyici fonksiyonu, hiçbir client/RPC'nin doğrudan
-- çağırmasına gerek yok — yalnızca yukarıdaki tetikleyici tarafından
-- çağrılır.
revoke all on function public.ensure_job_requester_is_hizmet_alan() from public, anon, authenticated;

create or replace function public.ensure_job_operation_requester_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.operation_id is not null and not exists (
    select 1 from public.operations
    where id = new.operation_id and requester_id = new.requester_id
  ) then
    raise exception 'MLK11: jobs.operation_id must belong to an operation owned by the same requester' using errcode = 'MLK11';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_operation_requester_matches on public.jobs;
create trigger trg_jobs_operation_requester_matches
  before insert or update of operation_id, requester_id on public.jobs
  for each row execute function public.ensure_job_operation_requester_matches();

revoke all on function public.ensure_job_operation_requester_matches() from public, anon, authenticated;

-- Stamps operations.closed_at/completed_at once every NON-DELETED member job
-- is independently resolved — mirrors job-completion.ts#isJobFullyCompletedForListing's
-- "tamamlandi bucket OR manually closed OR expired, for every (non-deleted)
-- sibling" rule.
create or replace function public.recompute_operation_terminal_state(p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_resolved integer;
  v_completed integer;
begin
  select count(*),
         count(*) filter (
           where listing_status = 'tamamlandi'
              or closed_at is not null
              or (publish_end_at < now())
         ),
         count(*) filter (where listing_status = 'tamamlandi')
    into v_total, v_resolved, v_completed
  from public.jobs
  where operation_id = p_operation_id and deleted_at is null;

  if v_total > 0 and v_total = v_resolved then
    update public.operations
      set closed_at = coalesce(closed_at, now()),
          completed_at = case when v_total = v_completed then coalesce(completed_at, now()) else completed_at end
      where id = p_operation_id;
  end if;
end;
$$;

-- DÜZELTME (SUPABASE-MIGRATION-VALIDATION.md §20, madde 9 — EXECUTE
-- izinleri): bu, aşağıdaki tetikleyici DIŞINDA hiçbir yerden çağrılmaz;
-- doğrudan client çağrısına gerek yok.
revoke all on function public.recompute_operation_terminal_state(uuid) from public, anon, authenticated;

create or replace function public.trg_jobs_recompute_operation_terminal_state()
returns trigger
language plpgsql
as $$
begin
  if new.operation_id is not null then
    perform public.recompute_operation_terminal_state(new.operation_id);
  end if;
  return null;
end;
$$;

revoke all on function public.trg_jobs_recompute_operation_terminal_state() from public, anon, authenticated;

drop trigger if exists trg_jobs_after_change_recompute_operation on public.jobs;
create trigger trg_jobs_after_change_recompute_operation
  after insert or update of listing_status, closed_at, publish_end_at, deleted_at on public.jobs
  for each row execute function public.trg_jobs_recompute_operation_terminal_state();

-- DUZELTME (yerel dry-run, gercek bulgu): public.jobs icin de HICBIR acik
-- "revoke all"/"grant select" yoktu -- profiles/provider_profiles'daki
-- ayni sinifta bulgu (bkz. 0003), farki jobs'un canli veritabaninda anon
-- bile SELECT'e (Supabase'in varsayilan yetkisi uzerinden, tesadufen)
-- sahipti -- bu kismen dogru davranisla ORTUSUYORDU (jobs_select_visible
-- RLS politikasi, 0013, gercekten "to authenticated, anon" -- misafirler
-- ilanlari gorebilir, uygulamanin bilinen bir ozelligi) ama anon+
-- authenticated AYNI ZAMANDA TRUNCATE/REFERENCES/TRIGGER de taniyordu --
-- TRUNCATE RLS'e tabi degildir, yani herhangi bir misafir bile TUM jobs
-- tablosunu silebilirdi. Duzeltme: once tum yetkiler geri alinir, sonra
-- yalniz SELECT (RLS politikasinin kendi "to" listesiyle birebir: hem
-- authenticated hem anon) acikca geri verilir.
revoke all on public.jobs from public, authenticated, anon;
grant select on public.jobs to authenticated, anon;

revoke update on public.jobs from authenticated;
grant update (title, description, operation_details, province, district, work_location_type,
  facility_id, location_mode, address_text, neighborhood, location_url, directions_note,
  work_date, work_end_date)
  on public.jobs to authenticated;
-- listing_status / closed_at / closure_reason / completed_at / publish_end_at /
-- republished_from_job_id / republished_to_job_id / deleted_at are ALL
-- system/RPC-only — see 0014_rpc_job_functions.sql (update_job/close_job/
-- republish_job), 0016 (close_job_as_admin/delete_job_as_admin) and the
-- scheduled expiry job (0018_scheduled_jobs.sql).

-- -----------------------------------------------------------------------------
-- job_photos
-- -----------------------------------------------------------------------------
create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10 * 1024 * 1024),
  width integer,
  height integer,
  sort_order integer not null default 0,
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.job_photos is
  'Metadata only — the file itself lives in Supabase Storage (job-photos bucket, see docs/database/storage-plan.md). Photo count bounds (1-10, verified from photo-validation.ts#MIN_PHOTOS/MAX_PHOTOS) are enforced at the RPC layer (create_job/create_operation_with_jobs/update_job/republish_job — ALL FOUR, see 0014), not by a table CHECK (cannot express COUNT(*) per job_id as a row-level CHECK).';
comment on column public.job_photos.size_bytes is
  '10 MB cap matches app/_lib/photo-validation.ts#MAX_PHOTO_SIZE_BYTES exactly.';

create unique index if not exists job_photos_job_id_sort_order_unique
  on public.job_photos (job_id, sort_order)
  where deleted_at is null;

revoke all on public.job_photos from authenticated, anon;
grant select on public.job_photos to authenticated;
