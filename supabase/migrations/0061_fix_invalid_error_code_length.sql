-- =============================================================================
-- MALSEVK — migration 0061: hata kodu uzunluğu düzeltmesi (MLK100/MLK101 ->
-- MLK86/MLK87)
-- =============================================================================
-- BULUNAN GERÇEK HATA (gerçek RPC çağrısıyla test edilirken bulundu):
-- Postgres'te `raise exception '...' using errcode = 'XXXXX'` yalnızca TAM
-- OLARAK 5 karakterli bir SQLSTATE-benzeri kod kabul eder — canlı veritabanına
-- karşı doğrudan doğrulandı: `errcode = 'MLK100'` (6 karakter) "unrecognized
-- exception condition" hatasıyla PATLIYORDU, `errcode = 'MLK86'` (5 karakter)
-- ise beklendiği gibi çalışıyor. Migration 0060'ta seçilen `MLK100`/`MLK101`
-- (canlı DB'deki her kullanılan MLK kodu sorgulanarak "boş" bulunmuştu, ama
-- 5 karakter kuralı gözden kaçırılmıştı) bu yüzden ASLA GERÇEKTEN
-- TETİKLENEMİYORDU — hem `create_provider_document`/`review_provider_document`
-- (IMO kod doğrulaması) hem `accept_offer` (uygunluk yeniden kontrolü) canlı
-- ortamda SESSİZCE bozuktu. Aynı DB sorgusu tekrarlanarak `MLK86`/`MLK87`nin
-- gerçekten boş 5 karakterli kodlar olduğu doğrulandı.
-- =============================================================================

create or replace function public.assert_valid_imo_class_codes(p_codes text[])
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_code text;
begin
  if p_codes is null then
    return;
  end if;
  foreach v_code in array p_codes loop
    if not (v_code = any(array[
      '1.1','1.2','1.3','1.4','1.5','1.6',
      '2.1','2.2','2.3',
      '3',
      '4.1','4.2','4.3',
      '5.1','5.2',
      '6.1','6.2',
      '7','8','9'
    ])) then
      raise exception 'MLK86: imo class codes must be one of the canonical IMO hazard class codes (got %)', v_code using errcode = 'MLK86';
    end if;
  end loop;
end;
$function$;

create or replace function public.accept_offer(p_offer_id uuid)
 returns offers
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer public.offers;
  v_job public.jobs;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select * into v_job from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end if;
  if v_job.category_id = 'konteyner-depolama' and not public.provider_can_view_job(v_offer.provider_id, v_job.category_id, v_job.storage_container_groups) then
    raise exception 'MLK87: provider no longer meets this job''s activity/IMO requirements' using errcode = 'MLK87';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_offer.provider_id::text || ':accept_offer'));
  if public.has_reached_active_job_limit(v_offer.provider_id) then
    raise exception 'MLK65: provider has reached active job capacity' using errcode = 'MLK65';
  end if;

  begin
    update public.offers set status = 'accepted', accepted_at = now()
      where id = p_offer_id and status = 'pending'
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end;
  if v_offer is null then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'accepted', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_kabul_edildi', v_offer.job_id, p_offer_id, v_job.operation_id,
    null, 'Hizmet Alan teklifinizi kabul etti.', null);

  return v_offer;
end;
$function$;
