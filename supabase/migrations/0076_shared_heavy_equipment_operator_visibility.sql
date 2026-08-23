-- İŞ MAKİNESİ / OPERATÖR İLAN GÖRÜNÜRLÜĞÜ (ORTAK GÖRÜNÜRLÜK)
--
-- Görev: İş Makinesi Hizmetleri (forklift/reach-stacker/vinç/manlift) ve
-- Operatör Hizmetleri (bunların operatörlü karşılıkları) — service-catalog.ts
-- "is-makinesi-hizmetleri"/"operator-hizmetleri" grupları, migration 0044'ün
-- PROVIDER_AUTHORIZATION_GROUPS#operator-is-makinesi-yetkisi İLE AYNI 8
-- kategori id'si (SQL PL/pgSQL TypeScript import edemediği için 0044'ün
-- kendi kuralına göre BURADA DA elle senkron tutulur) — bu 8 kategoriden
-- HERHANGİ birinde admin-onaylı aktif yetkisi olan bir hizmet veren, HER
-- İKİ grubun TAMAMINDAKİ yayımlanmış ilanları görebilmeli. Teklif verme
-- yetkisi ise DEĞİŞMİYOR — hâlâ yalnızca gerçekten yetkili olunan TEK
-- kategoride açık.
--
-- KRİTİK MİMARİ KARAR (görev talimatının kendi açık uyarısı: "teklif
-- oluşturma RPC'sinin yalnızca ilan görünürlüğüne güvenip güvenmediğini
-- kontrol et"): `provider_can_view_category(uuid, text)` (0012) hem RLS
-- görünürlüğü (provider_can_view_job üzerinden, 0059) HEM `create_offer`/
-- `accept_offer`'ın (0015/0042) teklif-yetkisi kapısı için KULLANILIYORDU —
-- AYNI fonksiyon. Bu fonksiyonu doğrudan gruplaştırmak, görünürlüğü açarken
-- İSTEMEDEN teklif-bypass açığı da açardı (forklift yetkili biri vinç
-- operatörü ilanına RPC ile teklif verebilirdi). Bu yüzden:
--   - `provider_can_view_category` (0012) TAMAMEN DOKUNULMADI — hâlâ TEK
--     kategori tam eşleşmesi, `create_offer`/`accept_offer` bunu DEĞİŞMEDEN
--     çağırmaya devam ediyor (teklif yetkisi hiç genişlemedi).
--   - YENİ `provider_can_view_category_or_group` yalnızca GÖRÜNÜRLÜK
--     amaçlıdır — `provider_can_view_job`in (0059) İÇİNDEKİ TEK bir satır
--     bu yeni fonksiyonu çağıracak şekilde değiştirildi (create or replace,
--     imza AYNI, ikinci bir overload oluşmaz), fonksiyonun geri kalanı
--     (konteyner/tehlikeli depolama/geri dönüşüm uygunluk kontrolleri)
--     BİREBİR KORUNDU.

create or replace function public.provider_can_view_category_or_group(p_provider_id uuid, p_category_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  -- service-catalog.ts#PROVIDER_AUTHORIZATION_GROUPS'un "operator-is-makinesi-
  -- yetkisi" girdisiyle AYNI 8 id — findGroupCategoryIds("is-makinesi-hizmetleri")
  -- + findGroupCategoryIds("operator-hizmetleri").
  v_group_categories text[] := array[
    'forklift', 'reach-stacker', 'vinc', 'manlift',
    'forklift-operatoru', 'reach-stacker-operatoru', 'vinc-operatoru', 'manlift-operatoru'
  ];
begin
  if not (p_category_id = any(v_group_categories)) then
    return public.provider_can_view_category(p_provider_id, p_category_id);
  end if;

  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    return true;
  end if;

  return exists (
    select 1 from public.provider_service_authorizations
    where provider_id = p_provider_id
      and service_category_id = any(v_group_categories)
      and revoked_at is null
  );
end;
$$;

comment on function public.provider_can_view_category_or_group(uuid, text) is
  '0076: GÖRÜNÜRLÜK-amaçlı sarmalayıcı — İş Makinesi/Operatör 8 kategorisinden BİRİNDE yetkili olmak HER İKİ grubun tamamını görünür kılar. Teklif yetkisi için KULLANILMAZ; create_offer/accept_offer hâlâ değişmeyen provider_can_view_category''yı (tek kategori tam eşleşmesi) çağırır.';

revoke all on function public.provider_can_view_category_or_group(uuid, text) from public;
grant execute on function public.provider_can_view_category_or_group(uuid, text) to authenticated, anon;

-- `provider_can_view_job` (0059) — TEK satır değişti (ilk satır, kategori
-- kontrolü), imza VE gövdenin geri kalanı (konteyner/tehlikeli depolama/
-- geri dönüşüm uygunluk döngüleri) BİREBİR AYNI — create or replace güvenli,
-- ikinci bir overload OLUŞTURMAZ.
create or replace function public.provider_can_view_job(
  p_provider_id uuid,
  p_category_id text,
  p_storage_container_groups jsonb,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null,
  p_recycling_requested_operation text default null,
  p_recycling_waste_code text default null,
  p_recycling_waste_code_unknown boolean default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group jsonb;
  v_status text;
  v_type text;
  v_hazardous boolean;
  v_imo text;
  v_scopes text[];
  v_imo_codes text[];
  v_risk_group text;
  v_required_activity text;
  v_required_activities text[];
  v_recycling_activities text[];
begin
  if not public.provider_can_view_category_or_group(p_provider_id, p_category_id) then
    return false;
  end if;

  if p_category_id = 'konteyner-depolama' and p_storage_container_groups is not null then
    select storage_activity_scopes, imo_class_codes into v_scopes, v_imo_codes
    from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = 'konteyner-depolama' and revoked_at is null
    limit 1;

    for v_group in select * from jsonb_array_elements(p_storage_container_groups) loop
      v_status := v_group->>'status';
      v_type := v_group->>'type';
      v_hazardous := nullif(v_group->>'hazardous', '')::boolean;
      v_imo := v_group->>'imoClass';

      if v_scopes is not null then
        if v_status = 'bos' and not ('bos-konteyner-depolama' = any(v_scopes)) then
          return false;
        end if;
        if v_status = 'dolu' and coalesce(v_hazardous, false) = false and not ('dolu-tehlikesiz-konteyner-depolama' = any(v_scopes)) then
          return false;
        end if;
        if v_status = 'dolu' and v_hazardous = true and not ('dolu-tehlikeli-konteyner-depolama' = any(v_scopes)) then
          return false;
        end if;
        if v_type = 'reefer' and not ('reefer-konteyner-depolama' = any(v_scopes)) then
          return false;
        end if;
      end if;

      if v_status = 'dolu' and v_hazardous = true and v_imo is not null and v_imo <> '' and v_imo_codes is not null then
        if not (v_imo = any(v_imo_codes)) then
          return false;
        end if;
      end if;
    end loop;
  end if;

  if p_category_id in ('kimyasal-depolama', 'tehlikeli-madde-depolama')
     and coalesce(p_storage_hazardous, false) = true
     and p_storage_risk_groups is not null
  then
    foreach v_risk_group in array p_storage_risk_groups loop
      if not exists (
        select 1 from public.provider_storage_risk_authorizations
        where provider_id = p_provider_id and risk_group_id = v_risk_group and revoked_at is null
      ) then
        return false;
      end if;
    end loop;
  end if;

  if p_category_id = 'geri-donusum-atik-tahliye' then
    if coalesce(p_recycling_waste_code_unknown, false) = true
       or p_recycling_waste_code is null or p_recycling_waste_code = ''
    then
      return false;
    end if;

    v_required_activities := case p_recycling_requested_operation
      when 'atik-tahliyesi-tasima' then array['tasima']
      when 'geri-donusum-geri-kazanim' then array['geri-kazanim']
      when 'bertaraf' then array['bertaraf']
      when 'tahliye-geri-kazanim' then array['tasima', 'geri-kazanim']
      when 'tahliye-bertaraf' then array['tasima', 'bertaraf']
      else array[]::text[]
    end;

    select recycling_activities into v_recycling_activities
    from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = 'geri-donusum-atik-tahliye' and revoked_at is null
    limit 1;

    foreach v_required_activity in array v_required_activities loop
      if v_recycling_activities is null or not (v_required_activity = any(v_recycling_activities)) then
        return false;
      end if;
    end loop;

    if not exists (
      select 1 from public.provider_recycling_waste_code_authorizations
      where provider_id = p_provider_id and waste_code = p_recycling_waste_code and revoked_at is null
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function public.provider_can_view_job(uuid, text, jsonb, boolean, text[], text, text, boolean) is
  '0076: 0059''un AYNI fonksiyonu — yalnızca kategori kontrolü provider_can_view_category_or_group''a (İş Makinesi/Operatör ortak görünürlüğü) yönlendirildi, geri kalan konteyner/tehlikeli-depolama/geri-dönüşüm uygunluk mantığı DEĞİŞMEDİ.';

revoke all on function public.provider_can_view_job(uuid, text, jsonb, boolean, text[], text, text, boolean) from public;
grant execute on function public.provider_can_view_job(uuid, text, jsonb, boolean, text[], text, text, boolean) to authenticated, anon;
