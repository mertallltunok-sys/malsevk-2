# MALSEVK — Data Migration Strategy

**No migration has been run. No Supabase connection exists. This document describes a plan for a future, separate effort.**

## 1. Auth strategy: auth-first vs. database-first — recommendation

| | Auth-first | Database-first |
|---|---|---|
| Approach | Stand up Supabase Auth + `profiles` in complete isolation first; migrate every user through a real signup/password-reset flow before touching jobs/offers/anything else | Migrate all data tables first (with a temporary bridge `legacy_user_id` column), wire up Auth last |
| Risk profile | One well-tested, isolated change; every subsequent migration step can assume real `auth.uid()` identities from day one | Every table needs a *second* migration later to swap `legacy_user_id` for real `auth.users.id` once Auth exists — doubles the surface area of "migration bugs" |
| User impact | Concentrated: everyone re-authenticates once, up front | Spread out and *worse*: users would need to re-authenticate a second time whenever Auth is eventually bolted on, potentially after they've already started using a partially-migrated system |

**Recommendation: auth-first, firmly.** Every other table in this schema has a hard `not null references profiles(id)` (or nullable-but-meaningless-without-it) dependency — building any of them against a temporary bridge id just relocates the hard part of the migration to later, with more surface area at risk by then (real production data instead of a clean cutover). See §5 for exactly where in the migration sequence this happens ("Section J: recommended order" in the original audit report already named this — this document formalizes it).

## 2. Why passwords cannot be migrated directly

`StoredUser.passwordHash` is unsalted SHA-256 (`users.ts#hashPassword`, explicitly documented in the source file as a dev-only stand-in). Supabase Auth stores passwords as bcrypt (or your configured provider's own scheme) — there is no reversible or even one-way-compatible transform from "SHA-256 of the plaintext" to "bcrypt of the plaintext" without ever having the plaintext again. **Every existing user must go through a forced credential-reset flow once, at cutover.** Recommended mechanics:

1. Create every existing user's `auth.users` row via the Supabase Admin API (`admin.createUser`), using their existing (already-verified-by-nothing, since there's no real backend today — see below) email, with `email_confirm: true` and **no usable password set** (or a random, discarded one).
2. Immediately trigger Supabase's password-reset email flow for every migrated user, OR require a one-time "set your password" step on next login (a magic-link-then-set-password flow is friendlier than a cold password-reset email for a userbase that never explicitly signed up for magic links).
3. Until a user completes step 2, their account exists in `auth.users`/`profiles` but cannot authenticate — this is the "everyone re-authenticates once" cost named in §1, and it should be communicated to users in advance (email/SMS campaign) rather than discovered as a surprise login failure.

**Email verification note**: today's app never verifies email ownership at all (any string that looks like an email is accepted at registration). Supabase Auth *can* enforce real verification — decide explicitly whether migrated accounts start "pre-verified" (matching today's de facto trust level, lower friction) or must re-verify (higher assurance, more friction) as part of the cutover communication plan; this document does not decide it, since no current behavior establishes a precedent either way.

## 3. Demo/seed accounts

`DEV_ACCOUNTS` (users.ts) — six accounts, `NODE_ENV === "development"`-gated, never created in production. **Do not migrate them as data at all.** Instead, re-seed them via a `NODE_ENV`-gated equivalent of `seedDevAccountsIfNeeded()` that calls the Supabase Admin API directly (creating real `auth.users` rows with real, dev-only-known passwords) — same idempotent upsert-by-email logic, ported to call Supabase instead of writing to `localStorage`. This keeps the dev-seeding *behavior* (automatic, idempotent, dev-only) while producing real Auth-backed accounts instead of trying to "migrate" data that only exists transiently in developers' own browsers.

## 4. Invalidating old sessions

`Session` (`malsevk.session.v1` in localStorage) becomes structurally meaningless the moment the app is pointed at Supabase Auth instead — the new client code simply stops reading/writing that key, and Supabase's own SDK manages its session token in its own storage key. No explicit "invalidate the old session" step is needed *for the localStorage key itself*; it becomes dead data in the user's browser, harmless, eventually cleared by normal browser storage churn or a one-time cleanup script bundled with the cutover release (`localStorage.removeItem("malsevk.session.v1")` on app load, for tidiness, not correctness).

## 5. Recommended table-by-table order

**Faz yapısı notu**: bu tablo yalnız FAZ 1 (`supabase/migrations/0001`–`0021`) tablolarını kapsar. Faz 2 (admin RBAC, abonelik) ve Faz 3 (ödeme) tabloları ilk göçe DAHİL DEĞİLDİR — bkz. `docs/database/future-migrations/MANIFEST.md`. `notification_states` artık ayrı bir tablo değildir (bkz. §7'nin güncellenmiş notu) — `read_at`/`dismissed_at` doğrudan `notifications` üzerinde göç eder. `contact_messages` (0021, yerel dry-run'da eklendi) kullanıcı hesabıyla ilişkili kritik bir veri değildir (basit bir iletişim formu kaydı) — bu yüzden aşağıdaki adım listesine ayrı bir zorunlu adım olarak eklenmedi; göç edilecek gerçek bir localStorage karşılığı da yoktur (kaynak uygulamada `contact-messages.ts` yalnız yeni gönderimler için, geriye dönük veri taşıma ihtiyacı doğurmaz).

| Step | Tables | Depends on |
|---|---|---|
| 1 | Auth + `profiles` (§1/§2) | Nothing — first, isolated |
| 2 | `provider_profiles`, `provider_services` | Step 1 |
| 3 | `service_categories` seed (code constant → table rows) | Nothing (independent, can run anytime before step 4) |
| 4 | `jobs`, `operations`, `job_photos` (+ Storage blob sync, §6) | Steps 1, 3 |
| 5 | `offers`, `offer_status_history` (backfilled with one synthetic row per existing offer — see below) | Step 4 |
| 6 | `ratings` | Step 5 |
| 7 | `provider_documents`, `provider_document_reviews`, `provider_document_consents` (+ Storage blob sync) | Step 1 |
| 8 | `legal_consents` | Step 1 |
| 9 | `notifications` (recipient's read/dismissed flags migrate as `read_at`/`dismissed_at` columns on the SAME row — the *notifications themselves* are NOT migrated, see below), `recently_viewed_jobs` | Steps 4, 5 |
| 10 | Faz 1 admin: yalnız `profiles.role = 'admin'` satırlarının kendisi (Auth ile birlikte, adım 1) — ayrı bir bootstrap adımı gerekmez | Step 1 |

**Faz 2/Faz 3 ertelendi**: Admin RBAC (`admin_permissions`/`admin_roles`/`admin_role_permissions`/`admin_user_roles`), abonelik/kota, ve ödeme tabloları bu göçün parçası DEĞİLDİR — her kullanıcı basitçe bu tablolarda hiç satırı olmadan başlar ve (Faz 2 devreye alınırsa) doğru şekilde `free` plana çözümlenir (bkz. architecture.md §5). Faz 2 bootstrap runbook'u için `docs/database/admin-permissions.md`'ye bakın.

**`offer_status_history` backfill**: the source app has no history table — only the *current* `Offer.status`. A migrated offer gets exactly ONE synthetic `offer_status_history` row (`previous_status = null, new_status = <current status>, changed_by = null, reason = 'migrated_from_localstorage'`) rather than a fabricated full transition history that never actually happened — inventing intermediate transitions the source data cannot support would be worse than admitting the pre-migration history is simply unavailable.

**Notifications are NOT migrated** — they are regenerated fresh from already-migrated `jobs`/`offers` state by running the equivalent of `sweep_expired_job_listings()` once manually post-migration for any already-expired listings, and by the fact that every *other* notification type is only ever created going forward, by the RPC layer, in response to a *new* state transition. A user's pre-migration notification history simply doesn't carry over — communicate this in the cutover release notes.

## 6. IndexedDB blob migration

The core difficulty: **IndexedDB blobs live only in each user's own browser** — there is no server-side copy to bulk-migrate from. Recommended approach: **client-driven, first-login synchronization**, not a server-side bulk job.

1. On first login after cutover, the (still-present, unchanged-per this design pass) client-side code opens the user's existing `malsevk-photo-blobs` IndexedDB database and enumerates every blob referenced by their (already-migrated, per §5) `job_photos`/`provider_documents`/`provider_profiles.logo_path` rows' *old* `storageKey` values (kept in a temporary mapping table during the DB migration, not thrown away).
2. For each blob still present in IndexedDB, upload it to the correct Storage bucket/path and `UPDATE` the corresponding row's `storage_path` — turning a "points to an IndexedDB key that no longer resolves to anything" row into a real, resolvable one.
3. **Duplicate-upload prevention**: reuse the exact SHA-256 content-hash technique the client already has (`photo-validation.ts#hashFileContent`) — before uploading, compute the hash and skip if a row for this exact content+owner already has a valid `storage_path` (covers the case where sync partially ran before and is resuming).
4. **A dedicated `client_blob_sync_status` table is recommended** (not included in the Faz 1 `supabase/migrations/0001`–`0021` set since it is migration-tooling, not application schema — add it as a throwaway migration at cutover time, or a plain admin script's own bookkeeping table, dropped once migration is complete): `(user_id, old_storage_key, target_table, target_row_id, status, attempted_at)`, so a resumed sync (browser closed mid-sync, network failure) knows exactly which blobs are already done without re-scanning IndexedDB from scratch every time.
5. **Users who never log in again after cutover never sync their blobs.** Their `job_photos`/`provider_documents` rows would carry a `storage_path` that never resolves. Decide (product call, not a schema question) whether to: (a) accept this as acceptable data loss for inactive accounts, (b) keep a read-through fallback to the old system for some grace period (adds real complexity — a dual-read path — for a shrinking set of never-returning users), or (c) proactively email inactive users asking them to log in once before a hard cutoff date. This document does not decide it — flagged as an Open Decision.

## 7. Normalization performed during migration (not a straight 1:1 copy)

A few source-app fields need reshaping, not just copying, during the migration script itself:

- `Job.photos: JobPhoto[]` (gomulu array) → separate `job_photos` rows.
- `StoredUser.providerProfile` (gomulu object) → separate `provider_profiles` row.
- `StoredUser.providerProfile.expertise`/`.serviceCategories` (both deprecated in source) → **not migrated at all**; `provider-services.ts`'s already-separate table is the one migrated into `provider_services` directly (it's already relational).
- Every "eksikse undefined'a normalize et" pattern in the source's own `normalizeStoredX` functions (missing `locationMode` → treat as `'catalog'`, missing `documentType` → treat as `'genel'`, etc.) must be replicated *exactly* in the migration script — see [schema-reference.md](schema-reference.md)'s field mapping table for which columns have this kind of legacy-default behavior baked into their source-app read path.

## 8. `data/locations/locations.json` and `data/locations/location_manual_overrides.json`

These are pipeline outputs (`scripts/locations/`), not user data — migrating them into `service_categories`/a future `facilities` table (not built in this design pass — `turkey-locations.ts#Facility` was not requested as a table and remains a build-time-bundled JSON read, matching today) is a separate, much lower-risk exercise than the rest of this document, since there is no per-user state involved — just re-run the existing pipeline against a target table instead of a target JSON file whenever that becomes a priority.
