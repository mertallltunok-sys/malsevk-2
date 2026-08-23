-- GENEL GÜVENLİK, VERİ DOĞRULAMA VE KÖTÜYE KULLANIM KORUMASI
--
-- İkinci bir kullanıcı/yetki sistemi İCAT EDİLMEZ — mevcut `is_admin()`/
-- `assert_active_user()`/RLS/RPC mimarisi üzerine inşa edilir. Bu migration
-- 7 bağımsız bölümden oluşur: (1) genel amaçlı rate limiting altyapısı,
-- (2) bu altyapının mevcut yazma yollarına TETİKLEYİCİLER üzerinden
-- bağlanması (RPC gövdelerini yeniden yazmak yerine — dev bir RPC'yi (ör.
-- create_job, 27 parametre) yeniden yazmak yerine TABLOYA bir BEFORE INSERT
-- trigger eklemek, mevcut ensure_job_content_has_no_direct_contact_info
-- (0052) ve ensure_service_category_active (0049) ile AYNI, daha düşük
-- riskli desendir — hangi yoldan (hangi RPC'den) satır geldiği önemsizdir),
-- (3) eksik sayısal üst sınırlar, (4) eksik dizi/JSONB uzunluk sınırları,
-- (5) location_url şema doğrulaması, (6) offers.description için 0052'nin
-- jobs.title/description iletişim-bilgisi-sızıntısı korumasının AYNISI,
-- (7) Sistem Sağlığı'nın "Muhtemel Neden" alanının kural-tabanlı otomatik
-- doldurulması (report_system_error'ın imzası DEĞİŞMEZ — yalnızca gövde).

-- =============================================================================
-- BÖLÜM 1 — Genel amaçlı, Postgres tabanlı rate limiting (ikinci bir Redis/
-- ücretli servis YOK, "yalnızca bellekte tutulan ve her istekle sıfırlanan
-- sahte" bir mekanizma DEĞİL — görev gereksinimi). Sabit pencere (fixed
-- window) sayaç deseni: her (subject, action, pencere) kombinasyonu için tek
-- satır, atomik `on conflict ... do update` ile artırılır — yarış durumuna
-- karşı güvenlidir.
-- =============================================================================

create table if not exists public.rate_limit_counters (
  subject_key text not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 1,
  primary key (subject_key, action, window_start)
);

comment on table public.rate_limit_counters is
  'Genel amaçlı, Postgres tabanlı sabit-pencere rate limit sayaçları — check_rate_limit() tarafından atomik olarak yazılır. Hiçbir role doğrudan grant YOK (yalnızca SECURITY DEFINER RPC/trigger üzerinden).';

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated;
-- Hiçbir SELECT policy'si YOK — bu tablo yalnızca dahili muhasebe içindir,
-- admin dahil hiçbir istemci doğrudan okumaz/yazmaz.

-- `p_subject_key`: verilmezse auth.uid() kullanılır (kimliği doğrulanmış
-- mutasyonların tamamı için yeterlidir — assert_active_user() zaten bunu
-- şart koşuyor). Yalnızca gerçekten anonim olabilen tek yol (submit_contact_
-- message) kendi e-posta/telefonunu subject_key olarak geçer (bkz. BÖLÜM 2).
create or replace function public.check_rate_limit(
  p_action text,
  p_max_count integer,
  p_window_seconds integer,
  p_subject_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subject text := coalesce(nullif(trim(p_subject_key), ''), auth.uid()::text);
  v_window_start timestamptz;
  v_count integer;
begin
  if v_subject is null then
    -- Ne kimliği doğrulanmış bir kullanıcı ne de bir subject_key var —
    -- bu, hiçbir çağıranın normal koşulda ulaşamayacağı bir durumdur (her
    -- tetikleyici/RPC ya auth.uid() gerektirir ya da kendi subject_key'ini
    -- geçer); güvenli tarafta kalıp reddetmek yerine sessizce izin verilir
    -- (rate limit'in kendisi asla meşru, tanımlanamayan bir isteği KIRICI
    -- bir güvenlik sınırı olmamalı).
    return;
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (subject_key, action, window_start, count)
  values (v_subject, p_action, v_window_start, 1)
  on conflict (subject_key, action, window_start)
  do update set count = rate_limit_counters.count + 1
  returning count into v_count;

  if v_count > p_max_count then
    raise exception 'ML161: rate limit exceeded for %', p_action using errcode = 'ML161';
  end if;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer, text) is
  'Sabit pencereli, Postgres tabanlı genel amaçlı rate limit kontrolü. Aşımda ML161 fırlatır (çağıran RPC/trigger''ın transaction''ını iptal eder). Yalnızca dahili (trigger/RPC içi) çağrılar için — clientlar bunu doğrudan çağıramaz.';

revoke all on function public.check_rate_limit(text, integer, integer, text) from public, anon, authenticated;
-- NOT: authenticated'e de grant YOK — bu fonksiyon yalnızca aşağıdaki
-- trigger'lar/RPC'ler (aynı sahip altında) tarafından çağrılır, hiçbir
-- istemci doğrudan çağıramaz (bir kullanıcı kendi sayacını manipüle edip
-- başkasının limitini "temizleyemez").

-- Eski pencerelerin birikmesini önlemek için basit bir temizlik yardımcı
-- fonksiyonu — bir cron/scheduled job olmadan da (bkz. 0018) tablo makul
-- boyutta kalır, çünkü her satır yalnızca bir pencere kadar anlamlıdır;
-- şimdilik manuel/gelecekte zamanlanmış çağrı için hazır tutulur, otomatik
-- tetiklenmez (yeni bir pg_cron job'ı İCAT ETMEK bu görevin kapsamı dışıdır).
create or replace function public.prune_old_rate_limit_counters()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limit_counters where window_start < now() - interval '2 days';
$$;

revoke all on function public.prune_old_rate_limit_counters() from public, anon, authenticated;

-- =============================================================================
-- BÖLÜM 2 — Mevcut yazma yollarına rate limit bağlanması (TRIGGER üzerinden,
-- mevcut büyük RPC gövdeleri YENİDEN YAZILMAZ). Limitler gerçek kullanım
-- verisine göre CÖMERT tutulur (görev gereksinimi: "normal kullanıcıyı
-- rahatsız etmeyecek") — amaç otomatikleştirilmiş kötüye kullanımı
-- yavaşlatmak, meşru yoğun kullanımı ENGELLEMEMEK.
-- =============================================================================

create or replace function public.rl_jobs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_rate_limit('create_job', 40, 3600);
  return new;
end;
$$;
revoke all on function public.rl_jobs_before_insert() from public, anon, authenticated;

drop trigger if exists trg_jobs_rate_limit on public.jobs;
create trigger trg_jobs_rate_limit
  before insert on public.jobs
  for each row execute function public.rl_jobs_before_insert();

create or replace function public.rl_offers_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_rate_limit('create_offer', 60, 3600);
  return new;
end;
$$;
revoke all on function public.rl_offers_before_insert() from public, anon, authenticated;

drop trigger if exists trg_offers_rate_limit on public.offers;
create trigger trg_offers_rate_limit
  before insert on public.offers
  for each row execute function public.rl_offers_before_insert();

create or replace function public.rl_provider_documents_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_rate_limit('upload_document', 20, 3600);
  return new;
end;
$$;
revoke all on function public.rl_provider_documents_before_insert() from public, anon, authenticated;

drop trigger if exists trg_provider_documents_rate_limit on public.provider_documents;
create trigger trg_provider_documents_rate_limit
  before insert on public.provider_documents
  for each row execute function public.rl_provider_documents_before_insert();

create or replace function public.rl_facility_candidate_raw_entries_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_rate_limit('submit_facility_candidate', 25, 3600);
  return new;
end;
$$;
revoke all on function public.rl_facility_candidate_raw_entries_before_insert() from public, anon, authenticated;

drop trigger if exists trg_facility_candidate_raw_entries_rate_limit on public.facility_candidate_raw_entries;
create trigger trg_facility_candidate_raw_entries_rate_limit
  before insert on public.facility_candidate_raw_entries
  for each row execute function public.rl_facility_candidate_raw_entries_before_insert();

-- contact_messages: TEK gerçekten anonim-olabilen yol — subject_key olarak
-- auth.uid() (oturum açıksa) yoksa gönderilen e-posta/telefonun kendisi
-- kullanılır (IP her zaman güvenilir şekilde elde edilemez, bkz. proje
-- raporu — Supabase'in bağlantı havuzlayıcısı gerçek istemci IP'sini
-- PL/pgSQL'e her zaman doğru yansıtmaz). Bu, "aynı e-posta/telefona saatte
-- N'den fazla mesaj" şeklinde daha anlamlı bir sınırdır.
create or replace function public.rl_contact_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.check_rate_limit(
    'submit_contact_message',
    5,
    3600,
    coalesce(auth.uid()::text, nullif(new.email, ''), nullif(new.phone, ''))
  );
  return new;
end;
$$;
revoke all on function public.rl_contact_messages_before_insert() from public, anon, authenticated;

drop trigger if exists trg_contact_messages_rate_limit on public.contact_messages;
create trigger trg_contact_messages_rate_limit
  before insert on public.contact_messages
  for each row execute function public.rl_contact_messages_before_insert();

-- report_system_error kendi RPC gövdesi içinde ayrıca sınırlanır (BÖLÜM 7),
-- çünkü zaten oradaki mantığı (ciddiyet/muhtemel neden hesaplama) BU
-- migration'da yeniden yazıyoruz — ayrı bir trigger gerekmiyor.

-- =============================================================================
-- BÖLÜM 3 — Eksik sayısal üst sınırlar (görev bölüm 6-7). `estimated_duration`/
-- `product_quantity`/`product_tonnage` (0005/0028) zaten üst sınırlıydı;
-- burada yalnızca ÜST SINIRI OLMAYAN alanlar tamamlanır. Mevcut satırlar
-- ASLA silinmez/kırpılmaz — CHECK yalnızca YENİ INSERT/UPDATE'lere uygulanır
-- (Postgres'in `check` kısıtı zaten bu şekilde çalışır: eklenirken yalnızca
-- MEVCUT satırlar doğrulanır, geriye dönük veri asla değiştirilmez; eğer
-- mevcut bir satır bu sınırı zaten aşıyorsa `alter table ... add constraint`
-- HATA VERİR — bu yüzden önce gerçek veriyi kontrol ediyoruz).
-- =============================================================================

do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count from public.jobs
    where recycling_quantity is not null and (recycling_quantity <= 0 or recycling_quantity > 999999);
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.recycling_quantity satırı yeni sınırın (0, 999999] dışında — CHECK eklenmeyecek, elle inceleyin.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_recycling_quantity_check;
    alter table public.jobs add constraint jobs_recycling_quantity_check
      check (recycling_quantity is null or (recycling_quantity > 0 and recycling_quantity <= 999999));
  end if;

  select count(*) into v_bad_count from public.jobs
    where storage_product_quantity is not null and (storage_product_quantity <= 0 or storage_product_quantity > 999999);
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.storage_product_quantity satırı yeni sınırın dışında — CHECK eklenmeyecek, elle inceleyin.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_storage_product_quantity_check;
    alter table public.jobs add constraint jobs_storage_product_quantity_check
      check (storage_product_quantity is null or (storage_product_quantity > 0 and storage_product_quantity <= 999999));
  end if;

  select count(*) into v_bad_count from public.jobs
    where storage_product_tonnage is not null and (storage_product_tonnage <= 0 or storage_product_tonnage > 999999);
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.storage_product_tonnage satırı yeni sınırın dışında — CHECK eklenmeyecek, elle inceleyin.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_storage_product_tonnage_check;
    alter table public.jobs add constraint jobs_storage_product_tonnage_check
      check (storage_product_tonnage is null or (storage_product_tonnage > 0 and storage_product_tonnage <= 999999));
  end if;
end $$;

-- =============================================================================
-- BÖLÜM 4 — Eksik dizi/JSONB uzunluk sınırları (görev: "Dizilere binlerce
-- eleman gönderilemesin"). Her dizinin İÇERİĞİ zaten ayrı assert_valid_*
-- fonksiyonları/trigger'larıyla katalog üyeliğine göre doğrulanıyor (bkz.
-- 0059/0068/0069) — burada eklenen SADECE eleman SAYISI üst sınırı, aynı
-- "elemanların hepsi geçerli ama binlerce kopya" saldırı yüzeyini kapatmak
-- için. Sınırlar gerçek kataloğun büyüklüğünün kayda değer üzerinde
-- (kataloglar 3-20 arası öğe taşıyor) tutuldu ki hiçbir meşru seçim
-- reddedilmesin.
-- =============================================================================

alter table public.jobs drop constraint if exists jobs_storage_risk_groups_length_check;
alter table public.jobs add constraint jobs_storage_risk_groups_length_check
  check (storage_risk_groups is null or array_length(storage_risk_groups, 1) <= 30);

alter table public.jobs drop constraint if exists jobs_recycling_hazard_properties_length_check;
alter table public.jobs add constraint jobs_recycling_hazard_properties_length_check
  check (recycling_hazard_properties is null or array_length(recycling_hazard_properties, 1) <= 30);

alter table public.jobs drop constraint if exists jobs_recycling_scope_of_work_length_check;
alter table public.jobs add constraint jobs_recycling_scope_of_work_length_check
  check (recycling_scope_of_work is null or array_length(recycling_scope_of_work, 1) <= 30);

alter table public.jobs drop constraint if exists jobs_customs_requested_services_length_check;
alter table public.jobs add constraint jobs_customs_requested_services_length_check
  check (customs_requested_services is null or array_length(customs_requested_services, 1) <= 30);

alter table public.jobs drop constraint if exists jobs_storage_container_groups_length_check;
alter table public.jobs add constraint jobs_storage_container_groups_length_check
  check (storage_container_groups is null or jsonb_array_length(storage_container_groups) <= 50);

alter table public.jobs drop constraint if exists jobs_nakliye_cargo_groups_length_check;
alter table public.jobs add constraint jobs_nakliye_cargo_groups_length_check
  check (nakliye_cargo_groups is null or jsonb_array_length(nakliye_cargo_groups) <= 50);

alter table public.provider_documents drop constraint if exists provider_documents_storage_activity_scopes_length_check;
alter table public.provider_documents add constraint provider_documents_storage_activity_scopes_length_check
  check (storage_activity_scopes is null or array_length(storage_activity_scopes, 1) <= 30);

alter table public.provider_documents drop constraint if exists provider_documents_imo_class_codes_length_check;
alter table public.provider_documents add constraint provider_documents_imo_class_codes_length_check
  check (imo_class_codes is null or array_length(imo_class_codes, 1) <= 30);

alter table public.provider_documents drop constraint if exists provider_documents_requested_storage_risk_groups_length_check;
alter table public.provider_documents add constraint provider_documents_requested_storage_risk_groups_length_check
  check (requested_storage_risk_groups is null or array_length(requested_storage_risk_groups, 1) <= 30);

alter table public.provider_documents drop constraint if exists provider_documents_requested_recycling_activities_length_check;
alter table public.provider_documents add constraint provider_documents_requested_recycling_activities_length_check
  check (requested_recycling_activities is null or array_length(requested_recycling_activities, 1) <= 30);

alter table public.provider_documents drop constraint if exists provider_documents_requested_recycling_waste_codes_length_check;
alter table public.provider_documents add constraint provider_documents_requested_recycling_waste_codes_length_check
  check (requested_recycling_waste_codes is null or array_length(requested_recycling_waste_codes, 1) <= 100);

-- =============================================================================
-- BÖLÜM 5 — location_url şema doğrulaması (bulunan gerçek XSS açığı: bu alan
-- doğrulama OLMADAN doğrudan `<a href>`ye yazılıyordu — bkz. proje raporu).
-- İstemci tarafı (job-form-validation.ts) BENZER bir kontrolü ayrıca uygular
-- (görev gereksinimi: aynı kural sunucu tarafında da olmalı) — bu, o
-- kontrolün RPC'yi bypass eden bir isteğe karşı sunucu tarafı YEDEĞİdir,
-- 0052'nin ensure_job_content_has_no_direct_contact_info'suyla AYNI ilke.
-- =============================================================================

create or replace function public.ensure_job_location_url_has_safe_scheme()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.location_url is not null and length(trim(new.location_url)) > 0
     and new.location_url !~* '^https?://' then
    raise exception 'ML162: location_url must start with http:// or https://' using errcode = 'ML162';
  end if;
  return new;
end;
$$;

comment on function public.ensure_job_location_url_has_safe_scheme() is
  '0073: jobs.location_url''in yalnızca http(s):// şemasıyla başlamasını zorunlu kılar — javascript:/data: gibi tehlikeli şemaların <a href>''e yazılmasını engeller.';

revoke all on function public.ensure_job_location_url_has_safe_scheme() from public, anon, authenticated;

drop trigger if exists trg_jobs_location_url_safe_scheme on public.jobs;
create trigger trg_jobs_location_url_safe_scheme
  before insert or update on public.jobs
  for each row execute function public.ensure_job_location_url_has_safe_scheme();

-- =============================================================================
-- BÖLÜM 6 — offers.description iletişim bilgisi sızıntısı koruması —
-- 0052'nin jobs.title/description trigger'ının AYNISI (aynı iki kalıp,
-- aynı muhafazakâr yaklaşım), yalnızca offers.description'a uygulanır.
-- Teklif açıklaması, ilan başlığı/açıklaması kadar (hatta ondan daha çok,
-- kabul öncesi karşı tarafça görüldüğü için) iletişim bilgisi kaçağına açık
-- bir alandı ve daha önce hiç korunmuyordu.
-- =============================================================================

create or replace function public.ensure_offer_content_has_no_direct_contact_info()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.description, '') ~* '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' then
    raise exception 'ML163: offer description may not contain an email address' using errcode = 'ML163';
  end if;
  if coalesce(new.description, '') ~ '(\+?\d[\s.\-]?){10,13}\d' then
    raise exception 'ML164: offer description may not contain a phone number' using errcode = 'ML164';
  end if;
  return new;
end;
$$;

comment on function public.ensure_offer_content_has_no_direct_contact_info() is
  '0073: offers.description''e yazılmış e-posta/telefon kalıplarını reddeder — 0052''nin ensure_job_content_has_no_direct_contact_info''sinin offers tablosundaki AYNI muhafazakâr karşılığı.';

revoke all on function public.ensure_offer_content_has_no_direct_contact_info() from public, anon, authenticated;

drop trigger if exists trg_offers_content_no_contact_info on public.offers;
create trigger trg_offers_content_no_contact_info
  before insert or update on public.offers
  for each row execute function public.ensure_offer_content_has_no_direct_contact_info();

-- =============================================================================
-- BÖLÜM 7 — Sistem Sağlığı: "Muhtemel Neden" otomatik, kural-tabanlı
-- çıkarımı (görev bölüm 16). report_system_error'ın DIŞ İMZASI DEĞİŞMEZ
-- (aynı 13 parametre, create or replace güvenlidir, drop/yeniden oluşturma
-- gerekmez) — yalnızca gövdesi genişletilir: (a) kendi rate limit'i eklenir,
-- (b) probable_cause/confidence/related_files/recommended_check kural
-- tabanlı doldurulur. Üçüncü taraf/ücretli bir yapay zekâ servisi YOK —
-- yalnızca hata_kodu/route/affected_action/source üzerinden basit bir CASE
-- eşlemesi. Kesin olmayan hiçbir çıkarım "yüksek güven" ETİKETİ ALMAZ.
-- =============================================================================

alter table public.system_error_logs add column if not exists recommended_check text;

comment on column public.system_error_logs.recommended_check is
  '0073: probable_cause''a eşlik eden, admin''in yapması önerilen somut bir sonraki adım — kural tabanlı, report_system_error() içinde hesaplanır.';

create or replace function public.report_system_error(
  p_message text,
  p_source text,
  p_error_code text default null,
  p_route text default null,
  p_affected_screen text default null,
  p_affected_action text default null,
  p_source_file text default null,
  p_function_name text default null,
  p_line_number integer default null,
  p_stack_excerpt text default null,
  p_request_id text default null,
  p_evidence jsonb default null,
  p_environment text default 'development'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_severity text;
  v_fingerprint text;
  v_id uuid;
  v_status text;
  v_message text;
  v_stack text;
  v_probable_cause text;
  v_confidence text;
  v_related_files jsonb;
  v_recommended_check text;
begin
  if auth.uid() is null then
    raise exception 'ML150: authentication required' using errcode = 'ML150';
  end if;
  if p_source not in ('client', 'server') then
    raise exception 'ML151: source must be client or server' using errcode = 'ML151';
  end if;

  -- 0073: kendi rate limit'i — bir hata döngüsünün (ör. bozuk bir sayfa
  -- her render'da yeniden fırlatıp raporluyorsa) bu tabloyu/audit zincirini
  -- spam aracına ÇEVİRMEMESİ için (görev gereksinimi: "hata kayıtlarının
  -- kendisi spam aracı olmasın"). Aynı fingerprint zaten occurrence_count
  -- ile GRUPLANDIĞI için bu, farklı/yeni hataların art arda patlaması gibi
  -- daha nadir bir senaryoya karşı ikinci bir savunma katmanıdır.
  perform public.check_rate_limit('report_system_error', 100, 3600);

  -- Payload boyutu sınırlanır (görev gereksinimi — istemci büyük stack/
  -- mesaj gönderemesin diye).
  v_message := left(coalesce(nullif(trim(p_message), ''), 'Bilinmeyen hata'), 500);
  v_stack := left(p_stack_excerpt, 2000);

  select role into v_role from public.profiles where id = auth.uid();

  -- Ciddiyet sınıflandırması SUNUCU tarafındadır (görev gereksinimi:
  -- "İstemcinin kendi rolünü veya kritiklik seviyesini sahte biçimde
  -- belirlemesine izin verme"). Bilinen/beklenen yetki reddi kodları asla
  -- kritik sayılmaz (görev gereksinimi madde 11/13) — 'info' seviyesine
  -- düşer, tamamen ATILMAZ (görünürlük korunur, yalnızca ciddiyeti düşük).
  v_severity := case
    when p_error_code in (
      'ML125', 'ML126', 'ML127',                  -- assert_active_user (askıya alınmış hesap)
      'MLK60', 'MLK98',                             -- kategori/kapsam yetkisizliği, iletişim zorunluluğu
      'ML115', 'ML116', 'ML117', 'ML118',           -- admin ilan moderasyonu concurrency
      'ML161'                                       -- rate limit aşımı (kendisi zaten korumanın çalıştığının kanıtı, kritik DEĞİL)
    ) then 'info'
    when p_affected_action in (
      'create_offer', 'accept_offer', 'create_job', 'create_operation_with_jobs',
      'review_provider_document', 'authorize_provider_service', 'update_job_as_requester'
    ) then 'critical'
    when p_source = 'server' then 'high'
    else 'high'
  end;

  -- MUHTEMEL NEDEN — kural tabanlı, üçüncü taraf servis YOK. Yalnızca
  -- ELİMİZDEKİ somut sinyallerden (hata kodu/kaynak/işlem) çıkarım yapılır;
  -- eşleşen bir kural yoksa NULL bırakılır ("yeterli bilgi yok" dürüst
  -- boş durumu, admin-system-health-content.tsx'in zaten gösterdiği).
  v_probable_cause := null;
  v_confidence := null;
  v_recommended_check := null;

  if p_error_code in ('ML125', 'ML126', 'ML127') then
    v_probable_cause := 'Kullanıcının oturumu geçersiz veya hesabı askıya alınmış (assert_active_user() reddi).';
    v_confidence := 'yuksek';
    v_recommended_check := 'Kullanıcının profiles.account_status değerini ve Supabase Auth oturumunun geçerliliğini kontrol edin.';
  elsif p_error_code = 'PGRST203' then
    v_probable_cause := 'Aynı isimde birden fazla RPC overload''ı PostgREST''in hangisini çağıracağına karar verememesine yol açıyor (eski/stale bir overload silinmemiş).';
    v_confidence := 'yuksek';
    v_recommended_check := 'pg_proc üzerinde bu fonksiyonun kaç overload''ı olduğunu kontrol edin (bkz. 0032-0034''ün aynı deseni) ve eskisini drop function ile kaldırın.';
  elsif p_error_code = '23505' then
    v_probable_cause := 'Bir benzersizlik (unique) kısıtı ihlal edildi — muhtemelen bir çift-gönderim/yarış durumu ya da idempotent yeniden deneme.';
    v_confidence := 'orta';
    v_recommended_check := 'İlgili tablodaki unique index''i ve bu işlemin çift-tıklama/yarış korumasını (submitLockRef, RPC''nin kendi idempotency kontrolü) gözden geçirin.';
  elsif p_error_code = '23503' then
    v_probable_cause := 'Bir yabancı anahtar (foreign key) kısıtı ihlal edildi — referans verilen kayıt bulunamadı veya silinmiş olabilir.';
    v_confidence := 'orta';
  elsif p_error_code = '22P02' then
    v_probable_cause := 'RPC''ye beklenen türde olmayan bir değer gönderildi (geçersiz metin/UUID/enum biçimi).';
    v_confidence := 'orta';
    v_recommended_check := 'İstemcinin gönderdiği parametre değerlerini ve RPC''nin beklediği türleri karşılaştırın.';
  elsif p_error_code = 'ML161' then
    v_probable_cause := 'Bu kullanıcı/kaynak için rate limit aşıldı — normal kullanım mı yoksa otomatikleştirilmiş bir kötüye kullanım denemesi mi olduğu ayrıca değerlendirilmeli.';
    v_confidence := 'yuksek';
    v_recommended_check := 'Aynı subject_key için kısa sürede kaç istek geldiğini rate_limit_counters''tan inceleyin; gerçekten meşru bir yoğun kullanım ise ilgili trigger''daki p_max_count değerini artırmayı değerlendirin.';
  elsif p_source = 'client' and p_error_code is null then
    v_probable_cause := 'İstemci tarafında yakalanmamış bir JavaScript hatası — olası bir null/undefined referans veya beklenmeyen veri şekli.';
    v_confidence := 'dusuk';
    v_recommended_check := 'stack_excerpt alanındaki dosya/satır bilgisini ve affected_screen''i inceleyerek ilgili bileşeni gözden geçirin.';
  elsif p_source = 'server' and p_error_code is null then
    v_probable_cause := 'Sunucu tarafında sınıflandırılmamış bir hata.';
    v_confidence := 'dusuk';
  end if;

  -- İLGİLİ KAYNAK — p_source_file verilmişse aynen kullanılır; yoksa
  -- bilinen affected_action -> dosya eşlemesinden en iyi tahmin üretilir
  -- (yine yalnızca bir İPUCU, kesin bir iddia DEĞİL).
  v_related_files := case
    when p_source_file is not null then jsonb_build_array(p_source_file)
    when p_affected_action = 'create_job' then jsonb_build_array('app/_lib/supabase-job-sync.ts')
    when p_affected_action = 'create_operation_with_jobs' then jsonb_build_array('app/_lib/supabase-job-sync.ts')
    when p_affected_action = 'create_offer' then jsonb_build_array('app/_lib/supabase-offer-sync.ts', 'app/_lib/offers.ts')
    when p_affected_action = 'accept_offer' then jsonb_build_array('app/_lib/supabase-offer-sync.ts', 'app/_lib/offers.ts')
    when p_affected_action = 'review_provider_document' then jsonb_build_array('app/_lib/supabase-provider-document-review.ts')
    when p_affected_action = 'authorize_provider_service' then jsonb_build_array('app/_lib/admin-companies.ts')
    when p_affected_action = 'update_job_as_admin' then jsonb_build_array('app/_lib/admin-jobs.ts')
    else null
  end;

  v_fingerprint := md5(
    coalesce(p_error_code, '') || '|' || p_source || '|' ||
    coalesce(p_route, '') || '|' || coalesce(p_affected_action, '') || '|' ||
    left(v_message, 120)
  );

  select id, status into v_id, v_status
  from public.system_error_logs
  where fingerprint = v_fingerprint;

  if v_id is not null then
    update public.system_error_logs
    set occurrence_count = occurrence_count + 1,
        last_seen_at = now(),
        status = case when v_status = 'cozuldu' then 'yeni' else v_status end,
        resolved_at = case when v_status = 'cozuldu' then null else resolved_at end,
        resolved_by = case when v_status = 'cozuldu' then null else resolved_by end,
        -- Yeni oluşumda evidence/route/screen güncel bilgiyle tazelenir —
        -- ilk görülme (first_seen_at) hiç değişmez.
        route = coalesce(p_route, route),
        affected_screen = coalesce(p_affected_screen, affected_screen),
        stack_excerpt = coalesce(v_stack, stack_excerpt),
        evidence = coalesce(p_evidence, evidence),
        probable_cause = coalesce(v_probable_cause, probable_cause),
        confidence = coalesce(v_confidence, confidence),
        related_files = coalesce(v_related_files, related_files),
        recommended_check = coalesce(v_recommended_check, recommended_check)
    where id = v_id;
    return v_id;
  end if;

  insert into public.system_error_logs (
    fingerprint, severity, error_code, message, source, route,
    affected_screen, affected_role, affected_action, environment,
    source_file, function_name, line_number, request_id, stack_excerpt,
    reported_by, evidence, probable_cause, confidence, related_files, recommended_check
  ) values (
    v_fingerprint, v_severity, p_error_code, v_message, p_source, p_route,
    p_affected_screen, v_role, p_affected_action, coalesce(nullif(p_environment, ''), 'development'),
    p_source_file, p_function_name, p_line_number, p_request_id, v_stack,
    auth.uid(), p_evidence, v_probable_cause, v_confidence, v_related_files, v_recommended_check
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) is
  '0073: Herhangi bir kimliği doğrulanmış kullanıcının kendi tarayıcısında/isteğinde gördüğü GERÇEK bir hatayı bildirir. Ciddiyet VE muhtemel neden/güven/önerilen kontrol SUNUCU tarafında kural-tabanlı sınıflandırılır, istemciden kabul edilmez. Kendi rate limit''i vardır (100/saat). Aynı fingerprint tekrar geldiğinde occurrence_count artar, çözülmüş kayıt varsa yeniden açılır.';

revoke all on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) from public, anon;
grant execute on function public.report_system_error(text, text, text, text, text, text, text, text, integer, text, text, jsonb, text) to authenticated;
