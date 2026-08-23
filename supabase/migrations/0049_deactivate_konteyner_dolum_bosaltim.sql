-- =============================================================================
-- MALSEVK — migration 0049: Konteyner Dolum/Boşaltım hizmetini pasifleştirme
-- =============================================================================
-- AMAÇ: "Development Temizliği, 16 Demo Hizmet Veren Hesabı ve Konteyner
-- Hizmetinin Kaldırılması" görevinin Faz 1'i — Konteyner Dolum/Boşaltım
-- (konteyner-dolum-bosaltim) artık kullanıcıya görünen 17. hizmet değil,
-- platformun sunduğu 16 hizmetten biri değil. Görev talimatı açık: bu
-- kategoriye bağlı geçmiş veri varsa `service_categories` satırı FİZİKSEL
-- OLARAK SİLİNMEZ, yalnızca aktif kataloğdan pasifleştirilir — bu migration
-- SADECE bunu yapar (Faz 2'nin kendi ayrı, onaylı temizlik işlemi bu
-- kategoriye bağlı TEK ilanı zaten fiziksel olarak sildi; bu migration'dan
-- önce provider_services/provider_service_authorizations/provider_documents
-- tarafında bu kategoriye referans veren SIFIR satır kalmıştı — bkz. Faz 0
-- dry-run envanteri).
--
-- BÖLÜM 1 (is_active=false) tek başına YETERSİZ: service_categories.is_active
-- hiçbir RPC/RLS/FK tarafından bugüne kadar OKUNMUYORDU (0002'nin kendi
-- başlığı: "Source of truth is still app/_lib/service-catalog.ts (code) at
-- cutover time" — provider_services/jobs/provider_service_authorizations/
-- provider_documents'in service_categories(id)'e FK'si yalnızca "id var mı"
-- kontrol eder, "is_active mi" değil). Görev talimatı "Backend aktif olmayan
-- kategori için yeni kayıt kabul etmemeli" diyor — bu yüzden BÖLÜM 2, tek bir
-- paylaşılan trigger fonksiyonuyla (ikinci bir doğrulama sistemi İCAT
-- EDİLMEDİ — mevcut trigger-tabanlı doğrulama deseninin AYNEN devamı, bkz.
-- ensure_job_requester_is_hizmet_alan/ensure_offer_provider_is_hizmet_veren)
-- dört tabloya (jobs/provider_services/provider_documents/provider_service_
-- authorizations) gerçek bir DB-seviyeli engel ekliyor — RPC'yi bypass eden
-- doğrudan bir INSERT bile artık pasif bir kategoriyi kabul edemez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — service_categories.is_active = false
-- -----------------------------------------------------------------------------
update public.service_categories
set is_active = false
where id = 'konteyner-dolum-bosaltim' and is_active = true;

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — paylaşılan trigger: pasif kategoriye yeni yazım engeli
-- -----------------------------------------------------------------------------
create or replace function public.ensure_service_category_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id text;
  v_is_active boolean;
begin
  if tg_table_name in ('provider_documents', 'provider_service_authorizations') then
    v_category_id := new.service_category_id;
  else
    v_category_id := new.category_id;
  end if;

  -- provider_documents.service_category_id nullable (genel/gruplu belge) —
  -- NULL her zaman geçerlidir, bu trigger yalnızca DOLU bir kategori id'si
  -- pasifse engeller.
  if v_category_id is null then
    return new;
  end if;

  select is_active into v_is_active from public.service_categories where id = v_category_id;
  if v_is_active is false then
    raise exception 'ML128: service category % is no longer active and cannot be used for new records', v_category_id
      using errcode = 'ML128';
  end if;

  return new;
end;
$$;

comment on function public.ensure_service_category_active() is
  '0049: jobs.category_id / provider_services.service_category_id / provider_documents.service_category_id (nullable) / provider_service_authorizations.service_category_id icin PAYLASILAN aktif-kategori kapisi — service_categories.is_active=false olan bir kategoriye YENI ilan, hizmet secimi, belge veya yetkilendirme (admin dahil) yazilamaz. Var olan satirlar dokunulmaz (yalniz INSERT/kategori-kolonu UPDATE''i kapsar) — gecmis veri asla geriye donuk olarak gecersiz kilinmaz.';

revoke all on function public.ensure_service_category_active() from public, anon, authenticated;

drop trigger if exists trg_jobs_service_category_active on public.jobs;
create trigger trg_jobs_service_category_active
  before insert or update of category_id on public.jobs
  for each row execute function public.ensure_service_category_active();

drop trigger if exists trg_provider_services_service_category_active on public.provider_services;
create trigger trg_provider_services_service_category_active
  before insert or update of service_category_id on public.provider_services
  for each row execute function public.ensure_service_category_active();

drop trigger if exists trg_provider_documents_service_category_active on public.provider_documents;
create trigger trg_provider_documents_service_category_active
  before insert or update of service_category_id on public.provider_documents
  for each row execute function public.ensure_service_category_active();

drop trigger if exists trg_provider_service_authorizations_service_category_active on public.provider_service_authorizations;
create trigger trg_provider_service_authorizations_service_category_active
  before insert or update of service_category_id on public.provider_service_authorizations
  for each row execute function public.ensure_service_category_active();
