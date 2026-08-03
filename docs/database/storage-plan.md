# MALSEVK — Storage Plan

Implements `supabase/migrations/0019_storage_policies.sql` (Faz 1). **Three buckets, not four** — see that file's header for why "activity-reports" is not a separate bucket from "provider-documents" (both hold `provider_documents` rows, discriminated by `document_type`, mirroring the source app's own `StoredProviderDocument.documentType` design).

**Yerel dry-run bulgusu**: `0019`'un ilk hâli, `storage.buckets` üzerinde bir `COMMENT ON TABLE` ve `storage.objects` üzerinde bir `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` içeriyordu — ikisi de gerçek bir `supabase db reset`'te "must be owner of table" (SQLSTATE 42501) hatasıyla başarısız oldu, çünkü bu iki tablo migration'ı uygulayan `postgres` rolünü değil, Supabase'in kendi `supabase_storage_admin` rolünü sahiplenir. İkisi de kaldırıldı (yorum düz bir SQL yorumuna çevrildi, `ENABLE ROW LEVEL SECURITY` zaten gereksizdi çünkü Supabase RLS'yi `storage.objects` üzerinde kendi proje bootstrap'inin bir parçası olarak zaten açıyor) — aşağıdaki `CREATE POLICY`'ler bundan etkilenmedi. Bu, yalnız yerel ortama özgü değildir; gerçek/hosted bir Supabase projesinde de birebir aynı şekilde başarısız olurdu. Tam ayrıntı: [SUPABASE-MIGRATION-VALIDATION.md](SUPABASE-MIGRATION-VALIDATION.md).

## Bucket-by-bucket

| | `job-photos` | `provider-logos` | `provider-documents` |
|---|---|---|---|
| Public read? | Yes | Yes | **No** |
| Path pattern | `{requester_id}/{job_id}/{photo_id}.{ext}` | `{provider_id}/{logo_id}.{ext}` | `{provider_id}/{document_id}.{ext}` |
| Upload (INSERT) | Owner (first path segment = `auth.uid()`) | Owner | Owner |
| Read (SELECT) | Anyone (public bucket) | Anyone (public bucket) | Owner or `is_admin()` (Faz 1 — see below) |
| Update | — (photos are replace-via-delete-then-reinsert, matching source app) | Owner | — |
| Delete | Owner | Owner | Owner |
| Max file size | 10 MB (`photo-validation.ts#MAX_PHOTO_SIZE_BYTES`, verified) | 10 MB | 15 MB (`document-validation.ts#MAX_DOCUMENT_SIZE_BYTES`, verified) |
| Allowed MIME types | jpeg/png/webp | jpeg/png/webp | pdf, doc(x), xls(x), odt, jpeg/png/webp/heic/heif/tiff |
| Signed URL needed? | No (public) | No (public) | **Recommended** on top of RLS, short-lived (~5 min) — see below |

## Path-manipulation defense

Every write policy checks `(storage.foldername(name))[1] = auth.uid()::text` — Supabase's standard pattern. A caller can never successfully write under a path whose first segment isn't their own `auth.uid()`, regardless of what path string their client constructs; this is enforced server-side by Postgres RLS on `storage.objects`, not by trusting the client. Everything after the first segment is free-form within the caller's own namespace and needs no further Storage-level check — associating an object with a specific DB row only ever happens through the RPC layer (`create_job`/`update_job`/registration), which independently validates ownership at the database level.

## Why `provider-documents` gets signed URLs on top of RLS

RLS on `storage.objects` already correctly gates *who may query/fetch* a document (owner or, in Faz 1, `is_admin()` — the coarse single admin gate; verified against the actual `provider_documents_bucket_read_own_or_admin` policy in `0019_storage_policies.sql`, whose own comment notes it could move to a fine-grained `has_admin_permission('documents.view')` in Faz 2, but does not today). Signed URLs are recommended as an *additional* layer specifically for business-sensitive documents: a short-lived (~5 minute) signed URL, minted by an Edge Function or RPC that re-checks the same access condition at mint time, avoids handing out a long-lived-equivalent reference to a document whose access could legitimately change (a document reviewer's permission is revoked, a provider is suspended) before a long-lived URL would otherwise expire. `job-photos`/`provider-logos` don't need this — nothing about them is access-sensitive in the first place (public bucket).

## Processing pipeline (Storage replaces IndexedDB as the final store)

Mirrors the source app's existing three-layer pattern exactly, with Supabase Storage taking IndexedDB's place as the final store:

1. **Client-side pre-check** (unchanged) — magic-number format sniff, size/count limits, SHA-256 duplicate-content hash. This logic has zero dependency on where the file ultimately lands and can be reused verbatim.
2. **Processing Edge Function** (replaces today's `/api/job-photos/process` Node route) — auto-rotates from EXIF orientation, strips all EXIF/GPS metadata (unchanged behaviour). **Deliberately flagged deviation**: this design recommends additionally standardizing output to WebP, which today's route does *not* do (today's route preserves JPEG/PNG/WebP depending on input). This is a reasonable storage-efficiency improvement enabled by rebuilding the pipeline anyway — not a silent change; see [schema-reference.md](schema-reference.md)'s Open Decisions if the product owner prefers to keep today's exact mixed-format output.
3. **Upload then RPC** — the client uploads the processed bytes to Storage at its own path *first*, then calls the matching RPC (`create_job`/`update_job`/registration) with the resulting `storage_path`. This order is required (Postgres cannot upload to Storage itself) and is what makes the "DB insert succeeded but Storage upload failed" race structurally impossible: the RPC never receives a `storage_path` for a file that didn't successfully upload, so it can never reference one.

### Watermarking and virus scanning — explicitly not built

- **"MALSEVK filigranı" (watermark)**: no current source-app equivalent exists (verified — today's pipeline only auto-rotates and strips metadata). Not designed or assumed here; the same processing Edge Function is the natural place to add it later if the product wants it.
- **Virus/malware scanning**: neither the source app's `document-validation.ts` nor this Storage design performs any content-safety inspection — both only validate magic-number/extension/container structure, never scan for malicious payloads. **This is flagged as a genuine, currently-unaddressed security gap**, not silently treated as solved. Recommended (not built) mitigation: a quarantine-bucket pattern — uploads land in a `provider-documents-incoming` staging bucket, get scanned by an Edge-Function-invoked scanning service, and are only moved into the real `provider-documents` bucket if clean.

## Storage-before-DB / DB-before-Storage ordering

- **Create**: Storage upload happens *before* the RPC call (see step 3 above) — a failed RPC after a successful upload leaves an orphaned Storage object, cleaned up by the sweep below (never synchronously, and never by the RPC itself, since Postgres cannot delete Storage objects).
- **Delete**: `delete_job_photo()` (0014_rpc_job_functions.sql) deletes the DB row *first*, in the same transaction as any other change — mirrors the source app's own documented fix (job-store.ts's write-then-delete ordering) exactly: a failed DB write never leaves a job referencing an already-deleted Storage object. The actual Storage object deletion happens *after* the RPC returns successfully (client-triggered) or via the orphan sweep if that call never happens.

## Orphaned Storage cleanup

Described in [0018_scheduled_jobs.sql](../../supabase/migrations/0018_scheduled_jobs.sql) but not built as SQL, because Postgres cannot call the Storage HTTP API directly without additional infrastructure (`pg_net` + a `service_role` credential in Vault) — both real deployment steps out of scope for a design-only pass. Recommended shape: a Scheduled Edge Function that lists each bucket's objects, cross-references them against `job_photos`/`provider_profiles.logo_path`/`provider_documents` (excluding soft-deleted rows), and deletes any object with no matching row that is *also* older than a 24-hour grace period — the grace period exists specifically to avoid racing a `create_job()` call whose Storage upload succeeded but whose RPC transaction hasn't committed yet at the exact moment the sweep runs.

## Doğrulanmamış kapsam

Yerel dry-run yalnız `storage.objects`/`storage.buckets` üzerindeki SQL politikalarını/GRANT'ları doğruladı. Gerçek Storage API'nin kendisi (gerçek bir dosya yükleme/indirme HTTP akışı, Edge Function işleme hattı) **henüz doğrulanmadı** — bu migration setinin kapsadığı tek katman SQL/RLS'dir.

## Old-file cleanup

No verified current feature replaces one provider document with another (`getCustomsLicenseDocumentForUser`'s own source comment: multiple documents can coexist for the same provider, the most recent one is simply preferred) — so beyond the generic orphan sweep above, no additional "supersede and delete the old file" logic is designed or assumed here.
