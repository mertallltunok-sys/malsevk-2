-- =============================================================================
-- MALSEVK — migration 0086: claim_offer_email_notification — varchar/text
-- tip uyuşmazlığı düzeltmesi (42804)
-- =============================================================================
-- KÖK NEDEN: 0085'in claim_offer_email_notification'ı `language plpgsql` +
-- `return query select ...` kullanıyor; `auth.users.email` GERÇEKTE
-- `character varying`dir (`text` DEĞİL — information_schema ile doğrulandı),
-- ve PL/pgSQL'in RETURN QUERY yürütücüsü, get_offer_contact (0078, `language
-- sql`) ile AYNI gevşek/otomatik atamayı UYGULAMAZ — sonuç, GERÇEK bir uçtan
-- uca testte (tmp-supabase-offer-email-notifications-test.mjs) yakalanan
-- SQLSTATE 42804 "datatype mismatch" idi; fonksiyon çağıranın kimliği ne
-- olursa olsun (hem otomatik tetikleyici hem manuel retry, GERÇEK teklif
-- sahibi/kabul eden için bile) her zaman başarısız oluyordu — ML182/184 gibi
-- yetkilendirme hatası DEĞİLDİ, saf bir tip hatasıydı. Tek değişiklik:
-- `ru.email` -> `ru.email::text` (RETURN QUERY'nin bildirilen `text` sütun
-- tipiyle tam eşleşmesi için); yeni bir mantık/yetkilendirme kuralı İCAT
-- EDİLMEDİ, dosya başlığındaki tasarım AYNEN korunuyor.
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
  '"Yeni Teklif Geldi"/"Teklifiniz Kabul Edildi" e-postalarının TEK hazırlık noktası — çağıranın gerçekten o olayın doğru tarafı olduğunu ve public.offers''ın GERÇEK durumunun o olayla tutarlı olduğunu doğrular, ardından (offer_id, event_type) UNIQUE kısıtı + koşullu upsert ile atomik idempotency claim''i yapar. claimed=false ise route hiçbir e-posta göndermemelidir. 0086: ru.email''e ::text cast''i eklendi (auth.users.email character varying''dir, PL/pgSQL RETURN QUERY''nin bildirilen text sütunuyla tam eşleşmesi gerekir) — mantıkta değişiklik yok, yalnızca tip düzeltmesi.';

revoke all on function public.claim_offer_email_notification(uuid, text) from public, anon;
grant execute on function public.claim_offer_email_notification(uuid, text) to authenticated;
