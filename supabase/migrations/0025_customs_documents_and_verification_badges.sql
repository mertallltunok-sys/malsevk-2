-- =============================================================================
-- MALSEVK — Faz 1 migration 0025: Gümrük destekleyici belgeleri (job_customs_
--           documents) + genişletilebilir hizmet veren doğrulama rozetleri
--           (badge_types / provider_badges)
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri, 0001-0024'e EK (hiçbiri değiştirilmedi).
--
-- KÖKEN: "Mimari rapor onaylandı" görevinin 8 kesinleşmiş ürün kararından
-- doğrudan bu migration'a giren dört tanesi:
--   #1 Gümrük destekleyici belgeleri tamamen gizli (yalnız ilan sahibi + admin).
--   #4 Retired gümrük alanları (customsOfficeId/customsGtipCode/
--      customsDeclarationItemCount/customsContainerCount) yeni şemaya
--      TAŞINMAZ — bu migration onları hiçbir tabloya/koluna eklemez (bkz.
--      Bölüm 1 sonu).
--   #6 Hizmet veren doğrulama rozetleri: Mavi Tik (admin onaylı zorunlu firma
--      belgeleri) + Altın Tik (ileride performans kurallarına göre, SATIN
--      ALINAMAZ) — genişletilebilir bir katalog+atama tablosu çifti olarak.
--   #7 Firma belgeleri (provider_documents, 0007) ile operasyon/ilan belgeleri
--      (bu dosyanın job_customs_documents'ı) HİÇBİR noktada karışmaz — ayrı
--      tablo, ayrı bucket (0026), ayrı RLS, ayrı RPC seti.
--   #8 (yalnız dokümantasyon): gelecekteki admin panelinin firma bazlı
--      yönetim ekranı (Firma Bilgileri/Belgeler/Belge Geçmişi/Rozet Durumu/
--      Hizmetleri/İş Geçmişi/Şikayetler) için gerekli TÜM tablolar zaten
--      provider_id/job_id üzerinden bire bir sorgulanabilir durumda —
--      profiles+provider_profiles (Firma Bilgileri), provider_documents
--      (Belgeler), provider_document_reviews (Belge Geçmişi), provider_badges
--      (Rozet Durumu, bu dosya), provider_services (Hizmetleri), jobs/offers
--      (İş Geçmişi). "Şikayetler" için kaynak uygulamada karşılığı olan bir
--      özellik/tablo YOK — bu migration icat etmez, gelecekteki gerçek bir
--      şikayet özelliği tanımlandığında ayrı bir migration'ın konusu olur.
--      Admin panelinin KENDİSİ bu görevin kapsamı DIŞINDA bırakılmıştır —
--      hiçbir UI/route dosyası bu migration'ın parçası değildir.
--
-- BİLEREK BU MİGRASYONUN DIŞINDA (kullanıcıyla netleştirildi): Karar #2
-- (Offer senkronizasyonunda referans job Supabase'te yoksa erteleme) ve
-- Karar #3 (hiç geri dönmeyen kullanıcıların localStorage verisi taşınmaz) —
-- ikisi de localStorage→Supabase Job/Offer senkronizasyon sistemi için genel
-- ilkelerdir; bugün 0001-0024'ün hiçbirinde herhangi bir sync/legacy_id
-- altyapısı YOK, bu yüzden bu ilkelerin somut şema/RPC karşılığı AYRI, daha
-- sonraki bir görevin konusudur. Bu dosya hiçbir sync tablosu/RPC'si içermez.
--
-- "Operasyon" terim uyarısı: Karar #7'nin "operasyon belgeleri" ifadesi,
-- şemanın KENDİ `operations` tablosuyla (Çoklu Hizmet Operasyonu başlık
-- satırı, 0004) KARIŞTIRILMAMALI — kaynak uygulamada customsDocuments her
-- zaman TEK bir `Job`a (Gümrük Müşavirliği kategorili) bağlıdır, bir
-- `operations` grubunun tamamına değil (bkz. CLAUDE.md "Gümrük Müşavirliği
-- Operasyon Bilgileri": "yalnızca Gümrük Müşavirliği hizmet kartı bu
-- alanları taşır — asla kardeş hizmetlere kopyalanmaz"). Bu yüzden aşağıdaki
-- tablo `public.jobs (id)`e FK'lidir, `public.operations`a değil.
--
-- Hata kodu aralığı: KASITLI OLARAK TEKRAR KULLANILAN beş kod — MLK50 (admin
-- gerekli), MLK56 (ilan sahibi değil), MLK76 (kayıt bulunamadı), MLK80
-- (storage_path kendi klasörünüzde olmalı), MLK81 (aynı türden zaten aktif
-- bir kayıt var, unique_violation) — 0023'ün kendi ilkesiyle birebir aynı:
-- "kavramsal olarak var olan hatalarla AYNI anlamdaki durumlar ... var olan
-- kodu tekrar kullanır". YENİ dört kod: ML104-107 — "MLK" ÖNEKİYLE DEĞİL,
-- 0022'nin kendi düzeltmesiyle AYNI "ML" (K'siz) önekiyle: Postgres
-- SQLSTATE'ler TAM 5 karakter olmalıdır; "MLK101" 6 karakterdir ve PL/pgSQL
-- bunu geçersiz/tanınmayan bir "exception condition" (42704) olarak reddeder
-- — bu migration'ın kendi yerel Docker güvenlik regresyon testi (scripts/
-- test-customs-documents-and-badges.mjs) bunu GERÇEK bir çalışma zamanı
-- hatası olarak buldu (0022'nin ML100-103 hatasıyla BİREBİR aynı kök neden —
-- bkz. o dosyanın kendi başlık notu). "ML" + 3 basamak tam 5 karakterdir;
-- 0022'nin ML100-103'üyle çakışmaz (ML104'ten başlar).
-- =============================================================================


-- =============================================================================
-- BÖLÜM 1 — job_customs_documents
-- =============================================================================
-- job_photos (0004) ile AYNI "yalnızca metadata, dosya Storage'da" deseni,
-- ama görünürlük provider_documents (0007) gibi ÖZEL (owner+admin) —
-- job_photos'un "herkese açık" (public bucket, herkes görür) görünürlüğüyle
-- KARIŞTIRILMAMALI. Karar #1'in tam gereksinimi: "Teklif veren, işi alan
-- hizmet veren veya diğer kullanıcılar bu belgeleri hiçbir durumda göremez" —
-- bu yüzden RLS'de is_engaged_offer_access/is_offer_provider gibi hiçbir
-- "karşı taraf" dalı YOK, yalnızca is_job_owner() veya is_admin().
create table if not exists public.job_customs_documents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  extension text not null
    check (extension in ('pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15 * 1024 * 1024),
  uploaded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.job_customs_documents is
  'Metadata only — file lives in Supabase Storage (job-customs-documents bucket, private, 0026). Mirrors app/_lib/customs-brokerage-catalog.ts#CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS (extension CHECK) and document-validation.ts#MAX_DOCUMENT_SIZE_BYTES (15 MB, size_bytes CHECK) exactly. FK is to jobs (a single Gümrük Müşavirliği job), never to operations — see file header "Operasyon terim uyarısı".';
comment on column public.job_customs_documents.extension is
  'Karar #4: yalnızca güncel/aktif alanlar için bir belge listesi — customsOfficeId/customsGtipCode/customsDeclarationItemCount/customsContainerCount (retired) bu tabloda veya başka hiçbir yeni kolonda YOKTUR ve bu migration onları hiçbir yere eklemez.';

-- Karar #1: kesinlikle "to anon" YOK, "to authenticated" bile yalnız RLS
-- politikasının izin verdiği satırları görür (owner veya admin) — bkz.
-- 0013_rls_policies.sql'in provider_documents_select_own_or_admin ile AYNI
-- kalıbı, yalnızca "provider" yerine "job" sahipliği.
revoke all on public.job_customs_documents from authenticated, anon;
grant select on public.job_customs_documents to authenticated;
-- current_review_status benzeri bir inceleme alanı YOK (Karar #1 yalnızca
-- görünürlük istiyor, bir onay/red akışı istemiyor) — INSERT/soft-DELETE
-- yalnızca aşağıdaki iki RPC üzerinden.

alter table public.job_customs_documents enable row level security;

drop policy if exists job_customs_documents_select_own_or_admin on public.job_customs_documents;
create policy job_customs_documents_select_own_or_admin on public.job_customs_documents
  for select to authenticated
  using (
    (deleted_at is null and public.is_job_owner(job_id))
    or public.is_admin()
  );

comment on policy job_customs_documents_select_own_or_admin on public.job_customs_documents is
  'Karar #1''in TAM karşılığı: is_job_owner() (0012, yalnız jobs.requester_id = auth.uid()) veya is_admin() — is_engaged_offer_access()/is_offer_provider() gibi HİÇBİR karşı-taraf dalı yok. Teklif veren, işi alan hizmet veren dahil hiçbir üçüncü taraf bu satırları HİÇBİR ZAMAN göremez. `deleted_at is null` filtresi YALNIZ sahip (is_job_owner) dalına uygulanır — is_admin() dalı KASITLI OLARAK bu filtrenin dışındadır, böylece bir admin soft-delete edilmiş bir belgenin geçmişini de inceleyebilir (normal kullanıcı sorgularında görünmez, admin geçmişi görebilir).';

-- -----------------------------------------------------------------------------
-- create_job_customs_document
-- -----------------------------------------------------------------------------
create or replace function public.create_job_customs_document(
  p_job_id uuid,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_extension text,
  p_size_bytes bigint
)
returns public.job_customs_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_row public.job_customs_documents;
begin
  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;

  -- Karar #7: yalnızca Gümrük Müşavirliği kategorili ilanlar bu belgeleri
  -- taşıyabilir — mirrors job-store.ts#isCustomsBrokerageCategory gating
  -- (CLAUDE.md "Gümrük Müşavirliği Operasyon Bilgileri").
  if v_job.category_id <> 'gumruk-musavirligi' then
    raise exception 'ML104: customs documents may only be attached to a gumruk-musavirligi job' using errcode = 'ML104';
  end if;

  -- Savunma derinliği: create_provider_document (0023) ile AYNI gerekçe —
  -- Storage RLS (0026) yükleme ANINDA zaten yalnız auth.uid() klasörüne
  -- yazılmasını zorunlu kılar, ama bu ayrı bir RPC çağrısıdır.
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;

  insert into public.job_customs_documents
    (job_id, storage_path, original_file_name, mime_type, extension, size_bytes, uploaded_by)
  values
    (p_job_id, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_job_customs_document(uuid, text, text, text, text, bigint) is
  'job_customs_documents icin TEK yazma yolu. job_id CAGIRANIN KENDI ilanina ait olmali (jobs.requester_id = auth.uid(), MLK56) VE o ilan gumruk-musavirligi kategorisinde olmali (ML104). extension gecersizse tablo CHECK kisiti standart 23514 ile reddeder (0023''un ayni precedent''i, yeni kod icat edilmedi).';

revoke all on function public.create_job_customs_document(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.create_job_customs_document(uuid, text, text, text, text, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_job_customs_document
-- -----------------------------------------------------------------------------
create or replace function public.delete_job_customs_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select j.requester_id into v_owner
  from public.job_customs_documents d
  join public.jobs j on j.id = d.job_id
  where d.id = p_document_id and d.deleted_at is null;

  if v_owner is null then
    -- review_provider_document'in (0016/0024) "document not found" ile AYNI
    -- kod: MLK76, farkli tablo/mesaj ama ayni anlam ("bu id'de bir kayit yok").
    raise exception 'MLK76: customs document not found' using errcode = 'MLK76';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'MLK56: not the owner of this job' using errcode = 'MLK56';
  end if;

  update public.job_customs_documents set deleted_at = now() where id = p_document_id;
end;
$$;

comment on function public.delete_job_customs_document(uuid) is
  'Soft delete (deleted_at) — job_photos/provider_documents ile ayni "hicbir satir fiziksel silinmez" deseni. Yalniz ilgili ilanin sahibi silebilir.';

revoke all on function public.delete_job_customs_document(uuid) from public, anon;
grant execute on function public.delete_job_customs_document(uuid) to authenticated;


-- =============================================================================
-- BÖLÜM 2 — badge_types: genişletilebilir rozet kataloğu
-- =============================================================================
-- service_categories (0002) ile AYNI "code-first bugun, DB-first yarin"
-- felsefesi degil -- burada TABLO GUNDEN ITIBAREN tek dogruluk kaynagidir
-- (rozet turleri kodda sabit degil), cunku Karar #6 acikca "genisletilebilir"
-- istiyor: yeni bir rozet turu ileride yalniz bir INSERT ile eklenir, yeni
-- bir migration/CHECK degisikligi GEREKMEZ.
create table if not exists public.badge_types (
  id text primary key,
  label text not null,
  description text,
  -- Karar #6: Altın Tik SATIN ALINAMAZ. is_purchasable bugün HER İKİ satır
  -- için de false — bu kolon yalnızca ileride gerçekten satın alınabilir bir
  -- rozet türü eklenirse (bugün YOK, hiçbir RPC bunu kullanmıyor) o türü
  -- ayırt etmek için hazır bırakılmıştır; kendi başına hiçbir satın alma
  -- akışını etkinleştirmez.
  is_purchasable boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.badge_types is
  'Genişletilebilir rozet kataloğu (Karar #6) — yeni bir rozet türü yalnızca bir INSERT ile eklenir, provider_badges.badge_type_id onu FK ile otomatik kabul eder. Bugün iki satır: mavi-tik (admin onaylı zorunlu firma belgeleri), altin-tik (ileride eklenecek performans kriterleri, satın alınamaz).';

insert into public.badge_types (id, label, description, is_purchasable, sort_order) values
  ('mavi-tik', 'Mavi Tik', 'Zorunlu firma belgeleri (Faaliyet Belgesi/Raporu, provider_documents) admin tarafından onaylanmış hizmet veren.', false, 1),
  ('altin-tik', 'Altın Tik', 'İleride eklenecek performans kriterlerine göre verilir (bugün hiçbir otomatik kriter/RPC tanımlı değildir). Satın alınamaz.', false, 2)
on conflict (id) do nothing;

revoke all on public.badge_types from authenticated, anon;
-- Karar #6/#8: rozetler bir güven/doğrulama sinyalidir, provider_profiles'ın
-- kendisinden (yalnız "to authenticated", bkz. 0013) daha kısıtlı OLMAMALI
-- ama bu görev kapsamında herkese açık bir "hizmet veren dizini" ekranı da
-- yok — en dar tutarlı seçim: yalnız authenticated (anon değil), tıpkı
-- provider_profiles/provider_documents gibi. Gelecekte genel bir kamuya açık
-- vitrine ihtiyaç olursa (public_provider_profiles, 0017, benzeri) bu ayrı
-- bir view ile açılır, taban RLS burada DEĞİŞMEZ.
grant select on public.badge_types to authenticated, anon;

alter table public.badge_types enable row level security;
drop policy if exists badge_types_select_all on public.badge_types;
create policy badge_types_select_all on public.badge_types
  for select to authenticated, anon
  using (true);

comment on policy badge_types_select_all on public.badge_types is
  'Katalog kendisi hassas değil (service_categories, 0013 ile aynı gerekçe) — herkese açık. Kimin HANGİ rozete SAHİP olduğu (provider_badges, aşağıda) ayrı ve daha kısıtlı bir politikaya tabidir.';

-- =============================================================================
-- BÖLÜM 3 — provider_badges: atama tablosu
-- =============================================================================
create table if not exists public.provider_badges (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  badge_type_id text not null references public.badge_types (id),

  granted_at timestamptz not null default now(),
  granted_by uuid not null references public.profiles (id),
  grant_reason text,

  -- Satır asla silinmez, yalnızca revoked_at damgalanır (provider_documents'ın
  -- 'superseded' tarihçe ilkesiyle AYNI ruh) — bir rozetin ne zaman
  -- kazanıldığı/kaybedildiği tam tarihçesi hep sorgulanabilir kalır.
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  constraint provider_badges_revoked_fields_consistent
    check ((revoked_at is null) = (revoked_by is null)),

  updated_at timestamptz not null default now()
);

comment on table public.provider_badges is
  'Bir provider''ın kazandığı/kaybettiği rozetlerin tam tarihçesi. revoked_at IS NULL = şu an aktif. Aynı (provider_id, badge_type_id) için birden fazla satır olabilir (revoke sonrası yeniden verilme) — bkz. provider_badges_one_active_per_type kısmi indeksi (yalnız AKTİF satırları kısıtlar).';
comment on column public.provider_badges.granted_by is
  'Karar #6: bugün TEK yazma yolu grant_provider_badge() (aşağıda), admin-only — otomatik/performans-tabanlı bir gelecekteki Altın Tik verme mekanizması (varsa) ayrı bir SECURITY DEFINER fonksiyon olarak eklenir, bu tabloyu DEĞİŞTİRMEZ.';

drop trigger if exists trg_provider_badges_set_updated_at on public.provider_badges;
create trigger trg_provider_badges_set_updated_at
  before update on public.provider_badges
  for each row execute function public.set_updated_at();

create unique index if not exists provider_badges_one_active_per_type
  on public.provider_badges (provider_id, badge_type_id)
  where revoked_at is null;

comment on index public.provider_badges_one_active_per_type is
  'provider_documents_one_pending_per_provider_type (0024) ile AYNI teknik: bir provider + rozet türü için aynı anda en fazla bir AKTİF satır, veritabanı seviyesinde (TOCTOU''ya kapalı). grant_provider_badge (aşağıda) bu indeksin unique_violation''ını MLK81''e çevirir (0024''ün AYNI kodu, farklı tablo).';

revoke all on public.provider_badges from authenticated, anon;
grant select on public.provider_badges to authenticated;
-- INSERT/UPDATE(revoke) yalnızca grant_provider_badge()/revoke_provider_badge()
-- üzerinden (aşağıda), ikisi de admin-only.

alter table public.provider_badges enable row level security;

drop policy if exists provider_badges_select_own_or_admin on public.provider_badges;
create policy provider_badges_select_own_or_admin on public.provider_badges
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

comment on policy provider_badges_select_own_or_admin on public.provider_badges is
  'provider_profiles_select_own_or_admin (0013) ile AYNI kısıt seviyesi. Bir counterparty''nin rozeti görebilmesi (ör. teklif ekranında "Mavi Tik" ikonu) gerekirse bu, public_provider_profiles (0017) benzeri AYRI bir view''dan sağlanır — bu görev kapsamında böyle bir view eklenmedi (Karar #8''in "admin paneli bu görevde geliştirilmeyecek" kısıtıyla aynı ölçülü kapsam).';

-- -----------------------------------------------------------------------------
-- grant_provider_badge
-- -----------------------------------------------------------------------------
create or replace function public.grant_provider_badge(
  p_provider_id uuid,
  p_badge_type_id text,
  p_reason text default null
)
returns public.provider_badges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_badges;
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  -- record_provider_document_consent'in (0007) "invalid statement_id" ile AYNI
  -- kod: MLK94, farkli parametre ama ayni anlam ("gecersiz/bilinmeyen
  -- kategorik id").
  if not exists (select 1 from public.badge_types where id = p_badge_type_id) then
    raise exception 'MLK94: unknown badge_type_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_badges.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;

  begin
    insert into public.provider_badges (provider_id, badge_type_id, granted_by, grant_reason)
    values (p_provider_id, p_badge_type_id, auth.uid(), nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  exception when unique_violation then
    -- provider_badges_one_active_per_type ihlali (yukarıda) — create_provider_
    -- document'in (0024) MLK81'i ile AYNI kod (ayni "bu turden zaten aktif bir
    -- kayit var" durumu, farkli tablo).
    raise exception 'MLK81: this provider already has an active badge of this type' using errcode = 'MLK81';
  end;

  perform public.log_audit_event('grant_provider_badge', 'provider_badges', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'badge_type_id', p_badge_type_id));

  return v_row;
end;
$$;

comment on function public.grant_provider_badge(uuid, text, text) is
  'Karar #6: Mavi Tik bugün YALNIZ bu admin-only RPC ile verilir (is_admin() zorunlu) — provider_documents onayına otomatik bağlı bir tetikleyici KASITLI OLARAK eklenmedi (Karar #6''nın kendi cümlesi "Admin tarafından ... onaylanmış" bir ADMIN KARARINI tarif ediyor, otomatik bir yan etkiyi değil; gelecekteki admin paneli, Karar #8''in kendi kapsamı, bu RPC''yi çağıracak somut UI''dır).';

revoke all on function public.grant_provider_badge(uuid, text, text) from public, anon;
grant execute on function public.grant_provider_badge(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- revoke_provider_badge
-- -----------------------------------------------------------------------------
create or replace function public.revoke_provider_badge(
  p_provider_id uuid,
  p_badge_type_id text,
  p_reason text default null
)
returns public.provider_badges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_badges;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML107: a reason is required to revoke a badge' using errcode = 'ML107';
  end if;

  update public.provider_badges
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
    where provider_id = p_provider_id and badge_type_id = p_badge_type_id and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'ML105: no active badge of this type to revoke' using errcode = 'ML105';
  end if;

  perform public.log_audit_event('revoke_provider_badge', 'provider_badges', v_row.id,
    jsonb_build_object('revoked_at', null), jsonb_build_object('provider_id', p_provider_id, 'badge_type_id', p_badge_type_id));

  return v_row;
end;
$$;

comment on function public.revoke_provider_badge(uuid, text, text) is
  'review_provider_document''un (0016/0024) "reddetme/revizyon için not zorunlu" ilkesiyle AYNI: bir rozeti geri almak her zaman bir gerekçe metni ister (ML107). Satır SİLİNMEZ, yalnızca revoked_at/revoked_by/revoke_reason damgalanır — tarihçe kalıcıdır.';

revoke all on function public.revoke_provider_badge(uuid, text, text) from public, anon;
grant execute on function public.revoke_provider_badge(uuid, text, text) to authenticated;


-- =============================================================================
-- BÖLÜM 4 — provider_profiles.verification_status ile ilişki (yalnız yorum)
-- =============================================================================
-- 0003'ün kendi verification_status kolonu ("Not read/written by any Faz 1
-- RPC today — a future admin verify_provider() capability was designed but
-- deferred") artık bu migration ile GERÇEK bir karşılığa kavuştu: badge_types/
-- provider_badges. Kolonun KENDİSİ (tip/CHECK/varsayılan) hiç değişmedi —
-- yalnızca gelecekteki okuyucuların iki mekanizmayı KARIŞTIRMAMASI için
-- açıklaması güncellenir. Hiçbir RPC/RLS bu kolonu hâlâ okumaz/yazmaz.
comment on column public.provider_profiles.verification_status is
  'Faz 1''in hiçbir RPC''si bunu hâlâ okumuz/yazmıyor. 0025''ten itibaren gerçek doğrulama sinyali badge_types/provider_badges''tır (''mavi-tik'' rozeti = admin onaylı zorunlu firma belgeleri) — bu kolon yalnızca geriye dönük şema-referansı/tarihçe amacıyla korunuyor, yeni kod bu kolonu DEĞİL badge sistemini okumalı.';
-- =============================================================================
