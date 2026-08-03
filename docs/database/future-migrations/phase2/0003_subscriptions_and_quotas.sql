-- =============================================================================
-- MALSEVK — Faz 2 TASLAK 0003: subscription_plans, subscription_plan_limits,
--                                 user_subscriptions, subscription_status_history,
--                                 user_limit_overrides, get_effective_limit()
-- =============================================================================
-- STATUS: FAZ 2 TASLAK — OTOMATİK ÇALIŞTIRILMAZ.
--
-- Bu dosya, faz-ayrımından önceki tasarımın 0012_subscriptions_and_quotas.sql'i
-- ile İÇERİK OLARAK AYNIDIR. Faz 1'de mevcut uygulamanın bugünkü kapasite
-- kuralı (MAX_ACTIVE_JOBS=5) supabase/migrations/0012_rls_helpers.sql'deki
-- SABİT get_active_job_limit() fonksiyonuyla korunuyor — bu dosya devreye
-- alındığında, TEK yapılması gereken get_active_job_limit()'i CREATE OR
-- REPLACE ile aşağıdaki gibi güncellemektir (hiçbir RPC/çağıran değişmez):
--
--   create or replace function public.get_active_job_limit()
--   returns integer language sql stable security definer set search_path = public
--   as $$ select get_effective_limit(auth.uid(), 'max_active_jobs')::integer $$;
--
-- Ayrıca create_offer()'a (Faz 1: supabase/migrations/0015) günlük teklif
-- kotası kontrolü GERİ EKLENMELİDİR (Faz 1'de YOK — bkz. o dosyanın başlık
-- notu, "mevcut uygulamada hiç kota yok"). Tam devreye alma adımları için
-- ../MANIFEST.md'ye bakın.
-- =============================================================================

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  billing_period text not null default 'monthly'
    check (billing_period in ('monthly', 'yearly', 'one_time')),
  price numeric(10, 2) not null default 0 check (price >= 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'USD')),
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_subscription_plans_set_updated_at
  before update on public.subscription_plans
  for each row execute function public.set_updated_at();

-- Free plan — bugünkü doğrulanmış davranışı birebir yansıtır: daily_offer_limit
-- = sınırsız (bugün hiç kota yok), max_active_jobs = 5 (MAX_ACTIVE_JOBS,
-- doğrulanmış).
insert into public.subscription_plans (code, name, description, price, is_public, sort_order)
values ('free', 'Ücretsiz', 'Varsayılan plan — mevcut sistemin bugünkü davranışını birebir yansıtır.', 0, true, 0)
on conflict (code) do nothing;

-- İllüstratif ücretli katmanlar KASITLI OLARAK seed edilmedi — hiçbir
-- fiyatlandırma/isimlendirme kararı verilmedi. Örnek (adapte edip
-- çalıştırmak isteyen bir operatör için):
--   insert into public.subscription_plans (code, name, price, is_public, sort_order)
--   values ('standard', 'Standart', 199.00, true, 1);

create table if not exists public.subscription_plan_limits (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans (id) on delete cascade,
  limit_key text not null,
  limit_value bigint,
  period_type text not null default 'concurrent'
    check (period_type in ('day', 'month', 'concurrent', 'boolean', 'bytes')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, limit_key)
);

create trigger trg_subscription_plan_limits_set_updated_at
  before update on public.subscription_plan_limits
  for each row execute function public.set_updated_at();

insert into public.subscription_plan_limits (plan_id, limit_key, limit_value, period_type)
select id, 'daily_offer_limit', null, 'day' from public.subscription_plans where code = 'free'
union all
select id, 'max_active_jobs', 5, 'concurrent' from public.subscription_plans where code = 'free'
on conflict (plan_id, limit_key) do nothing;

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  plan_id uuid not null references public.subscription_plans (id),
  status text not null default 'active'
    check (status in ('trialing', 'active', 'past_due', 'canceled')),
  started_at timestamptz not null default now(),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  trial_ends_at timestamptz,
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_user_subscriptions_set_updated_at
  before update on public.user_subscriptions
  for each row execute function public.set_updated_at();

create unique index if not exists user_subscriptions_one_active_per_user
  on public.user_subscriptions (user_id)
  where status in ('trialing', 'active');

create table if not exists public.subscription_status_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.user_subscriptions (id),
  previous_status text,
  new_status text not null,
  changed_by uuid references public.profiles (id),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.user_limit_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  limit_key text not null,
  limit_value bigint,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  granted_by uuid not null references public.profiles (id),
  reason text not null,
  created_at timestamptz not null default now()
);

revoke all on public.subscription_plans from authenticated, anon;
grant select on public.subscription_plans to authenticated, anon;
revoke all on public.subscription_plan_limits from authenticated, anon;
grant select on public.subscription_plan_limits to authenticated, anon;
revoke all on public.user_subscriptions from authenticated, anon;
grant select on public.user_subscriptions to authenticated;
revoke all on public.subscription_status_history from authenticated, anon;
grant select on public.subscription_status_history to authenticated;
revoke all on public.user_limit_overrides from authenticated, anon;
grant select on public.user_limit_overrides to authenticated;

create or replace function public.get_effective_limit(p_user_id uuid, p_limit_key text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_override bigint;
  v_has_override boolean := false;
  v_plan_limit bigint;
  v_has_plan_limit boolean := false;
begin
  select limit_value, true into v_override, v_has_override
  from public.user_limit_overrides
  where user_id = p_user_id
    and limit_key = p_limit_key
    and valid_from <= now()
    and (valid_until is null or valid_until > now())
  order by created_at desc
  limit 1;

  if v_has_override then
    return v_override;
  end if;

  select spl.limit_value, true into v_plan_limit, v_has_plan_limit
  from public.user_subscriptions us
  join public.subscription_plan_limits spl on spl.plan_id = us.plan_id and spl.limit_key = p_limit_key
  where us.user_id = p_user_id and us.status in ('trialing', 'active')
  order by us.current_period_start desc nulls last
  limit 1;

  if v_has_plan_limit then
    return v_plan_limit;
  end if;

  select spl.limit_value into v_plan_limit
  from public.subscription_plan_limits spl
  join public.subscription_plans sp on sp.id = spl.plan_id
  where sp.code = 'free' and spl.limit_key = p_limit_key;

  return v_plan_limit;
end;
$$;

comment on function public.get_effective_limit(uuid, text) is
  'Çözüm sırası: aktif user_limit_overrides (en yeni) > aktif user_subscriptions''ın plan limiti > free plan''ın limiti > NULL (sınırsız).';
