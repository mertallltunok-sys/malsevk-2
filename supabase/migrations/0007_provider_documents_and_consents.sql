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

drop trigger if exists trg_provider_documents_set_updated_at on public.provider_documents;
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

-- -----------------------------------------------------------------------------
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 3 - KRITIK):
-- provider_document_consents'in bu dosyada (ve 0013'te) hicbir yazma yolu
-- yoktu - yalniz SELECT grant/policy vardi, ne INSERT grant'i ne bir RPC.
-- Ama kaynagin provider-registration.ts#registerProviderAccount'u her
-- Gumruk Musaviri disi Hizmet Veren kaydinda recordProviderDocumentConsent()
-- cagiriyor - bu tablo yazilamadan kayit akisi tamamlanamiyordu. Asagidaki
-- RPC, mevcut mimariye uygun sekilde (SECURITY DEFINER, auth.uid()
-- dogrulamasi, en dar kapsamli GRANT) tek yazma yolunu acar.
-- -----------------------------------------------------------------------------
create or replace function public.record_provider_document_consent(
  p_statement_id text, p_statement_version text
)
returns public.provider_document_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_document_consents;
begin
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to record a document consent' using errcode = 'MLK93';
  end if;
  if p_statement_id not in ('belge-dogruluk-beyani', 'gumruk-musaviri-belge-beyani') then
    raise exception 'MLK94: invalid statement_id' using errcode = 'MLK94';
  end if;
  if p_statement_version is null or char_length(trim(p_statement_version)) = 0 then
    raise exception 'MLK94: statement_version is required' using errcode = 'MLK94';
  end if;

  -- provider_id HER ZAMAN auth.uid() -- cagiran hicbir sekilde baska bir
  -- kullanici adina onay kaydi olusturamaz (parametre olarak alinmiyor).
  insert into public.provider_document_consents (provider_id, statement_id, statement_version)
  values (auth.uid(), p_statement_id, trim(p_statement_version))
  on conflict on constraint provider_document_consents_no_duplicate do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.provider_document_consents
      where provider_id = auth.uid() and statement_id = p_statement_id and statement_version = trim(p_statement_version);
  end if;

  return v_row;
end;
$$;

comment on function public.record_provider_document_consent(text, text) is
  'provider_document_consents icin TEK yazma yolu. provider_id HER ZAMAN sunucu tarafinda auth.uid() ile belirlenir -- baska bir kullanici adina onay kaydi olusturulamaz. statement_version cagiran tarafindan verilir (guncel surum, legal-documents.ts/customs-license.ts benzeri bir istemci-taraflI kayittan gelir -- bu semada ayri bir "guncel surum" tablosu yoktur).';

revoke all on function public.record_provider_document_consent(text, text) from public, anon;
grant execute on function public.record_provider_document_consent(text, text) to authenticated;
