-- =============================================================================
-- MALSEVK — migration 0041: Belge Onayı → Otomatik Hizmet Yetkilendirmesi
-- =============================================================================
-- KÖK NEDEN (gerçek testte gözlemlendi, gerçek DB satırlarıyla kanıtlandı —
-- bkz. proje raporu "Belge Onayı / Hizmet Yetkilendirme Senkron Sorunu"):
-- migration 0038 iki ayrı kavram tanımladı — belge onayı (`provider_documents.
-- current_review_status`, review_provider_document/0016 tarafından yazılır)
-- ve hizmet yetkisi (`provider_service_authorizations`, YALNIZCA
-- authorize_provider_service/0038 tarafından yazılır) — ve BUNLARI KASITLI
-- OLARAK birbirine bağlamadı (0038'in kendi yorumu: "ayrı bir onay akışı
-- İCAT EDİLMEDİ"). Sonuç: bir admin `/admin/firma-belgeleri`'nden bir belgeyi
-- "Onayla" dediğinde, provider'ın GERÇEK erişimi (provider_can_view_category,
-- /ilanlar, create_offer) HİÇBİR ŞEKİLDE değişmiyordu — admin ayrıca
-- `/admin/firmalar/[id]`'ye gidip "Hizmet Yetkileri" kartından AYRI bir
-- "Yetkilendir" tıklaması yapmadıkça provider kalıcı olarak "Belge onaylı,
-- hizmet yetkisiz" durumunda sıkışıp kalıyordu — bu da /ilanlar'da "Henüz
-- hiçbir hizmet için yetkilendirilmediniz" mesajını GERÇEKTEN doğru (yetki
-- satırı gerçekten yok) ama KULLANICI AÇISINDAN yanıltıcı gösteriyordu
-- (belgesi onaylı olduğu için "az önce yetkilendirilmem gerekmez miydi?").
--
-- İKİNCİ, BAĞIMSIZ BİR HATA (app kodunda, bu migration'ın kapsamı dışında
-- ayrıca düzeltildi — bkz. supabase-my-service-authorizations.ts diff'i):
-- `getMyServiceAuthorizations`in durum merdiveni "onaylı belge + yetkisiz"
-- durumunu HİÇ TANIMIYORDU ve sessizce `"document_required"`e (belge HİÇ
-- yüklenmemiş gibi) düşürüyordu — provider'a zaten onaylanmış belgesini
-- YENİDEN YÜKLEMESİNİ söyleyen bir CTA gösteriyordu. Bu migration'ın
-- düzelttiği veri tutarsızlığı (belge onaylı ⇒ artık yetki de var) bu ikinci
-- hatayı çoğu senaryoda pratikte görünmez kılıyor, ama iki hata birbirinden
-- BAĞIMSIZ kök nedenlerdir — biri backend/veri bağı eksikliği, diğeri
-- frontend durum sınıflandırma hatası.
--
-- ÇÖZÜM (görev bölüm 3'ün tercih ettiği yaklaşım — "admin belgeyi onayladığında
-- ilgili hizmet yetkisi otomatik aktif olsun"): review_provider_document
-- (0016), `p_status = 'approved'` durumunda, AYNI (zaten admin olduğu
-- doğrulanmış) çağıran bağlamında `authorize_provider_service`i (0038)
-- KENDİSİ çağırır — ikinci bir yetkilendirme sistemi İCAT EDİLMEDİ, mevcut
-- fonksiyon YENİDEN KULLANILDI (idempotent upsert + notification + audit log
-- dahil TÜM davranışını olduğu gibi devralır). Hedef kategori(ler) belgenin
-- KENDİ verisinden çözülür — belgenin `service_category_id`si varsa o TEK
-- kategori; yoksa ve `document_type = 'gumruk-musaviri-izin-belgesi'` ise
-- sabit `gumruk-musavirligi`; ikisi de yoksa (yalnızca ESKİ kayıt akışından
-- kalma genel belgeler — YENİ `/panel/belge-yukleme` akışı artık HER ZAMAN
-- `service_category_id` gönderir) provider'ın o an seçili olan gümrük-dışı
-- TÜM kategorileri (eski akışın "tek genel belge = tüm seçili hizmetler"
-- örtük varsayımının birebir karşılığı). Bu adım BEST-EFFORT'tur (bir
-- exception bloğuyla sarmalanır) — asıl belge onayı ASLA bu adımın
-- başarısızlığına bağlı olarak geri alınmaz (bu codebase'in yerleşik "ikincil
-- yazma en iyi çaba, birincil yazmayı asla bloklamaz" ilkesi, bkz. proje
-- raporu deleteJobWithOffers örneği).
--
-- GERİYE DÖNÜK VERİ DÜZELTMESİ: bu migration bir kerelik bir DML ile,
-- ŞU AN zaten `approved` olan ama karşılığında aktif bir yetki satırı
-- OLMAYAN her belge için (gerçek test senaryosunun BİREBİR AYNISI) doğrudan
-- `provider_service_authorizations`e satır ekler — RPC üzerinden DEĞİL
-- (migration bağlamında `auth.uid()` NULL'dır, `is_admin()` bu yüzden HER
-- ZAMAN false döner ve RPC MLK50 ile başarısız olurdu), doğrudan INSERT ile.
-- `authorized_by` belgeyi GERÇEKTEN onaylayan adminin `reviewed_by`si,
-- `authorized_at` belgenin GERÇEK `reviewed_at`i — "şimdi" değil, tarihsel
-- olarak doğru bir zaman damgası.
--
-- SAĞLIK KONTROLÜ (görev bölüm 6): `provider_document_authorization_gaps`
-- view'ı — bundan SONRA bu tutarsızlığa GERÇEKTEN düşen (ör. bu migration'ın
-- best-effort bloğu başarısız olursa) satırları canlı olarak yüzeye çıkarır,
-- admin dashboard'da bir uyarı kartı olarak okunur (bkz. app kodu diff'i).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — review_provider_document: onay anında otomatik yetkilendirme
-- -----------------------------------------------------------------------------
create or replace function public.review_provider_document(p_document_id uuid, p_status text, p_note text default null)
returns public.provider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'MLK71: invalid review status' using errcode = 'MLK71';
  end if;
  if p_status in ('rejected', 'revision_requested') and v_trimmed_note is null then
    raise exception 'MLK75: a note is required for rejection or revision requests' using errcode = 'MLK75';
  end if;

  select * into v_document from public.provider_documents where id = p_document_id;
  if v_document is null then
    raise exception 'MLK76: document not found' using errcode = 'MLK76';
  end if;

  update public.provider_documents set
    current_review_status = p_status, current_review_note = v_trimmed_note,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_document_id
  returning * into v_document;

  insert into public.provider_document_reviews (document_id, provider_id, admin_id, action, note)
    values (p_document_id, v_document.provider_id, auth.uid(), p_status, v_trimmed_note);

  perform public.create_notification(
    v_document.provider_id, auth.uid(),
    case p_status when 'approved' then 'belge_onaylandi' when 'rejected' then 'belge_reddedildi' else 'belge_revizyon_istendi' end,
    null, null, null,
    case p_status when 'approved' then 'Belgeniz Onaylandı' when 'rejected' then 'Belgeniz Reddedildi' else 'Belge Güncellemesi Gerekiyor' end,
    coalesce('"' || v_document.original_file_name || '" belgeniz ' ||
      case p_status when 'approved' then 'onaylandı.' when 'rejected' then 'reddedildi: ' || v_trimmed_note else 'için yeniden yükleme isteniyor: ' || v_trimmed_note end,
      ''),
    null
  );

  perform public.log_audit_event('review_provider_document', 'provider_documents', p_document_id,
    jsonb_build_object('current_review_status', 'pending'),
    jsonb_build_object('current_review_status', p_status));

  -- 0041: belge onaylandığında, desteklediği hizmet(ler) için OTOMATİK
  -- olarak authorize_provider_service (0038) çağrılır — bu çağrı AYNI
  -- (zaten is_admin() doğrulanmış) admin oturumu bağlamında çalıştığı için
  -- authorize_provider_service'in kendi is_admin() kontrolü de doğal olarak
  -- geçer, ikinci bir yetki kontrolü İCAT EDİLMEDİ. BEST-EFFORT: bu blok
  -- başarısız olursa (ör. beklenmeyen veri durumu) yalnızca bir WARNING
  -- loglanır, asıl belge onayı (yukarıdaki tüm yazmalar) ASLA geri alınmaz.
  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      elsif v_document.document_type = 'gumruk-musaviri-izin-belgesi' then
        perform public.authorize_provider_service(
          v_document.provider_id, 'gumruk-musavirligi', p_document_id,
          'Gümrük Müşaviri İzin Belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      else
        -- Yalnızca service_category_id'siz ESKİ genel belgeler (yeni
        -- /panel/belge-yukleme akışı artık her zaman gönderir) — provider'ın
        -- o anda seçili gümrük-dışı TÜM kategorilerini yetkilendir (eski
        -- "tek genel belge = tüm seçili hizmetler" örtük varsayımı).
        for v_target_category_id in
          select service_category_id from public.provider_services
          where provider_id = v_document.provider_id and service_category_id <> 'gumruk-musavirligi'
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$$;

comment on function public.review_provider_document(uuid, text, text) is
  '0041: p_status=''approved'' artık AYRICA authorize_provider_service''i (0038) otomatik çağırır — belge onayı ile hizmet yetkisi artık senkron. İkinci bir sistem İCAT EDİLMEDİ, mevcut RPC yeniden kullanıldı (idempotent, kendi audit/notification''ını üretir). Best-effort: bu adımın başarısızlığı belge onayını asla geri almaz.';

revoke all on function public.review_provider_document(uuid, text, text) from public, anon;
grant execute on function public.review_provider_document(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — geriye dönük veri düzeltmesi (bir kerelik DML, RPC ÜZERİNDEN
-- DEĞİL — migration bağlamında auth.uid() NULL, is_admin() bu yüzden her
-- zaman false döner ve RPC MLK50 ile başarısız olurdu).
-- -----------------------------------------------------------------------------

-- 2a. service_category_id doğrudan dolu olan onaylı belgeler.
insert into public.provider_service_authorizations
  (provider_id, service_category_id, authorized_at, authorized_by, source_document_id, authorize_reason)
select pd.provider_id, pd.service_category_id, coalesce(pd.reviewed_at, now()), pd.reviewed_by, pd.id,
  'Backfill (migration 0041): onaylı belge, otomatik yetkilendirme kuralı geçmişe uygulandı.'
from public.provider_documents pd
where pd.current_review_status = 'approved'
  and pd.deleted_at is null
  and pd.service_category_id is not null
  and pd.reviewed_by is not null
  and not exists (
    select 1 from public.provider_service_authorizations psa
    where psa.provider_id = pd.provider_id and psa.service_category_id = pd.service_category_id and psa.revoked_at is null
  )
on conflict (provider_id, service_category_id) where revoked_at is null do nothing;

-- 2b. Gümrük Müşaviri İzin Belgesi (service_category_id boş, document_type sabit).
insert into public.provider_service_authorizations
  (provider_id, service_category_id, authorized_at, authorized_by, source_document_id, authorize_reason)
select pd.provider_id, 'gumruk-musavirligi', coalesce(pd.reviewed_at, now()), pd.reviewed_by, pd.id,
  'Backfill (migration 0041): onaylı Gümrük Müşaviri İzin Belgesi, otomatik yetkilendirme kuralı geçmişe uygulandı.'
from public.provider_documents pd
where pd.current_review_status = 'approved'
  and pd.deleted_at is null
  and pd.service_category_id is null
  and pd.document_type = 'gumruk-musaviri-izin-belgesi'
  and pd.reviewed_by is not null
  and not exists (
    select 1 from public.provider_service_authorizations psa
    where psa.provider_id = pd.provider_id and psa.service_category_id = 'gumruk-musavirligi' and psa.revoked_at is null
  )
on conflict (provider_id, service_category_id) where revoked_at is null do nothing;

-- 2c. service_category_id'siz ESKİ genel belgeler — provider'ın o anki
-- gümrük-dışı seçili tüm kategorilerini yetkilendir (2a/2b zaten kapsadığı
-- provider+kategori çiftlerini `on conflict ... do nothing` ile atlar).
insert into public.provider_service_authorizations
  (provider_id, service_category_id, authorized_at, authorized_by, source_document_id, authorize_reason)
select distinct on (pd.provider_id, ps.service_category_id)
  pd.provider_id, ps.service_category_id, coalesce(pd.reviewed_at, now()), pd.reviewed_by, pd.id,
  'Backfill (migration 0041): onaylı genel belge, otomatik yetkilendirme kuralı geçmişe uygulandı.'
from public.provider_documents pd
join public.provider_services ps on ps.provider_id = pd.provider_id and ps.service_category_id <> 'gumruk-musavirligi'
where pd.current_review_status = 'approved'
  and pd.deleted_at is null
  and pd.service_category_id is null
  and pd.document_type = 'genel'
  and pd.reviewed_by is not null
  and not exists (
    select 1 from public.provider_service_authorizations psa
    where psa.provider_id = pd.provider_id and psa.service_category_id = ps.service_category_id and psa.revoked_at is null
  )
order by pd.provider_id, ps.service_category_id, pd.reviewed_at desc
on conflict (provider_id, service_category_id) where revoked_at is null do nothing;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — provider_document_authorization_gaps: sağlık kontrolü view'ı
-- -----------------------------------------------------------------------------
-- Yalnızca DOĞRUDAN çözülebilen iki durumu (service_category_id dolu, veya
-- Gümrük Müşaviri İzin Belgesi) kapsar — service_category_id'siz ESKİ genel
-- belgelerin "birden çok kategoriye" genişlemesi burada TEKRARLANMADI
-- (2c'nin kendine özgü mantığı bir view'da gereksiz karmaşıklık olurdu);
-- BÖLÜM 1'in düzeltmesinden SONRA yeni belgeler zaten her zaman
-- service_category_id taşıdığı için bu, pratikte tam kapsamlıdır — bilinen,
-- kabul edilmiş bir sınır, bkz. proje raporu.
create or replace view public.provider_document_authorization_gaps as
select
  pd.id as document_id,
  pd.provider_id,
  coalesce(pd.service_category_id, case when pd.document_type = 'gumruk-musaviri-izin-belgesi' then 'gumruk-musavirligi' end) as service_category_id,
  pd.reviewed_at,
  pd.reviewed_by
from public.provider_documents pd
where pd.current_review_status = 'approved'
  and pd.deleted_at is null
  and coalesce(pd.service_category_id, case when pd.document_type = 'gumruk-musaviri-izin-belgesi' then 'gumruk-musavirligi' end) is not null
  and not exists (
    select 1 from public.provider_service_authorizations psa
    where psa.provider_id = pd.provider_id
      and psa.service_category_id = coalesce(pd.service_category_id, case when pd.document_type = 'gumruk-musaviri-izin-belgesi' then 'gumruk-musavirligi' end)
      and psa.revoked_at is null
  );

comment on view public.provider_document_authorization_gaps is
  '0041 sağlık kontrolü: "belge approved ama service authorization yok" tutarsızlığına düşen satırlar (BÖLÜM 1''in düzeltmesinden SONRA, teorik olarak boş kalması beklenir — bkz. proje raporu). admin-dashboard-data.ts bu view''ı sayar, UI''da bir uyarı kartı olarak gösterir.';

-- RLS: alttaki tablolar (provider_documents/provider_service_authorizations)
-- zaten "provider_id = auth.uid() or is_admin()" politikalarını taşıyor —
-- admin_job_list/active_job_listings (0017) ile AYNI desen, view kendi
-- RLS'ini İCAT ETMEZ, alttaki tablolardan devralır.
grant select on public.provider_document_authorization_gaps to authenticated;
