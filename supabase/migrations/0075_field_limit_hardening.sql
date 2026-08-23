-- TÜM İLAN FORMLARINDA GERÇEK, ALANA UYGUN VE AŞILAMAZ GİRİŞ SINIRLARI
--
-- 0073/0074'ün genel güvenlik migration'larının doğrudan devamı — o ikisi
-- rate-limit/iletişim-sızıntısı/location_url gibi genel açıkları kapattı,
-- bu migration ise gerçek alan bazlı karakter/sayı/tekrar-eden-grup üst
-- sınırlarını DB seviyesinde tamamlar (görev: "yalnızca arayüzdeki maxLength
-- güvenlik sayılmaz, aynı sınırlar RPC/veritabanı tarafında da olmalı").
-- Her bölümden önce hosted Development'taki gerçek veri, YENİ (daha sıkı)
-- sınırlarla çelişip çelişmediği `npx supabase db query --linked` ile
-- kontrol edildi (bkz. görev raporu) — yalnızca 2 eski ilanın başlığı 80
-- karakteri aşıyor (149/97 karakter, ikisi de "approved"), başka hiçbir
-- çelişki bulunmadı. 0073'ün kendi kuralına göre ("mevcut veriyle çelişen
-- bir CHECK asla eklenmez, yalnızca uyarı basılır") title CHECK'i BU İKİ
-- SATIR İÇİN atlanır — kanıtsız veri kırpma/silme YOK.

-- =============================================================================
-- BÖLÜM 1 — jobs.title / description / address_text / offers.description
-- karakter üst sınırları (görev madde 2). 0073'ün "önce mevcut veriyi
-- kontrol et, çelişiyorsa CHECK ekleme" deseninin AYNISI.
-- =============================================================================

do $$
declare
  v_bad_count integer;
begin
  select count(*) into v_bad_count from public.jobs where length(title) > 80;
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.title satırı yeni 80 karakter sınırının dışında (bkz. görev raporu — bilinen 2 eski ilan) — CHECK eklenmeyecek.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_title_length_check;
    alter table public.jobs add constraint jobs_title_length_check check (length(title) <= 80);
  end if;

  select count(*) into v_bad_count from public.jobs where length(description) > 1000;
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.description satırı yeni sınırın dışında — CHECK eklenmeyecek.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_description_length_check;
    alter table public.jobs add constraint jobs_description_length_check check (length(description) <= 1000);
  end if;

  select count(*) into v_bad_count from public.jobs where length(address_text) > 250;
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet jobs.address_text satırı yeni sınırın dışında — CHECK eklenmeyecek.', v_bad_count;
  else
    alter table public.jobs drop constraint if exists jobs_address_text_length_check;
    alter table public.jobs add constraint jobs_address_text_length_check check (length(address_text) <= 250);
  end if;

  select count(*) into v_bad_count from public.offers where length(description) > 1000;
  if v_bad_count > 0 then
    raise notice 'UYARI: % adet offers.description satırı yeni sınırın dışında — CHECK eklenmeyecek.', v_bad_count;
  else
    alter table public.offers drop constraint if exists offers_description_length_check;
    alter table public.offers add constraint offers_description_length_check check (length(description) <= 1000);
  end if;
end $$;

-- =============================================================================
-- BÖLÜM 2 — Mevcut sayısal CHECK'lerin yeni, alana-uygun sınırlara sıkılaştırılması.
-- 0028/0073'ün kendi sınırları (999.999) genel/tahmini bir üst sınırdı;
-- görev talimatı artık alana özel gerçek sınırlar veriyor (Ürün Adedi
-- 1.000.000, Toplam Ağırlık 100.000 ton). Adet sınırı GENİŞLİYOR (999.999 ->
-- 1.000.000, hiçbir mevcut satırı etkilemez), tonaj sınırı DARALIYOR
-- (999.999 -> 100.000) — bu yüzden her ikisi de önce gerçek veriyle
-- kontrol edildi (bkz. görev raporu, ikisi de 0 çelişki).
-- =============================================================================

alter table public.jobs drop constraint if exists jobs_product_quantity_range;
alter table public.jobs add constraint jobs_product_quantity_range
  check (product_quantity is null or (product_quantity > 0 and product_quantity <= 1000000));

alter table public.jobs drop constraint if exists jobs_product_tonnage_range;
alter table public.jobs add constraint jobs_product_tonnage_range
  check (product_tonnage is null or (product_tonnage > 0 and product_tonnage <= 100000));

alter table public.jobs drop constraint if exists jobs_recycling_quantity_check;
alter table public.jobs add constraint jobs_recycling_quantity_check
  check (recycling_quantity is null or (recycling_quantity > 0 and recycling_quantity <= 1000000));

alter table public.jobs drop constraint if exists jobs_storage_product_quantity_check;
alter table public.jobs add constraint jobs_storage_product_quantity_check
  check (storage_product_quantity is null or (storage_product_quantity > 0 and storage_product_quantity <= 1000000));

alter table public.jobs drop constraint if exists jobs_storage_product_tonnage_check;
alter table public.jobs add constraint jobs_storage_product_tonnage_check
  check (storage_product_tonnage is null or (storage_product_tonnage > 0 and storage_product_tonnage <= 100000));

-- `product_tonnage` numeric(9,2) idi — Nakliye'de Ton biriminde artık 3
-- ondalık basamak destekleniyor (görev madde 2); numeric(9,2) bunu SESSİZCE
-- yuvarlardı (görev talimatı: "sessizce kırpma" YASAK). Ölçek genişletmek
-- (2->3 ondalık) her zaman kayıpsızdır — mevcut 2 ondalıklı değerler
-- birebir korunur, tabloyu yeniden yazar ama veri kaybı YOKTUR. `admin_job_list`
-- (0017) bu kolona bağımlı olduğu için ALTER'dan önce DROP edilip, tam
-- olarak `pg_get_viewdef` ile doğrulanmış AYNI tanımla yeniden oluşturulur —
-- hiçbir sütun/mantık değişmez, yalnızca product_tonnage'ın altındaki kolon
-- tipi genişler.
drop view if exists public.admin_job_list;

alter table public.jobs alter column product_tonnage type numeric(12, 3);

create view public.admin_job_list as
select
  j.*,
  (select count(*) from public.offers o where o.job_id = j.id) as offer_count
from public.jobs j
where is_admin();

comment on view public.admin_job_list is
  '0075: product_tonnage numeric(12,3) genişletmesi için DROP/CREATE edildi — tanım 0017/0035/0075 öncesi ile birebir aynı (j.* + offer_count), yalnızca alttaki kolon tipi değişti.';

-- DROP VIEW mevcut GRANT'leri de düşürür — `authenticated`in SELECT izni
-- (view'ın kendi WHERE is_admin() koşulu gerçek yetkilendirme sınırıdır,
-- bu GRANT yalnızca PostgREST'in view'ı görmesini sağlar) burada AÇIKÇA
-- geri verilir, aksi hâlde admin paneli bu view'ı okuyamaz hâle gelirdi.
grant select on public.admin_job_list to authenticated;

-- =============================================================================
-- BÖLÜM 3 — Tekrar eden yük/konteyner grubu dizilerinin uzunluk sınırı
-- 50'den 20'ye sıkılaştırılıyor (görev madde 2: "İlan başına maksimum 20
-- yük grubu"). Hosted Development'ta şu an en fazla 2 (nakliye) / 3
-- (depolama) grup var (bkz. görev raporu) — güvenle sıkılaştırılabilir.
-- =============================================================================

alter table public.jobs drop constraint if exists jobs_nakliye_cargo_groups_length_check;
alter table public.jobs add constraint jobs_nakliye_cargo_groups_length_check
  check (nakliye_cargo_groups is null or jsonb_array_length(nakliye_cargo_groups) <= 20);

alter table public.jobs drop constraint if exists jobs_storage_container_groups_length_check;
alter table public.jobs add constraint jobs_storage_container_groups_length_check
  check (storage_container_groups is null or jsonb_array_length(storage_container_groups) <= 20);

-- =============================================================================
-- BÖLÜM 4 — JSONB İÇİ eleman-bazında sayısal doğrulama (görev madde 4/9'un
-- en kritik bulgusu: dizi UZUNLUĞU sınırlanmıştı ama her elemanın KENDİ
-- sayısal alanları — productQuantity/productTonnage/measurementInfo
-- ölçüleri/containerTransport.quantity/storage konteyner quantity-grossWeight —
-- hiç sınırlanmamıştı; RPC'yi bypass eden bir istek TEK bir grup içinde
-- aşırı büyük bir sayı gönderebilirdi). BEFORE INSERT/UPDATE trigger'ı, her
-- iki JSONB dizisini de eleman eleman gezip belirli anahtarların sayısal
-- olduğunu VE makul bir üst sınırın altında kaldığını doğrular — 0073'ün
-- "mevcut büyük RPC gövdesini yeniden yazma, TABLOYA trigger ekle" ilkesiyle
-- AYNI, düşük riskli yaklaşım.
-- =============================================================================

create or replace function public.ensure_job_group_numeric_fields_within_bounds()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_group jsonb;
  v_measurement jsonb;
  v_container jsonb;
begin
  if new.nakliye_cargo_groups is not null then
    for v_group in select * from jsonb_array_elements(new.nakliye_cargo_groups)
    loop
      if (v_group->>'productQuantity') is not null
         and ((v_group->>'productQuantity')::numeric <= 0 or (v_group->>'productQuantity')::numeric > 1000000) then
        raise exception 'ML170: nakliye cargo group productQuantity out of bounds' using errcode = 'ML170';
      end if;
      -- Birim-farkında üst sınır — Kg biriminde bir değer Ton'dan ~1000×
      -- büyük olabilir (product-catalog.ts#parseProductTonnage İLE AYNI ilke).
      if (v_group->>'productTonnage') is not null and (
        (v_group->>'productTonnageUnit' = 'kg' and ((v_group->>'productTonnage')::numeric <= 0 or (v_group->>'productTonnage')::numeric > 100000000))
        or
        (coalesce(v_group->>'productTonnageUnit', 'ton') <> 'kg' and ((v_group->>'productTonnage')::numeric <= 0 or (v_group->>'productTonnage')::numeric > 100000))
      ) then
        raise exception 'ML170: nakliye cargo group productTonnage out of bounds' using errcode = 'ML170';
      end if;

      v_measurement := v_group->'measurementInfo';
      if v_measurement is not null then
        if (v_measurement->>'widthCm') is not null and ((v_measurement->>'widthCm')::numeric <= 0 or (v_measurement->>'widthCm')::numeric > 1000) then
          raise exception 'ML171: nakliye measurement widthCm out of bounds' using errcode = 'ML171';
        end if;
        if (v_measurement->>'lengthCm') is not null and ((v_measurement->>'lengthCm')::numeric <= 0 or (v_measurement->>'lengthCm')::numeric > 5000) then
          raise exception 'ML171: nakliye measurement lengthCm out of bounds' using errcode = 'ML171';
        end if;
        if (v_measurement->>'heightCm') is not null and ((v_measurement->>'heightCm')::numeric <= 0 or (v_measurement->>'heightCm')::numeric > 1000) then
          raise exception 'ML171: nakliye measurement heightCm out of bounds' using errcode = 'ML171';
        end if;
        if (v_measurement->>'diameterCm') is not null and ((v_measurement->>'diameterCm')::numeric <= 0 or (v_measurement->>'diameterCm')::numeric > 1000) then
          raise exception 'ML171: nakliye measurement diameterCm out of bounds' using errcode = 'ML171';
        end if;
        if (v_measurement->>'volumeM3') is not null and ((v_measurement->>'volumeM3')::numeric <= 0 or (v_measurement->>'volumeM3')::numeric > 100000) then
          raise exception 'ML171: nakliye measurement volumeM3 out of bounds' using errcode = 'ML171';
        end if;
        if (v_measurement->>'maxStackCount') is not null and ((v_measurement->>'maxStackCount')::numeric <= 0 or (v_measurement->>'maxStackCount')::numeric > 200) then
          raise exception 'ML171: nakliye measurement maxStackCount out of bounds' using errcode = 'ML171';
        end if;
      end if;

      v_container := v_group->'containerTransport';
      if v_container is not null and (v_container->>'quantity') is not null
         and ((v_container->>'quantity')::numeric <= 0 or (v_container->>'quantity')::numeric > 1000) then
        raise exception 'ML172: nakliye container quantity out of bounds' using errcode = 'ML172';
      end if;
    end loop;
  end if;

  if new.storage_container_groups is not null then
    for v_group in select * from jsonb_array_elements(new.storage_container_groups)
    loop
      if (v_group->>'quantity') is not null
         and ((v_group->>'quantity')::numeric <= 0 or (v_group->>'quantity')::numeric > 1000) then
        raise exception 'ML173: storage container quantity out of bounds' using errcode = 'ML173';
      end if;
      if (v_group->>'grossWeight') is not null
         and ((v_group->>'grossWeight')::numeric <= 0 or (v_group->>'grossWeight')::numeric > 100000) then
        raise exception 'ML173: storage container grossWeight out of bounds' using errcode = 'ML173';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

comment on function public.ensure_job_group_numeric_fields_within_bounds() is
  '0075: nakliye_cargo_groups/storage_container_groups JSONB dizilerindeki HER elemanın kendi sayısal alanlarının (miktar/tonaj/ölçü/konteyner adedi) makul üst sınırlar içinde kaldığını doğrular — dizi UZUNLUĞU zaten 0073/0075''in ayrı CHECK''leriyle sınırlı, bu trigger ELEMAN İÇİ değerleri kapsar.';

revoke all on function public.ensure_job_group_numeric_fields_within_bounds() from public, anon, authenticated;

drop trigger if exists trg_jobs_group_numeric_bounds on public.jobs;
create trigger trg_jobs_group_numeric_bounds
  before insert or update on public.jobs
  for each row execute function public.ensure_job_group_numeric_fields_within_bounds();
