# MALSEVK — Payment Integration Readiness (Faz 3)

**Faz 3'e ertelendi** — bu dosyanın belgelediği her tablo `supabase/migrations/` DIŞINDA, `docs/database/future-migrations/phase3/0001_payment_foundations.sql` ve `phase3/0002_payment_webhook_events_and_outbox.sql`'dedir; Supabase CLI tarafından otomatik uygulanmaz. Bir önceki teknik denetim raporunun "ödeme tabloları ilk göç için erken" bulgusunun doğrudan sonucu — devreye alma ön koşulu (bir ödeme sağlayıcısının seçilmesi) için `docs/database/future-migrations/MANIFEST.md`'ye bakın.

Implements `phase3/0001_payment_foundations.sql` and `phase3/0002_payment_webhook_events_and_outbox.sql`. **No real payment provider is connected, and no provider-specific code exists anywhere in this design pass** — every table is provider-agnostic (`provider text` distinguishes iyzico/PayTR/Stripe/etc. rows; nothing is shaped around any one provider's API).

## Tables built

`payment_customers`, `payment_transactions`, `payment_attempts`, `payment_refunds`, `invoices`, `payment_webhook_events`, `outbox_events`.

## Architectural difference from every other part of this schema

Every other write path in this schema is a client-callable `SECURITY DEFINER` RPC. **Payment tables are the one exception**: they are written by a trusted Supabase Edge Function running as `service_role`, because charging a card requires an outbound HTTPS call to an external provider — something a Postgres function cannot safely or practically make. `authenticated` gets `SELECT` only, on their own rows, via RLS (see [rls-matrix.md](rls-matrix.md)); there is no `grant execute` on any payment-mutating RPC because none exists — the mutation happens in the Edge Function's own database writes, authenticated as `service_role`, which bypasses RLS entirely by Postgres/Supabase convention.

## No card data, ever — enforced at two levels

1. **Discipline**: a compliant provider integration (iyzico/PayTR/Stripe-equivalent) never sends raw PAN/CVV to your own backend in the first place — only tokens/references. This is the primary control and lives entirely in how the (not-yet-written) Edge Function is implemented.
2. **Defense-in-depth, enforced by the database itself**: `reject_sensitive_payment_metadata()`/`reject_sensitive_webhook_payload()` triggers (0013/0014) scan every `jsonb` metadata/payload column for a small forbidden-key list (`card_number`, `cvv`, `cvc`, `pan`, ...) and **reject the INSERT outright** if found — a genuine second layer, not just documentation, that would catch a bug in the Edge Function's payload construction before it ever persists.

## Duplicate webhook prevention — answering the brief directly

**"Aynı webhook iki kez işlense bile duplicate ödeme veya abonelik oluşmamalı"** — the mechanism is `payment_webhook_events`'s `UNIQUE (provider, external_event_id)` constraint. Every payment provider redelivers webhooks by design (on any timeout or non-2xx response), so this is not a hypothetical edge case — it is the normal operating condition. The Edge Function's insert becomes `ON CONFLICT (provider, external_event_id) DO NOTHING` (or an equivalent "already seen, return 200 immediately" check) on redelivery, making the processing logic naturally idempotent regardless of how many times the same event is delivered.

**Signature verification is a hard gate, enforced at the DB level too**: `payment_webhook_events_no_unverified_processed` CHECK constraint makes it structurally impossible for any row to reach `processing_status = 'processed'` without `signature_verified = true` having been set first — "Webhook imzası doğrulanmadan iş verisi güncellenmemelidir" is not just a coding guideline the Edge Function is supposed to follow, it is a constraint the database itself enforces.

## Consistency across the payment ↔ subscription boundary

- **"Ödeme başarılı, abonelik aktivasyonu başarısız"**: the webhook-processing Edge Function performs the `payment_transactions` update and the `user_subscriptions` activation in **one ordinary SQL transaction** — both succeed or both roll back. If the transaction itself fails, the webhook event stays at a non-`processed` status and is retried on the next redelivery (providers retry automatically) or via the `attempts` counter on `payment_webhook_events` if a manual retry mechanism is added later.
- **"Abonelik aktif, ödeme başarısız"**: prevented by construction, not by a reconciliation job — `user_subscriptions.status` is only ever set to `'active'` by the same transaction that recorded the underlying successful `payment_transactions` row (or by an admin's explicit `assign_subscription_plan()`, a deliberately manual/audited path, not a payment-driven one).

## `outbox_events` — what it's for, and what it's not for

The payment-activation consistency above needs **no** outbox — it's a single ordinary transaction, which is already atomic. `outbox_events` exists for side effects that must happen **after** that transaction commits and may target something entirely outside this database (a future accounting-system export, a transactional email/SMS send) — the classic transactional-outbox pattern. Included as requested infrastructure; **not wired to any specific producer or consumer** in this design pass, since no such external integration exists yet to design against. Recommended (not built) relay pattern: a scheduled Edge Function polling `WHERE status = 'pending'`.

## `webhook_processing_attempts` — deliberately not a separate table

`payment_webhook_events.attempts` (a plain counter) plus `processing_error` (the most recent failure) covers this need without a redundant one-to-many table — unlike `payment_attempts` (which genuinely needs a full request/response payload per retry, since each is a distinct outbound call to the provider), a webhook redelivery replays against the **same, already-stored** payload every time; there is no new request/response pair worth keeping per attempt.

## "Ödeme sağlayıcısı değiştirilirse veri modeli korunabilir mi?" — yes, by design

Every table's `provider text` column is exactly what makes this true: switching from iyzico to PayTR (or adding a second provider alongside the first) means new rows with a different `provider` value, using the same six tables, the same RLS policies, the same `idempotency_key`/webhook-dedup mechanisms. Nothing in this schema encodes a specific provider's field names, status vocabulary, or webhook shape — `metadata`/`payload` `jsonb` columns absorb whatever provider-specific detail doesn't map to a first-class column.

## Open Decisions

1. **Actual provider selection** (iyzico vs. PayTR vs. Stripe-equivalent) is entirely undecided and out of scope for this pass — the schema was built to not need to know.
2. **Invoicing/e-Fatura integration** — `invoices.document_path` is a placeholder column; no generation logic, Turkish e-Fatura/e-Arşiv compliance work, or numbering scheme is designed here.
3. **Reconciliation tooling** (comparing `payment_transactions` against the provider's own dashboard/statement for drift) is not designed — recommended as a follow-up once a real provider is chosen, since the exact reconciliation data format is provider-specific.
