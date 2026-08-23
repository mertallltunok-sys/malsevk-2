-- GENEL GÜVENLİK GÖREVİ §5/§8 — takip migration'ı (0073'ün ardından bulunan,
-- küçük ama gerçek bir kapsam boşluğu): `jobs.work_location_type` ("Liman /
-- Sanayi / OSB" — manuel giriş modunda kullanıcının serbestçe yazdığı tesis
-- adı) ne bir üst sınıra ne de iletişim-bilgisi-sızıntısı kontrolüne tabiydi.
-- İstemci tarafı (job-form-validation.ts) AYNI iki kontrolü zaten kazandı —
-- bu, RPC'yi bypass eden bir isteğe karşı sunucu tarafı YEDEĞİdir.
--
-- Zaten uygulanmış 0052/0073 GERİYE DÖNÜK DÜZENLENMEDİ — bu, projenin kendi
-- yerleşik kuralına uygun, küçük, hedefli bir takip migration'ıdır (0070/
-- 0071'in AYNI deseni).

do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count from public.jobs where char_length(work_location_type) > 150;
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.work_location_type satırı 150 karakteri aşıyor — CHECK eklenmeyecek, elle inceleyin.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_work_location_type_length_check;
    alter table public.jobs add constraint jobs_work_location_type_length_check
      check (char_length(work_location_type) <= 150);
  end if;
end $$;

-- `ensure_job_content_has_no_direct_contact_info()` (0052) parametresiz bir
-- trigger fonksiyonu olduğu için `create or replace` imzayı DEĞİŞTİRMEDEN
-- güvenle genişletilebilir (drop/yeniden oluşturmaya gerek yok).
create or replace function public.ensure_job_content_has_no_direct_contact_info()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_combined text := coalesce(new.title, '') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.work_location_type, '');
begin
  if v_combined ~* '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' then
    raise exception 'ML136: title/description/work_location_type may not contain an email address' using errcode = 'ML136';
  end if;
  if v_combined ~ '(\+?\d[\s.\-]?){10,13}\d' then
    raise exception 'ML137: title/description/work_location_type may not contain a phone number' using errcode = 'ML137';
  end if;
  return new;
end;
$$;

comment on function public.ensure_job_content_has_no_direct_contact_info() is
  '0052 (0074''te work_location_type''i de kapsayacak şekilde genişletildi): jobs.title/description/work_location_type''e yazılmış e-posta/telefon kalıplarını reddeden, istemci doğrulamasının (job-form-validation.ts) sunucu tarafı yedeği.';
