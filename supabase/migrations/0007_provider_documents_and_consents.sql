-- =============================================================================
-- MALSEVK — Faz 1 migration 0007: provider_documents, provider_document_reviews,
--                                    provider_document_consents
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0008_provider_documents.sql'i ile aynıdır. Bu üç tablo, Faz 1'in "Sağlayıcı
-- evrakları", "Evrak inceleme ve onay akışı" ve "Faaliyet raporları"
-- akışlarının doğrudan temeli — provider_documents.document_type
-- ('genel' = Faaliyet Belgesi/Raporu, 'gumruk-musaviri-izin-belgesi' =
-- Gümrük Müşaviri İzin Belgesi) kaynağın kendi StoredProviderDocument
-- ayrımını birebir yansıtır, ayrı bir "faaliyet raporu" tablosuna gerek
-- yoktur.
-- =============================================================================

create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  document_type text not null default 'genel'
    check (document_type in ('genel', 'gumruk-musaviri-izin-belgesi')),
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  extension text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15 * 1024 * 1024),

  current_review_status text not null default 'pending'
    check (current_review_status in ('pending', 'approved', 'rejected', 'revision_requested')),
  current_review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),

  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.provider_documents is
  'Metadata only — file lives in Supabase Storage (provider-documents bucket, docs/database/storage-plan.md). document_type discriminates "genel" (Faaliyet Belgesi/Raporu — required for every registration except customs-only) from "gumruk-musaviri-izin-belgesi" (Gümrük Müşaviri İzin Belgesi). 15 MB cap matches app/_lib/document-validation.ts#MAX_DOCUMENT_SIZE_BYTES exactly.';

create trigger trg_provider_documents_set_updated_at
  before update on public.provider_documents
  for each row execute function public.set_updated_at();

revoke all on public.provider_documents from authenticated, anon;
grant select on public.provider_documents to authenticated;
-- current_review_status and its sibling columns are set ONLY by
-- review_provider_document() (0016, admin-only, is_admin()) — never by the
-- uploading provider themselves.

create table if not exists public.provider_document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.provider_documents (id),
  provider_id uuid not null references public.profiles (id),
  admin_id uuid not null references public.profiles (id),
  action text not null check (action in ('approved', 'rejected', 'revision_requested')),
  note text,
  created_at timestamptz not null default now()
);

comment on table public.provider_document_reviews is
  'Append-only. review_provider_document() (0016) writes exactly one row here AND updates provider_documents.current_review_status in the same transaction.';

revoke all on public.provider_document_reviews from authenticated, anon;
grant select on public.provider_document_reviews to authenticated;

create table if not exists public.provider_document_consents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  statement_id text not null
    check (statement_id in ('belge-dogruluk-beyani', 'gumruk-musaviri-belge-beyani')),
  statement_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  constraint provider_document_consents_no_duplicate
    unique (provider_id, statement_id, statement_version)
);

comment on table public.provider_document_consents is
  'One row per (provider, statement, version) accepted. ip_address/user_agent populated from real server-side request context once running on Supabase.';

revoke all on public.provider_document_consents from authenticated, anon;
grant select on public.provider_document_consents to authenticated;
