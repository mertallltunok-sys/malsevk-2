-- =============================================================================
-- MALSEVK — migration 0087: claim_offer_email_notification — durum
-- değişikliği sonrası retry düzeltmesi
-- =============================================================================
-- KÖK NEDEN (gerçek uçtan uca testte, Mailinator gerçek gelen kutusu +
-- Resend gerçek API doğrulamasıyla birlikte bulundu):
-- claim_offer_email_notification, bir retry çağrısında bile HER ZAMAN
-- ÖNCE aktör/durum doğrulamasını (actor_id = provider/requester VE
-- offers.status = 'pending'/'accepted') yapıyordu, YALNIZCA ondan SONRA
-- (offer_id, event_type) idempotency claim'ine bakıyordu. Gerçek senaryo:
-- bir 'new_offer' bildirimi başarıyla 'sent' olarak gönderildikten SONRA,
-- teklif normal akışta kabul edilip offers.status 'pending'den 'accepted'e
-- geçer — bu noktada 'new_offer' olayı için GÜVENLİ bir retry (ör. istemci
-- ağ zaman aşımı sonrası tekrar denerse) ML183 "offer is not pending" ile
-- YANLIŞLIKLA reddediliyordu, oysa e-posta zaten başarıyla gönderilmişti ve
-- retry'nin tek doğru davranışı sessizce no-op olmaktı.
--
-- DÜZELTME: aktör/durum doğrulaması yalnızca GERÇEKTEN yeni bir gönderim
-- denemesi (kayıt hiç yok ya da 'failed') için anlamlıdır — bu yüzden artık
-- ÖNCE mevcut email_deliveries kaydına bakılır: 'sent' ya da 'pending'
-- (başka bir istek şu an gönderiyor) ise aktör/durum HİÇ yeniden
-- doğrulanmadan doğrudan claimed=false döner (zaten gönderilmiş/gönderiliyor
-- olduğu için ne alıcı e-postası ne başka hassas alan döner, güvenlik
-- açısından fark yaratmaz). Atomik claim (INSERT...ON CONFLICT...WHERE
-- status='failed') hâlâ TEK gerçek mutasyon noktasıdır ve değişmedi — bu
-- ön-kontrol yalnızca gereksiz/yanlış bir reddi önler, yeni bir yetkilendirme
-- kuralı İCAT ETMEZ.
-- =============================================================================

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
  v_existing_status text;
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

  -- Zaten 'sent' ya da 'pending' (eşzamanlı gönderiliyor) bir kayıt varsa,
  -- teklifin GÜNCEL durumu artık ilgisizdir — bu no-op bir retry'dir,
  -- aktör/durum yeniden doğrulanmaz (bkz. dosya başlığı, gerçek bulunan hata).
  select status into v_existing_status from public.email_deliveries where offer_id = p_offer_id and event_type = p_event;
  if v_existing_status is not null and v_existing_status <> 'failed' then
    return query select false, null::uuid, null::text, null::text, null::text, null::uuid, null::text, null::numeric, null::text, null::text;
    return;
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
      ru.email::text,
      coalesce(rp.company_name, rp.full_name)::text,
      coalesce(ap.company_name, ap.full_name)::text,
      v_job.id,
      v_job.title::text,
      v_offer.amount,
      v_offer.currency::text,
      v_offer.commercial_direction::text
    from auth.users ru
    join public.profiles rp on rp.id = v_recipient_id
    join public.profiles ap on ap.id = v_actor_id
    where ru.id = v_recipient_id;
end;
$$;

comment on function public.claim_offer_email_notification(uuid, text) is
  '"Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-postalarının TEK hazırlık noktası. 0087: mevcut bir sent/pending delivery kaydı varsa aktör/durum yeniden doğrulanmadan doğrudan claimed=false döner (retry, teklif durumu ilerlemiş olsa bile asla yanlışlıkla reddedilmez) — bkz. dosyanın kendi başlığı, gerçek uçtan uca testte bulunan hata. Atomik idempotency claim işlemi (INSERT...ON CONFLICT...WHERE status=''failed'') değişmedi.';

revoke all on function public.claim_offer_email_notification(uuid, text) from public, anon;
grant execute on function public.claim_offer_email_notification(uuid, text) to authenticated;
