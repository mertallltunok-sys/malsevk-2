# MALSEVK — Pre-Apply Test Plan (Faz 1)

None of these have been run — this document is the plan for validating this schema **before** it is ever applied to a real Supabase project, per the explicit instruction not to execute anything in this design pass.

**Faz kapsamı**: bu plan yalnız Faz 1'i (`supabase/migrations/0001`–`0020`) kapsar. §4 ve §14'teki günlük-teklif-kotası testleri (eski MLK66) Faz 1'de UYGULANAMAZ — Faz 1'de günlük kota yok (doğrulanmış bugünkü davranış); bu testler Faz 2 devreye alındığında, `docs/database/future-migrations/MANIFEST.md`'nin köprü adımından sonra geçerli olur, aşağıda buna göre işaretlendi.

## 1. Static / pre-flight checks

| Check | How |
|---|---|
| SQL lint | Run every file in `supabase/migrations/` through `sqlfluff` (postgres dialect) or the Supabase CLI's own `supabase db lint` — catches syntax issues, naming inconsistencies, missing `IF NOT EXISTS` guards. |
| Migration dry-run | `supabase db reset` (or `supabase start` against a fresh local Postgres via the Supabase CLI) applies `0001`→`0024` in order against an empty local database — the actual "does this even run top to bottom" test. |
| Fresh install | Same as above, verified against a **completely empty** Supabase project (no pre-existing tables) — the realistic first-apply target. |
| Second-run safety | Re-run the entire migration set a second time against the now-populated database. Every `CREATE TABLE IF NOT EXISTS`/`CREATE OR REPLACE FUNCTION`/`ON CONFLICT DO NOTHING` seed insert should make this a no-op with zero errors — this is the concrete test for "idempotent migration mantığıyla oluştur." |

## 2. Constraint & FK tests

For every `CHECK`/`UNIQUE`/FK constraint in `0002`–`0014`, at minimum: one INSERT that should succeed, one that should violate it and get rejected with the expected Postgres error. Priority list (the ones with non-obvious behavior, worth naming explicitly rather than leaving to "test everything generically"):

- `offers_one_blocking_per_job_provider` partial unique index — a second `pending` offer for the same `(job, provider)` while the first is still `pending` must fail; a second offer after the first is `withdrawn` must succeed.
- `jobs_republished_to_job_id_unique` / `jobs_republished_from_job_id_unique` — attempting to republish an already-republished job twice must fail at the RPC layer (`MLK58`) before it would even reach the index.
- `ratings_one_per_offer` — a second `submit_rating()` call for the same offer must fail (`MLK74`).
- `payment_webhook_events_unique_per_provider` — the exact duplicate-webhook test, see §7.

## 3. RLS tests (per role, per table)

Run the full [rls-matrix.md](rls-matrix.md) as a literal test matrix: for every table, authenticate as each of {anon, hizmet-alan A, hizmet-veren B, hizmet-veren C (unrelated third party), admin} and confirm SELECT/INSERT/UPDATE/DELETE match the documented cell exactly — especially the **negative** cases (hizmet-veren C must see zero rows of hizmet-veren B's `offers`; a non-`audit_logs.view` admin must see zero `audit_logs` rows despite `is_admin()` being true).

## 4. Race condition tests (the brief's explicit list, mapped to concrete test procedures)

| Race | Test procedure | Pass criterion |
|---|---|---|
| Same job, two simultaneous accepts | Two separate DB connections both call `accept_offer()` on two different `pending` offers of the same job, submitted as close together as the test harness allows | Exactly one succeeds; the other receives `MLK67` or `MLK68` |
| Provider exceeds 5-job capacity via concurrent accepts on different jobs | Provider has 4 engaged offers; two different requesters simultaneously `accept_offer()` two of the provider's other `pending` offers | Exactly one succeeds; the other receives `MLK65` — verifies the `pg_advisory_xact_lock` in `accept_offer()` actually serializes |
| Same offer started twice | Two simultaneous `start_work()` calls on the same offer | Exactly one succeeds; the other receives `MLK68` |
| Same completion confirmed twice | Two simultaneous `confirm_completion()` calls on the same offer | Exactly one succeeds; the other receives `MLK68` |
| Same job republished twice | Two simultaneous `republish_job()` calls on the same expired job | Exactly one succeeds; the other receives `MLK58` |
| Same notification created twice | Two simultaneous `create_notification()` calls with identical `(recipient_id, type, offer_id)` | Exactly one row exists afterward (`ON CONFLICT DO NOTHING`) |
| Operation created half-finished | Kill the connection mid-`create_operation_with_jobs()` call (simulate a network drop) | Zero rows from that call exist afterward — implicit transaction rollback, no manual verification of partial state needed |
| Storage upload succeeds, DB insert fails | Upload a photo to Storage, then call `create_job()` with an intentionally invalid parameter (e.g. bad `category_id`) | `create_job()` errors, no `jobs`/`job_photos` row created; the Storage object is orphaned until the sweep job removes it — verify it is NOT silently referenced by any row |
| DB insert succeeds, Storage upload "fails" | Structurally untestable as a race — `create_job()` requires `storage_path` as an input, so a failed upload never produces a call to `create_job()` in the first place (see [storage-plan.md](storage-plan.md)) | N/A — verify by code review that no code path calls `create_job()` before upload confirmation |
| **[Faz 2, Faz 1'de N/A]** Two simultaneous `create_offer()` calls exceeding the daily quota | Provider at `daily_offer_limit - 1` for the day; two simultaneous `create_offer()` calls on two different jobs | Exactly one succeeds; the other receives `MLK66` — verifies the advisory lock keyed on provider covers the quota count too |
| Aynı ilana iki farklı sağlayıcının teklifinin eşzamanlı kabulü | İki `pending` teklif (X: sağlayıcı A, Y: sağlayıcı B), aynı iş için iki ayrı DB bağlantısı `accept_offer(X)`/`accept_offer(Y)`'yi mümkün olduğunca eşzamanlı çağırır | Tam olarak biri başarılı; diğeri `offers_one_settled_per_job` unique_violation'ından `MLK67` alır — GÜVENLİK DÜZELTMESİ B.1'in doğrudan testi |

## 5. Transaction rollback tests

Deliberately trigger a failure partway through a multi-statement RPC (e.g. patch `create_operation_with_jobs()` in a test copy to `RAISE EXCEPTION` after the 2nd of 3 services is inserted) and confirm **zero** rows from that call persist — the concrete verification of "a single function call is already one transaction" (see architecture.md §2's simplification note).

## 6. Notification & scheduled-job idempotency

- Call `create_notification()` twice with identical logical-event parameters in two separate transactions (not just within one) — confirm the second is a no-op via `ON CONFLICT`.
- Run `sweep_completion_auto_approvals()` twice in a row with no time elapsed between calls — confirm the second run affects zero rows (every row it would have touched is no longer in `completion_requested` after the first run).
- Same for `sweep_expired_job_listings()` — second run produces zero new notifications for the same jobs (blocked by the `notifications` unique constraint even though the job is still "expired" on every check).

## 7. Storage policy tests

- Attempt to upload to `job-photos/{someone-else's-uuid}/...` as an authenticated user who is not that uuid — must be rejected by RLS before the object is written.
- Attempt to `SELECT` (fetch) a `provider-documents` object as a hizmet-veren who is neither its owner nor an admin — must be rejected.
- Confirm a `documents.view`-permission admin (not necessarily `is_admin()` in the coarse sense — test with a `document_officer`-role account specifically) CAN read another provider's document.

## 8. Contact/identity-leak tests

- As a hizmet-veren with a still-`pending` offer, call `get_offer_provider_display()` — wait, this is from the REQUESTER's side; the correct test: as the REQUESTER, with the offer still `pending`, call `get_offer_provider_display(offer_id)` and confirm `revealed = false` and the anonymous label, never the real company name.
- Attempt a raw `SELECT phone, company_name FROM profiles WHERE id = '<some other user>'` as any non-admin authenticated role — must return zero rows (RLS), never the target row with fields silently null (confirms the row-level policy, not a column-level mask, is what's actually protecting this).
- Attempt `SELECT address_text FROM jobs WHERE id = '<job I have no engaged offer on>'` as a hizmet-veren — must return zero rows/error (column grant revoked entirely, per [rls-matrix.md](rls-matrix.md)), confirming `get_job_address()` really is the only path.

## 9. Admin permission tests

- A `support_officer`-role admin attempts `review_provider_document()` (which requires `is_admin()` only, not a specific permission — by design, see [admin-permissions.md](admin-permissions.md)) — should succeed, confirming Layer 1 truly is independent of Layer 2 grants.
- The SAME `support_officer` attempts `close_job_as_admin()` (requires `jobs.close`, which `support_officer`'s starter grant does NOT include) — must fail with `MLK84`.
- Revoke a role mid-session (call `revoke_admin_role()` from a second, admin-role connection) and confirm the FIRST connection's very next RPC call using that permission fails immediately — the concrete test of "no session invalidation needed" (see [admin-permissions.md](admin-permissions.md)).

## 10. Audit log append-only test

As `service_role` (or any role), attempt `UPDATE audit_logs SET new_data = '{}' WHERE id = ...` and `DELETE FROM audit_logs WHERE id = ...` directly (bypassing every RPC) — both must fail on privilege grounds (no `UPDATE`/`DELETE` grant exists to ANY role, including `service_role`, per 0011).

## 11. Performance / EXPLAIN ANALYZE

Once seeded with a realistic synthetic dataset (recommended minimum: 10k profiles, 50k jobs, 150k offers — an order of magnitude above MALSEVK's current real scale, to surface issues before they'd actually bite), run `EXPLAIN ANALYZE` on the query each index in [index-plan.md](index-plan.md) was built for, confirming an index scan (not a sequential scan) is chosen for each. Pay particular attention to `active_job_listings`/`provider_visible_jobs` (0017_views.sql) — the two views most likely to be hit on every page load of the provider job-listing screen.

## Minimum test-scenario table (representative sample — extend per §2–10 above)

| # | Başlangıç verisi | İşlem | Beklenen sonuç | Beklenen hata kodu | Etkilenen tablolar |
|---|---|---|---|---|---|
| 1 | hizmet-alan A, no jobs | `create_job(...)` with 0 photos | Rejected | MLK51 | jobs, job_photos (neither written) |
| 2 | Job J owned by A, offer O `pending` from provider B | A calls `accept_offer(O)` | O → `accepted`; notification to B | — | offers, offer_status_history, notifications |
| 3 | Same as #2, immediately after #2 | A calls `reject_offer(O)` (already accepted) | Rejected | MLK68 | none |
| 4 | Provider B has 5 engaged offers | B calls `create_offer(...)` on a new job | Rejected | MLK65 | none |
| 5 | Job J, offer O `accepted` | Requester A calls `start_work(O)` | O → `in_progress` | — | offers, offer_status_history, notifications (job_activity_events'e YAZILMAZ — teklif olayları artık yalnız offer_status_history'de, bkz. 0010'un sadeleştirme notu) |
| 6 | Offer O `in_progress` | Provider B calls `request_completion(O)` then immediately `confirm_completion(O)` (wrong role) | Second call rejected | MLK56 | none |
| 7 | Offer O `completion_requested`, requested by B | A calls `confirm_completion(O)` | O → `completed` | — | offers, offer_status_history, notifications |
| 8 | Offer O `completed`, `auto_completed = false` | A calls `submit_rating(O, 5)` 400 days later | Succeeds (no window limit for manual completion) | — | ratings |
| 9 | Offer O `completed`, `auto_completed = true`, completed 31 days ago | A calls `submit_rating(O, 5)` | Rejected | MLK72 | none |
| 10 | Job J, `publish_end_at` in the past, no settled offer | Any read of `active_job_listings` | J does not appear | — | (read-only) |
| 11 | Same as #10, but J has an `accepted` offer | Any read of `active_job_listings` | J still appears (settled-offer exception) | — | (read-only) |
| 12 | `profiles.role='admin'` hesabı X | X calls `review_provider_document(...)` | Succeeds | — | provider_documents, provider_document_reviews, audit_logs |
| 13 | Non-admin authenticated user | Calls `close_job_as_admin(...)` | Rejected | MLK84 | none |
| 13a | Sistemde tek admin hesabı X, `account_status='active'` | X (veya başka bir admin, varsa) `suspend_user(X, ...)` çağırır | Rejected | MLK91 | none |
| 13b | **[Faz 2, Faz 1'de N/A]** Admin with `admin_roles.manage` | Grants `document_officer` to user X | Succeeds | — | admin_user_roles, audit_logs |
| 13c | **[Faz 2, Faz 1'de N/A]** Sistemde tek `admin_roles.manage` sahibi X | Başka bir yetkili (yoksa X'in kendisi) `revoke_admin_role(X, 'super_admin')` çağırır | Rejected | MLK89 | none |
| 14 | **[Faz 2, Faz 1'de N/A]** Provider with `daily_offer_limit = 5` override, 5 offers already created today (Europe/Istanbul day) | Calls `create_offer(...)` on a 6th job | Rejected | MLK66 | none |
| 15 | **[Faz 2, Faz 1'de N/A]** Same as #14, but at 00:01 Europe/Istanbul the next day | Calls `create_offer(...)` | Succeeds | — | offers, offer_status_history, notifications |
