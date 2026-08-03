-- =============================================================================
-- MALSEVK — Faz 1 migration 0012: shared security & business-rule helper functions
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DEĞİŞİKLİKLER (önceki tasarımın 0016_rls_helpers.sql'ine göre):
--   1. GÜVENLİK DÜZELTMESİ (önceki denetim C.3, Yüksek): log_audit_event()
--      artık `authenticated`'e DOĞRUDAN grant edilmiyor — yalnızca diğer
--      SECURITY DEFINER fonksiyonlar (aynı sahibe ait oldukları için) onu
--      içeriden çağırabilir. Önceki tasarım "yalnızca içeriden çağrılır"
--      diyordu ama `grant execute ... to authenticated` satırıyla bunu
--      PostgREST üzerinden HERKESE açık bir RPC uç noktası haline
--      getiriyordu — bu, sahte/uydurma audit_logs kaydı enjeksiyonuna izin
--      verirdi.
--   2. `has_admin_permission()` KALDIRILDI — admin_user_roles/admin_role_
--      permissions (Faz 2) tablolarına bağımlı. Faz 1'in TEK admin kapısı
--      is_admin() (profiles.role='admin', Layer 1) — bkz. görev bölüm 3.
--   3. YENİ: `get_active_job_limit()` — MAX_ACTIVE_JOBS=5'i (doğrulanmış:
--      app/_lib/provider-capacity.ts) sabit, merkezi TEK bir fonksiyonda
--      tutar; abonelik tablolarına (Faz 2) hiç bağımlı değildir.
--      `has_reached_active_job_limit()` artık get_effective_limit() yerine
--      bunu çağırıyor.
--   4. YENİ: `prevent_last_admin_loss()` tetikleyicisi — Faz 1'in "son
--      admin'in kaybolmasını engellemek" gereksinimi (bkz. görev bölüm 3).
--   5. `can_view_job_activity_event()` sadeleştirilmiş job_activity_events'e
--      (0010) uyarlandı — offer_id/offer_parties_only dalı kaldırıldı.
--
-- SECURITY DEFINER + fixed search_path — aşağıdaki HER fonksiyon için
-- geçerli: (1) SECURITY DEFINER, RLS recursion'ı önler (fonksiyon sahibi
-- olarak çalışır, kendi içindeki sorgu politika tarafından tekrar
-- tetiklenmez); (2) `set search_path = public`, caller-controlled schema'nın
-- unqualified isimleri gölgeleyerek yetki yükseltmesini önler.
-- =============================================================================

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

comment on function public.current_user_role() is
  'NULL if unauthenticated or if role is not yet set (registration incomplete).';

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 9): dogrudan
-- jobs_select_visible RLS politikasindan (0013, to authenticated, anon)
-- cagriliyor -- bu yuzden HER IKI role'e de EXECUTE gerekli (RLS policy
-- ifadeleri CAGIRAN rolun kendi EXECUTE yetkisiyle degerlendirilir, SECURITY
-- DEFINER bunu atlamaz).
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated, anon;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

comment on function public.is_admin() is
  'Faz 1''in TEK admin kapısı (profiles.role = ''admin''). Faz 2''nin has_admin_permission(code) ince taneli katmanı devreye alındığında bu fonksiyon DEĞİŞMEZ — yeni yetenekler onun yanına eklenir, onu değiştirmez (bkz. docs/database/future-migrations/MANIFEST.md).';

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 9): is_admin()
-- da jobs_select_visible (to authenticated, anon) dahil pek cok RLS
-- politikasindan DOGRUDAN cagriliyor -- her iki role de EXECUTE gerekli.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Job/offer ownership & party-membership predicates
-- -----------------------------------------------------------------------------
create or replace function public.is_job_owner(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.jobs where id = p_job_id and requester_id = auth.uid());
$$;

-- offers_select_parties_or_admin / offer_status_history_select_parties_or_admin
-- (0013, ikisi de yalniz "to authenticated") DOGRUDAN cagiriyor.
revoke all on function public.is_job_owner(uuid) from public, anon;
grant execute on function public.is_job_owner(uuid) to authenticated;

create or replace function public.is_offer_provider(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.offers where id = p_offer_id and provider_id = auth.uid());
$$;

-- Hicbir RLS politikasi/invoker-view/RPC bunu dogrudan cagirmiyor (0013-0018
-- taranmistir) -- client'a hicbir grant gerekmiyor.
revoke all on function public.is_offer_provider(uuid) from public, anon, authenticated;

-- Mirrors job-requests.ts#ENGAGED_OFFER_STATUSES exactly.
create or replace function public.is_engaged_offer_status(p_status text)
returns boolean
language sql
immutable
as $$
  select p_status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed');
$$;

comment on function public.is_engaged_offer_status(text) is
  'Mirrors job-requests.ts#ENGAGED_OFFER_STATUSES; change this ONE function if that set ever changes, never re-list the four statuses elsewhere.';

-- Yalnizca ayni sahibin diger fonksiyonlarindan (owner-to-owner) cagrilir --
-- hicbir RLS politikasi/invoker-view bunu dogrudan cagirmaz.
revoke all on function public.is_engaged_offer_status(text) from public, anon, authenticated;

create or replace function public.has_engaged_offer_access(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.offers
    where job_id = p_job_id and provider_id = auth.uid() and public.is_engaged_offer_status(status)
  );
$$;

revoke all on function public.has_engaged_offer_access(uuid) from public, anon, authenticated;

create or replace function public.can_view_job_contact(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_job_owner(p_job_id) or public.has_engaged_offer_access(p_job_id);
$$;

comment on function public.can_view_job_contact(uuid) is
  'Mirrors job-requests.ts#canViewJobAddress exactly (job owner always; any other caller only via their own engaged offer). Gates jobs.address_text/neighborhood/location_url/directions_note visibility.';

-- Yalniz get_job_address() (0014, SECURITY DEFINER, owner-to-owner cagri)
-- kullaniyor -- hicbir RLS politikasi/view bunu dogrudan cagirmiyor.
revoke all on function public.can_view_job_contact(uuid) from public, anon, authenticated;

create or replace function public.can_view_offer_contact(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.offers o
    join public.jobs j on j.id = o.job_id
    where o.id = p_offer_id
      and public.is_engaged_offer_status(o.status)
      and (auth.uid() = o.provider_id or auth.uid() = j.requester_id)
  );
$$;

comment on function public.can_view_offer_contact(uuid) is
  'Mirrors contact-access.ts#getRevealedContactForOffer exactly.';

-- Faz 1'in hicbir RPC'si bunu bugun cagirmiyor (ileride bir gercek
-- iletisim-acma RPC'si icin hazir tutulur) -- client'a hicbir grant yok.
revoke all on function public.can_view_offer_contact(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Settled/engaged offer derivation — mirrors job-requests.ts precisely
-- -----------------------------------------------------------------------------
create or replace function public.get_engaged_offer_id_for_job(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.offers
  where job_id = p_job_id and public.is_engaged_offer_status(status)
  limit 1;
$$;

-- Yalniz get_settled_offer_id_for_job (asagida, owner-to-owner) kullaniyor.
revoke all on function public.get_engaged_offer_id_for_job(uuid) from public, anon, authenticated;

create or replace function public.get_completed_offer_id_for_job(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.offers where job_id = p_job_id and status = 'completed' limit 1;
$$;

revoke all on function public.get_completed_offer_id_for_job(uuid) from public, anon, authenticated;

create or replace function public.get_settled_offer_id_for_job(p_job_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.get_engaged_offer_id_for_job(p_job_id),
    public.get_completed_offer_id_for_job(p_job_id)
  );
$$;

comment on function public.get_settled_offer_id_for_job(uuid) is
  'Mirrors job-requests.ts#getSettledOfferForJob exactly (engaged ?? completed).';

-- requester_job_summary / job_offer_summary (0017, security_invoker=true,
-- to authenticated) DOGRUDAN cagiriyor.
revoke all on function public.get_settled_offer_id_for_job(uuid) from public, anon;
grant execute on function public.get_settled_offer_id_for_job(uuid) to authenticated;

create or replace function public.is_job_closed_to_new_offers(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select settled_status is not null and settled_status <> 'accepted'
  from (
    select o.status as settled_status
    from public.offers o
    where o.id = public.get_settled_offer_id_for_job(p_job_id)
  ) s;
$$;

comment on function public.is_job_closed_to_new_offers(uuid) is
  'KRİTİK MİMARİ AYRIM, korunmuştur: mirrors job-requests.ts#isJobClosedToNewOffers — yalnız ''accepted'' bir settled teklif ilanı YENİ tekliflere kapatmaz; yalnız settled teklif ''accepted''ın ÖTESİNE geçtiğinde kapatır.';

-- operation_progress / job_offer_summary (0017, security_invoker=true, to
-- authenticated) DOGRUDAN cagiriyor.
revoke all on function public.is_job_closed_to_new_offers(uuid) from public, anon;
grant execute on function public.is_job_closed_to_new_offers(uuid) to authenticated;

create or replace function public.is_offer_pending_action_blocked(p_offer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when v_settled is null then false
    else v_settled <> p_offer_id
  end
  from (select public.get_settled_offer_id_for_job((select job_id from public.offers where id = p_offer_id)) as v_settled) s;
$$;

comment on function public.is_offer_pending_action_blocked(uuid) is
  'Mirrors job-requests.ts#isOfferPendingActionBlocked. Uygulama tarafı, ilk-kontrol katmanı — GERÇEK, race-condition-güvenli garanti offers_one_settled_per_job partial unique index''idir (0005_offers_and_status_history.sql); bkz. accept_offer() (0015) üzerindeki güvenlik notu.';

-- Yalniz accept_offer()/reject_offer() (0015, owner-to-owner) kullaniyor --
-- hicbir RLS politikasi/view bunu dogrudan cagirmiyor.
revoke all on function public.is_offer_pending_action_blocked(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Publish-window / expiry — mirrors job-publish-window.ts precisely
-- -----------------------------------------------------------------------------
create or replace function public.is_job_listing_expired(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.get_settled_offer_id_for_job(p_job_id) is null
     and exists (select 1 from public.jobs where id = p_job_id and publish_end_at < now())
$$;

comment on function public.is_job_listing_expired(uuid) is
  'Mirrors job-publish-window.ts#isJobListingExpired exactly (JOB_PUBLISH_WINDOW_DAYS = 14, doğrulanmış).';

-- active_job_listings (0017, security_invoker=true, to authenticated, anon)
-- DOGRUDAN cagiriyor -- her iki role de EXECUTE gerekli.
revoke all on function public.is_job_listing_expired(uuid) from public;
grant execute on function public.is_job_listing_expired(uuid) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Provider capacity — Faz 1: sabit merkezi helper, abonelik tablosuna
-- BAĞIMLI DEĞİL (bkz. dosya başlığı, görev bölüm 4)
-- -----------------------------------------------------------------------------
create or replace function public.get_active_job_count(p_provider_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.offers
  where provider_id = p_provider_id and public.is_engaged_offer_status(status);
$$;

-- provider_active_job_count (0017, security_invoker=true, to authenticated)
-- DOGRUDAN cagiriyor.
revoke all on function public.get_active_job_count(uuid) from public, anon;
grant execute on function public.get_active_job_count(uuid) to authenticated;

create or replace function public.get_active_job_limit()
returns integer
language sql
immutable
as $$
  select 5;
$$;

comment on function public.get_active_job_limit() is
  'Faz 1 sabiti — app/_lib/provider-capacity.ts#MAX_ACTIVE_JOBS = 5 ile doğrulanmış, birebir eşleşiyor. TEK merkezi kaynak: hiçbir RPC bu sayıyı kendi içinde tekrarlamaz (magic number dağıtmama kuralı). Faz 2''nin abonelik/kota sistemi devreye alındığında bu fonksiyon CREATE OR REPLACE ile get_effective_limit(auth.uid(), ''max_active_jobs'')''i çağıracak şekilde güncellenir — has_reached_active_job_limit() ve onu çağıran her RPC (create_offer, accept_offer) DEĞİŞMEDEN kalır. Bkz. docs/database/future-migrations/MANIFEST.md.';

-- provider_active_job_count (0017, security_invoker=true, to authenticated)
-- DOGRUDAN cagiriyor.
revoke all on function public.get_active_job_limit() from public, anon;
grant execute on function public.get_active_job_limit() to authenticated;

create or replace function public.has_reached_active_job_limit(p_provider_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer;
begin
  v_limit := public.get_active_job_limit();
  if v_limit is null then
    return false; -- NULL = sınırsız (Faz 2 devreye girdiğinde mümkün olabilir)
  end if;
  return public.get_active_job_count(p_provider_id) >= v_limit;
end;
$$;

comment on function public.has_reached_active_job_limit(uuid) is
  'Mirrors provider-capacity.ts#hasReachedActiveJobLimit exactly — bugünkü davranış birebir korunur (MAX_ACTIVE_JOBS=5).';

-- Yalniz create_offer()/accept_offer() (0015, owner-to-owner) kullaniyor --
-- hicbir RLS politikasi/view bunu dogrudan cagirmiyor.
revoke all on function public.has_reached_active_job_limit(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Category visibility isolation — mirrors job-visibility.ts precisely
-- -----------------------------------------------------------------------------
create or replace function public.provider_can_view_category(p_provider_id uuid, p_category_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_isolated_selected_count integer;
begin
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    return true; -- non-providers are unaffected, mirrors resolveVisibility's early return
  end if;

  select count(*) into v_isolated_selected_count
  from public.provider_services ps
  join public.service_categories sc on sc.id = ps.service_category_id
  where ps.provider_id = p_provider_id and sc.visibility_scope = 'isolated';

  if v_isolated_selected_count = 0 then
    return true; -- no isolated category selected: unaffected, mirrors resolveVisibility
  end if;

  return exists (
    select 1
    from public.provider_services ps
    join public.service_categories sc on sc.id = ps.service_category_id
    where ps.provider_id = p_provider_id
      and sc.visibility_scope = 'isolated'
      and sc.id = p_category_id
  );
end;
$$;

comment on function public.provider_can_view_category(uuid, text) is
  'Mirrors job-visibility.ts#resolveVisibility exactly (verified: Nakliye + Gümrük Müşavirliği izolasyonu — bir sağlayıcı hiç izole kategori seçmemişse HER ilanı görür, brief''in "yalnız seçili kategoriler" iddiasının AKSİNE — bkz. önceki denetim raporu Açık Karar #2).';

-- jobs_select_visible / operations_select_visible (0013, to authenticated,
-- anon) VE provider_visible_jobs (0017, security_invoker=true) DOGRUDAN
-- cagiriyor -- her iki role de EXECUTE gerekli.
revoke all on function public.provider_can_view_category(uuid, text) from public;
grant execute on function public.provider_can_view_category(uuid, text) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Job activity event visibility — sadeleştirilmiş job_activity_events'e (0010)
-- uyarlandı (offer_parties_only kaldırıldı)
-- -----------------------------------------------------------------------------
create or replace function public.can_view_job_activity_event(p_event_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visibility text;
  v_job_id uuid;
begin
  select visibility, job_id into v_visibility, v_job_id
  from public.job_activity_events where id = p_event_id;

  if v_visibility is null then
    return false;
  end if;
  if v_visibility = 'public' then
    return exists (select 1 from public.jobs where id = v_job_id);
  end if;
  -- 'requester_only'
  return public.is_job_owner(v_job_id);
end;
$$;

-- job_activity_events_select_visible (0013, to authenticated) DOGRUDAN
-- cagiriyor.
revoke all on function public.can_view_job_activity_event(uuid) from public, anon;
grant execute on function public.can_view_job_activity_event(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- log_audit_event — the ONLY write path into audit_logs
-- -----------------------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_old_data jsonb default null,
  p_new_data jsonb default null,
  p_ip_address inet default null,
  p_user_agent text default null,
  p_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id,
    old_data, new_data, request_id, ip_address, user_agent
  ) values (
    auth.uid(), public.current_user_role(), p_action, p_entity_type, p_entity_id,
    p_old_data, p_new_data, p_request_id, p_ip_address, p_user_agent
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.log_audit_event(text, text, uuid, jsonb, jsonb, inet, text, text) is
  'Callers MUST pre-redact p_old_data/p_new_data (never pass a raw to_jsonb(row) for a table containing phone/email/address).';

-- GÜVENLİK DÜZELTMESİ (önceki denetim C.3, Yüksek): `authenticated`'e HİÇ
-- grant YOK — yalnızca aynı sahibe ait diğer SECURITY DEFINER fonksiyonlar
-- (suspend_user, close_job_as_admin, review_provider_document, ...) bunu
-- içeriden çağırabilir; Postgres'te aynı sahibin fonksiyonları birbirini
-- çağırmak için ayrı bir client-grant'a ihtiyaç duymaz. Önceki tasarımın
-- `grant execute ... to authenticated` satırı KASITLI OLARAK KALDIRILDI.
revoke all on function public.log_audit_event(text, text, uuid, jsonb, jsonb, inet, text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- GÜVENLİK: son admin'in kaybolmasını engelleme (görev bölüm 3)
-- -----------------------------------------------------------------------------
-- Faz 1'de profiles.role/deleted_at'i değiştirebilen HİÇBİR client-callable
-- RPC yoktur (0003'teki column-grant zaten role/deleted_at'i authenticated'e
-- kapatıyor) — yani bu koruma bugün yalnızca DOĞRUDAN DB erişimiyle yapılan
-- kazara hatalara karşı bir savunma-derinliği katmanıdır (tıpkı önceki
-- tasarımın admin_user_roles bootstrap notundaki gibi). Faz 2'nin
-- grant_admin_role()/revoke_admin_role() RPC'leri devreye girdiğinde bu
-- tetikleyici hâlâ geçerli kalır ve ek bir koruma katmanı sağlar.
create or replace function public.prevent_last_admin_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'admin' and (new.role is distinct from 'admin' or new.deleted_at is not null) then
    if not exists (
      select 1 from public.profiles
      where role = 'admin' and deleted_at is null and id <> old.id
    ) then
      raise exception 'MLK90: cannot remove the last admin account' using errcode = 'MLK90';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.prevent_last_admin_loss() is
  'Faz 1''in "son admin korunmalı" gereksinimi. profiles.role/deleted_at değişimini engeller EĞER bu, sistemdeki son role=''admin''/deleted_at is null satırıysa. suspend_user() (0016) için AYRI, tamamlayıcı bir kontrol de o RPC''nin kendi gövdesinde vardır (son AKTİF admin''in askıya alınmasını engeller — account_status değişimi bu tetikleyicinin kapsamında değildir).';

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 9): tetikleyici
-- fonksiyonu, hicbir client'in dogrudan cagirmasina gerek yok.
revoke all on function public.prevent_last_admin_loss() from public, anon, authenticated;

-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 10 -
-- idempotency): DROP IF EXISTS + CREATE.
drop trigger if exists trg_profiles_prevent_last_admin_loss on public.profiles;
create trigger trg_profiles_prevent_last_admin_loss
  before update of role, deleted_at on public.profiles
  for each row execute function public.prevent_last_admin_loss();
