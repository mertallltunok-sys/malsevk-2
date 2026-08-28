-- =============================================================================
-- MALSEVK — migration 0089: MERSİS numarasını kayıt sırasında ZORUNLU
-- OLMAKTAN çıkar
-- =============================================================================
-- GÖREV: "Production Kabul Testi" sırasında gerçek bir kayıt denemesi MERSİS
-- zorunluluğuna takıldı — bireysel DIŞINDAKİ her company_type için MERSİS
-- isteyen 0083 kararı, üründe henüz hiçbir kurumsal doğrulama süreci
-- olmadan gerçek kullanıcıları kayıt dışı bırakıyordu. Bu migration 0083'ün
-- ML176 kararını TERSİNE ÇEVİRİR: mersis_no artık HER company_type için
-- (bireysel dahil) tamamen opsiyoneldir, her iki rol için de.
--
-- Önceden uygulanmış migration dosyaları (0082/0083) DEĞİŞTİRİLMEDİ — bu,
-- 0022/0030/0041 gibi bu projede zaten yerleşik olan "önceki bir migration'ın
-- kararı yeni bir migration'la tersine çevrilir, orijinal dosyaya dokunulmaz"
-- deseninin bir tekrarıdır. `profiles.mersis_no` sütunu ve
-- `profiles_mersis_no_unique` nullable partial unique index'i (0082)
-- KASITLI olarak dokunulmadan kalıyor — ileride ayrı bir kurumsal doğrulama
-- akışında yeniden kullanılabilir; yalnızca RPC'nin ZORUNLULUK kontrolü
-- kaldırılıyor.
--
-- Parametre imzası AYNI kalıyor (hâlâ 8 parametre, `p_mersis_no default
-- null`) — 0083'ün kendi notunda belirttiği gibi imza değişmediği için
-- `create or replace` güvenle yerini alır, 0032-0034'ün "yeni parametre
-- eklerken önce drop et" disiplini burada gerekmiyor.
-- =============================================================================

create or replace function public.complete_registration(
  p_role text, p_full_name text, p_phone text, p_company_name text, p_company_type text,
  p_province text, p_district text, p_mersis_no text default null
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
  v_mersis_no text := nullif(regexp_replace(coalesce(p_mersis_no, ''), '\D', '', 'g'), '');
begin
  if p_role not in ('hizmet-alan', 'hizmet-veren') then
    raise exception 'ML100: role must be hizmet-alan or hizmet-veren' using errcode = 'ML100';
  end if;

  if char_length(v_full_name) = 0 or char_length(v_phone) = 0 or char_length(v_company_name) = 0
     or char_length(v_province) = 0 or char_length(v_district) = 0 then
    raise exception 'ML102: full_name, phone, company_name, province and district are required' using errcode = 'ML102';
  end if;

  if v_mersis_no is not null and v_mersis_no !~ '^\d{16}$' then
    raise exception 'ML174: mersis_no must be exactly 16 digits' using errcode = 'ML174';
  end if;

  -- KALDIRILDI (0089) — 0083'ün ML176 kontrolü (bireysel DIŞINDAKİ firma
  -- tiplerinde mersis_no zorunlu) tamamen kaldırıldı. mersis_no artık her
  -- company_type için opsiyonel: verilirse hâlâ 16 haneli olmalı (yukarıdaki
  -- ML174 formatı korunuyor) ve hâlâ tekil olmalı (profiles_mersis_no_unique,
  -- aşağıdaki ML175), ama boş bırakılabilir.

  select * into v_profile from public.profiles where id = auth.uid();
  if v_profile is null then
    raise exception 'ML103: no profile row found for the current user' using errcode = 'ML103';
  end if;
  if v_profile.role is not null then
    raise exception 'ML101: registration has already been completed for this account' using errcode = 'ML101';
  end if;

  begin
    update public.profiles set
      role = p_role,
      full_name = v_full_name,
      phone = v_phone,
      company_name = v_company_name,
      company_type = p_company_type,
      province = v_province,
      district = v_district,
      mersis_no = v_mersis_no,
      onboarding_completed = true
    where id = auth.uid()
    returning * into v_profile;
  exception
    when unique_violation then
      raise exception 'ML175: mersis_no already registered to another company' using errcode = 'ML175';
  end;

  return v_profile;
end;
$$;

comment on function public.complete_registration(text, text, text, text, text, text, text, text) is
  '0022''nin kaydı tamamlayan RPC''si. 0082 ile p_mersis_no (normalize edilip 16 haneli biçimde doğrulanır, profiles_mersis_no_unique ile tekilliği zorlanır) eklendi. 0083 ile bireysel DIŞINDAKİ her company_type için ZORUNLU hâle getirildi (ML176). 0089 ile bu zorunluluk KALDIRILDI — mersis_no artık her company_type için opsiyonel, verildiğinde hâlâ 16 haneli ve tekil olmalı.';

revoke all on function public.complete_registration(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_registration(text, text, text, text, text, text, text, text) to authenticated;
