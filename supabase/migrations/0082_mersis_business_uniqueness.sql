-- =============================================================================
-- MALSEVK — migration 0082: MERSİS numarasıyla işletme tekilliği
-- =============================================================================
-- GÖREV: "Aynı MERSİS numarasıyla aynı işletmenin tekrar tekrar kayıt açması
-- engellensin." Kod tabanında MERSİS/işletme-tekilliği kavramı ÖNCEDEN HİÇ
-- YOKTU (bu görevin kendi denetiminde doğrulandı — `mersis`/`tax_id`/
-- `company_registration` terimleri hiçbir migration/app dosyasında hiç
-- geçmiyordu). Bu migration, mevcut `company-type.ts#CompanyType` ayrımını
-- ("bireysel" vs. `sahis-isletmesi`/`limited-sirket`/`anonim-sirket`/`diger`)
-- TEK doğruluk kaynağı olarak kullanır — bu ayrım zaten HEM Hizmet Alan HEM
-- Hizmet Veren kayıt formunda mevcuttur, yeni bir hesap sınıflandırması İCAT
-- EDİLMEDİ (görev bölüm 9/10'un kendi gerekçesi).
--
-- KAPSAM KARARI (görev bölüm 11 — resmî devlet sistemine bağlanan yeni bir
-- doğrulama servisi İCAT ETME, istenen yalnızca SİSTEM İÇİ tekilliktir):
-- MERSİS numarasının GERÇEKTEN var/geçerli olduğu Ticaret Sicili'ne karşı
-- doğrulanmaz — yalnızca (a) doğru BİÇİMDE (16 haneli sayı) girildiği ve (b)
-- sistemde BAŞKA bir aktif profille ÇAKIŞMADIĞI garanti edilir.
--
-- ZORUNLULUK KARARI: MERSİS alanı hiçbir `company_type` için ZORUNLU
-- KILINMADI (yalnızca girildiğinde tekillik/biçim doğrulanır) — bu, görevin
-- kendi "bireysel kullanıcıları yanlışlıkla kayıt dışı bırakma" uyarısını en
-- güvenli şekilde karşılar: gerçek bir işletmenin MERSİS'i kayıt anında elinde
-- olmayabilir, bu bir "kayıt dışı bırakma" sorunu yaratmamalıdır — asıl
-- istenen (aynı MERSİS'in İKİNCİ KEZ kullanılamaması) MERSİS GİRİLDİĞİNDE
-- zaten tam olarak zorlanır.
-- =============================================================================

alter table public.profiles
  add column if not exists mersis_no text
    check (mersis_no is null or mersis_no ~ '^\d{16}$');

comment on column public.profiles.mersis_no is
  'Merkezi Sicil Kayıt Sistemi numarası — yalnızca normalize edilmiş (boşluk/tire temizlenmiş) 16 haneli biçimde saklanır. Yalnızca company_type <> ''bireysel'' olan kayıtlarda anlamlıdır ama veritabanı seviyesinde ZORUNLU kılınmaz (bkz. bu migration''ın kendi başlığı — "kayıt dışı bırakma" riskini önlemek için bilinçli bir tasarım kararı). Diğer kullanıcılara HİÇ gösterilmez (görev bölüm 12) — yalnızca sahibi ve admin (profiles_select_own_or_admin RLS''i, 0013, DEĞİŞMEDİ) kendi/başka bir profilin bu alanını görebilir.';

-- Yalnızca DOLU ve silinmemiş satırlar arasında tekillik — NULL'lar (MERSİS
-- girilmemiş kayıtlar) standart SQL UNIQUE semantiğiyle zaten birbirini
-- ETKİLEMEZ, bu yüzden ayrıca "where mersis_no is not null" yazmaya bile
-- gerek yok (ama açıklık için eklendi) — eşzamanlı iki kayıt denemesi
-- (görev bölüm 6) bu index'in kendi transaction-güvenli UNIQUE zorlamasıyla
-- otomatik olarak engellenir, ayrı bir "kilitleme" mekanizması İCAT EDİLMEDİ.
create unique index if not exists profiles_mersis_no_unique
  on public.profiles (mersis_no)
  where mersis_no is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- complete_registration — opsiyonel p_mersis_no parametresi eklendi
-- -----------------------------------------------------------------------------
-- `create or replace function` yalnızca AYNI parametre imzasıyla gerçek bir
-- değişiklik yapar (bkz. 0032/0033/0034'ün kendi bulduğu, "yeni parametre
-- eklemek eski overload'u canlı bırakır" dersi) — burada TEK bir mevcut
-- fonksiyonun imzası genişletildiği (7 parametreden 8'e) için, ESKİ 7
-- parametreli overload'un yaşayan bir kopyası kalmasın diye önce açıkça
-- DÜŞÜRÜLÜR, aynı disiplinle.
drop function if exists public.complete_registration(text, text, text, text, text, text, text);

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
  -- Görev bölüm 4 — boşluk/tire/biçim farklılıklarıyla tekillik kontrolünün
  -- aşılmasını engelle: rakam OLMAYAN her karakter (boşluk, tire, nokta, ...)
  -- saklamadan ÖNCE burada temizlenir, "1234 5678 9012 3456" ile
  -- "1234-5678-9012-3456" ile "1234567890123456" AYNI değere normalize olur.
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
      -- profiles_mersis_no_unique (yukarıda) ihlal edildi — ham Postgres
      -- kısıt hatası yerine görev bölüm 7'nin istediği anlaşılır kod.
      raise exception 'ML175: mersis_no already registered to another company' using errcode = 'ML175';
  end;

  return v_profile;
end;
$$;

comment on function public.complete_registration(text, text, text, text, text, text, text, text) is
  '0022''nin kaydı tamamlayan RPC''si — 0082 ile p_mersis_no (opsiyonel, normalize edilip 16 haneli biçimde doğrulanır, profiles_mersis_no_unique ile tekilliği zorlanır) eklendi. Zorunlu DEĞİLDİR (görev bölüm 9''un "bireysel kullanıcıyı kayıt dışı bırakma" uyarısı) — yalnızca girildiğinde biçim/tekillik doğrulanır.';

revoke all on function public.complete_registration(text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_registration(text, text, text, text, text, text, text, text) to authenticated;
