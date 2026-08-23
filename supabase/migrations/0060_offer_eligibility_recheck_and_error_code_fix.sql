-- =============================================================================
-- MALSEVK — migration 0060: teklif kabulünde uygunluk yeniden kontrolü +
-- hata kodu çakışması düzeltmesi (MLK56)
-- =============================================================================
-- BÖLÜM A — HATA KODU ÇAKIŞMASI DÜZELTMESİ (kod incelemesi sırasında
-- bulundu, migration 0058'in kendi hatası): `assert_valid_imo_class_codes`
-- (0058/0059) yanlışlıkla `MLK56` kodunu kullanıyordu — bu kod ZATEN
-- `accept_offer`in "bu teklifin ilanının sahibi değilsiniz" hatası için
-- kullanılıyordu (app/_lib/supabase-offer-sync.ts#mapOfferSyncError'ın
-- "Bu işlem üzerinde yetkiniz yok." eşlemesi, migration 0058'den ÖNCE VAR
-- OLAN, doğru anlam). İki farklı RPC'nin İKİ TAMAMEN FARKLI hatası aynı kodu
-- paylaşıyordu — canlı DB'deki HER kullanılan MLK kodu doğrudan sorgulanarak
-- (`pg_get_functiondef` + regex) doğrulandı, `MLK100` gerçekten boş/kullanılmamış.
-- `assert_valid_imo_class_codes`in TEK çağrı noktası olduğu için (validate_
-- storage_container_groups/create_provider_document/authorize_provider_
-- service/review_provider_document, hepsi migration 0059'da bu paylaşılan
-- fonksiyonu çağırıyor) burada TEK bir düzeltme dört RPC'yi de kapsar.
--
-- BÖLÜM B — TEKLİF KABULÜNDE UYGUNLUK YENİDEN KONTROLÜ (görev talimatı:
-- "Teklif kabul edilirken uygunluğu yeniden kontrol et. Teklifin geçmişte
-- oluşturulabilmiş olması tek başına kabul edilmesi için yeterli olmasın.")
-- — `accept_offer`, migration 0059'un `provider_can_view_job()`sunu (İKİNCİ
-- bir eşleştirme motoru İCAT EDİLMEDİ, AYNEN yeniden kullanılır — create_
-- offer'ın MLK60 kapısıyla BİREBİR AYNI fonksiyon) YENİDEN çağırır: teklif
-- oluşturulduktan SONRA firmanın belgesi reddedilmiş/iptal edilmiş/süresi
-- dolmuş/yetkisi geri alınmışsa, kabul anında bu artık geçersiz durum
-- yakalanır. `v_job`nin tamamı artık FONKSİYONUN BAŞINDA (yalnızca
-- `requester_id` yerine) okunur — gövdenin geri kalanı zaten `v_job`i
-- KULLANIYORDU (kabul SONRASI), bu yüzden tek satırlık erken bir `select *`
-- hem yeni kontrolü hem mevcut kullanımı besler, ikinci bir sorgu eklenmez.
-- İMZA DEĞİŞMEDİ (yalnızca gövde).
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
      raise exception 'MLK100: imo class codes must be one of the canonical IMO hazard class codes (got %)', v_code using errcode = 'MLK100';
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
    raise exception 'MLK101: provider no longer meets this job''s activity/IMO requirements' using errcode = 'MLK101';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_offer.provider_id::text || ':accept_offer'));
  if public.has_reached_active_job_limit(v_offer.provider_id) then
    raise exception 'MLK65: provider has reached active job capacity' using errcode = 'MLK65';
  end if;

  -- GÜVENLİK: gerçek "job başına tek settled teklif" garantisi
  -- offers_one_settled_per_job partial unique index'idir (0005). Yukarıdaki
  -- is_offer_pending_action_blocked() kontrolü yalnızca ERKEN/dostça bir
  -- hata için vardır — iki farklı sağlayıcının aynı ilana eşzamanlı kabulü
  -- durumunda GERÇEK engel burada, unique_violation'ı yakalayarak sağlanır.
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
  -- NOT: job_activity_events'e YAZILMIYOR — teklif olayları yalnız
  -- offer_status_history'de (bkz. 0010'un sadeleştirme kararı).

  return v_offer;
end;
$function$;
