-- =============================================================================
-- MALSEVK — Faz 3 TASLAK 0003: ödeme tabloları için RLS + admin_payment_summary
-- =============================================================================
-- STATUS: FAZ 3 TASLAK — OTOMATİK ÇALIŞTIRILMAZ.
-- =============================================================================

alter table public.payment_customers enable row level security;
create policy payment_customers_select_own_or_permission on public.payment_customers
  for select to authenticated
  using (user_id = auth.uid() or public.has_admin_permission('payments.view'));

alter table public.payment_transactions enable row level security;
create policy payment_transactions_select_own_or_permission on public.payment_transactions
  for select to authenticated
  using (user_id = auth.uid() or public.has_admin_permission('payments.view'));

alter table public.payment_attempts enable row level security;
create policy payment_attempts_select_own_or_permission on public.payment_attempts
  for select to authenticated
  using (
    exists (select 1 from public.payment_transactions pt where pt.id = payment_attempts.payment_transaction_id and pt.user_id = auth.uid())
    or public.has_admin_permission('payments.view')
  );

alter table public.payment_refunds enable row level security;
create policy payment_refunds_select_own_or_permission on public.payment_refunds
  for select to authenticated
  using (
    exists (select 1 from public.payment_transactions pt where pt.id = payment_refunds.payment_transaction_id and pt.user_id = auth.uid())
    or public.has_admin_permission('payments.view')
  );

alter table public.invoices enable row level security;
create policy invoices_select_own_or_permission on public.invoices
  for select to authenticated
  using (user_id = auth.uid() or public.has_admin_permission('payments.view'));

alter table public.payment_webhook_events enable row level security;
create policy payment_webhook_events_select_permission_only on public.payment_webhook_events
  for select to authenticated
  using (public.has_admin_permission('payments.view'));

alter table public.outbox_events enable row level security;
create policy outbox_events_select_service_only on public.outbox_events
  for select to authenticated
  using (false);

create or replace view public.admin_payment_summary
with (security_invoker = false)
as
select
  (select count(*) from public.payment_transactions where status = 'succeeded') as succeeded_count,
  (select coalesce(sum(amount), 0) from public.payment_transactions where status = 'succeeded') as succeeded_amount,
  (select count(*) from public.payment_transactions where status = 'failed') as failed_count,
  (select count(*) from public.payment_refunds where status = 'succeeded') as refund_count
where public.has_admin_permission('payments.view');

revoke all on public.admin_payment_summary from public;
grant select on public.admin_payment_summary to authenticated;

create index if not exists idx_payment_transactions_user_id_created_at
  on public.payment_transactions (user_id, created_at desc);
create index if not exists idx_payment_transactions_subscription_id
  on public.payment_transactions (subscription_id)
  where subscription_id is not null;
