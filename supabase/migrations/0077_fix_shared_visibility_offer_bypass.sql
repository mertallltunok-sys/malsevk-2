-- KRİTİK DÜZELTME — 0076'nın gerçek RPC testiyle bulunan teklif-bypass açığı.
--
-- 0076, `provider_can_view_job` (0059/0068/0069) fonksiyonunun kategori
-- kontrolünü İş Makinesi/Operatör grubu için genişletti — AMA bu fonksiyon
-- yalnızca RLS/görünürlük için değil, `create_offer` VE `accept_offer`
-- RPC'lerinin GERÇEK teklif-yetkisi kapısı olarak da kullanılıyormuş (0059'un
-- kendi yorumu: "jobs_select_visible RLS politikası, get_visible_job/
-- get_visible_jobs ve create_offer'in MLK60 kapısı tarafından paylaşılır —
-- TEK doğruluk kaynağı" — bu migration yazılırken bu paylaşım gözden
-- kaçırıldı, yalnızca eski/statik bir migration grep'ine güvenilmişti).
--
-- GERÇEK RPC testiyle (scripts/tmp-shared-heavy-equipment-visibility-test.mjs,
-- Test C) doğrulandı: 0076 sonrası, yalnızca forklift'te yetkili bir
-- sağlayıcı GERÇEK create_offer RPC'siyle bir vinç operatörü ilanına teklif
-- VEREBİLİYORDU — tam olarak görev talimatının kendi açık uyardığı senaryo.
--
-- DÜZELTME: `provider_can_view_job` (0059/0068/0069'un tam imzası, 8
-- parametre) BİREBİR ESKİ hâline (provider_can_view_category, tam eşleşme)
-- DÖNDÜRÜLÜR — create_offer/accept_offer bunu hiç değiştirmeden çağırmaya
-- devam eder, teklif yetkisi ARTIK HİÇ genişlemez. YENİ, AYRI bir fonksiyon
-- — `provider_can_view_job_for_listing` (AYNI 8 parametre, AYNI gövde,
-- yalnızca kategori kontrolü provider_can_view_category_or_group'a
-- yönlendirilmiş) — SADECE görünürlük/listeleme yollarına (jobs_select_visible
-- RLS, get_visible_job, get_visible_jobs) bağlanır. create_offer/accept_offer
-- HİÇ DOKUNULMADI.

-- BÖLÜM 1 — provider_can_view_job: ESKİ hâline (tam eşleşme) dönüyor.
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
  if not public.provider_can_view_category(p_provider_id, p_category_id) then
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
  '0059/0068/0069''un ORİJİNAL hâline (0077 ile) döndürüldü — kategori kontrolü provider_can_view_category''dır (TAM eşleşme). create_offer/accept_offer''in gerçek teklif-yetkisi kapısı BUDUR; görünürlük/listeleme artık AYRI provider_can_view_job_for_listing''i kullanır (bkz. 0077).';

-- BÖLÜM 2 — YENİ, SADECE-GÖRÜNÜRLÜK varyantı: AYNI gövde, kategori kontrolü
-- provider_can_view_category_or_group'a (0076) yönlendirilir.
create or replace function public.provider_can_view_job_for_listing(
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

comment on function public.provider_can_view_job_for_listing(uuid, text, jsonb, boolean, text[], text, text, boolean) is
  '0077: provider_can_view_job (0059/0068/0069) İLE AYNI gövde — TEK FARK: kategori kontrolü provider_can_view_category_or_group (0076, İş Makinesi/Operatör ortak görünürlüğü). YALNIZCA jobs_select_visible RLS/get_visible_job/get_visible_jobs tarafından kullanılır — create_offer/accept_offer HİÇ ÇAĞIRMAZ.';

revoke all on function public.provider_can_view_job_for_listing(uuid, text, jsonb, boolean, text[], text, text, boolean) from public;
grant execute on function public.provider_can_view_job_for_listing(uuid, text, jsonb, boolean, text[], text, text, boolean) to authenticated, anon;

-- BÖLÜM 3 — jobs_select_visible RLS politikası: provider_can_view_job ->
-- provider_can_view_job_for_listing (yalnızca bu TEK çağrı değişiyor, diğer
-- koşullar 0069'dan BİREBİR AYNI).
drop policy if exists jobs_select_visible on public.jobs;
create policy jobs_select_visible on public.jobs
  for select
  using (
    deleted_at is null
    and (
      requester_id = auth.uid()
      or is_admin()
      or (
        moderation_status = 'approved'
        and (
          current_user_role() is distinct from 'hizmet-veren'
          or provider_can_view_job_for_listing(
            auth.uid(), category_id, storage_container_groups, storage_hazardous, storage_risk_groups,
            recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown
          )
        )
      )
    )
  );

-- BÖLÜM 4 — get_visible_job / get_visible_jobs: AYNI değişiklik (görünürlük
-- amaçlı okuma RPC'leri — app/_lib/supabase-job-reads.ts tarafından
-- kullanılıyor, bkz. o dosyanın "useRemoteJobsFallback" ile ilişkisi).
create or replace function public.get_visible_job(p_job_id uuid)
returns public.jobs
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.jobs;
  v_is_admin boolean := public.is_admin();
  v_role text := public.current_user_role();
begin
  select j.* into v_row from public.jobs j
  where j.id = p_job_id
    and j.deleted_at is null
    and (
      j.requester_id = auth.uid()
      or v_is_admin
      or (
        j.moderation_status = 'approved'
        and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job_for_listing(
          auth.uid(), j.category_id, j.storage_container_groups, j.storage_hazardous, j.storage_risk_groups,
          j.recycling_requested_operation, j.recycling_waste_code, j.recycling_waste_code_unknown
        ))
      )
    );

  if not found then
    return null;
  end if;

  if v_row.requester_id is distinct from auth.uid()
     and not v_is_admin
     and not exists (
       select 1 from public.offers o
       where o.job_id = v_row.id
         and o.provider_id = auth.uid()
         and o.status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed')
     )
  then
    v_row.address_text := null;
    v_row.neighborhood := null;
    v_row.location_url := null;
    v_row.directions_note := null;
    v_row.work_location_type := null;
    v_row.facility_id := null;
    v_row.delivery_facility_name := null;
    v_row.delivery_facility_id := null;
    v_row.delivery_address_text := null;
  end if;

  return v_row;
end;
$$;

create or replace function public.get_visible_jobs()
returns setof public.jobs
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.jobs;
  v_is_admin boolean := public.is_admin();
  v_role text := public.current_user_role();
begin
  for v_row in
    select j.* from public.jobs j
    where j.deleted_at is null
      and (
        j.requester_id = auth.uid()
        or v_is_admin
        or (
          j.moderation_status = 'approved'
          and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job_for_listing(
            auth.uid(), j.category_id, j.storage_container_groups, j.storage_hazardous, j.storage_risk_groups,
            j.recycling_requested_operation, j.recycling_waste_code, j.recycling_waste_code_unknown
          ))
        )
      )
  loop
    if v_row.requester_id is distinct from auth.uid()
       and not v_is_admin
       and not exists (
         select 1 from public.offers o
         where o.job_id = v_row.id
           and o.provider_id = auth.uid()
           and o.status in ('accepted', 'in_progress', 'completion_requested', 'completion_disputed')
       )
    then
      v_row.address_text := null;
      v_row.neighborhood := null;
      v_row.location_url := null;
      v_row.directions_note := null;
      v_row.work_location_type := null;
      v_row.facility_id := null;
      v_row.delivery_facility_name := null;
      v_row.delivery_facility_id := null;
      v_row.delivery_address_text := null;
    end if;
    return next v_row;
  end loop;
  return;
end;
$$;
