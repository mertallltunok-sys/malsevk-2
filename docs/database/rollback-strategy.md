# MALSEVK — Rollback Strategy (Faz 1)

**Hiçbir gerçek/hosted Supabase projesine hiç uygulanmadı, bu yüzden bugün geri alınacak gerçek bir dağıtım yok** — bu doküman **if/when** bu şemanın gerçek bir projeye uygulanıp sonradan geri alınması gerektiği plandır. (Tamamen yerel, izole, atılabilir bir Docker + Supabase CLI ortamına karşı bir dry-run yapıldı — bkz. [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md) — ama o ortam test bitince tamamen kapatıldı/silindi, kalıcı hiçbir dağıtım yok; aşağıdaki plan yine de değişmeden geçerlidir.) No migration file in `supabase/migrations/` contains a `DROP TABLE`, `DROP COLUMN`, or any other destructive statement, per the explicit instruction — rollback statements are described here, as a runbook, never bundled into the forward migrations themselves.

**Faz kapsamı**: bu doküman yalnız Faz 1'i (`supabase/migrations/0001`–`0021`) kapsar. Faz 2/Faz 3 taslakları hiçbir zaman `supabase/migrations/`'a uygulanmadığı için onların "rollback"ı basitçe o dosyaları hiç kopyalamamaktır — bkz. `docs/database/future-migrations/MANIFEST.md`.

## General principle

Every forward migration in this set is purely additive (new tables, new columns, new functions — never an `ALTER ... DROP`/`ALTER ... TYPE` against anything pre-existing, since there *is* no pre-existing Supabase schema yet). This means the safest rollback for the *first* apply of this entire set is simply: **restore from a pre-migration database snapshot** (Supabase's own point-in-time-recovery / daily backups, or a manual `pg_dump` taken immediately before applying `0001`). For a first apply against an empty project, this is trivial and lossless.

## Per-migration-group rollback (if only PART of this set needs reverting after real data exists)

| Group | Files | Rollback approach |
|---|---|---|
| Extensions/helpers | 0001, 0012 | `DROP FUNCTION` for each helper, in reverse dependency order (RPCs depend on these — drop RPCs first if reverting this group alone). Extensions (`pgcrypto`, `pg_cron`) are safe to leave enabled even if unused. Dropping `prevent_last_admin_loss()`'s trigger removes the last-admin safety net — do this only alongside a real plan to keep at least one admin account by hand. |
| Core tables | 0002–0010 | `DROP TABLE ... CASCADE` in **reverse creation order** (0010 → 0002), since later tables FK into earlier ones. **Only safe if the table has never held real user data**, or after that data has been exported/archived first — this is a data-loss operation, not a schema-only one, once real rows exist. |
| Indexes | 0011 | `DROP INDEX CONCURRENTLY` (outside a transaction, on a live table) for any single index found to be unused/harmful — indexes are the single safest thing in this entire schema to add/remove, since they never change query *results*, only performance. |
| RLS policies | 0013 | `DROP POLICY` for any specific policy; `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` as an emergency last resort (removes ALL row filtering for that table — treat as equivalent to a security incident requiring immediate follow-up, never a routine step). |
| RPCs | 0014–0016 | `DROP FUNCTION` individually — since every RPC is the *sole* write path for its tables (no direct client grant), dropping one without a replacement means that specific action becomes entirely unavailable until a fixed version is redeployed; plan RPC rollbacks as "redeploy a corrected version immediately after," not "leave the gap open." Dropping `close_job_as_admin`/`delete_job_as_admin`/`suspend_user`/`reinstate_user` (0016) removes Faz 1's entire admin-moderation surface — `review_provider_document`'s own `is_admin()` gate is unaffected. |
| Views | 0017 | `DROP VIEW`/`DROP FUNCTION` — zero data risk, views hold no data of their own. |
| Scheduled jobs | 0018 | `SELECT cron.unschedule('malsevk-...')` per job name (see the `cron.schedule` calls in that file for the exact names) — instantaneous, no data impact beyond the sweep simply no longer running. |
| Storage policies | 0019 | `DROP POLICY` on `storage.objects`; bucket rows in `storage.buckets` can be left in place (an unused bucket costs nothing) or removed via the Supabase dashboard once confirmed empty. |
| Seed data | 0020 | `DELETE FROM service_categories WHERE ...` — safe only if no `jobs`/`provider_services` row references the category id being removed (FK would reject it anyway). |
| Bize Ulaşın | 0021 | `DROP TABLE contact_messages CASCADE` — tamamen ek-yalnız, başka hiçbir tablo buna FK vermiyor; tek başına geri alınması güvenli. |

### Faz 2 / Faz 3 (yalnız bunlar gerçekten devreye alındıysa)

| Group | Konum | Rollback approach |
|---|---|---|
| Admin RBAC | `phase2/0001`-`0002` | `is_admin()` (Faz 1, `profiles.role`'a bakar, bu tablolara değil) BOZULMADIĞI SÜRECE güvenle kaldırılabilir — yalnız ince taneli Layer 2'yi kaldırır. |
| Abonelik/kota | `phase2/0003`-`0004` | Güvenle kaldırılabilir **yalnız `get_active_job_limit()` önce Faz 1'in sabit-5 haline geri `CREATE OR REPLACE` edilirse** — aksi halde her kapasite kontrolü artık var olmayan bir fonksiyona bağımlı kalır. |
| Ödemeler | `phase3/0001`-`0003` | Ek-yalnız ve hiçbir tablonun gerekli davranışına bağlı değil — herhangi bir zamanda bağımsız olarak kaldırılabilir. |

## What "rollback" does NOT mean here

Rolling back a *schema* change is never the same operation as rolling back *data* that real users have since created against that schema (a new job, a new offer, a granted admin role). This document covers the former. If real data needs to be preserved across a schema rollback (e.g. reverting `0012`'s subscription tables but keeping a record of who was on which plan), export the relevant rows to a flat file/separate archive table *before* dropping anything — no automatic "downgrade migration" that preserves data is written for any table in this set, since building one speculatively, for a rollback scenario that may never happen, would be exactly the kind of unnecessary complexity this design pass was asked to avoid elsewhere.
