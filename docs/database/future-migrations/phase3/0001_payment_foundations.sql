-- =============================================================================
-- MALSEVK — Faz 3 TASLAK 0001: payment_customers, payment_transactions,
--                                 payment_attempts, payment_refunds, invoices
-- =============================================================================
-- STATUS: FAZ 3 TASLAK — OTOMATİK ÇALIŞTIRILMAZ. Ödeme sağlayıcısı henüz
-- SEÇİLMEDİ; bu dosya sağlayıcı-agnostiktir ve hiçbir provider-özel kod
-- içermez. İçerik, faz-ayrımından önceki tasarımın
-- 0013_payment_foundations.sql'i ile AYNIDIR — hiçbir değişiklik yapılmadı.
--
-- MİMARİ NOT: bu tablolar client-callable SECURITY DEFINER RPC ile değil,
-- service_role olarak çalışan güvenilir bir Supabase Edge Function ile
-- yazılır (kart ödemesi, dış bir HTTPS API'sine çıkış gerektirir — bir
-- Postgres fonksiyonu bunu güvenle yapamaz). `authenticated` yalnızca kendi
-- satırlarını RLS üzerinden SELECT edebilir.
-- =============================================================================

create table if not exists public.payment_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  provider text not null,
  external_customer_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_customer_id),
  unique (user_id, provider)
);

create trigger trg_payment_customers_set_updated_at
  before update on public.payment_customers
  for each row execute function public.set_updated_at();

revoke all on public.payment_customers from authenticated, anon;
grant select on public.payment_customers to authenticated;

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  subscription_id uuid references public.user_subscriptions (id),
  job_id uuid references public.jobs (id),
  offer_id uuid references public.offers (id),
  provider text not null,
  external_payment_id text,
  transaction_type text not null check (transaction_type in ('subscription_payment', 'job_payment', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'USD')),
  idempotency_key text not null unique,
  failure_code text,
  failure_message text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create trigger trg_payment_transactions_set_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

revoke all on public.payment_transactions from authenticated, anon;
grant select on public.payment_transactions to authenticated;

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions (id),
  attempt_number integer not null check (attempt_number > 0),
  provider_request_id text,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  request_metadata jsonb,
  response_metadata jsonb,
  created_at timestamptz not null default now(),
  unique (payment_transaction_id, attempt_number)
);

create or replace function public.reject_sensitive_payment_metadata()
returns trigger
language plpgsql
as $$
declare
  v_forbidden_keys text[] := array['card_number', 'cardnumber', 'pan', 'cvv', 'cvc', 'card_cvv', 'security_code'];
  v_key text;
begin
  foreach v_key in array v_forbidden_keys loop
    if (new.request_metadata ? v_key) or (new.response_metadata ? v_key) then
      raise exception 'MLK40: payment metadata must never contain raw card data (key: %)', v_key using errcode = 'MLK40';
    end if;
  end loop;
  return new;
end;
$$;

create trigger trg_reject_sensitive_payment_metadata
  before insert or update on public.payment_attempts
  for each row execute function public.reject_sensitive_payment_metadata();

revoke all on public.payment_attempts from authenticated, anon;
grant select on public.payment_attempts to authenticated;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions (id),
  external_refund_id text,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  reason text,
  requested_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

revoke all on public.payment_refunds from authenticated, anon;
grant select on public.payment_refunds to authenticated;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  subscription_id uuid references public.user_subscriptions (id),
  payment_transaction_id uuid references public.payment_transactions (id),
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  subtotal numeric(12, 2) not null check (subtotal >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  currency text not null default 'TRY' check (currency in ('TRY', 'USD')),
  issued_at timestamptz,
  due_at timestamptz,
  paid_at timestamptz,
  document_path text,
  created_at timestamptz not null default now(),
  constraint invoices_total_matches_subtotal_plus_tax check (total_amount = subtotal + tax_amount)
);

revoke all on public.invoices from authenticated, anon;
grant select on public.invoices to authenticated;
