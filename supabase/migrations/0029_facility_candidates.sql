-- =============================================================================
-- MALSEVK — Admin Paneli Faz 3 migration 0029: facility_candidates (Sistem
-- Beslemesi / Tesis Onay Merkezi)
-- =============================================================================
-- STATUS: Admin Paneli Faz 3 — "Sistem Beslemesi" görevinin TEK şema
-- değişikliği. 0001-0028'in HİÇBİRİ değiştirilmedi/yeniden yazılmadı.
--
-- NEDEN YENİ TABLO (görev bölüm 8 gereği gerekçe): kullanıcıların
-- locationMode="custom" ile serbestçe yazdığı tesis adları (Job.workLocation
-- Type/customFacilityName/deliveryFacilityName, bkz. CLAUDE.md "Centralized
-- job location"/"Nakliye Güzergâh Yönetimi") bugün YALNIZCA localStorage'da
-- yaşıyor — job-store.ts'de hiçbir Supabase referansı yok (createJob henüz
-- Supabase'e bağlı değil, bkz. 0028'in kendi başlığı). Gerçek tesis kataloğu
-- (data/locations/locations.json) de Supabase'de DEĞİL — offline bir CLI
-- pipeline'ın (scripts/locations/) ürettiği, build-time'da bundle edilen
-- statik bir JSON dosyası; Vercel'in salt-okunur dosya sistemi bir admin
-- panelinin ONAYLA tuşuyla bu dosyayı canlı güncellemesini zaten imkansız
-- kılıyor. Dolayısıyla ne genişletilecek bir "adaylar" mekanizması, ne de
-- canlı yazılabilir bir "facilities" tablosu mevcut — ikisi de bu migration
-- ile ilk kez ekleniyor. `jobs.facility_id` (0004) düz bir `text` kolonu,
-- hiçbir tabloya FK değil; bu migration onu da DEĞİŞTİRMEZ.
--
-- TASARIM KARARI — onaylanan aday = doğrudan tesis kaydı: ayrı bir
-- "facilities" (onaylı) + "facility_candidates" (bekleyen) çift tablo
-- yerine TEK tablo kullanılıyor; onay yalnızca status='approved' yapar.
-- Görev bölüm 8'in "aynı işi yapan ikinci bir sistem oluşturma" uyarısına
-- karşılık: iki tablo arasında senkron gerektiren bir ayrım icat etmemek
-- için bilinçli bir sadeleştirme.
--
-- TASARIM KARARI — 5 tip kelime dağarcığı YENİ: görevin istediği 5 tür
-- (Liman/OSB/Sanayi/Antrepo/Gümrük Sahası) turkey-locations.ts#FacilityType
-- (LIMAN/OSB/SERBEST_BOLGE/DEPO/FABRIKA/ACIK_SAHA/DIGER) ile BİREBİR
-- ÖRTÜŞMÜYOR — doğrudan kontrol edildi (data/locations/locations.json'da
-- SANAYI/ANTREPO/GUMRUK_SAHASI hiç yok, DEPO/FABRIKA/SERBEST_BOLGE/ACIK_SAHA
-- ise görevin istemediği değerler). Bu yüzden suggested_types görevin kendi
-- 5 değerini kullanır, mevcut FacilityType'ı ZORLA yeniden kullanmaz —
-- ikisi kavramsal olarak farklı kataloglar (biri OSM/manuel-doğrulanmış
-- gerçek tesisler, diğeri admin tarafından kabaca sınıflandırılan kullanıcı
-- girdisi adayları).
--
-- TEK TUŞLA ONAY / GRUPLAMA MEKANİZMASI (görev bölüm 1/3/6/7özeti):
--   - normalize_facility_text(): Türkçe harfleri ASCII'ye indirger, küçük
--     harfe çevirir, alfanumerik-olmayanı boşluğa çevirir, boşlukları
--     tekilleştirir. suggested_compact_key/compact_key (generated, TÜM
--     boşluklar da atılmış) TIER-1 birebir eşleşme anahtarıdır — "evyapport"
--     / "ev yap port" / "Evyap Port" üçü de aynı compact_key'e iner.
--   - pg_trgm (bu migration ile ETKİNLEŞTİRİLDİ — 0001'in kendi notu bunu
--     açıkça "arama özelliği tasarlandığında ayrı bir migration'da ekle"
--     diye bırakmıştı, bu görev tam olarak o an) TIER-2 bulanık eşleşmedir:
--     compact_key eşleşmezse aynı ilde similarity(...) >= 0.28 olan en
--     yakın pending/approved grup bulunur (ör. "evyap port dilovası" gibi
--     ekstra kelime içeren varyasyonlar). Eşik (0.28) her iki kullanım
--     noktasında (submit_facility_candidate_entry, approve_facility_
--     candidate) aynı sabit değerdir — biri değişirse diğeri de güncellen-
--     melidir. Hiçbir zaman körlemesine birleştirme yapılmaz — eşik altı
--     benzerlik her zaman YENİ, ayrı incelenebilir bir aday grubu oluşturur
--     (bölüm 3'ün "yanlış eşleştirme riski varsa admin incelemesine bırak"
--     ilkesi).
--   - approve_facility_candidate() ONAYLANIRKEN aynı ilde, onaylanan son ada
--     benzerliği eşik üstü olan TÜM diğer pending gruplarını otomatik olarak
--     bu gruba KATLAR (raw_entries taşınır, boş kalan pending kayıt
--     silinir) — bölüm 3'ün "yüzlerce farklı yazım tek grup/tek karar"
--     hedefinin karşılığı; admin her varyasyonu tek tek onaylamak zorunda
--     kalmaz.
--   - Bölüm 6 (alias/onaylanmış eşleşme) + bölüm 7 (red tekrar oluşturmasın):
--     submit_facility_candidate_entry TIER-1'de statüye BAKMAKSIZIN (pending/
--     approved/rejected) eşleşen bir grup bulur ve ona ekler — rejected bir
--     grup asla yeniden pending olarak doğmaz, approved bir grup asla yeni
--     bir pending kopya doğurmaz. TEK istisna (bölüm 6'nın kendi güvenlik
--     notu): approved bir eşleşme, gönderilen ilçe önceki onaylı ilçeden
--     GERÇEKTEN farklıysa körlemesine birleştirilmez — "farklı bir lokasyon
--     kastedilmiş olabilir" ihtimaline karşı ayrı, yeni bir pending grup
--     açılır (admin incelemesine düşer).
--   - Güven seviyesi (bölüm 4) yalnızca usage_count'a dayanır (>=5 yüksek,
--     >=2 orta, aksi düşük) — bunun DIŞINDA bir "doğruluk" sinyali yok,
--     çünkü karşılaştırılacak canlı bir Supabase tesis kataloğu (yukarıdaki
--     not) bugün mevcut değil; birden fazla bağımsız kullanıcının aynı/
--     benzer metni yazması, bu sistemde elde edilebilecek en güçlü sinyal.
--     Bu skor hiçbir otomatik karara YOL AÇMAZ (görev bölüm 4) — yalnızca
--     admin panelinde gösterilir.
--
-- Hata kodu aralığı: ML108-ML114 (bu migration'a özel, önceki en yüksek
-- kod MLK101'di — doğrudan grep ile kontrol edildi, çakışma yok).
-- =============================================================================

-- pg_trgm: bkz. 0001_extensions_and_helpers.sql'in kendi notu — o migration
-- bunu KASITLI OLARAK etkinleştirmemişti ("arama özelliği tasarlandığında
-- ayrı bir migration'da ekle"). Bulanık tesis-adı gruplama tam olarak o
-- özelliktir.
create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- normalize_facility_text / guess_facility_type — saf, immutable yardımcılar
-- -----------------------------------------------------------------------------
create or replace function public.normalize_facility_text(p_text text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(p_text, ''), 'İIıĞğÜüŞşÖöÇç', 'iiigguussoocc')),
          '[^a-z0-9]+', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.normalize_facility_text(text) is
  'Türkçe harfleri ASCII''ye indirger + küçük harfe çevirir + alfanumerik-olmayanı tekil boşluğa indirger. Yalnızca karşılaştırma/gruplama içindir — suggested_name/raw_text kullanıcının yazdığı ORİJİNAL metni saklamaya devam eder.';

revoke all on function public.normalize_facility_text(text) from public, anon, authenticated;
grant execute on function public.normalize_facility_text(text) to authenticated;

create or replace function public.guess_facility_type(p_normalized text)
returns text
language sql
immutable
as $$
  select case
    when p_normalized ~ 'liman' or p_normalized ~ '(^| )port( |$)' then 'LIMAN'
    when p_normalized ~ 'antrepo' then 'ANTREPO'
    when p_normalized ~ 'gumruk' then 'GUMRUK_SAHASI'
    when p_normalized ~ '(^| )osb( |$)' or p_normalized ~ 'organize sanayi' then 'OSB'
    when p_normalized ~ 'sanayi' or p_normalized ~ 'fabrika' then 'SANAYI'
    else null
  end;
$$;

comment on function public.guess_facility_type(text) is
  'Anahtar kelime tabanlı, en-fazla-tek-tip tahmin (görev bölüm 4''ün "mümkünse" ile aynı ölçüde en-iyi-çaba) — admin panelinde yalnızca bir ÖN dolgu olarak kullanılır, suggested_types''ı asla tek başına belirlemez (admin her zaman düzenleyebilir).';

revoke all on function public.guess_facility_type(text) from public, anon, authenticated;
grant execute on function public.guess_facility_type(text) to authenticated;

-- -----------------------------------------------------------------------------
-- facility_candidates — aday grupları (bekleyen VE onaylanmış tesis kaydı
-- aynı satır, bkz. dosya başlığı "TASARIM KARARI")
-- -----------------------------------------------------------------------------
create table if not exists public.facility_candidates (
  id uuid primary key default gen_random_uuid(),
  suggested_name text not null,
  suggested_normalized_name text not null,
  suggested_compact_key text generated always as (replace(suggested_normalized_name, ' ', '')) stored,
  suggested_province text not null,
  suggested_district text,
  suggested_types text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  confidence text not null default 'low' check (confidence in ('high', 'medium', 'low')),
  usage_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facility_candidates_types_valid
    check (suggested_types <@ array['LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI']::text[])
);

comment on table public.facility_candidates is
  'Sistem Beslemesi (Tesis Onay Merkezi) — kullanıcıların locationMode="custom" ile serbestçe yazdığı tesis adı gruplarının admin incelemesi. status=''approved'' olan bir satır AYNI ZAMANDA onaylı tesis kaydının kendisidir (bkz. dosya başlığı). Tüm mutasyon yalnızca submit_facility_candidate_entry/approve_facility_candidate/reject_facility_candidate/update_facility_candidate_suggestion RPC''leri üzerinden — hiçbir role''e doğrudan INSERT/UPDATE/DELETE grant''i yok.';

drop trigger if exists trg_facility_candidates_set_updated_at on public.facility_candidates;
create trigger trg_facility_candidates_set_updated_at
  before update on public.facility_candidates
  for each row execute function public.set_updated_at();

create index if not exists facility_candidates_status_idx on public.facility_candidates (status);
create index if not exists facility_candidates_province_idx on public.facility_candidates (suggested_province);
create index if not exists facility_candidates_compact_key_idx on public.facility_candidates (suggested_province, suggested_compact_key);
create index if not exists facility_candidates_trgm_idx on public.facility_candidates using gin (suggested_normalized_name gin_trgm_ops);

revoke all on public.facility_candidates from authenticated, anon;
grant select on public.facility_candidates to authenticated;

alter table public.facility_candidates enable row level security;

drop policy if exists facility_candidates_select_admin on public.facility_candidates;
create policy facility_candidates_select_admin on public.facility_candidates
  for select to authenticated
  using (public.is_admin());

comment on policy facility_candidates_select_admin on public.facility_candidates is
  'Normal kullanıcı (görev bölüm 9) aday listesini göremez — yalnızca admin. INSERT yolu (submit_facility_candidate_entry) SECURITY DEFINER olduğu için bu RLS''i (owner bypass) atlar, ayrı bir INSERT policy''ye gerek yok.';

-- -----------------------------------------------------------------------------
-- facility_candidate_raw_entries — her bir ham kullanıcı girdisi (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.facility_candidate_raw_entries (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.facility_candidates (id) on delete cascade,
  raw_text text not null,
  normalized_text text not null,
  compact_key text generated always as (replace(normalized_text, ' ', '')) stored,
  province text not null,
  district text,
  type_guess text check (type_guess is null or type_guess in ('LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI')),
  submitted_by uuid references public.profiles (id),
  source text,
  created_at timestamptz not null default now()
);

comment on table public.facility_candidate_raw_entries is
  '"Benzer yazımlar" listesi (görev bölüm 5) — bir facility_candidates grubuna bağlı her ham, değişmeyen kullanıcı girdisi. candidate_id, approve_facility_candidate''ın sibling-merge''i sırasında başka bir gruba taşınabilir (bkz. dosya başlığı) — bu, tarihçenin KAYBOLMASI değil, doğru gruba TOPLANMASIdır.';

create index if not exists facility_candidate_raw_entries_candidate_idx on public.facility_candidate_raw_entries (candidate_id);
create index if not exists facility_candidate_raw_entries_compact_idx on public.facility_candidate_raw_entries (province, compact_key);

revoke all on public.facility_candidate_raw_entries from authenticated, anon;
grant select on public.facility_candidate_raw_entries to authenticated;

alter table public.facility_candidate_raw_entries enable row level security;

drop policy if exists facility_candidate_raw_entries_select_admin on public.facility_candidate_raw_entries;
create policy facility_candidate_raw_entries_select_admin on public.facility_candidate_raw_entries
  for select to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- submit_facility_candidate_entry — TEK ingestion yolu (hizmet-alan-only)
-- -----------------------------------------------------------------------------
create or replace function public.submit_facility_candidate_entry(
  p_raw_text text,
  p_province text,
  p_district text default null,
  p_source text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized text;
  v_compact text;
  v_type_guess text;
  v_candidate public.facility_candidates%rowtype;
  v_usage integer;
begin
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'ML108: only hizmet-alan accounts may submit a facility candidate' using errcode = 'ML108';
  end if;
  if p_province is null or length(trim(p_province)) = 0 then
    raise exception 'ML109: province is required' using errcode = 'ML109';
  end if;

  v_normalized := public.normalize_facility_text(p_raw_text);
  -- Anlamsız/çok kısa girdi (görev bölüm 7'nin "asdadasd" örneğiyle aynı
  -- ruhta): sessizce yok say, en-iyi-çaba bir yan-etki çağrısı hiçbir zaman
  -- iş akışını (ilan oluşturmayı) etkilememeli/hata döndürmemeli.
  if v_normalized is null or length(v_normalized) < 2 then
    return null;
  end if;
  v_compact := replace(v_normalized, ' ', '');
  v_type_guess := public.guess_facility_type(v_normalized);

  -- TIER 1: aynı ilde birebir compact-key eşleşmesi, statüden BAĞIMSIZ
  -- (bölüm 6/7 — onaylı/reddedilmiş grup asla yeniden doğmaz).
  select * into v_candidate
  from public.facility_candidates
  where suggested_province = p_province and suggested_compact_key = v_compact
  order by (status = 'approved') desc, updated_at desc
  limit 1;

  -- Bölüm 6 güvenlik notu: onaylı bir eşleşme, gönderilen ilçe önceki
  -- onaylı ilçeden GERÇEKTEN farklıysa körlemesine birleştirilmez.
  if v_candidate.id is not null and v_candidate.status = 'approved'
     and p_district is not null and trim(p_district) <> ''
     and v_candidate.suggested_district is not null
     and v_candidate.suggested_district <> p_district then
    v_candidate := null;
  end if;

  -- TIER 2: bulanık (trigram) eşleşme, yalnız pending/approved, aynı il —
  -- eşik 0.28 (bkz. dosya başlığı, approve_facility_candidate ile AYNI). Bir
  -- ONAYLI grupla eşleşme için AYNI bölüm-6 ilçe güvenlik kısıtı burada da
  -- tekrarlanır (TIER 1'in üstteki bloğu yalnız compact-key birebir
  -- eşleşmesini korur — bu olmadan TIER 2, farklı ilçedeki bir onaylı
  -- grubu, TIER 1'in az önce reddettiği AYNI satırla, yalnızca bulanık
  -- eşleşme yoluyla sessizce yeniden eşleştirebilirdi; gerçek bir hata
  -- olarak test sırasında bulundu ve düzeltildi).
  if v_candidate.id is null then
    select * into v_candidate
    from public.facility_candidates
    where suggested_province = p_province
      and status in ('pending', 'approved')
      and similarity(suggested_normalized_name, v_normalized) >= 0.28
      and (
        status = 'pending'
        or p_district is null or trim(p_district) = ''
        or suggested_district is null
        or suggested_district = p_district
      )
    order by similarity(suggested_normalized_name, v_normalized) desc
    limit 1;
  end if;

  if v_candidate.id is null then
    insert into public.facility_candidates (
      suggested_name, suggested_normalized_name, suggested_province, suggested_district, suggested_types
    ) values (
      initcap(trim(p_raw_text)), v_normalized, p_province, nullif(trim(coalesce(p_district, '')), ''),
      case when v_type_guess is null then '{}'::text[] else array[v_type_guess] end
    )
    returning * into v_candidate;
  end if;

  insert into public.facility_candidate_raw_entries (
    candidate_id, raw_text, normalized_text, province, district, type_guess, submitted_by, source
  ) values (
    v_candidate.id, trim(p_raw_text), v_normalized, p_province, nullif(trim(coalesce(p_district, '')), ''), v_type_guess, auth.uid(), p_source
  );

  select count(*) into v_usage from public.facility_candidate_raw_entries where candidate_id = v_candidate.id;

  update public.facility_candidates
    set usage_count = v_usage,
        last_seen_at = now(),
        confidence = case when v_usage >= 5 then 'high' when v_usage >= 2 then 'medium' else 'low' end
    where id = v_candidate.id;

  return v_candidate.id;
end;
$$;

comment on function public.submit_facility_candidate_entry(text, text, text, text) is
  'job-request-form.tsx/job-edit-form.tsx/nakliye-location-fields.tsx''in locationMode="custom" yolundan, mevcut lokal ilan oluşturma/güncelleme BAŞARILI olduktan SONRA, en-iyi-çaba (fire-and-forget) çağrılır — bu RPC''nin başarısız olması hiçbir zaman ilan oluşturmayı ENGELLEMEMELİ/geciktirmemeli.';

revoke all on function public.submit_facility_candidate_entry(text, text, text, text) from public, anon;
grant execute on function public.submit_facility_candidate_entry(text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- approve_facility_candidate — admin-only, tek tuşla onay + sibling-merge
-- -----------------------------------------------------------------------------
create or replace function public.approve_facility_candidate(
  p_candidate_id uuid,
  p_name text,
  p_province text,
  p_district text,
  p_types text[]
)
returns public.facility_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
  v_normalized text;
  v_sibling record;
begin
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if p_types is not null and not (p_types <@ array['LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI']::text[]) then
    raise exception 'ML111: invalid facility type' using errcode = 'ML111';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'ML112: facility name is required' using errcode = 'ML112';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  v_normalized := public.normalize_facility_text(p_name);

  -- Sibling-merge (bkz. dosya başlığı) — aynı ilde, onaylanan son ada
  -- benzerliği eşik (0.28) üstü olan diğer TÜM pending grupları bu gruba
  -- katlar. raw_entries FK''si CASCADE değil, bilinçli olarak UPDATE ile
  -- taşınıyor (tarihçe kaybolmasın), boş kalan pending satır sonra silinir.
  for v_sibling in
    select id from public.facility_candidates
    where id <> p_candidate_id
      and status = 'pending'
      and suggested_province = p_province
      and similarity(suggested_normalized_name, v_normalized) >= 0.28
  loop
    update public.facility_candidate_raw_entries set candidate_id = p_candidate_id where candidate_id = v_sibling.id;
    delete from public.facility_candidates where id = v_sibling.id;
  end loop;

  update public.facility_candidates
    set suggested_name = trim(p_name),
        suggested_normalized_name = v_normalized,
        suggested_province = p_province,
        suggested_district = nullif(trim(coalesce(p_district, '')), ''),
        suggested_types = coalesce(p_types, suggested_types),
        status = 'approved',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        rejection_reason = null,
        usage_count = (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id),
        confidence = case
          when (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id) >= 5 then 'high'
          when (select count(*) from public.facility_candidate_raw_entries where candidate_id = p_candidate_id) >= 2 then 'medium'
          else 'low'
        end
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('approve_facility_candidate', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.approve_facility_candidate(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.approve_facility_candidate(uuid, text, text, text, text[]) to authenticated;

-- -----------------------------------------------------------------------------
-- reject_facility_candidate — admin-only, gerekçe zorunlu
-- -----------------------------------------------------------------------------
create or replace function public.reject_facility_candidate(p_candidate_id uuid, p_reason text)
returns public.facility_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if v_trimmed_reason is null then
    raise exception 'ML114: a reason is required to reject a facility candidate' using errcode = 'ML114';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  update public.facility_candidates
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = v_trimmed_reason
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('reject_facility_candidate', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.reject_facility_candidate(uuid, text) from public, anon;
grant execute on function public.reject_facility_candidate(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- update_facility_candidate_suggestion — admin-only "Düzenle", statüyü
-- değiştirmez (görev bölüm 5: onaydan bağımsız düzenleme)
-- -----------------------------------------------------------------------------
create or replace function public.update_facility_candidate_suggestion(
  p_candidate_id uuid,
  p_name text,
  p_province text,
  p_district text,
  p_types text[]
)
returns public.facility_candidates
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.facility_candidates%rowtype;
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'ML110: admin role required' using errcode = 'ML110';
  end if;
  if p_types is not null and not (p_types <@ array['LIMAN', 'OSB', 'SANAYI', 'ANTREPO', 'GUMRUK_SAHASI']::text[]) then
    raise exception 'ML111: invalid facility type' using errcode = 'ML111';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'ML112: facility name is required' using errcode = 'ML112';
  end if;

  select * into v_row from public.facility_candidates where id = p_candidate_id;
  if v_row.id is null then
    raise exception 'ML113: facility candidate not found' using errcode = 'ML113';
  end if;
  v_old := to_jsonb(v_row);

  update public.facility_candidates
    set suggested_name = trim(p_name),
        suggested_normalized_name = public.normalize_facility_text(p_name),
        suggested_province = p_province,
        suggested_district = nullif(trim(coalesce(p_district, '')), ''),
        suggested_types = coalesce(p_types, suggested_types)
    where id = p_candidate_id
  returning * into v_row;

  perform public.log_audit_event('update_facility_candidate_suggestion', 'facility_candidates', v_row.id, v_old, to_jsonb(v_row));

  return v_row;
end;
$$;

revoke all on function public.update_facility_candidate_suggestion(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.update_facility_candidate_suggestion(uuid, text, text, text, text[]) to authenticated;
