-- =============================================================================
-- MALSEVK — Faz 1 migration 0022: profiles bootstrap + offer lifecycle runtime fix
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- KÖKEN: 0001–0021, gerçek/hosted bir development Supabase projesine
-- (`supabase link` ile bağlı, `supabase db push`) uygulandıktan SONRA, gerçek
-- GoTrue Auth/JWT/RLS/Storage akışlarıyla canlı test edildi (bkz. kullanıcı
-- tarafından sağlanan canlı doğrulama raporu). Bu test, yerel Docker dry-run'ın
-- (SUPABASE-MIGRATION-VALIDATION.md) YAKALAYAMADIĞI iki bağımsız, kritik
-- çalışma-zamanı hatası buldu — ikisi de statik inceleme veya CREATE-zamanı
-- kontrolüyle görülemez, yalnızca gerçek veriyle gerçek çalıştırmada ortaya
-- çıkar. Bu migration YALNIZCA bu iki hatayı düzeltir — 0001–0021'in hiçbir
-- dosyası değiştirilmedi, hiçbir iş kuralı/hata kodu/yetki modeli yeniden
-- tasarlanmadı.
--
-- Hata kodu aralığı: ML100-103 (bu dosya, tamamen yeni, farklı bir önek
-- (MLK yerine ML) — Postgres SQLSTATE'lerin TAM 5 karakter olması gerekir;
-- "MLK100" 6 karakterdir ve PL/pgSQL bunu geçersiz/tanınmayan bir "exception
-- condition" (42704) olarak reddeder — bu migration'ın kendi yerel dry-run'ı
-- bunu GERÇEK bir çalışma-zamanı hatası olarak buldu (aşağıya bkz.). "ML" +
-- 3 basamak tam 5 karakterdir ve 0001-0021'in birlikte kullandığı MLK10-99
-- aralığıyla (farklı önek olduğu için) çakışmaz; bkz. rpc-reference.md'nin
-- birlikte kullandığı MLK10-99 aralığıyla çakışmaz; bkz. rpc-reference.md'nin
-- kod tablosu).
-- =============================================================================


-- =============================================================================
-- BÖLÜM 1 — Teklif yaşam döngüsü runtime hatası (22P02) düzeltmesi
-- =============================================================================
-- KÖK NEDEN (gerçek hosted Postgres'e karşı doğrudan, uygulamadan bağımsız
-- SQL ile izole edilip doğrulandı — `CONTEXT` çıktısı tam satırı gösterdi):
--
--   select o into v_offer from public.offers o where o.id = p_offer_id;
--
-- Burada "o" TABLO TAKMA ADININ ÇIPLAK haliyle (o.* DEĞİL) bir INTO hedefine
-- verilmesi, hedef `v_offer` `public.offers` ile AYNI satır tipinde olsa bile,
-- hosted Postgres'te v_offer'ın alanlarının (ör. v_offer.job_id) sonraki
-- kullanımında "invalid input syntax for type uuid" hatasına yol açıyor —
-- hata mesajının kendisi, tüm satırın string'e çevrilmiş composite değerinin
-- bir uuid sütununa atanmaya çalışıldığını gösteriyor. 0015'in kendi başlığı
-- bu deseni önceki bir CREATE-zamanı hatasının (SQLSTATE 42601, "record
-- variable cannot be part of multiple-item INTO list") DÜZELTMESİ olarak
-- belgeliyor ve yerel dry-run'da "doğrulandı" diyor — ama o doğrulama yalnızca
-- fonksiyonların HATASIZ OLUŞTUĞUNU (CREATE başarılı) gösterdi, ÇAĞRILDIĞINDA
-- doğru çalıştığını değil; gerçek bir accept_offer/reject_offer/... çağrısı o
-- dry-run'da hiç yapılmamış.
--
-- DÜZELTME: aynı iki-adımlı yapı (v_offer'ı TEK BAŞINA dolduran bir SELECT,
-- ardından v_offer.job_id'yi kullanan AYRI bir SELECT — bu yapının kendisi
-- doğru, 42601 hatasını önlemek için hâlâ gerekli) korunuyor; yalnızca birinci
-- adımın kendisi, bu dosyanın ve dosyadaki DİĞER (bug'dan etkilenmeyen)
-- fonksiyonların (create_offer, withdraw_offer, request_completion) zaten
-- kanıtlanmış şekilde kullandığı desene çevriliyor:
--
--   select * into v_offer from public.offers where id = p_offer_id;
--
-- Yani tablo takma adı tamamen kaldırılıyor, `select o` yerine `select *`
-- kullanılıyor. Bu tam olarak withdraw_offer/request_completion'ın (0015,
-- DEĞİŞTİRİLMEDİ) zaten hatasız çalıştığı satırla birebir aynı kalıptır — bu
-- yüzden en düşük riskli, en tutarlı düzeltmedir (yeni bir desen icat
-- edilmedi, kod tabanının kendi kanıtlanmış deseni tekrar kullanıldı).
--
-- Bu düzeltme, aşağıdaki HİÇBİR ŞEYİ DEĞİŞTİRMEZ (satır satır karşılaştırıldı):
--   - hata kodları (MLK56/65/67/68/69/70/72/73/74/78 vb.) AYNI
--   - iş kuralları (sahiplik kontrolü, durum geçişleri, tamamlanma penceresi) AYNI
--   - concurrency/compare-and-set deseni AYNI: gerçek "iki farklı sağlayıcı
--     aynı ilanı eşzamanlı kabul edemez" garantisi hâlâ 0005'teki
--     offers_one_settled_per_job partial unique index'i + accept_offer'ın
--     kendi unique_violation yakalama bloğudur (BURADA DOKUNULMADI) — ilk
--     SELECT yalnızca erken/dostça bir hata mesajı ve sahiplik kontrolü
--     içindir, gerçek atomiklik sonraki "UPDATE ... WHERE status = 'pending'
--     RETURNING * INTO v_offer" ifadesindedir (AYNEN KORUNDU). Bu yüzden
--     burada ek bir "FOR UPDATE" kilidi de EKLENMEDİ — mevcut CAS deseni zaten
--     doğru ve yeterli; yeni bir kilitleme davranışı eklemek görev kapsamının
--     dışında bir davranış değişikliği olurdu.
--   - append_job_activity_event/create_notification çağrıları AYNI, aynı
--     parametrelerle, aynı sırada
--
-- ETKİLENEN 8 FONKSİYON (aynı "select o into v_offer from public.offers o
-- where o.id = p_offer_id" desenini taşıyan HER fonksiyon — dosya genelinde
-- tarandı, withdraw_offer/request_completion bu deseni HİÇ kullanmıyor,
-- onlar zaten "select * into v_offer from public.offers where id = ... and
-- provider_id = auth.uid()" kalıbını kullanıyor, DOKUNULMADI):
--   accept_offer, reject_offer, start_work, record_agreement_failure,
--   confirm_completion, dispute_completion, resolve_completion_dispute,
--   submit_rating
--
-- Fonksiyon imzaları (parametre tipleri) DEĞİŞMEDİ — bu yüzden CREATE OR
-- REPLACE FUNCTION mevcut GRANT/REVOKE'ları (0015'te tanımlı) korur, bu
-- dosyada tekrar GRANT etmeye gerek yok.
-- =============================================================================

create or replace function public.accept_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
begin
  -- DÜZELTME (0022, MLK-yok — bkz. bu dosyanın Bölüm 1 başlığı): "select o
  -- into v_offer from public.offers o where o.id = ..." yerine, v_offer'ı
  -- doğru dolduran "select * into v_offer ... where id = ...".
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester_id from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
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

  select * into v_job from public.jobs where id = v_offer.job_id;
  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'accepted', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_kabul_edildi', v_offer.job_id, p_offer_id, v_job.operation_id,
    null, 'Hizmet Alan teklifinizi kabul etti.', null);
  -- NOT: job_activity_events'e YAZILMIYOR — teklif olayları yalnız
  -- offer_status_history'de (bkz. 0010'un sadeleştirme kararı).

  return v_offer;
end;
$$;

comment on function public.accept_offer(uuid) is
  'GÜVENLİK DÜZELTMESİ (önceki denetim B.1, KRİTİK): unique_violation yakalama eklendi (0015). RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): ilk SELECT artık "select o into ... o where o.id=" değil "select * into ... where id=" — bkz. bu dosyanın Bölüm 1 başlığı.';

create or replace function public.reject_offer(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end if;

  update public.offers set status = 'rejected', rejected_at = now()
    where id = p_offer_id and status = 'pending'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'rejected', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_reddedildi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Hizmet Alan teklifinizi kabul etmedi.', null);
  -- NOT: job_activity_events'e YAZILMIYOR — teklif olayları yalnız
  -- offer_status_history'de (bkz. 0010'un sadeleştirme kararı).

  return v_offer;
end;
$$;

comment on function public.reject_offer(uuid) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';

create or replace function public.start_work(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job public.jobs;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  update public.offers set status = 'in_progress', started_at = now()
    where id = p_offer_id and status = 'accepted'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in an acceptable state to start work' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'accepted', 'in_progress', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'is_basladi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Hizmet Alan, işin başladığını onayladı.', null);

  return v_offer;
end;
$$;

comment on function public.start_work(uuid) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';

create or replace function public.record_agreement_failure(p_offer_id uuid, p_reason text, p_note text default null)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester_id uuid;
  v_job_operation_id uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id, j.operation_id into v_job_requester_id, v_job_operation_id
    from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job_requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  update public.offers set
    status = 'agreement_failed', agreement_failed_at = now(),
    disagreement_reason = p_reason,
    disagreement_note = case when p_reason = 'diger' then p_note else null end
  where id = p_offer_id and status = 'accepted'
  returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in an acceptable state' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
    values (p_offer_id, 'accepted', 'agreement_failed', auth.uid(), p_reason);
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'anlasma_saglanamadi', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Teklifinizin kabul edildiği ilan için anlaşma sağlanamadı. İletişim bilgileri artık görüntülenemez.', null);
  perform public.create_notification(v_job_requester_id, auth.uid(), 'ilan_yeniden_yayinda', v_offer.job_id, p_offer_id, v_job_operation_id,
    null, 'Anlaşma sağlanamadığı için ilanınız yeniden yayına alındı ve yeni teklifler almaya hazır.', null);

  return v_offer;
end;
$$;

comment on function public.record_agreement_failure(uuid, text, text) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';

create or replace function public.confirm_completion(p_offer_id uuid)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.completion_requested_by = auth.uid() then
    raise exception 'MLK69: cannot confirm your own completion request' using errcode = 'MLK69';
  end if;

  update public.offers set status = 'completed', completed_at = now()
    where id = p_offer_id and status = 'completion_requested'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not awaiting completion confirmation' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'completion_requested', 'completed', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'tamamlanma_onaylandi', v_offer.job_id, p_offer_id, null,
    null, 'Hizmet Alan işin tamamlandığını onayladı.', null);

  return v_offer;
end;
$$;

comment on function public.confirm_completion(uuid) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bu fonksiyon, aynı "select o into v_offer ... o where o.id=" deseninin CREATE-zamanında (42601) durduğu ASIL fonksiyondu (bkz. 0015 başlığı) — o düzeltme fonksiyonu OLUŞTURULABİLİR yaptı ama ÇAĞRILDIĞINDA hâlâ 22P02 veriyordu; bkz. accept_offer(uuid) yorumu.';

create or replace function public.dispute_completion(p_offer_id uuid, p_note text)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  if char_length(trim(p_note)) < 10 or char_length(trim(p_note)) > 1000 then
    raise exception 'MLK70: dispute note must be between 10 and 1000 characters' using errcode = 'MLK70';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.completion_requested_by = auth.uid() then
    raise exception 'MLK69: cannot dispute your own completion request' using errcode = 'MLK69';
  end if;

  update public.offers set status = 'completion_disputed', completion_dispute_note = trim(p_note)
    where id = p_offer_id and status = 'completion_requested'
    returning * into v_offer;
  if v_offer is null then
    raise exception 'MLK68: this offer is not awaiting completion confirmation' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by, reason)
    values (p_offer_id, 'completion_requested', 'completion_disputed', auth.uid(), trim(p_note));
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'tamamlanma_itiraz_edildi', v_offer.job_id, p_offer_id, null,
    null, 'Hizmet Alan, işin tamamlanma talebine itiraz etti. İtiraz açıklamasını kontrol edin.', null);

  return v_offer;
end;
$$;

comment on function public.dispute_completion(uuid, text) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';

create or replace function public.resolve_completion_dispute(p_offer_id uuid, p_resolution text)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
begin
  if p_resolution not in ('completed', 'cancelled') then
    -- DÜZELTME (önceki denetim C.9): önceki tasarımda bu MLK71'di ve
    -- 0016'daki review_provider_document()'ın "invalid review status"
    -- hatasıyla ÇAKIŞIYORDU. Şimdi MLK78 (bu dosyanın kendi aralığında,
    -- benzersiz) — 0022 bu davranışı DEĞİŞTİRMEDİ.
    raise exception 'MLK78: resolution must be completed or cancelled' using errcode = 'MLK78';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;

  if p_resolution = 'completed' then
    update public.offers set status = 'completed', completed_at = now() where id = p_offer_id and status = 'completion_disputed' returning * into v_offer;
  else
    update public.offers set status = 'cancelled', cancelled_at = now() where id = p_offer_id and status = 'completion_disputed' returning * into v_offer;
  end if;
  if v_offer is null then
    raise exception 'MLK68: this offer is not in a disputed state' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'completion_disputed', p_resolution, auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(),
    case when p_resolution = 'completed' then 'tamamlanma_onaylandi' else 'is_iptal_edildi' end,
    v_offer.job_id, p_offer_id, null, null,
    case when p_resolution = 'completed' then 'Hizmet Alan işin tamamlandığını onayladı.' else 'Hizmet Alan, itiraz edilen işi iptal olarak sonuçlandırdı.' end,
    null);

  return v_offer;
end;
$$;

comment on function public.resolve_completion_dispute(uuid, text) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';

create or replace function public.submit_rating(p_offer_id uuid, p_stars integer, p_comment text default null)
returns public.ratings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.offers;
  v_job_requester uuid;
  v_rating public.ratings;
begin
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may submit a rating' using errcode = 'MLK50';
  end if;
  select * into v_offer from public.offers where id = p_offer_id;
  select j.requester_id into v_job_requester from public.jobs j where j.id = v_offer.job_id;
  if v_job_requester is null or v_job_requester <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'completed' then
    raise exception 'MLK73: only a completed offer can be rated' using errcode = 'MLK73';
  end if;
  if exists (select 1 from public.ratings where offer_id = p_offer_id) then
    raise exception 'MLK74: this offer has already been rated' using errcode = 'MLK74';
  end if;
  if v_offer.auto_completed and v_offer.updated_at + interval '30 days' < now() then
    raise exception 'MLK72: the rating window for this auto-completed offer has expired' using errcode = 'MLK72';
  end if;

  insert into public.ratings (offer_id, job_id, provider_id, rater_id, stars, comment)
  values (p_offer_id, v_offer.job_id, v_offer.provider_id, auth.uid(), p_stars, p_comment)
  returning * into v_rating;

  return v_rating;
end;
$$;

comment on function public.submit_rating(uuid, integer, text) is
  'RUNTIME DÜZELTMESİ (0022, canlı test bulgusu): bkz. accept_offer(uuid) yorumu — aynı düzeltme.';


-- =============================================================================
-- BÖLÜM 2 — profiles bootstrap eksikliği düzeltmesi
-- =============================================================================
-- KÖK NEDEN: 0001-0021'in hiçbirinde auth.users üzerinde bir trigger, ne de
-- bir "kayıt tamamlama" RPC'si vardı (canlı test: gerçek, onaylanmış bir
-- auth.users satırı oluşturulduktan hemen sonra public.profiles'ta o kullanıcı
-- için 0 satır bulundu) — 0003'ün kendi yorumu ("a profiles row is created
-- automatically the instant a Supabase Auth user is created") YANLIŞ
-- ÇIKTI/hiç uygulanmamıştı. `authenticated` rolünün de profiles üzerinde
-- INSERT yetkisi yok (0003, kasıtlı — yalnız SECURITY DEFINER bir yol
-- yazabilmeli). Sonuç: gerçek bir kullanıcı GoTrue'da hesap açabiliyor ama
-- hiçbir API yoluyla kendi profiles satırını hiç oluşturamıyordu —
-- current_user_role() hep NULL kalıyor, bu da create_job/create_offer dahil
-- hemen hemen her RPC'yi bloke ediyordu.
--
-- TASARIM KARARI — neden tek adımlı bir trigger DEĞİL, hibrit (trigger +
-- ayrı RPC): app/_lib/register-form-validation.ts + users.ts#RegisterInput
-- doğrudan kod okunarak doğrulandı — gerçek kayıt formu role'ü (hizmet-alan/
-- hizmet-veren, KULLANICI SEÇER) VE companyName/companyType/province/
-- district'i (hepsi form-seviyesinde ZORUNLU) TEK bir gönderimde toplar; bu
-- alanlar auth.users INSERT anında (GoTrue'nun kendi signup çağrısında) HİÇ
-- mevcut değildir — yalnızca email/password vardır. Bu yüzden auth.users
-- trigger'ının KENDİSİ role'ü asla varsayamaz/tahmin edemez (0003'ün zaten
-- `role` sütununu NULLABLE bırakmasının VE "role/phone being NULL is the
-- expected, valid state in between auth signup and registration completion"
-- diye belgelemesinin sebebi tam olarak budur — şema bu hibrit tasarımı
-- zaten öngörmüştü, yalnızca iki parçası da hiç yazılmamıştı):
--
--   1. `handle_new_auth_user()` — auth.users AFTER INSERT trigger'ı, SADECE
--      minimal bir profiles satırı açar: id = NEW.id, role = NULL (zaten
--      sütunun varsayılan/nötr durumu), diğer her şey tablo varsayılanında
--      (account_status='active', onboarding_completed=false). E-posta HİÇ
--      kopyalanmaz — profiles'ın hiç email sütunu yok (0003'ün kendi yorumu:
--      "Maps StoredUser minus passwordHash/email, both owned by Supabase
--      Auth") — bu satır bunu DEĞİŞTİRMEZ, yalnızca doğrular.
--   2. `complete_registration(...)` — YENİ, kontrollü bir RPC; register
--      formunun gerçek gönderdiği 7 alanı (role, full_name, phone,
--      company_name, company_type, province, district — RegisterInput ile
--      birebir) auth.uid() ile kilitli kendi satırına yazar, onboarding_
--      completed=true yapar. p_role yalnızca 'hizmet-alan'/'hizmet-veren'
--      kabul eder — 'admin' (veya başka bir değer) İSTİSNA ile reddedilir;
--      admin rolü hiçbir zaman bu RPC'den veya herhangi bir client girdisinden
--      GELEMEZ (kaynak uygulamada da admin yalnızca dev-seed ile
--      oluşturuluyor, hiçbir kayıt formunda seçilebilir bir "Hesap Türü"
--      değil — bkz. CLAUDE.md "Provider document verification" bölümü).
--
-- GÜVENLİK MODELİ (görev gereksinimleriyle birebir):
--   - handle_new_auth_user(): SECURITY DEFINER + search_path=public,
--     ON CONFLICT (id) DO NOTHING (idempotent — aynı id için ikinci bir
--     INSERT denemesi sessizce no-op), PUBLIC/anon/authenticated'den TÜM
--     EXECUTE yetkisi geri alınmış (zaten `returns trigger` olduğu için
--     PostgREST bunu bir RPC ucu olarak HİÇ göstermez — ama görev açıkça
--     istediği için REVOKE yine de açıkça yazıldı, savunma-derinliği).
--   - complete_registration(): SECURITY DEFINER + search_path=public,
--     yalnızca `authenticated`e (anon'a DEĞİL — kayıt tamamlamak için önce
--     gerçek bir GoTrue oturumu/JWT'si gerekir) EXECUTE. user_id PARAMETRE
--     OLARAK ALINMAZ — satır her zaman `where id = auth.uid()` ile
--     kilitlenir, başka bir kullanıcı adına asla tamamlanamaz. role zaten
--     NULL değilse (yani kayıt zaten bir kere tamamlanmışsa) ikinci bir
--     tamamlama denemesi ML101 ile reddedilir — kaynak uygulamada da bir
--     kullanıcının kendi rolünü kayıttan SONRA self-servis değiştirebileceği
--     hiçbir özellik yok, bu RPC yeni bir "rol değiştir" yeteneği İCAT ETMEZ.
--
-- KAPSAM DIŞI (bilinçli): provider_services/provider_documents/consent
-- tabloları için zaten AYRI, ÇALIŞAN RPC'ler var (set_provider_service_
-- categories — 0014, record_provider_document_consent — 0007,
-- record_legal_consent — 0008) — complete_registration bunları TEKRARLAMAZ,
-- yalnızca kaynağın registerUser()/users.ts'sinin karşılığı olan `profiles`
-- alanlarını üstlenir (kaynağın registerProviderAccount() orkestrasyonunun
-- geri kalanı zaten ayrı RPC'lerle kapsanıyor).
-- =============================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  '0022: auth.users AFTER INSERT trigger fonksiyonu. Yalnızca minimal (id-only) bir profiles satırı açar — role NULL kalır ("registration henüz tamamlanmadı" durumu, 0003''ün kendi belgelediği ama hiç uygulanmayan tasarım). Rol/firma alanları complete_registration() ile ayrıca tamamlanır (bkz. bu dosyanın Bölüm 2 başlığı). E-posta buraya KOPYALANMAZ — profiles''ın email sütunu yok.';

-- returns trigger olduğu için PostgREST bunu zaten hiçbir zaman bir RPC ucu
-- olarak GÖSTEREMEZ (schema introspection'ı bu tipi hariç tutar) — aşağıdaki
-- REVOKE, kod tabanının zaten trg_jobs_recompute_operation_terminal_state
-- (0004) için kullandığı aynı savunma-derinliği deseni içindir, işlevsel bir
-- boşluğu kapatmaz.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;

-- DÜZELTME (yerel dry-run, gerçek "must be owner of relation users" hatası,
-- SQLSTATE 42501): "comment on trigger ... on auth.users is ..." kaldırıldı.
-- auth.users, migration'ı uygulayan role (postgres) tarafından değil,
-- Supabase'in kendi auth servisi/rolü (supabase_auth_admin) tarafından
-- sahiplenilen bir tablodur — COMMENT ON TRIGGER (tıpkı COMMENT ON TABLE
-- gibi) tablo SAHİBİ olmayı gerektirir (0019_storage_policies.sql'in
-- storage.buckets için zaten belgelediği AYNI sınıf hata). CREATE TRIGGER'ın
-- kendisi soruna yol açmıyor — yalnızca sonradan yorum eklemek gerektiriyor.
-- Açıklama, işlevsel bir kayıp olmadan yukarıdaki düz SQL yorumunda korunuyor.
drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- -----------------------------------------------------------------------------
-- complete_registration — kayıt formunun gerçek alanlarıyla profili tamamlar
-- -----------------------------------------------------------------------------
create or replace function public.complete_registration(
  p_role text,
  p_full_name text,
  p_phone text,
  p_company_name text,
  p_company_type text,
  p_province text,
  p_district text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
  v_company_name text := trim(coalesce(p_company_name, ''));
  v_province text := trim(coalesce(p_province, ''));
  v_district text := trim(coalesce(p_district, ''));
begin
  -- Admin rolü asla client girdisinden gelemez — kaynak uygulamada da admin
  -- yalnızca dev-seed ile oluşuyor, hiçbir kayıt formunda seçilebilir değil.
  if p_role not in ('hizmet-alan', 'hizmet-veren') then
    raise exception 'ML100: role must be hizmet-alan or hizmet-veren' using errcode = 'ML100';
  end if;

  -- register-form-validation.ts'te bu 5 alanın hepsi form-seviyesinde
  -- zorunlu (companyName/companyType/province/district: "... zorunludur.").
  -- company_type'ın kendi geçerli değer kümesi (0003'ün CHECK kısıtı) ve
  -- phone'un format kontrolü (0003'ün CHECK kısıtı) burada TEKRAR
  -- yazılmıyor — UPDATE ifadesi sırasında Postgres'in kendi kısıtı bunları
  -- zaten doğrular (create_offer'ın currency'i CHECK kısıtına bırakmasıyla
  -- aynı desen).
  if char_length(v_full_name) = 0 or char_length(v_phone) = 0 or char_length(v_company_name) = 0
     or char_length(v_province) = 0 or char_length(v_district) = 0 then
    raise exception 'ML102: full_name, phone, company_name, province and district are required' using errcode = 'ML102';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile is null then
    -- Normalde hiç oluşmamalı (trigger her auth.users satırı için bir
    -- profiles satırı açar) — yalnızca savunma amaçlı.
    raise exception 'ML103: no profile row found for the current user' using errcode = 'ML103';
  end if;
  if v_profile.role is not null then
    -- Kaynak uygulamada bir kullanıcının kendi rolünü kayıttan SONRA
    -- self-servis değiştirebileceği hiçbir özellik yok — bu RPC yeni bir
    -- "rol değiştir" yeteneği İCAT ETMEZ, yalnızca TEK SEFERLİK tamamlamayı
    -- destekler.
    raise exception 'ML101: registration has already been completed for this account' using errcode = 'ML101';
  end if;

  update public.profiles set
    role = p_role,
    full_name = v_full_name,
    phone = v_phone,
    company_name = v_company_name,
    company_type = p_company_type,
    province = v_province,
    district = v_district,
    onboarding_completed = true
  where id = auth.uid()
  returning * into v_profile;

  return v_profile;
end;
$$;

comment on function public.complete_registration(text, text, text, text, text, text, text) is
  '0022: users.ts#registerUser''in gerçek karşılığı — role/full_name/phone/company_name/company_type/province/district''i, HER ZAMAN auth.uid() ile kilitli kendi satırına, TEK SEFERLİK (role zaten NULL değilse reddedilir) yazar. user_id parametre olarak ASLA alınmaz. provider_services/provider_documents/consent tabloları için zaten ayrı RPC''ler var (set_provider_service_categories, record_provider_document_consent, record_legal_consent) — bu fonksiyon onları tekrarlamaz.';

revoke all on function public.complete_registration(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_registration(text, text, text, text, text, text, text) to authenticated;


-- =============================================================================
-- BÖLÜM 3 — service_role bulgusu: KASITLI OLARAK BU MIGRATION'IN DIŞINDA
-- =============================================================================
-- Canlı test, hosted development projesinde `service_role`'ün (hem yeni
-- sb_secret_... anahtarı hem legacy JWT) public şemasındaki HİÇBİR tabloya/
-- fonksiyona REST erişimi olmadığını buldu (6+ farklı tabloda VE basit,
-- tablo erişimi olmayan bir SQL fonksiyonunda 403/42501 "permission denied",
-- Postgres'in kendi hint'i "service_role'e yetki verilmemiş" diyor) — proje
-- geneli bir durum, tek bir eksik GRANT değil, ve yerel Docker dry-run'da hiç
-- görülmemişti (hosted platformun güncel proje-bootstrap varsayılan
-- yetkileri, yerelde doğrulanandan farklı görünüyor).
--
-- Bu migration BİLEREK bunu düzeltmiyor: (1) görev tanımı açıkça yasaklıyor
-- ("service_role açığını bu migrationa gelişigüzel GRANT ALL ile yamama");
-- (2) bu iki kritik hatanın (profiles bootstrap, offer lifecycle) HİÇBİRİ
-- service_role'e bağımlı değil — ikisi de SECURITY DEFINER fonksiyon
-- sahipliğiyle (postgres/migration rolü) çalışıyor, service_role'ün REST
-- erişimini hiç gerektirmiyor; (3) service_role'ün asıl neden bu hosted
-- projede farklı davrandığı (platform bootstrap farkı mı, org/proje
-- ayarı mı) henüz doğrulanmadı — kör bir GRANT ALL, kapsamı belirsiz ve
-- potansiyel olarak aşırı geniş bir yetki değişikliği olurdu. Bu, AYRI, açık
-- bir bulgu olarak kalır — bkz. docs/database/SUPABASE-MIGRATION-VALIDATION.md.
-- =============================================================================
