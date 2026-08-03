-- =============================================================================
-- MALSEVK — Faz 3 TASLAK 0002: payment_webhook_events, outbox_events
-- =============================================================================
-- STATUS: FAZ 3 TASLAK — OTOMATİK ÇALIŞTIRILMAZ. İçerik, faz-ayrımından
-- önceki tasarımın 0014_payment_webhook_events.sql'i ile AYNIDIR.
-- =============================================================================

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_verified boolean not null default false,
  processing_status text not null default 'received'
    check (processing_status in ('received', 'verified', 'processing', 'processed', 'failed', 'ignored')),
  processing_error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint payment_webhook_events_no_unverified_processed
    check (processing_status <> 'processed' or signature_verified = true),
  constraint payment_webhook_events_unique_per_provider unique (provider, external_event_id)
);

create or replace function public.reject_sensitive_webhook_payload()
returns trigger
language plpgsql
as $$
declare
  v_forbidden_keys text[] := array['card_number', 'cardnumber', 'pan', 'cvv', 'cvc', 'card_cvv', 'security_code'];
  v_key text;
begin
  foreach v_key in array v_forbidden_keys loop
    if new.payload ? v_key then
      raise exception 'MLK41: webhook payload must never contain raw card data (key: %)', v_key using errcode = 'MLK41';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_reject_sensitive_webhook_payload on public.payment_webhook_events;
create trigger trg_reject_sensitive_webhook_payload
  before insert or update on public.payment_webhook_events
  for each row execute function public.reject_sensitive_webhook_payload();

revoke all on public.payment_webhook_events from authenticated, anon;
-- No SELECT grant even — bkz. dosyanın orijinal notu: webhook payload'ları
-- son kullanıcıya yönelik olmayan sağlayıcı-içi tanımlayıcılar içerebilir.

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

revoke all on public.outbox_events from authenticated, anon;
-- service_role / SECURITY DEFINER RPC only.
