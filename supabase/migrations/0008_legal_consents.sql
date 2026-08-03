-- =============================================================================
-- MALSEVK — Faz 1 migration 0008: legal_consents
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. İçerik önceki tasarımın
-- 0009_legal_consents.sql'i ile aynıdır. Kayıt akışının (register-form,
-- login-form.tsx) ayrılmaz bir parçası — abonelik/ödeme/admin ile ilgisi
-- yok, bu yüzden Faz 1'de kalır.
-- =============================================================================

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  document_id text not null check (document_id in ('privacy_policy', 'terms_of_service', 'kvkk')),
  version text not null,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  consent_source text not null default 'registration'
    check (consent_source in ('registration', 'other'))
);

comment on table public.legal_consents is
  'Append-only audit trail of legal-document acceptance, one row per (user, document, version) accepted. ip_address/user_agent are permanent-null placeholders until running on real Supabase infrastructure.';

revoke all on public.legal_consents from authenticated, anon;
grant select on public.legal_consents to authenticated;
-- INSERT only via the registration RPC path (writes 3 rows, one per
-- document, matching recordConsentForAllLegalDocuments's "one action, three
-- independent records" behaviour). No UPDATE/DELETE grant to any client
-- role — permanent audit records, not even soft-deletable.
