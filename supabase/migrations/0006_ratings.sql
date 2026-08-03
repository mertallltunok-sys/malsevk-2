-- =============================================================================
-- MALSEVK — Faz 1 migration 0006: ratings
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0007_ratings.sql'i ile aynıdır (faz ayrımı bu tabloyu etkilemez).
-- =============================================================================

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  job_id uuid not null references public.jobs (id),
  provider_id uuid not null references public.profiles (id),
  rater_id uuid not null references public.profiles (id),
  stars integer not null check (stars between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint ratings_one_per_offer unique (offer_id),
  constraint ratings_rater_not_provider check (rater_id <> provider_id)
);

comment on table public.ratings is
  'One row per completed Offer, submitted once by the job''s requester. Immutable after creation in the source app (no update path exists).';

drop trigger if exists trg_ratings_set_updated_at on public.ratings;
create trigger trg_ratings_set_updated_at
  before update on public.ratings
  for each row execute function public.set_updated_at();

create or replace function public.ensure_rating_matches_completed_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer record;
begin
  select status, job_id, provider_id into v_offer from public.offers where id = new.offer_id;
  if v_offer is null then
    raise exception 'MLK30: ratings.offer_id does not reference an existing offer' using errcode = 'MLK30';
  end if;
  if v_offer.status <> 'completed' then
    raise exception 'MLK31: only a completed offer can be rated' using errcode = 'MLK31';
  end if;
  if v_offer.job_id <> new.job_id or v_offer.provider_id <> new.provider_id then
    raise exception 'MLK32: ratings.job_id/provider_id must match the referenced offer' using errcode = 'MLK32';
  end if;
  if not exists (
    select 1 from public.jobs where id = new.job_id and requester_id = new.rater_id
  ) then
    raise exception 'MLK33: rater_id must be the requester of the rated job' using errcode = 'MLK33';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ratings_matches_completed_offer on public.ratings;
create trigger trg_ratings_matches_completed_offer
  before insert on public.ratings
  for each row execute function public.ensure_rating_matches_completed_offer();

revoke all on function public.ensure_rating_matches_completed_offer() from public, anon, authenticated;

revoke all on public.ratings from authenticated, anon;
grant select on public.ratings to authenticated, anon;
-- INSERT only via submit_rating() (0015_rpc_offer_functions.sql), which
-- additionally enforces the 30-day auto-completed review window
-- (AUTO_COMPLETED_RATING_WINDOW_DAYS = 30, verified: app/_lib/ratings.ts).

-- Average-rating storage decision: NOT a denormalized column. A
-- `provider_rating_summary` VIEW (0017_views.sql) computes it live from this
-- table + offers, avoiding the "denormalized average drifted from the real
-- rows" bug class entirely.
