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
    check (consent_source in ('registration', 'other')),

  -- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 3): onceki
  -- taslakta bu tabloda HICBIR unique kisit yoktu, ama tablo yorumu "one row
  -- per (user, document, version)" diyordu -- hicbir sey bunu DB seviyesinde
  -- zorlamiyordu. NULL user_id (anonim kabul) icin PostgreSQL UNIQUE kisiti
  -- her NULL'u birbirinden FARKLI sayar -- yani anonim satirlar arasinda
  -- hicbir de-duplikasyon ZORLANMAZ (istenen davranis: anonim kabuller
  -- birbirinden bagimsiz, tekillestirme kavrami onlara uygulanmaz), yalniz
  -- GERCEK (non-null) bir kullanici icin ayni (belge, surum) cifti tekrar
  -- kaydedilemez.
  constraint legal_consents_one_per_user_document_version
    unique (user_id, document_id, version)
);

comment on table public.legal_consents is
  'Append-only audit trail of legal-document acceptance, one row per (user, document, version) accepted. ip_address/user_agent are permanent-null placeholders until running on real Supabase infrastructure.';

revoke all on public.legal_consents from authenticated, anon;
grant select on public.legal_consents to authenticated;
-- INSERT only via record_legal_consent() (below, called once per document —
-- matching recordConsentForAllLegalDocuments's "one action, three
-- independent records" behaviour, three separate RPC calls). No UPDATE/
-- DELETE grant to any client role — permanent audit records, not even
-- soft-deletable.

-- -----------------------------------------------------------------------------
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 3 - KRITIK):
-- bu tablonun da hicbir yazma yolu yoktu. Misafir (anon) kabulu de mesru bir
-- senaryo oldugu icin (bkz. user_id'nin nullable olmasi VE
-- sweep_stale_anonymous_legal_consents'in -- 0018 -- bunu acikca varsaymasi)
-- bu RPC hem anon hem authenticated'e acik.
-- -----------------------------------------------------------------------------
create or replace function public.record_legal_consent(p_document_id text, p_version text)
returns public.legal_consents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.legal_consents;
begin
  if p_document_id not in ('privacy_policy', 'terms_of_service', 'kvkk') then
    raise exception 'MLK94: invalid document_id' using errcode = 'MLK94';
  end if;
  if p_version is null or char_length(trim(p_version)) = 0 then
    raise exception 'MLK94: version is required' using errcode = 'MLK94';
  end if;

  -- user_id HER ZAMAN auth.uid() (oturum yoksa NULL = anonim kabul) --
  -- cagiran baska bir kullanici adina onay kaydi olusturamaz.
  insert into public.legal_consents (user_id, document_id, version, consent_source)
  values (auth.uid(), p_document_id, trim(p_version), 'registration')
  on conflict on constraint legal_consents_one_per_user_document_version do nothing
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.legal_consents
      where user_id is not distinct from auth.uid()
        and document_id = p_document_id and version = trim(p_version)
      order by accepted_at desc limit 1;
  end if;

  return v_row;
end;
$$;

comment on function public.record_legal_consent(text, text) is
  'legal_consents icin TEK yazma yolu. user_id HER ZAMAN sunucu tarafinda auth.uid() ile belirlenir (anon icin NULL = anonim kabul, meru bir senaryo) -- cagiran hicbir sekilde baska bir kullanici adina kayit olusturamaz.';

revoke all on function public.record_legal_consent(text, text) from public;
grant execute on function public.record_legal_consent(text, text) to authenticated, anon;
