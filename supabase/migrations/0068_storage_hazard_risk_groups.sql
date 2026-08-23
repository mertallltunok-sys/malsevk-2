-- =============================================================================
-- MALSEVK — migration 0068: "Kimyasal Depolama / Tehlikeli Madde Depolama"
-- risk-grubu görevi — Nakliye ADR sıralama düzeltmesi (uygulama katmanında,
-- bkz. storage-container-catalog.ts#IMO_CLASS_SELECT_ITEMS) TAMAMLANDIKTAN
-- SONRAKİ ikinci, bağımsız görev: bu iki hazmat'a-özel Depo Hizmetleri alt
-- kategorisi için (1) ilan tarafında Hayır/Evet + çoklu risk-grubu alanları,
-- (2) BU İKİ KATEGORİYE ÖZEL, provider_service_authorizations'tan TAMAMEN
-- AYRI/İLAVE bir depocu risk-grubu yetkilendirme katmanı.
--
-- MİMARİ KARAR (görev talimatının kendi açık cevabı): "Grup belgesi aynı
-- kalsın, sadece risk-grubu katmanı ekle" — depo-hizmetleri-belgesi'nin
-- MEVCUT 12-kategori otomatik yetkilendirme zinciri (0041/0044) HİÇ
-- DEĞİŞMEDİ. Risk-grubu yetkisi YENİ, BAĞIMSIZ bir tabloda
-- (provider_storage_risk_authorizations) tutulur — provider_service_
-- authorizations'a sütun EKLENMEDİ, çünkü risk-grubu yetkinliği KATEGORİDEN
-- BAĞIMSIZDIR (aynı fiziksel tehlike-yönetim becerisi, ilan Kimyasal
-- Depolama'ya mı Tehlikeli Madde Depolama'ya mı açılmış farketmez) — bu
-- ikisi arasında AYRI/senkronizasyonu bozulabilecek iki satır İCAT ETMEK
-- yanlış olurdu. 0059'un storage_activity_scopes/imo_class_codes'undan
-- KASITLI OLARAK FARKLI bir varsayılan: o özellikte NULL = "SINIRSIZ" (geriye
-- dönük uyumluluk gereği), BURADA İSE hiçbir aktif satır = "YETKİSİZ"
-- (fail-closed) — çünkü bu TAMAMEN YENİ bir özellik, korunması gereken bir
-- "önceden sınırsız yetkilendirilmiş" provider kümesi yok, ve görev
-- talimatı açıkça "seçimler otomatik yetki vermesin" diyor.
--
-- AKIŞ (görev talimatının kendi cevabı, birebir):
--  1. Depocu belge yüklerken hangi risk gruplarında hizmet verebileceğini
--     KENDİSİ seçer (provider_documents.requested_storage_risk_groups,
--     çoklu seçim) — bu seçim OTOMATİK YETKİ VERMEZ.
--  2. Admin belgeyi incelerken seçilen risk gruplarını görür, HER GRUBU AYRI
--     AYRI onaylar/reddeder (review_provider_document'in YENİ
--     p_approved_storage_risk_groups parametresi — admin'in kendi seçtiği
--     ALT KÜME, "onaylandı" durumundaki belgenin TAMAMI değil).
--  3. Yalnız onaylanan gruplar provider_storage_risk_authorizations'ta aktif
--     bir satır olarak belirir.
--  4. İlan oluştururken Hizmet Alan'ın seçtiği risk grubuna YALNIZ aynı
--     grup admin tarafından onaylanmış depocular teklif verebilir —
--     provider_can_view_job() (0059) BÖYLECE genişletildi (İKİNCİ bir
--     eşleştirme motoru İCAT EDİLMEDİ), create_offer VE accept_offer
--     (kabul anında YENİDEN kontrol, 0060 ile AYNI ilke) ikisi de bu TEK
--     fonksiyonu kullanır — arayüzde VE backend/RPC'de uygulanır.
--
-- ADR (Nakliye, karayolu taşımacılığı) İLE KARIŞTIRILMAZ — bu risk-grubu
-- kataloğu storage-hazard-catalog.ts'te TAMAMEN AYRI/bağımsız 18 üyeli bir
-- listedir (app tarafı zaten IMO_CLASS_OPTIONS'ı YENİDEN KULLANMADI, bkz. o
-- dosyanın kendi başlık dokümanı) — assert_valid_storage_risk_groups bu 18
-- kanonik id'yi assert_valid_imo_class_codes'tan TAMAMEN BAĞIMSIZ doğrular.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs: yeni sütunlar (yalnızca Kimyasal Depolama/Tehlikeli Madde
-- Depolama için anlamlı, diğer HER kategoride her zaman null — 0053/0057
-- İLE AYNI "kategoriye özel, diğerlerinde hep null" ilkesi).
-- -----------------------------------------------------------------------------
alter table public.jobs
  add column if not exists storage_hazardous boolean null,
  add column if not exists storage_risk_groups text[] null;

comment on column public.jobs.storage_hazardous is
  'app/_lib/storage-hazard-catalog.ts#isHazardousStorageCategory ile ilişkili — Kimyasal Depolama''da kullanıcının Hayır/Evet seçimi, Tehlikeli Madde Depolama''da her zaman true (sunucu tarafında da zorlanır, bkz. create_job/create_operation_with_jobs). Diğer her kategoride null.';
comment on column public.jobs.storage_risk_groups is
  'storage-hazard-catalog.ts#StorageRiskGroupId ile birebir (18 kanonik id, çoklu seçim) — yalnızca storage_hazardous = true iken anlamlı. ADR (nakliye_hazmat.adr_class) İLE KARIŞTIRILMAZ, tamamen ayrı bir kataloktur.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — provider_documents: depocunun belge yüklerken KENDİSİNİN talep
-- ettiği risk grupları (admin onayından ÖNCEKİ durum — otomatik yetki
-- VERMEZ, bkz. bu migration'ın kendi başlık dokümanı).
-- -----------------------------------------------------------------------------
alter table public.provider_documents
  add column if not exists requested_storage_risk_groups text[] null;

comment on column public.provider_documents.requested_storage_risk_groups is
  'storage-hazard-catalog.ts#StorageRiskGroupId ile birebir — depocunun belge yüklerken KENDİSİNİN seçtiği, hizmet verebileceğini iddia ettiği risk grupları. Bu seçim OTOMATİK YETKİ VERMEZ (review_provider_document''in p_approved_storage_risk_groups''u admin''in AYRI kararıdır) — bkz. bu migration''ın kendi başlık dokümanı.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — assert_valid_storage_risk_groups: assert_valid_storage_activity_
-- scopes (0059) İLE AYNI desen, storage-hazard-catalog.ts#StorageRiskGroupId
-- İLE ELLE SENKRON tutulan 18 kanonik id.
-- -----------------------------------------------------------------------------
create or replace function public.assert_valid_storage_risk_groups(p_groups text[])
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_group text;
begin
  if p_groups is null then
    return;
  end if;
  foreach v_group in array p_groups loop
    if not (v_group = any(array[
      'yanici-parlayici-sivilar', 'yanici-katilar', 'yanici-gazlar', 'basincli-gazlar',
      'kendiliginden-yanabilen', 'suyla-temasinda-tehlikeli', 'oksitleyici-maddeler', 'organik-peroksitler',
      'asindirici-asitler', 'asindirici-bazlar', 'diger-asindirici-reaktif',
      'zehirli-akut-toksik', 'zararli-saglik-tehlikesi',
      'cevreye-zararli', 'lityum-pil-batarya', 'patlayici-maddeler', 'bulasici-biyolojik', 'radyoaktif-maddeler'
    ])) then
      raise exception 'ML138: storage_risk_groups must only contain canonical risk group ids (got %)', v_group using errcode = 'ML138';
    end if;
  end loop;
end;
$function$;

comment on function public.assert_valid_storage_risk_groups(text[]) is
  'app/_lib/storage-hazard-catalog.ts#STORAGE_RISK_GROUP_OPTIONS ile ELLE senkron tutulan 18 kanonik id. create_job/create_operation_with_jobs/update_job_as_admin/update_job_as_requester/create_provider_document/authorize_provider_storage_risk_group/review_provider_document tarafından paylaşılan TEK doğrulama noktası.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — provider_storage_risk_authorizations: YENİ, BAĞIMSIZ tablo —
-- provider_service_authorizations (0038) İLE AYNI şekil/RLS/audit deseni,
-- ama kategoriden BAĞIMSIZ (risk_group_id ile anahtarlanır, service_
-- category_id İLE DEĞİL) — bkz. bu migration'ın kendi başlık dokümanındaki
-- mimari gerekçe. FK delete davranışı 0043'ün provider_service_
-- authorizations için kurduğu sınıflandırmayla BİREBİR AYNI (provider_id:
-- Grup 1/dokunulmadı — gerçek bir yeterlilik kaydı, karşı taraf çıkarı var;
-- authorized_by/revoked_by: Grup 2/ON DELETE SET NULL — "kim yaptı"
-- atfı) — burada baştan doğru davranışla oluşturulduğu için 0043'teki gibi
-- SONRADAN bir alter/drop-constraint adımına gerek YOKTUR.
-- -----------------------------------------------------------------------------
create table if not exists public.provider_storage_risk_authorizations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  risk_group_id text not null,

  authorized_at timestamptz not null default now(),
  authorized_by uuid references public.profiles (id) on delete set null,
  source_document_id uuid references public.provider_documents (id),
  authorize_reason text,

  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  constraint provider_storage_risk_authorizations_revoked_fields_consistent
    check ((revoked_at is null) = (revoked_by is null)),

  updated_at timestamptz not null default now()
);

comment on table public.provider_storage_risk_authorizations is
  'Bir provider''ın hangi depolama tehlike/risk grubu (storage-hazard-catalog.ts#StorageRiskGroupId) için admin tarafından yetkilendirildiğinin tam tarihçesi. revoked_at IS NULL = şu an aktif/yetkili. provider_documents.requested_storage_risk_groups (talep, "kendim seçtim") ile KASITLI OLARAK AYRI — seçim otomatik yetki VERMEZ. provider_service_authorizations''tan (kategori bazlı) BAĞIMSIZ, İLAVE bir katman — Kimyasal Depolama/Tehlikeli Madde Depolama''nın KENDİ kategori yetkisi (genel Depo Hizmetleri belgesi onayıyla, DEĞİŞMEDEN) hâlâ ayrıca gereklidir, bu tablo yalnızca hangi risk gruplarında ADDITIONALLY yetkili olduğunu belirler. provider_can_view_job() (0059, burada genişletiliyor) TEK okuma noktasıdır.';

comment on column public.provider_storage_risk_authorizations.risk_group_id is
  'storage-hazard-catalog.ts#StorageRiskGroupId ile birebir. Kasıtlı olarak service_categories''e değil, sabit bir id kümesine referans verir (risk yeterliliği kategoriden bağımsızdır) — assert_valid_storage_risk_groups tarafından doğrulanır.';

create unique index if not exists provider_storage_risk_authorizations_one_active
  on public.provider_storage_risk_authorizations (provider_id, risk_group_id)
  where revoked_at is null;

drop trigger if exists trg_provider_storage_risk_authorizations_set_updated_at on public.provider_storage_risk_authorizations;
create trigger trg_provider_storage_risk_authorizations_set_updated_at
  before update on public.provider_storage_risk_authorizations
  for each row execute function public.set_updated_at();

revoke all on public.provider_storage_risk_authorizations from authenticated, anon;
grant select on public.provider_storage_risk_authorizations to authenticated;
-- INSERT/UPDATE(revoke) yalnızca authorize_provider_storage_risk_group()/
-- revoke_provider_storage_risk_group() üzerinden (aşağıda), ikisi de admin-only.

alter table public.provider_storage_risk_authorizations enable row level security;

drop policy if exists provider_storage_risk_authorizations_select_own_or_admin on public.provider_storage_risk_authorizations;
create policy provider_storage_risk_authorizations_select_own_or_admin on public.provider_storage_risk_authorizations
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

comment on policy provider_storage_risk_authorizations_select_own_or_admin on public.provider_storage_risk_authorizations is
  'provider_service_authorizations_select_own_or_admin (0038) ile AYNI kısıt seviyesi — provider kendi satırlarını HER ZAMAN canlı/doğrudan Supabase''ten okur (localStorage aynası DEĞİL).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — notifications.type CHECK: +2 yeni tip (0038'deki AYNI genişletme
-- deseni — mevcut satırlar/tipler DEĞİŞMEDİ).
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'yeni_teklif', 'teklif_kabul_edildi', 'teklif_reddedildi', 'is_basladi',
  'anlasma_saglanamadi', 'baska_hizmet_verenle_anlasildi', 'ilan_yeniden_yayinda',
  'tamamlanma_onayi_bekleniyor', 'is_tamamlandi', 'tamamlanma_onaylandi',
  'tamamlanma_itiraz_edildi', 'itiraz_kaydedildi', 'is_iptal_edildi',
  'teklif_geri_cekildi', 'hizmet_kalemi_kaldirildi', 'ilan_kapatildi',
  'ilan_yayin_suresi_doldu', 'belge_onaylandi', 'belge_reddedildi', 'belge_revizyon_istendi',
  'service_document_required', 'service_authorized', 'service_authorization_revoked',
  'storage_risk_group_authorized', 'storage_risk_group_authorization_revoked'
));

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — create_provider_document: +1 opsiyonel parametre (9 -> 10),
-- STALE OVERLOAD KORUMASI (0032/0033/0034'ün dersi).
-- -----------------------------------------------------------------------------
drop function if exists public.create_provider_document(text, text, text, text, text, bigint, text, text[], text[]);

create or replace function public.create_provider_document(
  p_document_type text, p_storage_path text, p_original_file_name text, p_mime_type text,
  p_extension text, p_size_bytes bigint, p_service_category_id text default null::text,
  p_storage_activity_scopes text[] default null::text[], p_imo_class_codes text[] default null::text[],
  p_requested_storage_risk_groups text[] default null::text[]
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
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_imo_class_codes);
  perform public.assert_valid_storage_risk_groups(p_requested_storage_risk_groups);

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id, storage_activity_scopes, imo_class_codes, requested_storage_risk_groups)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id, p_storage_activity_scopes, p_imo_class_codes, p_requested_storage_risk_groups)
  returning * into v_row;

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 6A — authorize_provider_service: GERÇEK, ÖNCEDEN VAR OLAN bir bug
-- düzeltmesi (0038/0059'dan beri, bu migrationın kapsamı DIŞINDA bulundu —
-- gerçek RPC testiyle: bir provider'ı ZATEN aktif olduğu bir kategori için
-- TEKRAR yetkilendirmek — ör. review_provider_document'in "depo-hizmetleri-
-- belgesi" 12-kategori döngüsü, bir kategori daha önce ayrı ayrı yetkilen-
-- dirilmişse — her zaman `provider_service_authorizations_one_active`
-- unique_violation'ı ile PATLIYORDU). Kök neden: `if v_existing is not null
-- then` — composite/row tipli bir değişkende IS NOT NULL yalnızca TÜM
-- alanlar non-null iken true döner; bu tablonun source_document_id/
-- authorize_reason/revoked_at gibi nullable alanları olduğu için "satır
-- bulundu ama bazı alanları null" durumunda hem IS NULL hem IS NOT NULL
-- false döner, UPDATE dalı hiç tetiklenmez, her çağrı INSERT dener. İMZA
-- DEĞİŞMEDİ (yalnızca `if v_existing is not null` -> `if found`), drop
-- gerekmez, düz `create or replace` yeterli.
-- -----------------------------------------------------------------------------
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

  if found then
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
-- BÖLÜM 7 — authorize_provider_storage_risk_group / revoke_provider_storage_
-- risk_group: authorize_provider_service/revoke_provider_service_
-- authorization (0038) İLE AYNI admin-only desen, kategori yerine risk_
-- group_id ile anahtarlanır. TEK grup başına çağrılır (admin'in "her grubu
-- ayrı ayrı onaylasın/reddetsin" gereksinimi, review_provider_document
-- BÖLÜM 8'de bunu döngüyle bir belgenin TÜM talep edilen gruplarına
-- uygular).
-- -----------------------------------------------------------------------------
create or replace function public.authorize_provider_storage_risk_group(
  p_provider_id uuid, p_risk_group_id text, p_source_document_id uuid default null::uuid,
  p_reason text default null::text
)
returns provider_storage_risk_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_storage_risk_authorizations;
  v_existing public.provider_storage_risk_authorizations;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  perform public.assert_valid_storage_risk_groups(array[p_risk_group_id]);
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_storage_risk_authorizations.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.provider_documents where id = p_source_document_id and provider_id = p_provider_id
  ) then
    raise exception 'MLK76: source document not found for this provider' using errcode = 'MLK76';
  end if;

  select * into v_existing from public.provider_storage_risk_authorizations
    where provider_id = p_provider_id and risk_group_id = p_risk_group_id and revoked_at is null;

  -- BUG NOTU (gerçek RPC testiyle bulundu, bkz. BÖLÜM 6A'daki authorize_
  -- provider_service düzeltmesi): `v_existing IS NOT NULL` KULLANILMAZ —
  -- composite/row tipli bir PL/pgSQL değişkeninde IS NOT NULL yalnızca
  -- TÜM alanlar non-null iken true döner; bu satırda source_document_id/
  -- authorize_reason/revoked_at gibi nullable alanlar olduğu için "bulundu
  -- ama bazı alanları null" durumunda hem IS NULL hem IS NOT NULL false
  -- döner ve UPDATE dalı asla tetiklenmez, INSERT her seferinde dener ve
  -- unique_violation'a çarpar. `FOUND` (SELECT INTO'nun kendi, satır
  -- bulunup bulunmadığını gösteren özel değişkeni) TEK güvenilir kontrol.
  if found then
    update public.provider_storage_risk_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_storage_risk_authorizations
      (provider_id, risk_group_id, authorized_by, source_document_id, authorize_reason)
    values
      (p_provider_id, p_risk_group_id, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'storage_risk_group_authorized', null, null, null,
    'Depolama Risk Grubu Yetkiniz Onaylandı',
    'Bir depolama tehlike/risk grubu için yetkiniz onaylandı. Artık bu risk grubuna ait Kimyasal Depolama/Tehlikeli Madde Depolama ilanlarına teklif verebilirsiniz.',
    jsonb_build_object('risk_group_id', p_risk_group_id)
  );

  perform public.log_audit_event('authorize_provider_storage_risk_group', 'provider_storage_risk_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'risk_group_id', p_risk_group_id));

  return v_row;
end;
$function$;

create or replace function public.revoke_provider_storage_risk_group(
  p_provider_id uuid, p_risk_group_id text, p_reason text
)
returns provider_storage_risk_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_storage_risk_authorizations;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'MLK75: a reason is required to revoke this authorization' using errcode = 'MLK75';
  end if;

  update public.provider_storage_risk_authorizations set
    revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
  where provider_id = p_provider_id and risk_group_id = p_risk_group_id and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'MLK76: no active authorization found for this provider and risk group' using errcode = 'MLK76';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'storage_risk_group_authorization_revoked', null, null, null,
    'Depolama Risk Grubu Yetkiniz Kaldırıldı',
    'Bir depolama tehlike/risk grubu için yetkiniz kaldırıldı: ' || v_trimmed_reason,
    jsonb_build_object('risk_group_id', p_risk_group_id)
  );

  perform public.log_audit_event('revoke_provider_storage_risk_group', 'provider_storage_risk_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'risk_group_id', p_risk_group_id));

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 8 — review_provider_document: +1 opsiyonel parametre (5 -> 6).
-- KASITLI OLARAK mevcut otomatik-yetkilendirme zincirinin (0041/0044) BİR
-- PARÇASI DEĞİL — risk grupları yalnızca admin AÇIKÇA p_approved_storage_
-- risk_groups içinde bir id gönderirse yetkilendirilir (genel belge onayı
-- KENDİLİĞİNDEN risk grubu yetkilendirmez, görev talimatının kendi kesin
-- kuralı). depo-hizmetleri-belgesi VE service_category_id ile Kimyasal/
-- Tehlikeli Madde Depolama'yı doğrudan hedefleyen genel belgeler için
-- geçerlidir (aynı belge, admin aynı inceleme aksiyonunda hem kategori
-- yetkisini hem -varsa- risk gruplarını onaylayabilir).
-- -----------------------------------------------------------------------------
drop function if exists public.review_provider_document(uuid, text, text, text[], text[]);

create or replace function public.review_provider_document(
  p_document_id uuid, p_status text, p_note text default null::text,
  p_approved_storage_activity_scopes text[] default null::text[],
  p_approved_imo_class_codes text[] default null::text[],
  p_approved_storage_risk_groups text[] default null::text[]
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
  v_risk_group text;
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
  perform public.assert_valid_storage_risk_groups(p_approved_storage_risk_groups);

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

      -- BU MİGRATION: risk grupları, YUKARIDAKİ zincirin BİR PARÇASI DEĞİL,
      -- admin'in AYRICA/AÇIKÇA onayladığı bir alt küme (görev talimatı:
      -- "genel belge onayı risk gruplarını kendiliğinden yetkilendirmesin").
      if p_approved_storage_risk_groups is not null then
        foreach v_risk_group in array p_approved_storage_risk_groups loop
          perform public.authorize_provider_storage_risk_group(
            v_document.provider_id, v_risk_group, p_document_id,
            'Belge incelemesi sırasında admin tarafından ayrı ayrı onaylandı (review_provider_document, migration 0068).'
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
-- BÖLÜM 9 — provider_can_view_job: +2 opsiyonel parametre (3 -> 5). Konteyner
-- Depolama mantığı (0059) DEĞİŞMEDİ; Kimyasal Depolama/Tehlikeli Madde
-- Depolama için YENİ bir dal eklendi — job'un TÜM storage_risk_groups'unun
-- provider_storage_risk_authorizations'ta AKTİF bir karşılığı olmalı
-- (fail-closed: hiçbir aktif satır yoksa eşleşmez — 0059'un "NULL=SINIRSIZ"
-- varsayılanından KASITLI OLARAK FARKLI, bkz. bu migration'ın başlık
-- dokümanı).
--
-- BAĞIMLILIK NOTU: jobs_select_visible RLS politikası eski (uuid,text,jsonb)
-- imzasını `USING` ifadesinde DOĞRUDAN çağırdığı için düz bir `drop function`
-- 2BP01 ("other objects depend on it") ile başarısız olur — policy ÖNCE
-- kaldırılır (BÖLÜM 10'da AYNI `for select to authenticated, anon` ile,
-- 0035'in kendi tanımıyla BİREBİR AYNI çatı, yeniden oluşturulur).
-- -----------------------------------------------------------------------------
drop policy if exists jobs_select_visible on public.jobs;
drop function if exists public.provider_can_view_job(uuid, text, jsonb);

create or replace function public.provider_can_view_job(
  p_provider_id uuid, p_category_id text, p_storage_container_groups jsonb,
  p_storage_hazardous boolean default null::boolean, p_storage_risk_groups text[] default null::text[]
)
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
  v_risk_group text;
begin
  if not public.provider_can_view_category(p_provider_id, p_category_id) then
    return false;
  end if;

  if p_category_id = 'konteyner-depolama' and p_storage_container_groups is not null then
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
  end if;

  if p_category_id in ('kimyasal-depolama', 'tehlikeli-madde-depolama')
     and coalesce(p_storage_hazardous, false) = true
     and p_storage_risk_groups is not null
  then
    foreach v_risk_group in array p_storage_risk_groups loop
      if not exists (
        select 1 from public.provider_storage_risk_authorizations
        where provider_id = p_provider_id and risk_group_id = v_risk_group and revoked_at is null
      ) then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$function$;

comment on function public.provider_can_view_job(uuid, text, jsonb, boolean, text[]) is
  'provider_can_view_category''yi sarar (o fonksiyon DEĞİŞMEDİ). Konteyner Depolama dalı 0059''dan DEĞİŞMEDEN taşındı. YENİ dal (0068): Kimyasal Depolama/Tehlikeli Madde Depolama''da storage_hazardous=true iken job''un HER risk grubunun provider_storage_risk_authorizations''ta aktif bir karşılığı olmalı (fail-closed, 0059''un NULL=SINIRSIZ varsayılanından FARKLI — bkz. bu migration''ın başlık dokümanı). jobs_select_visible RLS, get_visible_job/get_visible_jobs, create_offer''in MLK60 kapısı VE accept_offer''in yeniden-kontrolü tarafından paylaşılır — TEK doğruluk kaynağı.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 10 — jobs_select_visible RLS politikası: BÖLÜM 9'da kaldırılan
-- policy, 0035'in kendi `for select to authenticated, anon` çatısıyla
-- BİREBİR AYNI şekilde, yalnızca provider_can_view_job çağrısına +2 argüman
-- (storage_hazardous, storage_risk_groups) eklenerek yeniden oluşturulur.
-- -----------------------------------------------------------------------------
create policy jobs_select_visible on public.jobs
  for select to authenticated, anon
  using (
    (deleted_at is null) and (
      (requester_id = auth.uid()) or is_admin() or (
        (moderation_status = 'approved'::text) and (
          (current_user_role() is distinct from 'hizmet-veren'::text)
          or provider_can_view_job(auth.uid(), category_id, storage_container_groups, storage_hazardous, storage_risk_groups)
        )
      )
    )
  );

comment on policy jobs_select_visible on public.jobs is
  '0035/0059''dan devam — moderation_status=''approved'' olmayan bir ilan sahibi/admin dışında kimseye görünmez; onay üzerine provider_can_view_job (0068''de +storage_hazardous/+storage_risk_groups argümanlarıyla genişledi) kategori/kapsam/risk-grubu uygunluğunu kontrol eder.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 11 — get_visible_job/get_visible_jobs: gövde-içi (yalnızca), AYNI
-- İMZA — provider_can_view_job çağrılarına +2 argüman.
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
        and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(auth.uid(), j.category_id, j.storage_container_groups, j.storage_hazardous, j.storage_risk_groups))
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
          and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(auth.uid(), j.category_id, j.storage_container_groups, j.storage_hazardous, j.storage_risk_groups))
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
-- BÖLÜM 12 — create_offer: gövde-içi (yalnızca), AYNI İMZA. MLK60 kapısındaki
-- provider_can_view_job çağrısına +2 argüman.
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
  if v_job is null or not public.provider_can_view_job(auth.uid(), v_job.category_id, v_job.storage_container_groups, v_job.storage_hazardous, v_job.storage_risk_groups) or v_job.moderation_status <> 'approved' then
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

-- -----------------------------------------------------------------------------
-- BÖLÜM 13 — accept_offer: gövde-içi (yalnızca), AYNI İMZA. Kabul anındaki
-- yeniden kontrol (0060/0061'in kendi ilkesi) artık YALNIZ Konteyner
-- Depolama değil, Kimyasal Depolama/Tehlikeli Madde Depolama'yı da kapsıyor
-- — "teklifin geçmişte oluşturulabilmiş olması tek başına kabul edilmesi
-- için yeterli olmasın" (görev talimatı, risk-grubu yetkisi teklif
-- SONRASINDA geri alınmış/reddedilmiş olabilir).
-- -----------------------------------------------------------------------------
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
  if v_job.category_id in ('konteyner-depolama', 'kimyasal-depolama', 'tehlikeli-madde-depolama')
     and not public.provider_can_view_job(v_offer.provider_id, v_job.category_id, v_job.storage_container_groups, v_job.storage_hazardous, v_job.storage_risk_groups)
  then
    raise exception 'MLK87: provider no longer meets this job''s activity/IMO/risk-group requirements' using errcode = 'MLK87';
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

-- -----------------------------------------------------------------------------
-- BÖLÜM 14 — create_job: +2 opsiyonel parametre (50 -> 52). Tehlikeli Madde
-- Depolama için storage_hazardous SUNUCU TARAFINDA da true'ya zorlanır
-- (job-store.ts#resolveStorageHazardFields İLE AYNI savunma-derinliği
-- ilkesi — istemci atlanarak bu kategoriye "false" gönderilemez).
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date,
  integer, numeric, text, text, uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb,
  text, text, text, text, jsonb, jsonb, jsonb, jsonb
);

create or replace function public.create_job(
  p_category_id text,
  p_title text,
  p_description text,
  p_operation_details text,
  p_province text,
  p_district text,
  p_work_location_type text,
  p_work_date date,
  p_photos jsonb,
  p_facility_id text default null,
  p_location_mode text default 'catalog',
  p_address_text text default '',
  p_neighborhood text default null,
  p_location_url text default null,
  p_directions_note text default null,
  p_work_end_date date default null,
  p_product_quantity integer default null,
  p_product_tonnage numeric default null,
  p_product_type text default null,
  p_customs_product_type text default null,
  p_client_id uuid default null,
  p_delivery_province text default null,
  p_delivery_district text default null,
  p_delivery_location_type text default null,
  p_delivery_facility_id text default null,
  p_delivery_facility_name text default null,
  p_delivery_address_text text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
  v_storage_hazardous boolean;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_photo_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_photo_count < 1 or v_photo_count > 10 then
    raise exception 'MLK51: a job requires between 1 and 10 photos (got %)', v_photo_count using errcode = 'MLK51';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);

  v_storage_hazardous := case when p_category_id = 'tehlikeli-madde-depolama' then true else p_storage_hazardous end;

  insert into public.jobs (
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type, delivery_province, delivery_district, delivery_location_type,
    delivery_facility_id, delivery_facility_name, delivery_address_text,
    recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
    recycling_unit, recycling_material_condition, recycling_material_condition_note,
    recycling_scope_of_work, customs_transaction_type, customs_requested_services,
    storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
    product_tonnage_unit, storage_container_groups,
    nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
    nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
    nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
    storage_hazardous, storage_risk_groups,
    moderation_status
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text,
    p_recycling_material_category_id, p_recycling_material_subtype_id, p_recycling_quantity,
    p_recycling_unit, p_recycling_material_condition, p_recycling_material_condition_note,
    p_recycling_scope_of_work, p_customs_transaction_type, p_customs_requested_services,
    p_storage_product_type, p_storage_product_quantity, p_storage_product_unit, p_storage_product_tonnage,
    p_product_tonnage_unit, p_storage_container_groups,
    p_nakliye_load_preparation_type, p_nakliye_load_preparation_custom_text,
    p_nakliye_loading_method, p_nakliye_loading_method_custom_text, p_nakliye_measurement_info,
    p_nakliye_hazmat, p_nakliye_container_transport, p_nakliye_cargo_groups,
    v_storage_hazardous, p_storage_risk_groups,
    'pending_review'
  )
  returning * into v_job;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
    values (
      v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
      (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
      v_order, auth.uid()
    );
    v_order := v_order + 1;
  end loop;

  perform public.append_job_activity_event(v_job.id, null, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

  return v_job;
end;
$$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 15 — create_operation_with_jobs: gövde-içi (yalnızca), AYNI İMZA
-- (per-service alanlar zaten p_services jsonb dizisinden okunuyor, top-level
-- parametre listesi hiç değişmedi — drop/recreate GEREKMEZ). Aynı sunucu
-- tarafı zorlaması (Tehlikeli Madde Depolama -> storage_hazardous = true)
-- her servis için ayrı ayrı uygulanır.
-- -----------------------------------------------------------------------------
create or replace function public.create_operation_with_jobs(
  p_province text,
  p_operation_details text,
  p_services jsonb,
  p_photos_by_service_index jsonb,
  p_client_operation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.operations;
  v_service jsonb;
  v_index integer := 0;
  v_service_count integer;
  v_category_ids text[];
  v_job public.jobs;
  v_job_ids uuid[] := '{}';
  v_photo jsonb;
  v_photo_count integer;
  v_order integer;
  v_service_client_id uuid;
  v_service_province text;
  v_service_container_groups jsonb;
  v_service_measurement_info jsonb;
  v_service_hazmat jsonb;
  v_service_container_transport jsonb;
  v_service_cargo_groups jsonb;
  v_service_storage_risk_groups text[];
  v_service_storage_hazardous boolean;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_service_count := jsonb_array_length(coalesce(p_services, '[]'::jsonb));
  if v_service_count < 2 then
    raise exception 'MLK53: an operation requires at least 2 services (got %)', v_service_count using errcode = 'MLK53';
  end if;

  select array_agg(s->>'category_id') into v_category_ids from jsonb_array_elements(p_services) s;
  if (select count(distinct x) from unnest(v_category_ids) x) <> v_service_count then
    raise exception 'MLK54: an operation cannot select the same category more than once' using errcode = 'MLK54';
  end if;

  insert into public.operations (id, requester_id)
  values (coalesce(p_client_operation_id, gen_random_uuid()), auth.uid())
  returning * into v_operation;

  for v_service in select * from jsonb_array_elements(p_services) loop
    if (v_service->>'work_end_date') is not null
       and (v_service->>'work_end_date')::date < (v_service->>'work_date')::date then
      raise exception 'MLK52: work_end_date cannot be before work_date (service %)', v_index using errcode = 'MLK52';
    end if;

    v_photo_count := jsonb_array_length(coalesce(p_photos_by_service_index -> v_index::text, '[]'::jsonb));
    if v_photo_count < 1 or v_photo_count > 10 then
      raise exception 'MLK51: a job requires between 1 and 10 photos (service %, got %)', v_index, v_photo_count using errcode = 'MLK51';
    end if;

    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);
    v_service_container_groups := v_service->'storage_container_groups';
    v_service_measurement_info := v_service->'nakliye_measurement_info';
    v_service_hazmat := v_service->'nakliye_hazmat';
    v_service_container_transport := v_service->'nakliye_container_transport';
    v_service_cargo_groups := v_service->'nakliye_cargo_groups';
    v_service_storage_risk_groups := (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'storage_risk_groups', '[]'::jsonb)) x);
    perform public.validate_storage_container_groups(v_service_container_groups);
    perform public.validate_nakliye_measurement_info(v_service_measurement_info);
    perform public.validate_nakliye_hazmat(v_service_hazmat);
    perform public.validate_nakliye_container_transport(v_service_container_transport);
    perform public.validate_nakliye_cargo_groups(v_service_cargo_groups);
    perform public.assert_valid_storage_risk_groups(v_service_storage_risk_groups);

    v_service_storage_hazardous := case
      when v_service->>'category_id' = 'tehlikeli-madde-depolama' then true
      else nullif(v_service->>'storage_hazardous', '')::boolean
    end;

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type, delivery_province, delivery_district, delivery_location_type,
      delivery_facility_id, delivery_facility_name, delivery_address_text,
      recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
      recycling_unit, recycling_material_condition, recycling_material_condition_note,
      recycling_scope_of_work, customs_transaction_type, customs_requested_services,
      storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
      product_tonnage_unit, storage_container_groups,
      nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
      nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
      nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
      storage_hazardous, storage_risk_groups,
      moderation_status
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, v_service_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type',
      v_service->>'delivery_province', v_service->>'delivery_district', v_service->>'delivery_location_type',
      v_service->>'delivery_facility_id', v_service->>'delivery_facility_name', v_service->>'delivery_address_text',
      v_service->>'recycling_material_category_id', v_service->>'recycling_material_subtype_id',
      nullif(v_service->>'recycling_quantity', '')::numeric, v_service->>'recycling_unit',
      v_service->>'recycling_material_condition', v_service->>'recycling_material_condition_note',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'recycling_scope_of_work', '[]'::jsonb)) x),
      v_service->>'customs_transaction_type',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'customs_requested_services', '[]'::jsonb)) x),
      v_service->>'storage_product_type', nullif(v_service->>'storage_product_quantity', '')::numeric,
      v_service->>'storage_product_unit', nullif(v_service->>'storage_product_tonnage', '')::numeric,
      v_service->>'product_tonnage_unit', v_service_container_groups,
      v_service->>'nakliye_load_preparation_type', v_service->>'nakliye_load_preparation_custom_text',
      v_service->>'nakliye_loading_method', v_service->>'nakliye_loading_method_custom_text', v_service_measurement_info,
      v_service_hazmat, v_service_container_transport, v_service_cargo_groups,
      v_service_storage_hazardous, v_service_storage_risk_groups,
      'pending_review'
    )
    returning * into v_job;

    v_order := 0;
    for v_photo in select * from jsonb_array_elements(p_photos_by_service_index -> v_index::text) loop
      insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
      values (
        v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
        (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
        v_order, auth.uid()
      );
      v_order := v_order + 1;
    end loop;

    perform public.append_job_activity_event(v_job.id, v_operation.id, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

    v_job_ids := array_append(v_job_ids, v_job.id);
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('operation_id', v_operation.id, 'job_ids', v_job_ids);
end;
$$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 16 — update_job_as_admin / update_job_as_requester: +2 opsiyonel
-- parametre. STALE OVERLOAD KORUMASI (0032/0033/0034'ün dersi) — 0067'nin
-- BIRAKTIĞI imza AÇIKÇA drop edilir. Admin/requester düzenlemesinde de AYNI
-- sunucu tarafı zorlaması (Tehlikeli Madde Depolama -> true) uygulanır.
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
);

create or replace function public.update_job_as_admin(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
  p_operation_details text default null,
  p_neighborhood text default null, p_location_url text default null, p_directions_note text default null,
  p_delivery_province text default null, p_delivery_district text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
  v_storage_hazardous boolean;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML115: admin role required' using errcode = 'ML115';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML116: job not found' using errcode = 'ML116';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for review, please re-review' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';
  v_storage_hazardous := case when v_job.category_id = 'tehlikeli-madde-depolama' then true else coalesce(p_storage_hazardous, v_job.storage_hazardous) end;

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
    product_tonnage = coalesce(p_product_tonnage, product_tonnage),
    product_type = coalesce(p_product_type, product_type),
    customs_product_type = coalesce(p_customs_product_type, customs_product_type),
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text),
    operation_details = coalesce(p_operation_details, operation_details),
    neighborhood = coalesce(p_neighborhood, neighborhood),
    location_url = coalesce(p_location_url, location_url),
    directions_note = coalesce(p_directions_note, directions_note),
    delivery_province = coalesce(p_delivery_province, delivery_province),
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups),
    storage_hazardous = v_storage_hazardous,
    storage_risk_groups = coalesce(p_storage_risk_groups, storage_risk_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

drop function if exists public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb
);

create or replace function public.update_job_as_requester(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
  p_operation_details text default null,
  p_neighborhood text default null, p_location_url text default null, p_directions_note text default null,
  p_delivery_province text default null, p_delivery_district text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
  v_storage_hazardous boolean;
begin
  perform public.assert_active_user();

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML129: job not found' using errcode = 'ML129';
  end if;
  if v_job.requester_id <> auth.uid() then
    raise exception 'ML130: only the job owner may edit this job' using errcode = 'ML130';
  end if;
  if v_job.moderation_status <> 'pending_review' then
    raise exception 'ML131: only a job awaiting review can be edited this way' using errcode = 'ML131';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for editing, please reload' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';
  v_storage_hazardous := case when v_job.category_id = 'tehlikeli-madde-depolama' then true else coalesce(p_storage_hazardous, v_job.storage_hazardous) end;

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
    product_tonnage = coalesce(p_product_tonnage, product_tonnage),
    product_type = coalesce(p_product_type, product_type),
    customs_product_type = coalesce(p_customs_product_type, customs_product_type),
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text),
    operation_details = coalesce(p_operation_details, operation_details),
    neighborhood = coalesce(p_neighborhood, neighborhood),
    location_url = coalesce(p_location_url, location_url),
    directions_note = coalesce(p_directions_note, directions_note),
    delivery_province = coalesce(p_delivery_province, delivery_province),
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups),
    storage_hazardous = v_storage_hazardous,
    storage_risk_groups = coalesce(p_storage_risk_groups, storage_risk_groups)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan sahibi tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_requester', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;
