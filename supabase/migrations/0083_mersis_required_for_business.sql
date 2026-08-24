-- =============================================================================
-- MALSEVK — migration 0083: MERSİS numarası "bireysel" DIŞINDAKİ firma
-- tiplerinde ZORUNLU
-- =============================================================================
-- GÖREV: "Development Kapanış Turu" — migration 0082 MERSİS'i BİLEREK
-- opsiyonel bırakmıştı (kayıt dışı bırakma riskinden kaçınmak için). Bu
-- görev bunu açıkça tersine çevirdi: "CompanyType = bireysel ise MERSİS
-- isteğe bağlı olabilir. Bireysel dışındaki işletme türlerinde MERSİS
-- zorunlu olmalı." — ve bunun yalnızca istemci doğrulamasıyla değil, RPC/DB
-- katmanında da uygulanmasını istedi (bir saldırganın istemci doğrulamasını
-- atlayıp RPC'yi doğrudan çağırması bu kuralı asla aşamamalı).
--
-- Yalnızca `complete_registration`in KENDİ İÇ mantığı değişiyor — parametre
-- imzası AYNI kalıyor (hâlâ 8 parametre, `p_mersis_no default null`), bu
-- yüzden 0032-0034'ün "yeni parametre eklerken önce drop et" disiplini
-- burada gerekmiyor (imza değişmediği için `create or replace` güvenle
-- yerini alır, ikinci bir overload asla oluşmaz).
--
-- `profiles.mersis_no` sütununun KENDİSİ hâlâ NULL'a izin veriyor (bireysel
-- hesaplar hâlâ NULL yazar) — zorunluluk yalnızca p_company_type <>
-- 'bireysel' olduğunda, RPC'nin kendi iş kuralı olarak uygulanıyor; bir CHECK
-- constraint DEĞİL, çünkü CHECK constraint'ler yalnızca sütun DEĞERLERİNE
-- bakabilir, `company_type`e göre KOŞULLU zorunluluk için PL/pgSQL'in kendi
-- if/raise'i doğru araçtır (aynı desen zaten ML102'nin diğer zorunlu
-- alanları için de kullanılıyor).
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

  -- YENİ (0083) — bireysel DIŞINDAKİ her firma tipinde MERSİS zorunlu.
  -- İstemci tarafı (register-form-validation.ts/complete-registration-form.tsx)
  -- zaten aynı kuralı uyguluyor, ama gerçek sınır burasıdır: RPC doğrudan
  -- çağrılsa (istemci doğrulaması tamamen atlanarak) bile bu kontrol geçerli.
  if p_company_type <> 'bireysel' and v_mersis_no is null then
    raise exception 'ML176: mersis_no is required for non-individual company types' using errcode = 'ML176';
  end if;

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
  '0022''nin kaydı tamamlayan RPC''si. 0082 ile p_mersis_no (normalize edilip 16 haneli biçimde doğrulanır, profiles_mersis_no_unique ile tekilliği zorlanır) eklendi. 0083 ile bireysel DIŞINDAKİ her company_type için ZORUNLU hâle getirildi (ML176) — yalnızca bireysel hesaplar MERSİS''siz kayıt olabilir.';

revoke all on function public.complete_registration(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_registration(text, text, text, text, text, text, text, text) to authenticated;
