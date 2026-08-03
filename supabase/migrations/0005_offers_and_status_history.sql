-- =============================================================================
-- MALSEVK — Faz 1 migration 0005: offers, offer_status_history
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- GÜVENLİK DÜZELTMESİ (önceki teknik denetim raporunun B.1 "Kritik" bulgusu):
-- `offers_one_settled_per_job` partial unique index EKLENDİ. Önceki tasarım
-- yalnızca `offers_one_blocking_per_job_provider` (job_id, provider_id)
-- çiftini kısıtlıyordu — bu, AYNI sağlayıcının aynı ilana iki teklif
-- vermesini engelliyordu ama İKİ FARKLI sağlayıcının aynı ilandaki
-- tekliflerinin EŞZAMANLI olarak ikisinin de "accepted" olmasına karşı HİÇBİR
-- DB seviyeli engel yoktu (accept_offer()'daki pg_advisory_xact_lock
-- provider_id üzerine alınıyordu, job_id üzerine değil — bkz.
-- 0015_rpc_offer_functions.sql'in accept_offer() üzerindeki notu). Yeni
-- index, "bir ilanda en fazla bir SETTLED (accepted/in_progress/
-- completion_requested/completion_disputed/completed) teklif olabilir"
-- kuralını doğrudan veritabanı seviyesinde, RPC'yi bypass eden bir yazımda
-- bile garanti eder.
-- =============================================================================

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id),
  provider_id uuid not null references public.profiles (id),

  amount numeric(12, 2) not null check (amount > 0 and amount <= 999999999),
  currency text not null check (currency in ('TRY', 'USD')),
  description text not null check (char_length(description) between 20 and 1000),
  estimated_duration text not null check (char_length(estimated_duration) between 2 and 100),

  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'rejected', 'withdrawn', 'in_progress',
    'agreement_failed', 'completion_requested', 'completion_disputed',
    'completed', 'cancelled'
  )),

  disagreement_reason text check (disagreement_reason is null or disagreement_reason in (
    'telefona_ulasilamadi', 'epostaya_donus_olmadi', 'fiyatta_anlasilamadi',
    'tarih_planinda_anlasilamadi', 'hizmet_veren_yapamayacagini_bildirdi',
    'hizmet_alan_vazgecti', 'diger'
  )),
  disagreement_note text,
  completion_dispute_note text check (
    completion_dispute_note is null or char_length(completion_dispute_note) between 10 and 1000
  ),

  completion_requested_by uuid references public.profiles (id),
  completion_requested_at timestamptz,
  auto_completed boolean not null default false,

  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  withdrawn_at timestamptz,
  agreement_failed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.offers is
  'Maps app/_lib/types.ts#Offer field-for-field, plus per-transition timestamp columns with no direct source-app equivalent. The offer state machine itself is enforced entirely by the RPC layer (0015_rpc_offer_functions.sql), never by a client UPDATE.';

create trigger trg_offers_set_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- "At most one blocking offer per (job_id, provider_id)" — matches the
-- REOFFER_COOLDOWN model exactly (verified: app/_lib/job-requests.ts#
-- REOFFER_COOLDOWN_DAYS = 3, REOFFER_COOLDOWN_OFFER_STATUSES = withdrawn/
-- rejected/agreement_failed; app/_lib/offers.ts#createOffer's own
-- findLast-over-history read pattern).
-- -----------------------------------------------------------------------------
create unique index if not exists offers_one_blocking_per_job_provider
  on public.offers (job_id, provider_id)
  where status not in ('withdrawn', 'rejected', 'agreement_failed');

comment on index public.offers_one_blocking_per_job_provider is
  'Enforces: at most one non-retry-eligible offer per (job, provider) pair. Rows with status withdrawn/rejected/agreement_failed are excluded so multiple historical retries can coexist (3-day cooldown, enforced in create_offer(), 0015). This does NOT protect against two DIFFERENT providers'' offers on the SAME job both settling — see offers_one_settled_per_job below for that.';

-- -----------------------------------------------------------------------------
-- GÜVENLİK DÜZELTMESİ (B.1): "At most one SETTLED offer per job", across
-- every provider — this is the actual database-level guarantee behind
-- "Single active acceptance per job" (job-requests.ts#getSettledOfferForJob /
-- isOfferPendingActionBlocked). Mirrors is_engaged_offer_status()'s four
-- values (0012_rls_helpers.sql) plus 'completed'.
-- -----------------------------------------------------------------------------
create unique index if not exists offers_one_settled_per_job
  on public.offers (job_id)
  where status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed', 'completed');

comment on index public.offers_one_settled_per_job is
  'GÜVENLİK: bir job_id için en fazla bir teklif "settled" (accepted..completed) durumunda olabilir. accept_offer() (0015) bu index''in unique-violation''ını yakalayıp MLK67''ye çevirir — bu, RPC''nin kendi is_offer_pending_action_blocked() ön-kontrolünün (TOCTOU''ya açık bir MVCC-anlık-görüntü okuması) YETERSİZ kaldığı tam senaryoda (iki farklı sağlayıcının aynı ilandaki tekliflerinin eşzamanlı kabulü) gerçek korumayı sağlayan katmandır.';

-- -----------------------------------------------------------------------------
-- Role/self-offer guards
-- -----------------------------------------------------------------------------
create or replace function public.ensure_offer_provider_is_hizmet_veren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_requester uuid;
begin
  if not exists (
    select 1 from public.profiles where id = new.provider_id and role = 'hizmet-veren'
  ) then
    raise exception 'MLK20: offers.provider_id must belong to a hizmet-veren profile' using errcode = 'MLK20';
  end if;

  select requester_id into v_job_requester from public.jobs where id = new.job_id;
  if v_job_requester is null then
    raise exception 'MLK21: offers.job_id does not reference an existing job' using errcode = 'MLK21';
  end if;
  if v_job_requester = new.provider_id then
    raise exception 'MLK22: a provider cannot offer on their own job' using errcode = 'MLK22';
  end if;

  return new;
end;
$$;

create trigger trg_offers_provider_is_hizmet_veren
  before insert or update of provider_id, job_id on public.offers
  for each row execute function public.ensure_offer_provider_is_hizmet_veren();

revoke all on public.offers from authenticated, anon;
grant select on public.offers to authenticated;
-- No INSERT/UPDATE/DELETE grant at all: every state transition is a
-- dedicated RPC in 0015_rpc_offer_functions.sql.

-- -----------------------------------------------------------------------------
-- offer_status_history — append-only transition log
-- -----------------------------------------------------------------------------
create table if not exists public.offer_status_history (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  previous_status text,
  new_status text not null,
  -- NULL = system-initiated transition (the 7-day auto-completion
  -- scheduled job, 0018_scheduled_jobs.sql) rather than a specific user.
  changed_by uuid references public.profiles (id),
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.offer_status_history is
  'Append-only. Every offer status transition RPC inserts exactly one row here in the same transaction as the offers UPDATE.';

revoke all on public.offer_status_history from authenticated, anon;
grant select on public.offer_status_history to authenticated;
