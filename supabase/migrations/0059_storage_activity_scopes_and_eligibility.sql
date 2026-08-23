-- =============================================================================
-- MALSEVK — migration 0059: "Depocu Faaliyet Alanları" + çoklu IMO sınıfı
-- (belge bazlı) + ilan–depocu uygunluk eşleştirmesi (Konteyner Depolama)
-- =============================================================================
-- AMAÇ: Konteyner Depolama hizmet yetkisinin (provider_service_authorizations,
-- migration 0038) İNCE TANELİ ayrıntıları — bir depocu, hangi faaliyet
-- alanlarında (Boş/Dolu Tehlikesiz/Reefer/Dolu Tehlikeli Konteyner Depolama)
-- ve (Dolu Tehlikeli ise) hangi IMO tehlike sınıflarında yetkilendirildi.
-- YENİ VE BAĞIMSIZ BİR YETKİLENDİRME SİSTEMİ KURULMADI (görev talimatı) —
-- mevcut provider_documents/provider_service_authorizations tabloları ve
-- authorize_provider_service/review_provider_document RPC'leri İKİ YENİ
-- text[] SÜTUNUYLA genişletildi; Konteyner Depolama DIŞINDAKİ HER kategori
-- için bu sütunlar her zaman null kalır, davranış BİREBİR AYNI kalır.
--
-- GERİYE DÖNÜK UYUMLULUK KARARI (app/_lib/storage-container-catalog.ts#
-- ContainerStorageAuthorization'ın kendi dokümanıyla AYNI, orada da
-- açıklanmıştır): provider_service_authorizations.storage_activity_scopes/
-- imo_class_codes NULL ise "SINIRSIZ" (her şeyle eşleşir) anlamına gelir —
-- bu özellikten ÖNCE (ya da admin panelindeki eski, kapsam seçmeyen
-- "Yetkilendir" butonuyla) verilmiş bir Konteyner Depolama yetkisi ASLA
-- sessizce kısıtlanmaz. Yalnızca belge tabanlı bir onay AÇIKÇA dar bir dizi
-- (boş dizi `{}` dahil) kaydettiğinde gerçek bir kısıtlama başlar.
--
-- MİMARİ (mevcut desenlerin AYNEN devamı):
--  - Sabit liste + CHECK doğrulaması yerine PAYLAŞILAN plpgsql yardımcı
--    fonksiyonlar (`assert_valid_storage_activity_scopes`/`assert_valid_
--    imo_class_codes`) — assert_active_user() İLE AYNI "birçok RPC'den
--    çağrılan tek doğrulama noktası" ilkesi (0042/0058). Migration 0058'in
--    `validate_storage_container_groups`ı da BU YENİ paylaşılan IMO
--    doğrulayıcısını çağıracak şekilde yeniden düzenlendi (kod tekrarı
--    ortadan kalktı) — davranış DEĞİŞMEDİ.
--  - Tablo sütunlarında TAM CHECK kısıtı İCAT EDİLMEDİ (0057'nin
--    `storage_container_groups` için kurduğu "yalnızca minimal dizi-şekli
--    kontrolü, derin doğrulama RPC'nin kendisinde" ilkesiyle AYNI) — her
--    yazma yolu (create_provider_document/authorize_provider_service/
--    review_provider_document) zaten paylaşılan doğrulayıcıları çağırır.
--  - Belge onayı → yetki bağlantısı: review_provider_document'in MEVCUT
--    (0041/0044) otomatik-yetkilendirme zincirine YENİ bir dal EKLENMEDİ —
--    aynı `authorize_provider_service` çağrılarına, YALNIZCA hedef kategori
--    'konteyner-depolama' İSE (tekil seçim VEYA "depo-hizmetleri-belgesi"
--    grup belgesi içindeki 12 kategoriden biri olarak), admin'in ONAYLADIĞI
--    (talep edilenden DAR olabilir — kısmi onay) kapsam/IMO dizileri
--    iletilir; diğer 19 kategori için bu iki parametre her zaman null
--    kalır (davranışları BİREBİR AYNI).
--  - İlan–depocu eşleştirmesi: `provider_can_view_job(provider_id,
--    category_id, storage_container_groups)` YENİ fonksiyonu, MEVCUT
--    `provider_can_view_category`yi SARAR (o fonksiyon DEĞİŞMEDİ, diğer 19
--    kategori için TEK doğruluk kaynağı olmaya devam eder) — yalnızca
--    kategori 'konteyner-depolama' İSE, İLANIN HER GRUBUNUN gereksinimini
--    (bkz. app/_lib/storage-container-catalog.ts#getRequiredStorageActivity
--    ForGroup İLE ELLE SENKRON tutulan aşağıdaki plpgsql mantığı) provider'ın
--    onaylı kapsam/IMO kümesiyle karşılaştırır. Bu yeni fonksiyon ÜÇ mevcut
--    yerde `provider_can_view_category`nin YERİNE geçirildi — jobs_select_
--    visible RLS politikası, get_visible_job/get_visible_jobs RPC'leri
--    (SECURITY DEFINER oldukları için RLS'i atlarlar, AYNI mantığı KENDİ
--    gövdelerinde tekrar ederler — bu ÜÇÜ zaten 0038'den beri birbirinin
--    aynı kopyasıdır) ve create_offer (MLK60 kapısı) — dördü de AYNI, TEK
--    doğruluk kaynağını kullanır.
--
-- REEFER EŞLEŞTİRME KURALI (kullanıcı onayıyla BİLEREK, birden fazla
-- okuma mümkündü): Tip="reefer" olan bir grup, Boş/Dolu-Tehlikesiz/Dolu-
-- Tehlikeli ekseninden gelen gereksinimin YANINDA `reefer-konteyner-
-- depolama`yı da gerektirir — YERİNE değil. Reefer+Dolu+Tehlikeli bir grup
-- HEM Reefer HEM Dolu Tehlikeli kapsamını + ilgili IMO sınıfını gerektirir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — yeni sütunlar (yalnızca Konteyner Depolama için anlamlı, diğer
-- her kategoride her zaman null)
-- -----------------------------------------------------------------------------
alter table public.provider_documents
  add column if not exists storage_activity_scopes text[] null,
  add column if not exists imo_class_codes text[] null;

comment on column public.provider_documents.storage_activity_scopes is
  'app/_lib/storage-container-catalog.ts#StorageActivityScopeId ile birebir — belge yüklenirken provider''ın TALEP ettiği Konteyner Depolama faaliyet alanları. Yalnızca konteyner-depolama''yı kapsayan belgeler için dolu; diğer belgelerde her zaman null.';
comment on column public.provider_documents.imo_class_codes is
  'storage-container-catalog.ts#ImoClassCode ile birebir (20 kanonik kod) — yalnızca storage_activity_scopes içinde ''dolu-tehlikeli-konteyner-depolama'' varsa anlamlı, TALEP edilen IMO sınıfları (çoklu seçim).';

alter table public.provider_service_authorizations
  add column if not exists storage_activity_scopes text[] null,
  add column if not exists imo_class_codes text[] null;

comment on column public.provider_service_authorizations.storage_activity_scopes is
  'YALNIZCA service_category_id = ''konteyner-depolama'' iken anlamlı. NULL = SINIRSIZ (bu özellikten önce/kapsam seçmeden verilen bir yetki asla sessizce kısıtlanmaz, bkz. bu migration''ın kendi başlığı). Boş dizi ({}) = "hiçbir kapsam onaylanmadı" (NULL''dan FARKLI, gerçek bir kısıtlama).';
comment on column public.provider_service_authorizations.imo_class_codes is
  'YALNIZCA service_category_id = ''konteyner-depolama'' VE storage_activity_scopes içinde dolu-tehlikeli-konteyner-depolama varken anlamlı. NULL = SINIRSIZ, aynı gerekçe.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — paylaşılan doğrulayıcılar (assert_active_user() İLE AYNI desen)
-- -----------------------------------------------------------------------------
create or replace function public.assert_valid_storage_activity_scopes(p_scopes text[])
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_scope text;
begin
  if p_scopes is null then
    return;
  end if;
  foreach v_scope in array p_scopes loop
    if not (v_scope = any(array[
      'bos-konteyner-depolama', 'dolu-tehlikesiz-konteyner-depolama',
      'reefer-konteyner-depolama', 'dolu-tehlikeli-konteyner-depolama'
    ])) then
      raise exception 'MLK97: storage_activity_scopes must only contain canonical scope ids (got %)', v_scope using errcode = 'MLK97';
    end if;
  end loop;
end;
$function$;

comment on function public.assert_valid_storage_activity_scopes(text[]) is
  'app/_lib/storage-container-catalog.ts#STORAGE_ACTIVITY_SCOPE_OPTIONS ile ELLE senkron tutulan 4 kanonik kapsam id''si. create_provider_document/authorize_provider_service/review_provider_document tarafından paylaşılan TEK doğrulama noktası.';

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
      raise exception 'MLK56: imo class codes must be one of the canonical IMO hazard class codes (got %)', v_code using errcode = 'MLK56';
    end if;
  end loop;
end;
$function$;

comment on function public.assert_valid_imo_class_codes(text[]) is
  'app/_lib/storage-container-catalog.ts#IMO_CLASS_OPTIONS ile ELLE senkron tutulan 20 kanonik kod. 0058''in validate_storage_container_groups''u ve bu migration''ın create_provider_document/authorize_provider_service/review_provider_document''u tarafından paylaşılan TEK doğrulama noktası (0058''deki inline kopya bu migrationla KALDIRILDI).';

-- validate_storage_container_groups (0058) — gövde-içi, aynı imza: inline
-- 20-kod listesi artık yukarıdaki paylaşılan fonksiyonu çağırıyor (kod
-- tekrarı ortadan kalktı, davranış DEĞİŞMEDİ).
create or replace function public.validate_storage_container_groups(p_groups jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_group jsonb;
  v_imo text;
begin
  if p_groups is null then
    return;
  end if;
  if jsonb_typeof(p_groups) <> 'array' then
    raise exception 'MLK55: storage_container_groups must be a jsonb array' using errcode = 'MLK55';
  end if;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_imo := v_group->>'imoClass';
    if v_imo is not null and v_imo <> '' then
      perform public.assert_valid_imo_class_codes(array[v_imo]);
    end if;
  end loop;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — create_provider_document: +2 opsiyonel parametre (7 -> 9)
-- -----------------------------------------------------------------------------
drop function if exists public.create_provider_document(text, text, text, text, text, bigint, text);

create or replace function public.create_provider_document(
  p_document_type text, p_storage_path text, p_original_file_name text, p_mime_type text,
  p_extension text, p_size_bytes bigint, p_service_category_id text default null::text,
  p_storage_activity_scopes text[] default null::text[], p_imo_class_codes text[] default null::text[]
)
returns provider_documents
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_documents;
begin
  perform public.assert_active_user();
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to upload a document' using errcode = 'MLK93';
  end if;
  if p_document_type not in ('genel', 'gumruk-musaviri-izin-belgesi', 'depo-hizmetleri-belgesi', 'operator-is-makinesi-belgesi') then
    raise exception 'MLK94: invalid document_type' using errcode = 'MLK94';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;
  -- Görev bölüm 6/41: bir belge yalnızca ÇAĞIRANIN KENDİ seçtiği bir
  -- hizmetle ilişkilendirilebilir — başka bir provider'ın hizmetine ya da
  -- kataloğun kendisinde olmayan bir kategoriye sahte bağlama girişimini
  -- engeller. Grup belgeleri (0044) p_service_category_id'yi hiç
  -- GÖNDERMEDİĞİ (NULL) için bu kontrol onları hiç etkilemez.
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_imo_class_codes);

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id, storage_activity_scopes, imo_class_codes)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id, p_storage_activity_scopes, p_imo_class_codes)
  returning * into v_row;

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — authorize_provider_service: +2 opsiyonel parametre (4 -> 6),
-- coalesce-koru semantiği (yalnızca AÇIKÇA null-olmayan bir değer geldiğinde
-- üzerine yazılır — ör. admin panelinin eski kapsam seçmeyen "Yetkilendir"
-- butonu her zaman null gönderir, mevcut bir dar kapsamı ASLA sessizce
-- "sınırsız"a genişletmez).
-- -----------------------------------------------------------------------------
drop function if exists public.authorize_provider_service(uuid, text, uuid, text);

create or replace function public.authorize_provider_service(
  p_provider_id uuid, p_service_category_id text, p_source_document_id uuid default null::uuid,
  p_reason text default null::text, p_storage_activity_scopes text[] default null::text[],
  p_imo_class_codes text[] default null::text[]
)
returns provider_service_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_service_authorizations;
  v_existing public.provider_service_authorizations;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if not exists (select 1 from public.service_categories where id = p_service_category_id) then
    raise exception 'MLK94: unknown service_category_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_service_authorizations.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.provider_documents where id = p_source_document_id and provider_id = p_provider_id
  ) then
    raise exception 'MLK76: source document not found for this provider' using errcode = 'MLK76';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_imo_class_codes);

  select * into v_existing from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null;

  if v_existing is not null then
    update public.provider_service_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason),
      storage_activity_scopes = coalesce(p_storage_activity_scopes, storage_activity_scopes),
      imo_class_codes = coalesce(p_imo_class_codes, imo_class_codes)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_service_authorizations
      (provider_id, service_category_id, authorized_by, source_document_id, authorize_reason, storage_activity_scopes, imo_class_codes)
    values
      (p_provider_id, p_service_category_id, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''), p_storage_activity_scopes, p_imo_class_codes)
    returning * into v_row;
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_authorized', null, null, null,
    'Hizmet Yetkiniz Onaylandı',
    (select name from public.service_categories where id = p_service_category_id) ||
      ' hizmetiniz onaylandı. Artık bu hizmete ait ilanları görüntüleyebilir ve teklif verebilirsiniz.',
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('authorize_provider_service', 'provider_service_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id));

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — review_provider_document: +2 opsiyonel parametre (3 -> 5) —
-- admin'in KISMİ onayı (talep edilenden dar olabilir). Otomatik-yetkilendirme
-- zincirinin YAPISI (0041/0044) DEĞİŞMEDİ — yalnızca 'konteyner-depolama'
-- hedeflendiğinde (tekil VEYA grup belgesi içindeki döngüden) bu iki yeni
-- parametre authorize_provider_service'e iletiliyor, diğer TÜM kategoriler
-- için null (davranışları BİREBİR AYNI).
-- -----------------------------------------------------------------------------
drop function if exists public.review_provider_document(uuid, text, text);

create or replace function public.review_provider_document(
  p_document_id uuid, p_status text, p_note text default null::text,
  p_approved_storage_activity_scopes text[] default null::text[],
  p_approved_imo_class_codes text[] default null::text[]
)
returns provider_documents
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'MLK71: invalid review status' using errcode = 'MLK71';
  end if;
  if p_status in ('rejected', 'revision_requested') and v_trimmed_note is null then
    raise exception 'MLK75: a note is required for rejection or revision requests' using errcode = 'MLK75';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_approved_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_approved_imo_class_codes);

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

  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
        );
      elsif v_document.document_type = 'gumruk-musaviri-izin-belgesi' then
        perform public.authorize_provider_service(
          v_document.provider_id, 'gumruk-musavirligi', p_document_id,
          'Gümrük Müşaviri İzin Belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      elsif v_document.document_type = 'operator-is-makinesi-belgesi' then
        foreach v_target_category_id in array array[
          'forklift', 'reach-stacker', 'vinc', 'manlift',
          'forklift-operatoru', 'reach-stacker-operatoru', 'vinc-operatoru', 'manlift-operatoru'
        ]
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Operatör veya İş Makinesi Hizmeti belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).'
          );
        end loop;
      elsif v_document.document_type = 'depo-hizmetleri-belgesi' then
        foreach v_target_category_id in array array[
          'ellecleme', 'genel-depolama', 'acik-saha-depolama', 'kapali-depolama',
          'antrepo-gumruklu', 'gecici-depolama', 'konteyner-depolama', 'dokme-yuk-depolama',
          'proje-yuku-depolama', 'soguk-hava-depolama', 'kimyasal-depolama', 'tehlikeli-madde-depolama'
        ]
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Depo Hizmetleri belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
          );
        end loop;
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
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — provider_can_view_job: YENİ, provider_can_view_category'yi
-- SARAN (o fonksiyon DEĞİŞMEDİ) ilan–depocu uygunluk eşleştirmesi. app/_lib/
-- storage-container-catalog.ts#getRequiredStorageActivityForGroup İLE ELLE
-- SENKRON tutulmalıdır.
-- -----------------------------------------------------------------------------
create or replace function public.provider_can_view_job(p_provider_id uuid, p_category_id text, p_storage_container_groups jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_group jsonb;
  v_status text;
  v_type text;
  v_hazardous boolean;
  v_imo text;
  v_scopes text[];
  v_imo_codes text[];
begin
  if not public.provider_can_view_category(p_provider_id, p_category_id) then
    return false;
  end if;

  if p_category_id <> 'konteyner-depolama' or p_storage_container_groups is null then
    return true;
  end if;

  select storage_activity_scopes, imo_class_codes into v_scopes, v_imo_codes
  from public.provider_service_authorizations
  where provider_id = p_provider_id and service_category_id = 'konteyner-depolama' and revoked_at is null
  limit 1;

  for v_group in select * from jsonb_array_elements(p_storage_container_groups) loop
    v_status := v_group->>'status';
    v_type := v_group->>'type';
    v_hazardous := nullif(v_group->>'hazardous', '')::boolean;
    v_imo := v_group->>'imoClass';

    if v_scopes is not null then
      if v_status = 'bos' and not ('bos-konteyner-depolama' = any(v_scopes)) then
        return false;
      end if;
      if v_status = 'dolu' and coalesce(v_hazardous, false) = false and not ('dolu-tehlikesiz-konteyner-depolama' = any(v_scopes)) then
        return false;
      end if;
      if v_status = 'dolu' and v_hazardous = true and not ('dolu-tehlikeli-konteyner-depolama' = any(v_scopes)) then
        return false;
      end if;
      if v_type = 'reefer' and not ('reefer-konteyner-depolama' = any(v_scopes)) then
        return false;
      end if;
    end if;

    if v_status = 'dolu' and v_hazardous = true and v_imo is not null and v_imo <> '' and v_imo_codes is not null then
      if not (v_imo = any(v_imo_codes)) then
        return false;
      end if;
    end if;
  end loop;

  return true;
end;
$function$;

comment on function public.provider_can_view_job(uuid, text, jsonb) is
  'provider_can_view_category''yi sarar (o fonksiyon TEK DEĞİŞMEDİ kalır, diğer 19 kategori için tek doğruluk kaynağıdır) — yalnızca konteyner-depolama için İLANIN HER GRUBUNUN gereksinimini provider''ın onaylı kapsam/IMO kümesiyle karşılaştırır. jobs_select_visible RLS politikası, get_visible_job/get_visible_jobs ve create_offer''in MLK60 kapısı tarafından paylaşılır — TEK doğruluk kaynağı.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 7 — jobs_select_visible RLS politikası: provider_can_view_category
-- çağrısı provider_can_view_job ile değiştirildi (diğer koşullar DEĞİŞMEDİ).
-- -----------------------------------------------------------------------------
alter policy jobs_select_visible on public.jobs
using (
  (deleted_at is null) and (
    (requester_id = auth.uid()) or is_admin() or (
      (moderation_status = 'approved'::text) and (
        (current_user_role() is distinct from 'hizmet-veren'::text)
        or provider_can_view_job(auth.uid(), category_id, storage_container_groups)
      )
    )
  )
);

-- -----------------------------------------------------------------------------
-- BÖLÜM 8 — get_visible_job/get_visible_jobs: gövde-içi (yalnızca), AYNI
-- İMZA. SECURITY DEFINER oldukları için RLS'i atlarlar ve BÖLÜM 7'deki AYNI
-- mantığı kendi gövdelerinde tekrar ederler (0038'den beri kurulu desen) —
-- provider_can_view_category çağrıları provider_can_view_job ile değiştirildi.
-- -----------------------------------------------------------------------------
create or replace function public.get_visible_job(p_job_id uuid)
 returns jobs
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.jobs;
  v_is_admin boolean := public.is_admin();
  v_role text := public.current_user_role();
begin
  select j.* into v_row from public.jobs j
  where j.id = p_job_id
    and j.deleted_at is null
    and (
      j.requester_id = auth.uid()
      or v_is_admin
      or (
        j.moderation_status = 'approved'
        and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(auth.uid(), j.category_id, j.storage_container_groups))
      )
    );

  if not found then
    return null;
  end if;

  if v_row.requester_id is distinct from auth.uid()
     and not v_is_admin
     and not exists (
       select 1 from public.offers o
       where o.job_id = v_row.id
         and o.provider_id = auth.uid()
         and o.status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed')
     )
  then
    v_row.address_text := null;
    v_row.neighborhood := null;
    v_row.location_url := null;
    v_row.directions_note := null;
    v_row.work_location_type := null;
    v_row.facility_id := null;
    v_row.delivery_facility_name := null;
    v_row.delivery_facility_id := null;
    v_row.delivery_address_text := null;
  end if;

  return v_row;
end;
$function$;

create or replace function public.get_visible_jobs()
 returns setof jobs
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row public.jobs;
  v_is_admin boolean := public.is_admin();
  v_role text := public.current_user_role();
begin
  for v_row in
    select j.* from public.jobs j
    where j.deleted_at is null
      and (
        j.requester_id = auth.uid()
        or v_is_admin
        or (
          j.moderation_status = 'approved'
          and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(auth.uid(), j.category_id, j.storage_container_groups))
        )
      )
  loop
    if v_row.requester_id is distinct from auth.uid()
       and not v_is_admin
       and not exists (
         select 1 from public.offers o
         where o.job_id = v_row.id
           and o.provider_id = auth.uid()
           and o.status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed')
       )
    then
      v_row.address_text := null;
      v_row.neighborhood := null;
      v_row.location_url := null;
      v_row.directions_note := null;
      v_row.work_location_type := null;
      v_row.facility_id := null;
      v_row.delivery_facility_name := null;
      v_row.delivery_facility_id := null;
      v_row.delivery_address_text := null;
    end if;
    return next v_row;
  end loop;
  return;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 9 — create_offer: gövde-içi (yalnızca), AYNI İMZA. MLK60 kapısındaki
-- provider_can_view_category çağrısı provider_can_view_job ile değiştirildi
-- (aynı hata kodu — "ilan yok/erişilemez" anlamı DEĞİŞMEDİ, yalnızca
-- konteyner-depolama için daha zengin bir kontrol).
-- -----------------------------------------------------------------------------
create or replace function public.create_offer(p_job_id uuid, p_amount numeric, p_currency text, p_description text, p_estimated_duration integer default null::integer)
 returns offers
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_latest_offer public.offers;
  v_offer public.offers;
  v_requires_estimated_duration boolean;
  v_estimated_duration integer;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK50: only hizmet-veren accounts may create an offer' using errcode = 'MLK50';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':create_offer'));

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null or not public.provider_can_view_job(auth.uid(), v_job.category_id, v_job.storage_container_groups) or v_job.moderation_status <> 'approved' then
    raise exception 'MLK60: job not found or not available for offers' using errcode = 'MLK60';
  end if;

  if exists (
    select 1 from public.provider_services ps
    join public.service_categories sc on sc.id = ps.service_category_id
    where ps.provider_id = auth.uid() and sc.id = 'gumruk-musavirligi'
  ) and not exists (
    select 1 from public.provider_documents
    where provider_id = auth.uid() and document_type = 'gumruk-musaviri-izin-belgesi' and current_review_status = 'approved'
  ) then
    raise exception 'MLK61: customs broker license must be approved before offering' using errcode = 'MLK61';
  end if;

  select * into v_latest_offer from public.offers
    where job_id = p_job_id and provider_id = auth.uid()
    order by created_at desc limit 1;
  if v_latest_offer is not null then
    if v_latest_offer.status in ('withdrawn', 'rejected', 'agreement_failed') then
      if v_latest_offer.updated_at + interval '3 days' > now() then
        raise exception 'MLK62: re-offer cooldown still active for this job' using errcode = 'MLK62';
      end if;
    else
      raise exception 'MLK63: an offer for this job already exists and cannot be repeated' using errcode = 'MLK63';
    end if;
  end if;

  if v_job.listing_status <> 'yayinda'
     or public.is_job_closed_to_new_offers(p_job_id)
     or v_job.closed_at is not null
     or public.is_job_listing_expired(p_job_id) then
    raise exception 'MLK64: this job is not open for new offers' using errcode = 'MLK64';
  end if;

  if public.has_reached_active_job_limit(auth.uid()) then
    raise exception 'MLK65: active job capacity reached' using errcode = 'MLK65';
  end if;

  v_requires_estimated_duration := (v_job.category_id = 'nakliye');
  if v_requires_estimated_duration and (
    p_estimated_duration is null or p_estimated_duration < 1 or p_estimated_duration > 60
  ) then
    raise exception 'MLK66: estimated_duration must be an integer between 1 and 60 for Nakliye jobs' using errcode = 'MLK66';
  end if;
  v_estimated_duration := case when v_requires_estimated_duration then p_estimated_duration else null end;

  insert into public.offers (job_id, provider_id, amount, currency, description, estimated_duration)
  values (p_job_id, auth.uid(), p_amount, p_currency, p_description, v_estimated_duration)
  returning * into v_offer;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (v_offer.id, null, 'pending', auth.uid());

  perform public.create_notification(v_job.requester_id, auth.uid(), 'yeni_teklif', p_job_id, v_offer.id, v_job.operation_id,
    null, 'İlanınıza yeni teklif geldi: ' || v_job.title, null);

  return v_offer;
end;
$function$;
