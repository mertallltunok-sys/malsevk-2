# MALSEVK — Future Escrow / Pooled-Funds Architecture (Documentation Only)

**No SQL migration exists for anything in this document.** This is a design-on-paper for a feature that does not exist in the source app, was not requested to be built now, and — per explicit instruction — must not be added to the "today" migration set even in skeleton form. This holds across all three phases: it is not in Faz 1 (`supabase/migrations/0001`–`0021`), nor in the Faz 2/Faz 3 drafts (`docs/database/future-migrations/`). If/when a pooled-funds feature is greenlit, this document is the starting point for a **separate, dedicated migration group**, not an extension of any of the above.

## This is not just a technical feature

Holding a hizmet-alan's payment in trust until a job completes, then splitting it between MALSEVK (commission) and the hizmet-veren (payout), is a **regulated financial activity** in most jurisdictions, Turkey included — it is not simply "add some tables." Before any implementation work begins, this needs a real answer to: *does MALSEVK need to become, or partner with, a licensed payment institution to do this legally?* The guiding principle for everything below:

> **MALSEVK's own technical design must never assume it is legally permitted to hold user funds directly.** The intended architecture rides on top of a **licensed payment institution's** marketplace/split-payment/sub-account primitives (e.g. iyzico Marketplace, PayTR's alt-üye işyeri model, or a Stripe Connect-equivalent for the Turkish market) — MALSEVK's own database records what the licensed provider did, on the licensed provider's authority, rather than acting as the custodian of record itself. Every table below is a **ledger of provider-executed money movements**, not a system that itself moves money.

This framing determines almost every design choice below — a genuinely different, provider-abstracted "who actually holds the money" model changes which fields matter, but the *shape* (double-entry, append-only, commission-snapshotted) stays the same regardless of which provider primitive ends up underneath it, which is exactly why this can be designed now without picking a provider now.

## The flow this needs to eventually support

1. Hizmet alan pays (through the licensed provider's checkout/payment flow — not a raw MALSEVK-collected card charge).
2. Funds are held/protected by the **provider's own escrow/marketplace primitive** until the job completes — MALSEVK records that a hold exists and its state, it does not itself hold anything.
3. On completion, MALSEVK's commission is computed (using the rate that was in effect at the time the order was PLACED, never the current rate — see "Commission snapshotting" below).
4. The remainder is released to the hizmet-veren via the provider's payout/split-payment mechanism.
5. If disputed (`completion_disputed`), the hold stays frozen — no release, no refund — until resolved.
6. On dispute resolution: either release (completed) or refund (cancelled) — never both, never neither.
7. Every one of the above is an **immutable, append-only ledger entry** — never a single mutable `balance` column anywhere.

## Tables (design-level, not DDL)

| Table | Purpose |
|---|---|
| `escrow_accounts` | One row per party (a hizmet-alan's payment source reference, or a hizmet-veren's payable-to reference) that can appear on either side of a hold — NOT a bank account, a reference into the ledger below. |
| `escrow_cases` | One row per job/offer that has entered the paid-and-held flow — the anchor entity a hold/release/refund/dispute all point back to. |
| `escrow_holds` | One row per amount placed into protected status, referencing `offers.id` (the connection point — see below). |
| `escrow_releases` | One row per release-to-provider event, always referencing the hold it releases and the commission_rules snapshot used. |
| `escrow_refunds` | One row per refund-to-requester event. |
| `provider_payout_accounts` | A provider's verified payout destination (bank IBAN reference, or the licensed provider's own sub-merchant id) — payouts are only ever initiated against a **verified** row here (see "Provider payout verification" below). |
| `provider_payouts` | One row per actual payout attempt/execution to a provider. |
| `payout_attempts` | Per-attempt request/response trace for a payout (mirrors `payment_attempts`' own shape and rationale — a payout call to an external payout API deserves the same per-attempt tracing an inbound charge does). |
| `commission_rules` | Versioned commission rate(s) — see "Commission snapshotting." |
| `payment_disputes` | Chargebacks/formal payment disputes raised through the payment provider itself — **distinct from `offers.status = 'completion_disputed'`**, which is a MALSEVK-internal "is the work done" disagreement with no payment-provider involvement at all. A `completion_disputed` offer may or may not ever become a `payment_disputes` row; the two are correlated but not the same concept. |
| `ledger_accounts` | The chart of accounts for the double-entry system (see below) — e.g. `escrow_pool`, `platform_commission_revenue`, `provider_payable:{provider_id}`, `requester_receivable:{requester_id}`. |
| `ledger_entries` | Append-only individual debit/credit lines. |
| `ledger_transactions` | Groups a balanced set of entries — the atomic unit money "moves" in. |

## Double-entry ledger — why, and the balance invariant

**"Para hareketleri yalnızca bir `balance` sütununu artırıp azaltarak tutulmamalı"** is the explicit, correct instruction this design follows. A single mutable balance column can silently drift from reality (a missed update, a race condition, a bug) with no way to ever detect *when* or *why* it went wrong. Double-entry accounting makes drift structurally impossible to introduce unnoticed: every `ledger_transaction` must have its member `ledger_entries` sum to exactly zero across debits and credits (money only ever moves *between* named accounts, never created or destroyed), and the invariant can be *mechanically checked*, not just trusted.

Recommended enforcement mechanism: a `CONSTRAINT TRIGGER ... INITIALLY DEFERRED` on `ledger_entries`, checked once at the end of each transaction (not per-row, since a balanced transaction necessarily has entries whose sum is only correct once ALL of them exist) — the standard PostgreSQL technique for a multi-row invariant that can't be expressed as a single-row `CHECK`.

Every step in the flow above becomes its own `ledger_transaction` with (at minimum) two entries:
- Hold: debit `requester_receivable:{X}`, credit `escrow_pool`.
- Release: debit `escrow_pool`, credit `platform_commission_revenue` (the commission portion) AND debit `escrow_pool`, credit `provider_payable:{Y}` (the remainder) — three entries, still balanced.
- Refund: debit `escrow_pool`, credit `requester_receivable:{X}` (reversing the hold).

## Connection points to the existing `jobs`/`offers`/`completion_disputed` flow

This is the concrete answer to "mevcut jobs/offers/completion_disputed akışıyla bağlantı noktaları" — every hook is a **new** trigger/RPC call added *at* an existing, unchanged transition, never a modification of the transition's own existing logic:

| Existing event (already built, Faz 1: `0014_rpc_job_functions.sql`/`0015_rpc_offer_functions.sql`) | Future escrow hook (not built) |
|---|---|
| `offers.status` reaches `in_progress` (`start_work()`) | Could trigger `escrow_holds` creation IF a "pay up front, hold until done" product decision is made — or holds could instead be created earlier, at `accepted`, depending on the eventual payment UX; undecided, a product question, not a technical one. |
| `offers.status` reaches `completed` (`confirm_completion()`, or the auto-approval sweep) | Triggers commission calculation (snapshotting the rate in effect at hold-creation time, not now) + `escrow_releases` row + provider payout initiation. |
| `offers.status` reaches `completion_disputed` (`dispute_completion()`) | The corresponding `escrow_holds` row (if one exists) simply stays in its current state — no release, no refund. This requires NO new code at the `offers` layer at all; the absence of a release/refund trigger on this specific transition IS the "frozen" behavior. |
| `offers.status` reaches `cancelled` (`resolve_completion_dispute()`, cancelled branch) | Triggers a refund flow (`escrow_refunds`) against the same hold. |
| `offers.status` reaches `agreement_failed` | If a hold already existed (pre-work-start payment), triggers a refund — same as the cancelled case. |

**Critically**: none of the existing Faz 1 RPC bodies (`0014`/`0015`) need to change shape to support this — each hook is an *additional* function call appended at the point where the status transition already happens, following the exact same pattern `create_notification()`/`append_job_activity_event()` already use today for their own "additional side effect at an existing transition" role. This is why building the core schema now, without escrow, does not paint the design into a corner.

## Commission snapshotting

`commission_rules` is versioned (effective-from/effective-to, mirroring `legal-documents.ts`'s own versioning principle). **The rate used for any given release is the one that was in effect when the corresponding `escrow_holds` row was created, recorded as a literal value on the `escrow_releases` row itself at release time** — never re-looked-up against the *current* rate. This is what "Komisyon oranı geçmişe dönük değişikliklerden etkilenmemelidir; işlem anındaki oran snapshot olarak saklanmalıdır" requires: changing the commission rate tomorrow must never retroactively change what an already-held (or already-released) transaction owes.

## Idempotency / atomicity requirements carried into this design

- **"Aynı tamamlanma olayı iki kez para serbest bırakmamalı"**: `escrow_releases` would need a `UNIQUE(hold_id)` constraint — a hold can be released at most once, structurally, the same pattern `ratings_one_per_offer` already uses in the shipped schema for an analogous "at most once" rule.
- **"Aynı payout iki kez gönderilmemeli"**: `provider_payouts` needs the same idempotency-key pattern already built for `payment_transactions` (Faz 3 taslağı, `phase3/0001_payment_foundations.sql`) — a caller-generated key, reused across retries of the same logical payout intent.
- **"İtiraz sonucu ile finansal serbest bırakma atomik veya idempotent olmalı"**: the release/refund triggered by `resolve_completion_dispute()` must happen in the SAME transaction as the offer status write, exactly like every other side effect in this schema already does (notifications, activity events) — no new pattern needed, just applying the existing one to a new kind of side effect.
- **"Sağlayıcının ödeme hesabı doğrulanmadan payout yapılmamalı"**: `provider_payouts` INSERT would need a trigger (mirroring `ensure_offer_provider_is_hizmet_veren`'s own shape) rejecting any payout whose `provider_payout_accounts` row is not in a verified state.

## Multi-currency

Every table would carry `currency text check (in ('TRY', 'USD'))` (or the wider set, once genuinely needed) matching this schema's existing convention exactly — `ledger_transactions` would need same-currency-only entries within a single transaction (no implicit FX conversion inside the ledger itself; an FX conversion, if ever needed, would be its own explicit ledger transaction with its own designated FX-gain/loss account, not a silent number change). TRY-only is sufficient for the initial build, per the brief.

## What is deliberately left undecided here

- Which licensed payment institution/primitive to build against (determines exactly which fields `escrow_accounts`/`provider_payout_accounts` need to mirror).
- Whether holds are created at `accepted` or `in_progress` (a payment-UX product decision).
- Tax/withholding treatment on provider payouts (a Turkish tax-law question, not a schema question — `commission_rules`/`ledger_accounts` are designed to be extensible enough to add tax-related accounts/entries later without restructuring, but no specific tax logic is designed here).

None of the above blocks building the CURRENT (non-escrow) schema — that is precisely why this whole feature is documentation-only for now rather than a set of dormant tables: dormant tables built against undecided requirements would need to be redesigned anyway once those requirements exist, at which point they'd have added review/maintenance surface for zero benefit in between.
