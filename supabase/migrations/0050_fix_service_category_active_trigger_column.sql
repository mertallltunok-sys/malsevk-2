-- =============================================================================
-- MALSEVK — migration 0050: 0049'un ensure_service_category_active() sütun hatasını düzelt
-- =============================================================================
-- KÖK NEDEN (canlı test sırasında bulundu, statik incelemeyle yakalanamazdı —
-- bu repodaki 0032/0041/0047 ile AYNI sınıf hata): 0049'un trigger
-- fonksiyonu `tg_table_name in ('provider_documents', 'provider_service_
-- authorizations')` ise `new.service_category_id`, DEĞİLSE (yani jobs VE
-- provider_services için) `new.category_id` okuyordu — ama bu YANLIŞ:
-- yalnızca `jobs.category_id` bu adı taşır, `provider_services` de (0003)
-- `provider_documents`/`provider_service_authorizations` gibi
-- `service_category_id` kullanır. `provider_services` üzerindeki HER
-- INSERT (yeni hizmet seçimi) `record "new" has no field "category_id"`
-- (42703) ile PATLIYORDU — 0049'un eski migration dosyası DEĞİŞTİRİLMİYOR
-- (görev talimatı), bu dosya yalnızca fonksiyonun gövdesini `create or
-- replace function` ile düzeltir; trigger'ların kendisi (tetiklendikleri
-- tablo/kolon) doğruydu, dokunulmadı.
-- =============================================================================

create or replace function public.ensure_service_category_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_id text;
  v_is_active boolean;
begin
  if tg_table_name = 'jobs' then
    v_category_id := new.category_id;
  else
    -- provider_services / provider_documents / provider_service_authorizations
    -- ucunun ucu service_category_id kullanir.
    v_category_id := new.service_category_id;
  end if;

  if v_category_id is null then
    return new;
  end if;

  select is_active into v_is_active from public.service_categories where id = v_category_id;
  if v_is_active is false then
    raise exception 'ML128: service category % is no longer active and cannot be used for new records', v_category_id
      using errcode = 'ML128';
  end if;

  return new;
end;
$$;

comment on function public.ensure_service_category_active() is
  '0050: 0049''un sutun-adi hatasini duzeltir (yalniz jobs.category_id kullanir, provider_services/provider_documents/provider_service_authorizations ucu de service_category_id kullanir) -- ML128''in kendi anlami/kapsami degismedi.';
