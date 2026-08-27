-- =============================================================================
-- MALSEVK — migration 0085: e-posta bildirim teslimat kaydı + iki dar amaçlı
-- SECURITY DEFINER RPC (Resend teklif e-postaları görevi)
-- =============================================================================
-- KÖK MİMARİ KARARI: e-postanın kendisi Postgres'ten DEĞİL, Next.js Route
-- Handler'ından (Resend HTTP API, sunucu tarafı) gönderilir — bu proje pg_net/
-- Edge Functions kullanmıyor (bkz. CLAUDE.md "Supabase Auth migration"),
-- yeni bir altyapı İCAT EDİLMEDİ. Bu migration yalnızca İKİ şeyi sağlar:
--   1) `public.email_deliveries` — kalıcı, benzersiz (offer_id, event_type)
--      idempotency/teslimat kaydı. authenticated/anon'a HİÇBİR grant yok,
--      RLS açık ve KASITLI OLARAK sıfır policy — tek erişim yolu aşağıdaki
--      iki SECURITY DEFINER fonksiyondur (get_offer_contact/get_job_address
--      ile AYNI dar-kapsamlı RPC deseni, bkz. 0078/0014).
--   2) `claim_offer_email_notification(p_offer_id, p_event)` — çağıranın
--      (auth.uid()) gerçekten bu olayın doğru tarafı olduğunu VE teklifin
--      GERÇEK sunucu durumunun (public.offers, tek doğruluk kaynağı) o olayla
--      tutarlı olduğunu doğrular, ardından atomik "claim" (INSERT ... ON
--      CONFLICT ... WHERE status = 'failed') ile aynı olay için ikinci bir
--      başarılı gönderimi İMKANSIZ kılar — bu bir uygulama-katmanı
--      "kontrol-sonra-yaz" kontrolü DEĞİL, veritabanı seviyesinde bir garanti
--      (unique constraint + koşullu upsert). Alıcının GERÇEK e-postasını
--      (auth.users.email, hiçbir client tablosunda YOKTUR) yalnızca claim
--      başarılıysa döner.
--   3) `mark_offer_email_delivery(p_delivery_id, p_status, ...)` — Resend
--      çağrısının GERÇEK sonucunu (sent/failed) yazar; yalnızca claim'i
--      kazanan AYNI kullanıcı (actor_user_id = auth.uid()) kendi kaydını
--      güncelleyebilir.
--
-- Yeni bir teklif/bildirim sistemi İCAT EDİLMEDİ — mevcut public.offers/
-- public.jobs/public.profiles tek doğruluk kaynağı olarak okunur,
-- assert_active_user() (0042) ve mevcut hata kodu kalıbı (MLK.../ML1xx)
-- AYNEN yeniden kullanılır. Kullanılan yeni kodlar (çakışma taraması
-- yapıldı — ML177 ve sonrası hiçbir migration'da kullanılmıyor): ML180-ML186.
-- =============================================================================

create table if not exists public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id) on delete cascade,
  event_type text not null check (event_type in ('new_offer', 'offer_accepted')),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  resend_message_id text,
  error_message text,
  attempt_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_deliveries_one_per_offer_event unique (offer_id, event_type)
);

comment on table public.email_deliveries is
  'Teklif e-posta bildirimlerinin (yeni_teklif/teklif_kabul_edildi) idempotency + teslimat durumu kaydı. (offer_id, event_type) UNIQUE olduğu için aynı olay için asla ikinci bir başarılı gönderim oluşamaz. authenticated/anon''a hiçbir doğrudan erişim YOKTUR (ne SELECT ne yazma) — tek yol claim_offer_email_notification/mark_offer_email_delivery''dir.';

revoke all on public.email_deliveries from authenticated, anon;
alter table public.email_deliveries enable row level security;
-- Kasıtlı olarak SIFIR RLS policy: authenticated/anon zaten hiçbir tablo
-- ayrıcalığına sahip değil (yukarıdaki revoke), RLS bu ikinci, bağımsız bir
-- savunma katmanıdır. SECURITY DEFINER fonksiyonları tablo SAHİBİNİN
-- (postgres) ayrıcalıklarıyla çalıştığı için RLS'ten etkilenmez.

create index if not exists email_deliveries_offer_id_idx on public.email_deliveries (offer_id);

-- -----------------------------------------------------------------------------
-- claim_offer_email_notification — "yeni teklif" veya "teklif kabul edildi"
-- e-postasını göndermeye çalışmadan ÖNCE Next.js route'unun çağırdığı RPC.
-- claimed = false dönerse (zaten 'sent' ya da başka bir istek şu an
-- 'pending'/gönderiyor), route HİÇBİR e-posta göndermez — bu, "aynı olay
-- tekrarlandığında mükerrer e-posta gönderilmesin" gereksiniminin veritabanı
-- seviyesindeki garantisidir.
-- -----------------------------------------------------------------------------
create or replace function public.claim_offer_email_notification(p_offer_id uuid, p_event text)
returns table (
  claimed boolean,
  delivery_id uuid,
  recipient_email text,
  recipient_display_name text,
  actor_display_name text,
  job_id uuid,
  job_title text,
  offer_amount numeric,
  offer_currency text,
  offer_commercial_direction text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_recipient_id uuid;
  v_delivery_id uuid;
  v_actor_id uuid;
begin
  perform public.assert_active_user();
  v_actor_id := auth.uid();

  if p_event not in ('new_offer', 'offer_accepted') then
    raise exception 'ML180: invalid event type' using errcode = 'ML180';
  end if;

  select * into v_offer from public.offers where id = p_offer_id and deleted_at is null;
  if v_offer is null then
    raise exception 'ML181: offer not found' using errcode = 'ML181';
  end if;

  select * into v_job from public.jobs j where j.id = v_offer.job_id;
  if v_job is null then
    raise exception 'ML181: offer not found' using errcode = 'ML181';
  end if;

  if p_event = 'new_offer' then
    if v_actor_id <> v_offer.provider_id then
      raise exception 'ML182: caller is not the provider of this offer' using errcode = 'ML182';
    end if;
    if v_offer.status <> 'pending' then
      raise exception 'ML183: offer is not pending' using errcode = 'ML183';
    end if;
    v_recipient_id := v_job.requester_id;
  else
    if v_actor_id <> v_job.requester_id then
      raise exception 'ML184: caller is not the requester of this job' using errcode = 'ML184';
    end if;
    if v_offer.status <> 'accepted' then
      raise exception 'ML185: offer is not accepted' using errcode = 'ML185';
    end if;
    v_recipient_id := v_offer.provider_id;
  end if;

  -- Atomik claim: satır hiç yoksa oluştur; 'failed' ise yeniden dene; 'pending'
  -- (başka bir çağrı şu an gönderiyor) ya da 'sent' ise WHERE koşulu eşleşmez,
  -- UPDATE hiç uygulanmaz ve INSERT..ON CONFLICT..RETURNING satır DÖNMEZ.
  insert into public.email_deliveries (offer_id, event_type, recipient_user_id, actor_user_id, status, attempt_count)
    values (p_offer_id, p_event, v_recipient_id, v_actor_id, 'pending', 1)
  on conflict (offer_id, event_type) do update
    set status = 'pending', updated_at = now(), attempt_count = email_deliveries.attempt_count + 1
    where email_deliveries.status = 'failed'
  returning id into v_delivery_id;

  if v_delivery_id is null then
    return query select false, null::uuid, null::text, null::text, null::text, null::uuid, null::text, null::numeric, null::text, null::text;
    return;
  end if;

  return query
    select
      true,
      v_delivery_id,
      ru.email,
      coalesce(rp.company_name, rp.full_name),
      coalesce(ap.company_name, ap.full_name),
      v_job.id,
      v_job.title,
      v_offer.amount,
      v_offer.currency,
      v_offer.commercial_direction
    from auth.users ru
    join public.profiles rp on rp.id = v_recipient_id
    join public.profiles ap on ap.id = v_actor_id
    where ru.id = v_recipient_id;
end;
$$;

comment on function public.claim_offer_email_notification(uuid, text) is
  '"Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-postalarının TEK hazırlık noktası — çağıranın gerçekten o olayın doğru tarafı olduğunu ve public.offers''ın GERÇEK durumunun o olayla tutarlı olduğunu doğrular, ardından (offer_id, event_type) UNIQUE kısıtı + koşullu upsert ile atomik idempotency claim''i yapar. claimed=false ise route hiçbir e-posta göndermemelidir (zaten gönderilmiş ya da eşzamanlı bir istek gönderiyor). get_offer_contact (0078) ile KARIŞTIRILMAMALI — bu fonksiyon "kabul sonrası karşı taraf iletişim bilgisi ifşası" değil, alıcının KENDİ e-postasına sistem bildirimi göndermek içindir; new_offer olayında teklif verenin kimliği route katmanında bilerek KULLANILMAZ (bkz. job-requests.ts#isOfferProviderIdentityRevealed ile AYNI kabul-öncesi anonimleştirme ilkesi) — bu RPC actor_display_name''i yine de döner, o kararı burada değil TypeScript''te tek yerde tutmak için.';

revoke all on function public.claim_offer_email_notification(uuid, text) from public, anon;
grant execute on function public.claim_offer_email_notification(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- mark_offer_email_delivery — Resend API çağrısının GERÇEK sonucunu yazar.
-- Yalnızca claim'i kazanan AYNI oturum (actor_user_id = auth.uid()) kendi
-- delivery kaydını güncelleyebilir.
-- -----------------------------------------------------------------------------
create or replace function public.mark_offer_email_delivery(
  p_delivery_id uuid,
  p_status text,
  p_resend_message_id text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_active_user();

  if p_status not in ('sent', 'failed') then
    raise exception 'ML186: invalid delivery status' using errcode = 'ML186';
  end if;

  update public.email_deliveries
    set status = p_status,
        resend_message_id = p_resend_message_id,
        error_message = left(coalesce(p_error_message, ''), 500),
        updated_at = now()
    where id = p_delivery_id and actor_user_id = auth.uid();

  if not found then
    raise exception 'ML186: delivery not found or not owned by caller' using errcode = 'ML186';
  end if;
end;
$$;

comment on function public.mark_offer_email_delivery(uuid, text, text, text) is
  'claim_offer_email_notification ile açılan bir delivery kaydının GERÇEK Resend sonucunu (sent/failed) yazar. actor_user_id = auth.uid() kontrolü, claim''i kazanmayan bir çağıranın başka birinin delivery kaydını değiştirmesini engeller. error_message 500 karaktere kırpılır (hassas/uzun içerik veritabanında kalıcı olarak büyümesin diye) — API anahtarı/e-posta adresi asla bu alana yazılmaz (route katmanının kendi sorumluluğu, bkz. app/api/offer-notifications/route.ts).';

revoke all on function public.mark_offer_email_delivery(uuid, text, text, text) from public, anon;
grant execute on function public.mark_offer_email_delivery(uuid, text, text, text) to authenticated;
