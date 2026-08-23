-- =============================================================================
-- MALSEVK — Faz 1 migration 0023: provider_profiles + provider_documents
--           istemci yazma yolları (görev: profil/provider entegrasyonu tur 3)
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- KÖKEN: SUPABASE-MIGRATION-VALIDATION.md'nin "profil/provider entegrasyonu"
-- turunda (0001-0022'ye dokunulmadan) gerçek development projesine karşı
-- canlı doğrulandı — `public.provider_profiles` (0003) sütun-seviyeli
-- `UPDATE (bio, founded_year, experience_range, regions, service_features,
-- logo_path)` GRANT'ine SAHİPTİR ama satırı OLUŞTURACAK hiçbir INSERT
-- GRANT'i/RPC'si/trigger'ı yoktur — yeni bir hizmet-veren için bu tabloda
-- HİÇ satır yoktur, bu yüzden var olan UPDATE GRANT'i tek başına işe
-- yaramaz (0 satır etkiler, sessizce). Aynı şekilde `public.provider_documents`
-- (0007) yalnızca `grant select` alır — istemciden hiçbir INSERT yolu yoktur.
-- Bu migration, YALNIZCA bu iki eksik yazma yolunu SECURITY DEFINER RPC'lerle
-- açar — 0001-0022'nin HİÇBİR dosyası değiştirilmedi, hiçbir mevcut tablo/
-- policy/RPC'nin davranışı değiştirilmedi.
--
-- Hata kodu aralığı: MLK79-80 (mevcut MLK10-99 havuzunda BOŞ olduğu
-- doğrudan grep ile doğrulandı — MLK95-99 ZATEN KULLANIMDA, çakışma yok).
-- Kavramsal olarak var olan hatalarla AYNI anlamdaki durumlar (oturum
-- gerekli / geçersiz enum değeri) kasıtlı olarak var olan MLK93/MLK94
-- kodlarını TEKRAR KULLANIR — record_legal_consent/record_provider_document_
-- consent'in (0007/0008) zaten kurduğu "aynı anlam = aynı kod, farklı
-- fonksiyon" ilkesiyle birebir aynı.
-- =============================================================================


-- =============================================================================
-- BÖLÜM 1 — provider_profiles: güvenli UPSERT
-- =============================================================================
-- TASARIM KARARI — neden TEK bir "upsert_provider_profile" RPC'si, `provider_
-- profiles.logo_path` İÇİN AYRI bir "set_provider_profile_logo_path" RPC'si:
-- kaynak uygulamada (provider-profile-editor.tsx) logo YÜKLEME/SİLME zaten
-- form gönderiminden BAĞIMSIZ bir Storage işlemidir (Storage'a yaz/sil, SONRA
-- yolu kaydet — 0019'un kendi "Storage'a yükle, SONRA RPC'yi çağır" ilkesi).
-- Tek bir RPC'de "p_logo_path: text, dokunma/temizle/ayarla" için üç-değerli
-- bir sentinel icat etmek yerine, iki bağımsız, tek-amaçlı RPC bu ayrımı
-- doğal olarak yansıtır — form kaydı logo'ya HİÇ dokunmaz, logo işlemi form
-- alanlarına HİÇ dokunmaz.
--
-- Her ikisi de AYNI "insert ... on conflict (user_id) do update" desenini
-- kullanır — provider_profiles.user_id zaten PRIMARY KEY (0003), bu yüzden
-- ON CONFLICT hedefi doğal ve tektir. `bio`/`founded_year`/`experience_range`/
-- `regions`/`service_features` sütunlarının kendi CHECK kısıtları (0003)
-- burada TEKRAR DOĞRULANMAZ — create_offer()'ın currency'i CHECK kısıtına
-- bırakmasıyla AYNI desen; geçersiz bir değer standart bir Postgres CHECK
-- ihlali (23514) olarak döner, yeni bir MLK kodu icat edilmedi.
-- =============================================================================

create or replace function public.upsert_provider_profile(
  p_bio text,
  p_founded_year integer,
  p_experience_range text,
  p_regions text[],
  p_service_features text[]
)
returns public.provider_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_profiles;
begin
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK79: only hizmet-veren accounts may edit a provider profile' using errcode = 'MLK79';
  end if;

  insert into public.provider_profiles (user_id, bio, founded_year, experience_range, regions, service_features)
  values (auth.uid(), p_bio, p_founded_year, p_experience_range, coalesce(p_regions, '{}'), coalesce(p_service_features, '{}'))
  on conflict (user_id) do update set
    bio = excluded.bio,
    founded_year = excluded.founded_year,
    experience_range = excluded.experience_range,
    regions = excluded.regions,
    service_features = excluded.service_features
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.upsert_provider_profile(text, integer, text, text[], text[]) is
  '0023: provider_profiles icin TEK yazma yolu (logo_path haric, bkz. set_provider_profile_logo_path). user_id HER ZAMAN sunucu tarafinda auth.uid() ile belirlenir -- baska bir kullanici adina satir olusturulamaz/guncellenemez. Satir yoksa olusturur (INSERT), varsa gunceller (UPDATE) -- tek RPC, iki durumu da kapsar.';

revoke all on function public.upsert_provider_profile(text, integer, text, text[], text[]) from public, anon;
grant execute on function public.upsert_provider_profile(text, integer, text, text[], text[]) to authenticated;


create or replace function public.set_provider_profile_logo_path(p_logo_path text)
returns public.provider_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_profiles;
begin
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK79: only hizmet-veren accounts may edit a provider profile' using errcode = 'MLK79';
  end if;

  insert into public.provider_profiles (user_id, logo_path)
  values (auth.uid(), p_logo_path)
  on conflict (user_id) do update set logo_path = excluded.logo_path
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_provider_profile_logo_path(text) is
  '0023: yalnizca logo_path icin dar kapsamli yazma yolu (bkz. upsert_provider_profile ustundeki tasarim karari notu). p_logo_path NULL verilmesi logoyu kaldirir. user_id HER ZAMAN auth.uid().';

revoke all on function public.set_provider_profile_logo_path(text) from public, anon;
grant execute on function public.set_provider_profile_logo_path(text) to authenticated;


-- =============================================================================
-- BÖLÜM 2 — provider_documents: güvenli metadata yazma yolu
-- =============================================================================
-- KAPSAM DIŞI (bilinçli): bir belgeyi SİLME/değiştirme RPC'si eklenmedi —
-- kaynak uygulamada bu yönde çalışan bir UI akışı yok (yalnızca kayıt
-- sırasında ekleme, admin incelemesi review_provider_document — 0016 — ile
-- ZATEN var). review_provider_document ZATEN sahiptir/kısıtlıdır (yalnızca
-- is_admin()) ve bu migration ONA HİÇ DOKUNMADI — bu RPC'nin ürettiği
-- satırlar, review_provider_document'in `select * into v_document from
-- public.provider_documents where id = ...` sorgusuyla BİREBİR aynı şekilde
-- (satırın NASIL oluştuğuyla ilgilenmeden) işlenir; admin iş akışı bu
-- migration'dan HİÇ ETKİLENMEZ.
-- =============================================================================

create or replace function public.create_provider_document(
  p_document_type text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_extension text,
  p_size_bytes bigint
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
  -- Savunma derinliği: Storage RLS (0019, provider_documents_bucket_write_own_folder)
  -- yükleme ANINDA zaten yalnizca auth.uid() klasorune yazilmasini
  -- zorunlu kilar -- ama bu RPC ayri bir cagridir, kotu niyetli bir client
  -- teorik olarak BASKA birinin (daha once baska bir kanaldan sizmis)
  -- storage_path'ini buraya elle verebilirdi. Bu kontrol, metadata
  -- satirinin HER ZAMAN cagiranin GERCEKTEN yazabildigi bir yolu isaret
  -- etmesini garanti eder.
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes)
  returning * into v_row;
  -- current_review_status sutununun kendi DEFAULT 'pending'i (0007) burada
  -- HIC elle yazilmiyor -- client kendi belgesini asla "approved" olarak
  -- olusturamaz, tek yazma yolu budur ve bu sutunu hic parametre olarak
  -- almaz.

  return v_row;
end;
$$;

comment on function public.create_provider_document(text, text, text, text, text, bigint) is
  '0023: provider_documents icin TEK yazma yolu. provider_id HER ZAMAN auth.uid(). current_review_status HER ZAMAN tablonun kendi ''pending'' varsayilanindan gelir -- bu fonksiyon onu hicbir sekilde parametre olarak almaz/degistiremez. review_provider_document (0016) bu satirlari NASIL olusturduklarindan bagimsiz islerine devam eder.';

revoke all on function public.create_provider_document(text, text, text, text, text, bigint) from public, anon;
grant execute on function public.create_provider_document(text, text, text, text, text, bigint) to authenticated;
