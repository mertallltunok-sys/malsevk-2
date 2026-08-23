-- =============================================================================
-- MALSEVK — migration 0036: Admin Profil Düzenleme
-- =============================================================================
-- STATUS: Admin Paneli Finalizasyon Sprinti #2 — bir önceki sprintin
-- envanterinde bulunan gerçek eksik: `admin-company-detail.tsx`/
-- `admin-requester-detail.tsx` yalnızca Askıya Al/Aç sağlıyordu (bkz.
-- kabul kriteri zinciri: Listele -> Detay -> Düzenle -> Onayla/Reddet ->
-- Audit) — "Düzenle" adımı hiç yoktu, ADMIN bir kullanıcının firma adındaki
-- bir yazım hatasını/yanlış telefon numarasını DÜZELTEMİYORDU.
--
-- KÖK NEDEN: `profiles.profiles_update_own` RLS politikası (0013)
-- KESİNLİKLE `id = auth.uid()`dir, `is_admin()` dalı YOKTUR — bu yüzden
-- admin, kendi kullanıcı adına self-servis düzenleme yapan doğrudan
-- `.from("profiles").update(...)` (bkz. supabase-profile-update.ts#
-- updateMyProfileRemote) yolunu BAŞKA bir kullanıcı için asla kullanamaz,
-- kolon-seviyeli GRANT (full_name/phone/company_name/company_type/province/
-- district, 0003) var olsa bile RLS onu engeller.
--
-- ÇÖZÜM: `close_job`/`close_job_as_admin`, `update_job`/`update_job_as_admin`
-- ile AYNI kurulu ikili desen — self-servis RLS/GRANT yoluna hiç
-- dokunulmadan, YALNIZCA admin için SECURITY DEFINER bir RPC eklenir.
-- İKİNCİ bir kullanıcı yönetim sistemi/tablo İCAT EDİLMEDİ — AYNI
-- `profiles` tablosunun AYNI 6 kolonu (0003'ün kendi GRANT listesiyle
-- birebir) güncellenir; `role`/`account_status`/`onboarding_completed`
-- (zaten yalnızca suspend_user/reinstate_user'ın yazdığı alanlar) bu
-- fonksiyonun KAPSAMI DIŞINDADIR — kasıtlı olarak parametre bile alınmaz.
-- Auth identity (email/şifre) da BİLEREK dışarıda bırakılmıştır (görev
-- gereksinimi: "Auth identity/email gibi alanları güvenli Auth mekanizması
-- dışında doğrudan DB update ile değiştirme").
--
-- AUDIT: `log_audit_event`in kendi belgelenmiş kuralına uyulur ("Callers
-- MUST pre-redact p_old_data/p_new_data — never pass a raw to_jsonb(row)
-- for a table containing phone/email/address", bkz. 0012) — bu yüzden
-- old/new payload'a phone'un KENDİSİ değil yalnızca "değişti mi" boole'u
-- yazılır, diğer tüm alanlar (isim/firma/il/ilçe zaten hassas değildir)
-- olduğu gibi kaydedilir.
--
-- Hata kodu aralığı: ML119-ML123 (bu migration'a özel, yeni) + ML102
-- (complete-registration.ts'in "zorunlu alan eksik" ile AYNI kavram için
-- YENİDEN KULLANILDI, yeni bir kod İCAT EDİLMEDİ). Önceki en yüksek YENİ
-- kod ML118'di — 0035'in kendi başlığındaki "ML115-ML119" ifadesi bir ÜST
-- SINIR beyanıydı, ML119 fiilen hiçbir yerde KULLANILMAMIŞTI; `grep -rhoE
-- "ML1[0-9]+" supabase/migrations/*.sql` ile doğrudan doğrulanarak buradan
-- devam edildi.
-- =============================================================================

create or replace function public.update_profile_as_admin(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_company_name text,
  p_company_type text,
  p_province text,
  p_district text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.profiles;
  v_new public.profiles;
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_company_name text := trim(coalesce(p_company_name, ''));
  v_province text := trim(coalesce(p_province, ''));
  v_district text := trim(coalesce(p_district, ''));
begin
  if not public.is_admin() then
    raise exception 'ML119: admin role required' using errcode = 'ML119';
  end if;

  select * into v_old from public.profiles where id = p_user_id and deleted_at is null;
  if v_old is null then
    raise exception 'ML120: profile not found' using errcode = 'ML120';
  end if;

  if v_full_name = '' then
    raise exception 'ML102: full name is required' using errcode = 'ML102';
  end if;
  if p_phone is not null and p_phone !~ '^\+905\d{9}$' then
    raise exception 'ML121: phone must be in +905XXXXXXXXX format' using errcode = 'ML121';
  end if;
  if p_company_type is not null and p_company_type not in ('bireysel', 'sahis-isletmesi', 'limited-sirket', 'anonim-sirket', 'diger') then
    raise exception 'ML123: invalid company type' using errcode = 'ML123';
  end if;
  if v_company_name = '' or v_province = '' or v_district = '' then
    raise exception 'ML102: company name, province and district are required' using errcode = 'ML102';
  end if;
  if char_length(v_company_name) > 150 then
    raise exception 'ML122: company name must be at most 150 characters' using errcode = 'ML122';
  end if;

  update public.profiles set
    full_name = v_full_name,
    phone = p_phone,
    company_name = v_company_name,
    company_type = p_company_type,
    province = v_province,
    district = v_district
  where id = p_user_id
  returning * into v_new;

  perform public.log_audit_event('update_profile_as_admin', 'profiles', p_user_id,
    jsonb_build_object('full_name', v_old.full_name, 'company_name', v_old.company_name, 'company_type', v_old.company_type, 'province', v_old.province, 'district', v_old.district, 'phone_changed', v_old.phone is distinct from p_phone),
    jsonb_build_object('full_name', v_new.full_name, 'company_name', v_new.company_name, 'company_type', v_new.company_type, 'province', v_new.province, 'district', v_new.district, 'phone_changed', v_old.phone is distinct from p_phone));

  return v_new;
end;
$$;

comment on function public.update_profile_as_admin(uuid, text, text, text, text, text, text) is
  'Admin-only — profiles_update_own RLS politikası (id = auth.uid()) admin dahil kimsenin başka bir satırı doğrudan UPDATE etmesine izin vermez; bu SECURITY DEFINER RPC o sınırı, is_admin() kendi kontrolüyle, KASITLI olarak aşar. role/account_status/onboarding_completed/email bu fonksiyonun kapsamı DIŞINDADIR (suspend_user/reinstate_user ve Supabase Auth''un kendi yönetim alanı).';

revoke all on function public.update_profile_as_admin(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_profile_as_admin(uuid, text, text, text, text, text, text) to authenticated;
