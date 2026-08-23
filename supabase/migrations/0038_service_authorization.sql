-- =============================================================================
-- MALSEVK — migration 0038: Hizmet Bazlı Provider Yetkilendirmesi
-- =============================================================================
-- STATUS: "Kullanıcının seçtiği hizmet ≠ kullanıcının yetkili olduğu hizmet."
-- Bugüne kadar `provider_can_view_category()` (0012) yalnızca İZOLE
-- kategorilerde (Nakliye/Gümrük Müşavirliği, service_categories.visibility_
-- scope='isolated') "seçim = görünürlük" kuralını uyguluyordu — SEÇEN her
-- provider otomatik görürdü, admin onayı hiç aranmazdı; izole olmayan
-- kategorilerde ise (Lashing/Depolama/Forklift/Gözetim/Konteyner/vb.) HİÇBİR
-- kısıtlama yoktu, seçim bile gerekmezdi. Bu migration bu iki farklı kuralı
-- TEK, genel bir kurala birleştirir: HER kategori artık admin onaylı
-- (`provider_service_authorizations.revoked_at is null`) olmadan görünmez/
-- teklif alamaz — `service_categories.visibility_scope` kolonu artık
-- OKUNMUYOR (silinmedi, zararsız/kullanılmayan bir kolon olarak kalıyor,
-- bkz. proje raporu).
--
-- İKİNCİ BİR SİSTEM İCAT EDİLMEDİ — mevcut `provider_can_view_category()`
-- fonksiyonu (RLS policy'lerin, `provider_visible_jobs` view'ının,
-- `create_offer`/`accept_offer` RPC'lerinin ZATEN çağırdığı TEK nokta)
-- BURADA yeniden tanımlanıyor; çağıranların HİÇBİRİ değişmedi. `provider_
-- documents`/`provider_document_reviews` (belge onay akışı) da AYNEN
-- korunuyor — yalnızca `provider_documents`'a bir belgenin HANGİ hizmeti
-- desteklediğini işaretleyen nullable bir kolon (`service_category_id`)
-- ekleniyor (mevcut `document_type`'ın 2 sabit değeri — 'genel'/'gumruk-
-- musaviri-izin-belgesi' — bunu çözmüyor, bkz. proje raporu §E).
--
-- VERİ MODELİ: `provider_service_authorizations`, `provider_badges`'ın
-- (0025) BİREBİR AYNI kanıtlanmış deseni — satır asla silinmez, yalnızca
-- `revoked_at` damgalanır (tarihçe kalıcı), bir provider+kategori için en
-- fazla bir AKTİF satır (kısmi unique indeks). İkinci bir "rozet" sistemi
-- DEĞİL — Mavi Tik/Altın Tik'in kaldırılması AYRI bir migration'dadır
-- (0039), burası yalnızca yetkilendirmeyle ilgilidir.
--
-- Hata kodu aralığı: MEVCUT kodlar YENİDEN KULLANILIYOR (aynı anlam, farklı
-- tablo — bu codebase'in zaten kurulu ilkesi, bkz. MLK81/MLK94'ün kendi
-- önceki reuse'ları): MLK50 (admin role required — grant_provider_badge ile
-- AYNI), MLK94 (unknown/invalid categorical id — badge_type_id/document_type
-- ile AYNI), ML105 (no active row to revoke — revoke_provider_badge ile
-- AYNI), ML106 (provider_id must belong to hizmet-veren — grant_provider_
-- badge ile AYNI), ML107 (revoke reason required — revoke_provider_badge ile
-- AYNI). Yalnızca BİR YENİ kod: ML124 (create_provider_document'in yeni
-- service_category_id doğrulaması — grep ile ML123'ün en yüksek olduğu
-- doğrulandı, çakışma yok).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — provider_documents.service_category_id
-- -----------------------------------------------------------------------------
alter table public.provider_documents
  add column if not exists service_category_id text references public.service_categories (id);

comment on column public.provider_documents.service_category_id is
  'Bu belgenin HANGİ hizmeti desteklediği — nullable: NULL = genel belge (birden çok seçili hizmete uygulanabilir, provider''ın TEK hizmeti varsa örtük olarak o hizmet içindir), dolu = yalnızca bu spesifik hizmet için sunulmuş belge. document_type''ın (0007) 2 sabit değeri (genel/gumruk-musaviri-izin-belgesi) bunu ÇÖZMEZ — o "belgenin TÜRÜ", bu ise "belgenin DESTEKLEDİĞİ hizmet", iki farklı boyut.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — provider_service_authorizations (provider_badges, 0025 ile AYNI desen)
-- -----------------------------------------------------------------------------
create table if not exists public.provider_service_authorizations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  service_category_id text not null references public.service_categories (id),

  authorized_at timestamptz not null default now(),
  authorized_by uuid not null references public.profiles (id),
  -- Görev bölüm 6: "Belgeyi Onayla + Gözetim Hizmeti → Yetkilendir" — hangi
  -- belgenin bu yetkiyi tetiklediğinin izi. Nullable: section 27'nin
  -- "belgesiz manuel override" senaryosu için (o durumda log_audit_event
  -- zaten gerekçesini taşır, ayrıca bu satırda da açık kalır).
  source_document_id uuid references public.provider_documents (id),
  authorize_reason text,

  -- provider_badges (0025) ile AYNI: satır asla silinmez, yalnızca
  -- revoked_at damgalanır — tarihçe kalıcı.
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revoke_reason text,
  constraint provider_service_authorizations_revoked_fields_consistent
    check ((revoked_at is null) = (revoked_by is null)),

  updated_at timestamptz not null default now()
);

comment on table public.provider_service_authorizations is
  'Bir provider''ın hangi hizmet kategorisi için admin tarafından yetkilendirildiğinin tam tarihçesi. revoked_at IS NULL = şu an aktif/yetkili. provider_services (seçim, "talep edilen hizmetler") ile KASITLI OLARAK AYRI bir tablo — seçim otomatik yetki VERMEZ (görev bölüm 2). provider_can_view_category() (0012, burada yeniden tanımlanıyor) ve create_offer/accept_offer (0015) TEK okuma noktasıdır.';

create unique index if not exists provider_service_authorizations_one_active
  on public.provider_service_authorizations (provider_id, service_category_id)
  where revoked_at is null;

drop trigger if exists trg_provider_service_authorizations_set_updated_at on public.provider_service_authorizations;
create trigger trg_provider_service_authorizations_set_updated_at
  before update on public.provider_service_authorizations
  for each row execute function public.set_updated_at();

revoke all on public.provider_service_authorizations from authenticated, anon;
grant select on public.provider_service_authorizations to authenticated;
-- INSERT/UPDATE(revoke) yalnızca authorize_provider_service()/revoke_provider_
-- service_authorization() üzerinden (aşağıda), ikisi de admin-only.

alter table public.provider_service_authorizations enable row level security;

drop policy if exists provider_service_authorizations_select_own_or_admin on public.provider_service_authorizations;
create policy provider_service_authorizations_select_own_or_admin on public.provider_service_authorizations
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

comment on policy provider_service_authorizations_select_own_or_admin on public.provider_service_authorizations is
  'provider_badges_select_own_or_admin (0025) ile AYNI kısıt seviyesi. Görev bölüm 34 (cross-device): provider kendi oturumundan bu satırları HER ZAMAN canlı/doğrudan Supabase''ten okur (localStorage aynası DEĞİL) — bkz. app/_lib/supabase-provider-service-authorizations.ts.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — provider_can_view_category: genelleştirme (TEK karar noktası)
-- -----------------------------------------------------------------------------
-- ÖNCEKİ (yalnız izole kategoriler): "hiç izole kategori seçmemişse HER
-- ilanı görür." YENİ (her kategori): "her kategori için ayrı ayrı, aktif bir
-- yetkilendirme satırı YOKSA görmez." service_categories.visibility_scope
-- artık BU fonksiyon tarafından hiç okunmuyor (kolon silinmedi, zararsız).
create or replace function public.provider_can_view_category(p_provider_id uuid, p_category_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    return true; -- non-providers unaffected, mirrors resolveVisibility's early return
  end if;

  return exists (
    select 1 from public.provider_service_authorizations
    where provider_id = p_provider_id
      and service_category_id = p_category_id
      and revoked_at is null
  );
end;
$$;

comment on function public.provider_can_view_category(uuid, text) is
  '0038: genelleştirildi — artık TÜM kategoriler için provider_service_authorizations''ta AKTİF bir yetkilendirme satırı arar (eskiden yalnız "isolated" kategoriler için seçim bazlı bir kısıtlama uyguluyordu). jobs_select_visible (0013/0035) RLS policy''si, provider_visible_jobs view''ı (0017), create_offer/accept_offer (0015) HİÇBİRİ değişmedi — hepsi bu TEK fonksiyonu çağırmaya devam ediyor, bu yüzden genelleme otomatik olarak her yere yayılıyor.';

-- İmza DEĞİŞMEDİ — grant tekrarlanır, zararsız/idempotent.
revoke all on function public.provider_can_view_category(uuid, text) from public;
grant execute on function public.provider_can_view_category(uuid, text) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — authorize_provider_service / revoke_provider_service_authorization
-- -----------------------------------------------------------------------------
-- İdempotent (görev bölüm 7, close_job_as_admin/approve_job_as_admin ile AYNI
-- ilke): zaten aktif bir yetkilendirme varsa yeniden INSERT denenmez (unique
-- index çakışmasına asla girmez) — mevcut satır güncellenir (authorized_at/
-- by/source_document_id/reason "yeniden teyit" olarak yenilenir). Daha önce
-- revoke edilmiş bir kategori yeniden yetkilendirilirse YENİ bir satır açılır
-- (provider_badges'ın AYNI "birden fazla satır, tam tarihçe" ilkesi).
create or replace function public.authorize_provider_service(
  p_provider_id uuid,
  p_service_category_id text,
  p_source_document_id uuid default null,
  p_reason text default null
)
returns public.provider_service_authorizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_service_authorizations;
  v_existing public.provider_service_authorizations;
begin
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

  select * into v_existing from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null;

  if v_existing is not null then
    update public.provider_service_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_service_authorizations
      (provider_id, service_category_id, authorized_by, source_document_id, authorize_reason)
    values
      (p_provider_id, p_service_category_id, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''))
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
$$;

comment on function public.authorize_provider_service(uuid, text, uuid, text) is
  'Admin-only. Görev bölüm 27: belgesiz manuel override MÜMKÜN (p_source_document_id null bırakılabilir) — bu durum log_audit_event''e AÇIKÇA yazılır (audit''te p_source_document_id yoksa "belgesiz/manuel" olduğu anlaşılır), ayrı bir onay akışı İCAT EDİLMEDİ.';

revoke all on function public.authorize_provider_service(uuid, text, uuid, text) from public, anon;
grant execute on function public.authorize_provider_service(uuid, text, uuid, text) to authenticated;

create or replace function public.revoke_provider_service_authorization(
  p_provider_id uuid,
  p_service_category_id text,
  p_reason text
)
returns public.provider_service_authorizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_service_authorizations;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML107: a reason is required to revoke a service authorization' using errcode = 'ML107';
  end if;

  update public.provider_service_authorizations
    set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'ML105: no active service authorization of this type to revoke' using errcode = 'ML105';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_authorization_revoked', null, null, null,
    'Hizmet Yetkiniz Kaldırıldı',
    (select name from public.service_categories where id = p_service_category_id) || ' hizmeti erişiminiz durduruldu: ' || v_trimmed_reason,
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('revoke_provider_service_authorization', 'provider_service_authorizations', v_row.id,
    jsonb_build_object('revoked_at', null), jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id, 'reason', v_trimmed_reason));

  return v_row;
end;
$$;

comment on function public.revoke_provider_service_authorization(uuid, text, text) is
  'Admin-only. Görev bölüm 37: geçmiş teklifler/operasyonlar/tamamlanan işler HİÇ etkilenmez — bu fonksiyon yalnızca provider_service_authorizations satırını günceller, offers/operations/jobs''a HİÇ dokunmaz. Yeni ilan görünürlüğü/teklif yetkisi provider_can_view_category''nin (0038, Bölüm 3) bir sonraki okumasında otomatik kapanır.';

revoke all on function public.revoke_provider_service_authorization(uuid, text, text) from public, anon;
grant execute on function public.revoke_provider_service_authorization(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — notifications.type: +3 yeni değer (mevcut modele uyum, görev
-- bölüm 38 — "mevcut notification taxonomy farklıysa mevcut modele uyum
-- sağla"). document_rejected için YENİ bir tür İCAT EDİLMEDİ — mevcut
-- 'belge_reddedildi' (0009, review_provider_document zaten üretiyor)
-- birebir aynı anlamı taşıyor, yeniden kullanılıyor.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'yeni_teklif', 'teklif_kabul_edildi', 'teklif_reddedildi', 'is_basladi',
  'anlasma_saglanamadi', 'baska_hizmet_verenle_anlasildi', 'ilan_yeniden_yayinda',
  'tamamlanma_onayi_bekleniyor', 'is_tamamlandi', 'tamamlanma_onaylandi',
  'tamamlanma_itiraz_edildi', 'itiraz_kaydedildi', 'is_iptal_edildi',
  'teklif_geri_cekildi', 'hizmet_kalemi_kaldirildi', 'ilan_kapatildi',
  'ilan_yayin_suresi_doldu', 'belge_onaylandi', 'belge_reddedildi', 'belge_revizyon_istendi',
  'service_document_required', 'service_authorized', 'service_authorization_revoked'
));

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — create_provider_document: service_category_id parametresi
-- -----------------------------------------------------------------------------
-- STALE OVERLOAD KORUMASI (0032/0033/0034'ün dersi): imza değişiyor, eski
-- 6-parametreli overload AÇIKÇA drop edilir.
drop function if exists public.create_provider_document(text, text, text, text, text, bigint);

create or replace function public.create_provider_document(
  p_document_type text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_extension text,
  p_size_bytes bigint,
  p_service_category_id text default null
)
returns public.provider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_documents;
begin
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to upload a document' using errcode = 'MLK93';
  end if;
  if p_document_type not in ('genel', 'gumruk-musaviri-izin-belgesi') then
    raise exception 'MLK94: invalid document_type' using errcode = 'MLK94';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;
  -- Görev bölüm 6/41: bir belge yalnızca ÇAĞIRANIN KENDİ seçtiği bir
  -- hizmetle ilişkilendirilebilir — başka bir provider'ın hizmetine ya da
  -- kataloğun kendisinde olmayan bir kategoriye sahte bağlama girişimini
  -- engeller.
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_provider_document(text, text, text, text, text, bigint, text) is
  '0038: p_service_category_id eklendi (nullable — geriye dönük uyumlu, NULL = genel belge). Diğer tüm doğrulamalar (0023) DEĞİŞMEDİ.';

revoke all on function public.create_provider_document(text, text, text, text, text, bigint, text) from public, anon;
grant execute on function public.create_provider_document(text, text, text, text, text, bigint, text) to authenticated;
