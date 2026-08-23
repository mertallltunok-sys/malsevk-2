-- =============================================================================
-- MALSEVK — migration 0052: MALSEVK genel ilan konum/iletişim gizliliği
-- =============================================================================
-- AMAÇ: "MALSEVK genel ilan gizlilik kuralı" — teklif kabul edilmeden önce,
-- ilanı görmeye yetkili HER Hizmet Veren (16 aktif hizmet kategorisinin
-- TAMAMINDA, yalnızca Nakliye'de DEĞİL) yalnızca işi değerlendirmek için
-- gereken bilgileri görebilir: kategori/başlık/açıklama/İlçe-İl/tarihler/
-- kategoriye özel ürün-tonaj-adet-ekipman bilgileri. Tesis/fabrika/liman/OSB
-- adı, açık adres, harita/yol tarifi VE Hizmet Alan'ın iletişim bilgileri
-- (bkz. BÖLÜM 0) yalnızca ilan sahibi, admin, ve teklifi KABUL EDİLMİŞ (ve
-- anlaşması hâlâ geçerli) Hizmet Veren için açılır. Bu gizleme sunucu
-- tarafında (RPC projection) uygulanır, CSS/React koşuluyla DEĞİL.
--
-- KAPSAM GENİŞLEMESİ NOTU: bu dosyanın önceki taslakları (a) yalnızca
-- Nakliye kategorisini kapsıyordu, (b) ayrı bir "job_route_reveals" yetki
-- tablosu icat ediyordu. Development'ta HİÇBİR taslak canlı OBJE olarak hiç
-- var olmadı (bkz. proje raporu — bu yüzden "geçmiş migration dosyasını
-- değiştirme" kuralını İHLAL ETMİYOR). Bu sürüm: (a) maskeleme kategoriden
-- BAĞIMSIZ hale getirildi — Nakliye'nin delivery_* alanları zaten yalnızca
-- Nakliye'de dolu olduğu için (job-store.ts#resolveDeliveryLocationFields'ın
-- "kapsam dışıysa temizlenir" kuralı) diğer kategorilerde bu alanları
-- maskelemenin gözlemlenebilir hiçbir etkisi yoktur — tek bir koşulsuz kural
-- hem daha basit hem daha doğru; (b) job_route_reveals TAMAMEN KALDIRILDI,
-- görünürlük YALNIZCA public.offers.status'tan (canlı sorgu) hesaplanıyor.
--
-- BULGU (canlı doğrudan Postgres bağlantısıyla doğrulandı):
--   1) information_schema.role_column_grants: jobs.address_text (ve
--      neighborhood/location_url/directions_note/work_location_type/
--      facility_id/delivery_facility_name/delivery_facility_id/
--      delivery_address_text) BUGÜN anon VE authenticated için SELECT açık
--      — grantor=postgres, is_grantable=NO (doğrudan bir GRANT'ten geliyor).
--      0013_rls_policies.sql'in bu tam kolonlar için bir REVOKE satırı
--      olmasına rağmen (git geçmişi: ilk commit'ten beri değişmemiş) canlı
--      veritabanında etkisiz. Kesin kök neden canlı sunucu audit log'u
--      olmadan kanıtlanamaz; en olası açıklama, bu hosted dev projede
--      "Merkezi Veri Zorunluluğu Faz 5" özelliğinin canlı testi sırasında bu
--      REVOKE'un supabase-job-reads.ts'in SELECT'ini kalıcı olarak kırdığı
--      fark edilip migration dosyasına YANSITILMADAN doğrudan (dashboard SQL
--      editor/manuel oturum) `grant select on jobs to authenticated, anon`
--      yeniden çalıştırılmış olmasıdır.
--   2) `select count(*) from public.offers` = 0 satır — hiçbir hesap,
--      hiçbir teklif Supabase'e hiç yazılmamış (app/_lib/offers.ts'de tek
--      bir Supabase referansı yok). Bu yüzden görünürlük kararını GERÇEK bir
--      kaynaktan hesaplamak için app kodu artık TÜM kategorilerde,
--      best-effort DEĞİL BLOKLAYAN şekilde mevcut create_offer/accept_offer/
--      reject_offer/withdraw_offer/record_agreement_failure RPC'lerine
--      bağlanıyor (bu migration'ın kapsamı DIŞINDA, ayrı app-kodu
--      değişikliği — bkz. proje raporu, app/_lib/supabase-offer-sync.ts).
--
-- Bu migration ham tablo GRANT/REVOKE durumuna GÜVENMİYOR — tüm gizleme
-- SECURITY DEFINER fonksiyon gövdesinde, satır satır, çağıranın kimliğinden
-- bağımsız olarak uygulanıyor; AYRICA bu migration'ın kendisi 9 hassas
-- kolonun ham tablo SELECT ayrıcalığını GERÇEKTEN kapatıyor (BÖLÜM 1).
--
-- İKİNCİ BİR İLAN TABLOSU YOK, İKİNCİ BİR KABUL/YETKİ KAVRAMI YOK:
-- `public.jobs`/`public.offers` aynen kullanılıyor. Yalnızca (a) 9 hassas
-- `jobs` kolonunun ham SELECT ayrıcalığı anon/authenticated'ten kapatılıyor,
-- (b) mevcut merkezi ilan okuma akışının çağıracağı iki salt-okunur
-- projeksiyon RPC'si ekleniyor, (c) BÖLÜM 0'da Hizmet Alan iletişim
-- bilgilerinin (profiles) zaten satır-seviyesi RLS ile korunduğu doğrulanıp
-- BELGELENIYOR (kod değişikliği gerektirmiyor), (d) BÖLÜM 3'te başlık/
-- açıklama serbest metnine yazılmış telefon/e-posta kalıplarını reddeden
-- basit bir içerik-güvenliği trigger'ı ekleniyor (istemci tarafı
-- doğrulamanın sunucu tarafı yedeği — bkz. proje raporu §8).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 0 — Hizmet Alan iletişim bilgileri (profiles.phone/full_name/
-- company_name) zaten satır-seviyesi RLS ile korunuyor, DOĞRULANDI, DEĞİŞİKLİK
-- GEREKMİYOR: `profiles_select_own_or_admin` (0013) `using (id = auth.uid()
-- or public.is_admin())` — bir Hizmet Veren'in BAŞKA bir kullanıcının
-- profiles satırını (dolayısıyla telefon/e-posta/firma adı) doğrudan
-- `select * from profiles where id = <requester_id>` ile okuması RLS
-- tarafından SIFIR SATIR döndürülerek engellenir (kolon-seviyesi bir GRANT
-- sorunu değil, satır-seviyesi RLS — bu migration'ın BÖLÜM 1'deki gibi ayrıca
-- "gerçekten etkin mi" diye canlı doğrulanması AYRI bir denetim adımında
-- yapıldı, bkz. proje raporu). `jobs` tablosunda Hizmet Alan'ın firma/
-- iletişim bilgisini taşıyan hiçbir kolon YOKTUR (bkz. 0004'ün kendi notu:
-- "company_or_factory_name intentionally NOT included: legacy/removed
-- from forms"). Bu yüzden BÖLÜM 1/2'nin kapsamı yalnızca `jobs` tablosunun
-- KENDİ konum kolonlarıdır — iletişim bilgisi ayrı bir mekanizma gerektirmez.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — hassas konum alanlarının ham tablo erişimini GERÇEKTEN kapat. Bu
-- 9 kolon HER kategoride ortaktır (pickup: address_text/neighborhood/
-- location_url/directions_note/work_location_type/facility_id) ya da yalnızca
-- Nakliye'de dolu olur (delivery_*, diğer kategorilerde zaten her zaman NULL
-- — bkz. job-store.ts#resolveDeliveryLocationFields) — bu yüzden TEK bir
-- koşulsuz REVOKE, hem ortak hem Nakliye'ye-özel alanları doğru kapsar.
-- BÖLÜM 2'deki get_visible_jobs/get_visible_job RPC'leri SECURITY DEFINER
-- olarak tanımlı olduğundan tablo sahibinin ayrıcalıklarıyla okur ve
-- app/_lib/supabase-job-reads.ts artık HER kategori için (yalnızca Nakliye
-- değil) ham SELECT yerine bu RPC'leri çağıracak şekilde güncellendi (bkz.
-- proje raporu) — hiçbir kategori/ekran için app'in gördüğü veri
-- DEĞİŞMİYOR, yalnızca DOĞRUDAN REST/tablo çağrısıyla bypass etme yolu
-- kapanıyor.
-- -----------------------------------------------------------------------------
revoke select (
  address_text, neighborhood, location_url, directions_note,
  work_location_type, facility_id,
  delivery_facility_name, delivery_facility_id, delivery_address_text
) on public.jobs from authenticated, anon;

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — get_visible_jobs / get_visible_job: public.jobs_select_visible
-- (0013/0035) satır görünürlüğünün BİREBİR AYNI kopyası (SECURITY DEFINER
-- içinde yeniden uygulanıyor, çünkü bu fonksiyonlar RLS'i bypass eder —
-- ikisinin ASLA birbirinden sapmaması için tek satırlık aynı koşul
-- kullanılır — kategori yetkisi/belge onayı zaten provider_can_view_category
-- (0038/0041) üzerinden bu koşulun İÇİNDE), artı KATEGORİDEN BAĞIMSIZ konum
-- maskeleme. Maskeleme koşulu: çağıran ilan sahibi/admin DEĞİLSE VE
-- `public.offers`'ta bu (job, auth.uid()) çifti için
-- job-requests.ts#ENGAGED_OFFER_STATUSES ile BİREBİR AYNI durum kümesinde
-- ('accepted','in_progress','completion_requested','completion_disputed')
-- bir teklif YOKSA 9 hassas alan NULL'a indirgenir — HER kategori için AYNI
-- kural, kategoriye özel dallanma YOK. Statik bir grant/revoke DEĞİL; her
-- çağrıda offers.status'un GÜNCEL hâli okunur — teklif sonradan
-- agreement_failed/cancelled olursa bir SONRAKİ okumada otomatik olarak
-- tekrar gizlenir, ayrı bir "revoke" eylemi gerekmez.
--
-- Sertleştirme (kullanıcı talimatı — sabit search_path, açık şema adları,
-- yalnız gerekli rollere EXECUTE, askıya alınmış hesabı/kategori
-- yetkilendirmesini bozmayan yapı): `set search_path = public, pg_temp`
-- (yalnızca `public` yerine, olası bir `pg_temp` nesne-gölgeleme saldırısına
-- karşı ekstra savunma — fonksiyon gövdesindeki HER referans zaten
-- `public.` ile açıkça şema-nitelikli, bu yüzden `pg_temp`'in kendisi hiç
-- çözümlenmeyecek, yalnızca savunma-derinliği). Askıya alınmış hesap: bu
-- fonksiyonlar SALT OKUNUR (0042'nin kendi kapsamı "yalnızca mutasyonlar" —
-- bkz. o migration'ın dosya başlığı), bu yüzden BİLEREK assert_active_user()
-- ÇAĞIRMIYOR, tıpkı jobs_select_visible RLS'inin kendisi gibi (bir askıya
-- alınmış kullanıcının KENDİ verisi okunabilir kalmaya devam eder, yalnızca
-- yeni mutasyonlar engellenir).
-- -----------------------------------------------------------------------------
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
          and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_category(auth.uid(), j.category_id))
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

comment on function public.get_visible_jobs() is
  '0052: jobs_select_visible (0013/0035) ile BİREBİR AYNI satır görünürlüğü (kategori yetkisi + belge onayı dahil, provider_can_view_category üzerinden), artı HER kategoride tesis adı/açık adres (pickup+delivery) alanlarının, çağıranın bu ilanda ENGAGED_OFFER_STATUSES kümesinde (public.offers.status) bir teklifi olmadığı sürece, sunucu tarafında NULL''a indirgenmesi. İkinci bir yetki tablosu YOK — görünürlük doğrudan public.offers''tan, canlı olarak hesaplanır. app/_lib/supabase-job-reads.ts#fetchAllVisibleJobsFromSupabase tarafından çağrılır.';

revoke all on function public.get_visible_jobs() from public, anon;
grant execute on function public.get_visible_jobs() to authenticated, anon;

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
        and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_category(auth.uid(), j.category_id))
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

comment on function public.get_visible_job(uuid) is
  '0052: get_visible_jobs() ile AYNI mantığın tek-ilan hâli — app/_lib/supabase-job-reads.ts#fetchJobByIdFromSupabase VE app/_lib/admin-jobs.ts#getJobDetailForAdmin (admin dalı is_admin() ile maskelemeden geçer) tarafından çağrılır; ikisi de artık jobs tablosunu DOĞRUDAN okumak yerine bu TEK merkezi RPC''yi kullanır.';

revoke all on function public.get_visible_job(uuid) from public, anon;
grant execute on function public.get_visible_job(uuid) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — İlan içeriğinden sızıntı: başlık/açıklamaya doğrudan yazılmış
-- telefon numarası veya e-posta adresi kalıplarını reddet. İstemci tarafı
-- doğrulamanın (job-form-validation.ts) sunucu tarafı YEDEĞİ — RPC'yi
-- bypass eden doğrudan bir INSERT/UPDATE bile bunu atlayamaz. BİLEREK basit/
-- muhafazakâr: yalnız YÜKSEK GÜVENİLİRLİKLİ e-posta kalıbı ve açıkça
-- telefon-şekilli (10-11 haneli, yaygın ayraçlarla) rakam dizileri
-- reddedilir — meşru bir açıklamadaki ürün kodu/tarih/miktar gibi kısa rakam
-- dizilerini YANLIŞLIKLA reddetmemek için agresif bir genel-amaçlı "herhangi
-- bir rakam dizisi" kuralı KULLANILMAZ (görev talimatı: "test edilmeden
-- 'tamamen çözüldü' deme" — bu, otomatik tespitin doğası gereği eksiksiz
-- olmadığının kabulüdür, fotoğraf/tabela riski AYRICA çözülmemiş olarak
-- kalır, bkz. proje raporu).
-- -----------------------------------------------------------------------------
create or replace function public.ensure_job_content_has_no_direct_contact_info()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_combined text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  if v_combined ~* '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' then
    raise exception 'ML136: title/description may not contain an email address' using errcode = 'ML136';
  end if;
  if v_combined ~ '(\+?\d[\s.\-]?){10,13}\d' then
    raise exception 'ML137: title/description may not contain a phone number' using errcode = 'ML137';
  end if;
  return new;
end;
$$;

comment on function public.ensure_job_content_has_no_direct_contact_info() is
  '0052: jobs.title/description''e yazılmış e-posta/telefon kalıplarını reddeden, istemci doğrulamasının (job-form-validation.ts) sunucu tarafı yedeği — kasıtlı olarak muhafazakâr (yanlış-pozitif riskini düşük tutmak için yalnızca açıkça e-posta/telefon şekilli dizileri yakalar), tabela/fotoğraf içeriği kapsam DIŞIDIR (bkz. proje raporu açık risk notu).';

revoke all on function public.ensure_job_content_has_no_direct_contact_info() from public, anon, authenticated;

drop trigger if exists trg_jobs_content_no_contact_info on public.jobs;
create trigger trg_jobs_content_no_contact_info
  before insert or update of title, description on public.jobs
  for each row execute function public.ensure_job_content_has_no_direct_contact_info();
