-- =============================================================================
-- MALSEVK — migration 0037: Admin İlan Düzenleme — Alan Kaybı Düzeltmesi
-- =============================================================================
-- KÖK NEDEN (kanıtlanmış, tahmin değil — bkz. proje raporu §A): admin-job-
-- edit-form.tsx'te Tonaj alanının GÖRÜNÜRLÜĞÜ `isTonnageRequired(categoryId)`
-- (yalnızca Nakliye'de true) ile kapılıydı, oysa doğru koşul
-- `requiresProductInfo(categoryId)` (Liman Hizmetleri BİRLEŞİM Nakliye)
-- olmalıydı — product-catalog.ts'in kendi doc yorumu zaten "Tonaj Nakliye'de
-- ZORUNLU, Liman Hizmetleri'nin TAMAMINDA isteğe bağlıdır" der; "isteğe
-- bağlı" ALAN GÖSTERİLMESİN anlamına gelmez. Sonuç: Liman Hizmetleri (Lashing/
-- Unlashing/Gözetim/Konteyner Dolum-Boşaltım) ilanlarında Tonaj alanı formda
-- HİÇ görünmüyordu, bu yüzden değeri asla gönderilmiyordu (`undefined` ->
-- `null`), VE bu RPC'nin (0035) `product_tonnage = p_product_tonnage`
-- KOŞULSUZ ataması (coalesce YOK) bunu doğrudan NULL'a eziyordu — admin
-- yalnızca başlığı değiştirse bile.
--
-- Bu, tek başına bir "tonaj bug'ı" değil, bir SINIF: aynı koşulsuz atama
-- deseni product_quantity/product_type/customs_product_type için de vardı
-- (bugün TESADÜFEN güvenli, çünkü onların form-görünürlük koşulu create-time
-- doldurma koşuluyla birebir eşleşiyor) — ama gelecekte AYNI hatanın
-- tekrarlanmasına karşı hiçbir savunma yoktu. Bu migration İKİ katmanlı
-- düzeltir: (1) admin-job-edit-form.tsx'teki görünürlük koşulu ayrı bir
-- commit'te düzeltildi (kod tarafı), (2) BURADA, RPC'nin kendisi artık HER
-- opsiyonel/kategoriye-bağlı-görünür alan için `coalesce(p_x, x)` kullanır —
-- form tarafında BENZER bir görünürlük hatası TEKRAR olsa bile RPC bir
-- daha ASLA var olan veriyi sessizce silmez (yalnızca güncellemeyi atlar).
--
-- KAPSAM GENİŞLEMESİ (görev bölüm 1-3, 7, 12): admin edit formu ayrıca
-- şimdiye kadar hiç kapsamadığı ama create_job'un (0031/0035) zaten yazdığı
-- gerçek içerik alanlarını da kapsıyor: operation_details, neighborhood,
-- location_url, directions_note (özel/"Listede yok" konum alanları),
-- delivery_province, delivery_district (Nakliye teslim ili/ilçesi — yalnızca
-- delivery_facility_name/delivery_address_text vardı, il/ilçe eksikti).
-- BİLEREK KAPSAM DIŞI BIRAKILANLAR (bkz. proje raporu §N, gerekçeleriyle):
-- facility_id/location_mode/delivery_facility_id/delivery_location_type
-- (katalog-ilişkili alanlar — admin panelinde tam bir Bölge/Tesis seçici
-- inşa etmek bu görevin kapsamının dışında, İKİNCİ bir tasarım sistemi
-- İCAT ETMEME kuralına aykırı olurdu; bu dört alan basitçe SET listesinden
-- HİÇ dokunulmadan atlanır — parametre bile almazlar, bu yüzden RPC'nin
-- kendisi onları asla değiştiremez, coalesce'e bile gerek yok); customs_
-- transaction_type/customs_requested_services/customsDocuments (Supabase
-- şemasında HİÇ kolon yok — 0028'in kendi başlığında zaten "Gümrük
-- Müşavirliği'nin remain unrepresented in the Supabase schema... explicit,
-- documented scope boundary" diye belgelenmiş; create_job'un imzasını (27
-- parametre, 3 kez stale-overload bug'ı yaşamış — 0032/0033/0034) bu görev
-- kapsamında GENİŞLETMEK, tonaj veri-kaybı düzeltmesiyle İLGİSİZ, çok daha
-- büyük ve riskli AYRI bir karar olurdu).
--
-- STALE OVERLOAD KORUMASI (0032/0033/0034'ün kendi belgelediği ders): bu
-- fonksiyonun parametre listesi DEĞİŞİYOR (yeni alanlar ekleniyor) — `create
-- or replace function` bunu YALNIZCA imza BİREBİR eşleşirse gerçekten
-- DEĞİŞTİRİR, aksi halde eskisini canlı bırakıp yeni bir overload'ı AYRICA
-- CREATE eder (PostgREST PGRST203 "Could not choose the best candidate"
-- hatasına yol açar). Bu yüzden eski 16-parametreli overload BURADA, aynı
-- migration içinde, açıkça DROP edilir.
-- =============================================================================

drop function if exists public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, timestamptz);

create or replace function public.update_job_as_admin(
  p_job_id uuid,
  p_title text, p_description text,
  p_province text, p_district text, p_work_location_type text, p_address_text text,
  p_work_date date, p_work_end_date date default null,
  p_product_quantity integer default null, p_product_tonnage numeric default null, p_product_type text default null,
  p_customs_product_type text default null,
  p_delivery_facility_name text default null, p_delivery_address_text text default null,
  p_operation_details text default null,
  p_neighborhood text default null, p_location_url text default null, p_directions_note text default null,
  p_delivery_province text default null, p_delivery_district text default null,
  p_expected_updated_at timestamptz default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
begin
  if not public.is_admin() then
    raise exception 'ML115: admin role required' using errcode = 'ML115';
  end if;

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML116: job not found' using errcode = 'ML116';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for review, please re-review' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;

  -- NOT: title/description/province/district/work_location_type/address_text/
  -- work_date her zaman doğrudan atanır — bunlar formun `isValid` kontrolüyle
  -- HER gönderimde zorunlu ve dolu, coalesce'e gerek yok (ve yanlışlıkla
  -- "asla temizlenemez" davranışı da İSTENMEZ, admin bunları gerçekten
  -- düzeltmek için buradadır). work_end_date de İSTEĞE BAĞLI ama formda HER
  -- ZAMAN görünür (kategoriye bağlı gizlenmez) — admin onu bilerek
  -- temizleyebilmeli, bu yüzden o da doğrudan atanır.
  --
  -- Aşağıdaki TÜMÜ ise hem opsiyonel HEM DE kategoriye/moda göre formda
  -- KOŞULLU görünür (bu tam olarak tonaj bug'ının sınıfı) — bu yüzden HEPSİ
  -- `coalesce(p_x, x)` ile GÜVENLİ birleştirilir: form bu alanı hiç
  -- göstermediyse (p_x = null gelir) mevcut değer AYNEN korunur; form
  -- gösterip admin gerçekten yeni bir değer girdiyse o değer yazılır. Bilinen
  -- ve kabul edilen sınır: bu semantikle admin, DOLU bir opsiyonel alanı
  -- tamamen BOŞA döndüremez (yalnızca BAŞKA bir değerle değiştirebilir) —
  -- görev bölüm 5'in "hiçbir koşulda kaybolmamalı" gereksinimini KESİN
  -- garanti etmek için kasıtlı bir ödünleşim (bkz. proje raporu §E).
  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = coalesce(p_product_quantity, product_quantity),
    product_tonnage = coalesce(p_product_tonnage, product_tonnage),
    product_type = coalesce(p_product_type, product_type),
    customs_product_type = coalesce(p_customs_product_type, customs_product_type),
    delivery_facility_name = coalesce(p_delivery_facility_name, delivery_facility_name),
    delivery_address_text = coalesce(p_delivery_address_text, delivery_address_text),
    operation_details = coalesce(p_operation_details, operation_details),
    neighborhood = coalesce(p_neighborhood, neighborhood),
    location_url = coalesce(p_location_url, location_url),
    directions_note = coalesce(p_directions_note, directions_note),
    delivery_province = coalesce(p_delivery_province, delivery_province),
    delivery_district = coalesce(p_delivery_district, delivery_district)
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

comment on function public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, text, text, text, text, text, text, timestamptz) is
  'Admin-only ilan düzeltme (0035, 0037''de alan kapsamı genişletildi + PATCH semantiği eklendi). Kategori-koşullu görünür TÜM opsiyonel alanlar coalesce(p_x, x) ile korunur — formda gösterilmeyen/dokunulmayan bir alan asla NULL''a ezilmez. facility_id/location_mode/delivery_facility_id/delivery_location_type ve customs_transaction_type/customs_requested_services bilerek KAPSAM DIŞI (bkz. migration başlığı) — parametre bile almazlar, bu yüzden bu fonksiyon onları hiçbir şekilde değiştiremez.';

revoke all on function public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, text, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.update_job_as_admin(uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text, text, text, text, text, text, text, text, text, timestamptz) to authenticated;
