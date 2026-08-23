-- =============================================================================
-- MALSEVK — migration 0069: "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme"
-- görevi — mevcut Geri Dönüşüm & Atık Tahliye hizmetini GÜÇLENDİRİR, yeni bir
-- hizmet kategorisi/paralel belge sistemi/ikinci bir yetkilendirme mimarisi
-- İCAT ETMEZ. Görev talimatının kendi açık cevabı (kullanıcının 3
-- AskUserQuestion cevabından): Kimyasal Depolama/Tehlikeli Madde Depolama
-- için 0068'de kurulan "kapsam bazlı yetkilendirme" yaklaşımı YENİDEN
-- KULLANILIR, ama DEPOLAMA yetkisi ATIK yetkisi yerine ASLA kabul edilmez —
-- bu iki eksen (0068'in provider_storage_risk_authorizations'ı ile bu
-- migration'ın provider_recycling_waste_code_authorizations'ı) TAMAMEN
-- BAĞIMSIZDIR.
--
-- MİMARİ KARAR — İKİ AYRI EKSEN, İKİ FARKLI (ama HER İKİSİ DE var olan
-- desenden ödünç alınan) MEKANİZMA:
--  1. FAALİYET (tasima/geri-kazanim/bertaraf, 3 sabit değer) — 0059'un
--     storage_activity_scopes/imo_class_codes ÖRNEĞİNİ izler: kategoriye
--     ÖZEL bir text[] sütunu, provider_service_authorizations'ın (Geri
--     Dönüşüm & Atık Tahliye kategorisi için TEK aktif) satırının ÜZERİNDE
--     — YENİ bir tablo İCAT EDİLMEDİ, çünkü faaliyet sayısı sabit/küçük (3)
--     ve kategoriyle bire bir ilişkilidir (0059'daki gerekçeyle AYNI).
--  2. ATIK KODU (86 resmî EK-4 kodu, her biri BAĞIMSIZ onaylanabilir/
--     reddedilebilir) — 0068'in provider_storage_risk_authorizations
--     ÖRNEĞİNİ izler: YENİ, BAĞIMSIZ bir tablo (provider_recycling_waste_
--     code_authorizations), çünkü kod sayısı büyük/değişken ve HER kod
--     kendi audit/revoke tarihçesini hak eder (görev bölüm 3'ün kendi somut
--     örneği: "15 01 10* için onaylı, Geri Kazanım için onaylı DEĞİL").
--     Fail-closed varsayılan 0068 İLE AYNI (hiçbir aktif satır = yetkisiz) —
--     bu da tamamen yeni bir özellik, korunması gereken "önceden sınırsız
--     yetkilendirilmiş" bir küme yok.
--
-- ÖZEL/YÜKSEK RİSKLİ ATIKLAR (görev bölüm 9): tıbbi/enfeksiyöz atık (EK-4
-- bölüm 18) bu migration'ın referans kataloğuna (BÖLÜM 3) HİÇ DAHİL
-- EDİLMEDİ — MALSEVK kapsamı dışı, seçilebilir bir kod olarak asla var
-- olmayacak. Asbest (17 06 05*) İSE gerçek bir kod olarak İnşaat/Yıkım Atığı
-- altında VAR — ama "her kod bağımsız onaylanır" ilkesi zaten bu kodu genel
-- faaliyet/kategori yetkisiyle asla otomatik açılmayacak şekilde korur: bir
-- provider'ın 17 06 05* için provider_recycling_waste_code_authorizations'ta
-- AYRI, AKTİF bir satırı olmadıkça provider_can_view_job bu kod için HER
-- ZAMAN false döner — grup bazlı bir otomatik-genişletme YOKTUR (0044'ün
-- depo-hizmetleri-belgesi grup mekanizmasının aksine, BİLEREK).
--
-- TEHLİKE DURUMU (görev bölüm 1.D): recycling_hazardous İSTEMCİDEN ASLA
-- güvenilmez — derive_recycling_hazardous(waste_code) (BÖLÜM 4) her yazma
-- noktasında (create_job/create_operation_with_jobs/update_job_as_admin/
-- update_job_as_requester) sunucu tarafında yeniden hesaplanır, tıpkı
-- job-store.ts#resolveRecyclingFields'in istemci tarafında yaptığı gibi —
-- bu da recycling_waste_codes (BÖLÜM 3) referans tablosuna karşı bir
-- LOOKUP'tır, İKİNCİ bir kısaltılmış/tahmini kural DEĞİL.
--
-- TİCARİ YÖN (görev bölüm 5): offers.commercial_direction YALNIZCA bir
-- ETİKETTİR — ödeme altyapısı, komisyon, muhasebe, operasyon durumları HİÇ
-- DEĞİŞMEDİ. "ucretsiz-alim" iken amount=0'a izin vermek için offers_amount_
-- check GEVŞETİLİR (BÖLÜM 2) — bu, mevcut "amount > 0" kuralının YERİNE
-- geçen tek satırlık bir koşullu genişletmedir, ayrı bir ödeme yolu değildir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BÖLÜM 1 — jobs: 5 yeni sütun (yalnızca Geri Dönüşüm & Atık Tahliye için
-- anlamlı, diğer HER kategoride her zaman null — 0053/0057/0068 İLE AYNI
-- "kategoriye özel, diğerlerinde hep null" ilkesi).
-- -----------------------------------------------------------------------------
alter table public.jobs
  add column if not exists recycling_requested_operation text null,
  add column if not exists recycling_waste_code text null,
  add column if not exists recycling_waste_code_unknown boolean null,
  add column if not exists recycling_hazardous boolean null,
  add column if not exists recycling_hazard_properties text[] null;

comment on column public.jobs.recycling_requested_operation is
  'app/_lib/recycling-catalog.ts#RecyclingRequestedOperationId ile birebir (5 sabit id). "Talep Edilen İşlem" -> gereken faaliyet(ler) eşlemesi getRequiredRecyclingActivities''in (istemci) ve bu migration''daki plpgsql eşdeğerinin (BÖLÜM 14) TEK ortak kaynağıdır — ELLE senkron tutulur.';
comment on column public.jobs.recycling_waste_code is
  'recycling_waste_codes (BÖLÜM 3) referans tablosundaki bir "code" değeri — recycling_waste_code_unknown = true iken null. Sunucu tarafında create_job/create_operation_with_jobs/update_job_as_admin/update_job_as_requester tarafından recycling_waste_codes''a karşı doğrulanır (assert_valid_recycling_waste_code, BÖLÜM 5) — istemci tarafından uydurulmuş bir kod asla kabul edilmez.';
comment on column public.jobs.recycling_waste_code_unknown is
  '"Atık kodunu bilmiyorum" seçildiğinde true — bu durumda recycling_waste_code/recycling_hazardous her zaman null''dır. provider_can_view_job (BÖLÜM 14) bu bayrak true iken Geri Dönüşüm & Atık Tahliye ilanını HİÇBİR hizmet verene göstermez (fail-closed) — admin incelemesi/düzeltmesi beklenir, sistem asla tahmini bir kod üretmez.';
comment on column public.jobs.recycling_hazardous is
  'İSTEMCİDEN ASLA doğrudan yazılmaz — derive_recycling_hazardous(recycling_waste_code) (BÖLÜM 4) ile HER yazmada sunucu tarafında yeniden hesaplanır (kullanıcı/admin yıldızlı bir kodu asla tehlikesiz olarak override edemez). Kod bilinmiyorsa (recycling_waste_code_unknown = true) null.';
comment on column public.jobs.recycling_hazard_properties is
  'app/_lib/recycling-waste-code-catalog.ts#WasteHazardPropertyId ile birebir (6 sabit id, çoklu seçim) — yalnızca recycling_hazardous = true iken anlamlı; sunucu tarafında da bu koşula göre temizlenir (BÖLÜM 18/20/21). Storage risk gruplarıyla (jobs.storage_risk_groups) VE Nakliye ADR sınıflarıyla (nakliye_hazmat.adr_class) KARIŞTIRILMAZ — tamamen ayrı, bağımsız bir kataloktur.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 2 — offers: "Teklifin Ticari Yönü" — YALNIZCA bir etiket, ödeme
-- altyapısı/komisyon/operasyon durumları HİÇ DEĞİŞMEDİ (bkz. bu migration'ın
-- başlık dokümanı). offers_amount_check, "ucretsiz-alim" iken amount=0'a
-- izin verecek şekilde GEVŞETİLİR — mevcut kuralın (amount > 0) YERİNE
-- geçen tek koşullu genişletme, ikinci bir ödeme yolu DEĞİL.
-- -----------------------------------------------------------------------------
alter table public.offers
  add column if not exists commercial_direction text null;

alter table public.offers drop constraint if exists offers_commercial_direction_check;
alter table public.offers add constraint offers_commercial_direction_check check (
  commercial_direction is null or commercial_direction in ('hizmet-bedeli', 'atik-satin-alma', 'ucretsiz-alim')
);

alter table public.offers drop constraint if exists offers_amount_check;
alter table public.offers add constraint offers_amount_check check (
  (commercial_direction = 'ucretsiz-alim' and amount = 0)
  or (amount > 0 and amount <= 999999999)
);

comment on column public.offers.commercial_direction is
  'app/_lib/recycling-catalog.ts#RecyclingCommercialDirection ile birebir — YALNIZCA Geri Dönüşüm & Atık Tahliye ilanlarında create_offer tarafından zorunlu kılınır (BÖLÜM 16, Nakliye''nin estimated_duration''ı İLE AYNI "yalnızca ilgili kategoride toplanır" ilkesi), diğer her kategoride her zaman null. Salt etikettir — hiçbir ödeme/komisyon/tahsilat mantığı bu alana bağlı DEĞİLDİR.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 3 — recycling_waste_codes: GERÇEK, DOĞRULANMIŞ, RESMÎ referans
-- kataloğu — app/_lib/recycling-waste-code-catalog.ts#WASTE_CODE_ENTRIES'in
-- SUNUCU TARAFI birebir aynası (86 kod, aynı kaynak: Atık Yönetimi
-- Yönetmeliği EK-4, RG 02.04.2015/29314, değişik RG 23.03.2017/30016 —
-- bkz. o dosyanın kendi başlık dokümanındaki tam kaynak/çapraz-doğrulama
-- açıklaması). Bu tablo İKİ amaca hizmet eder: (1) "geçerli bir resmî kod
-- mu" doğrulaması (create_job/create_operation_with_jobs/update_job_as_
-- admin/update_job_as_requester, BÖLÜM 18/19/20/21 — istemci tarafından
-- uydurulmuş bir kod asla kabul edilmez), (2) derive_recycling_hazardous
-- (BÖLÜM 4) için tehlike-durumu kaynağı. service_categories/badge_types İLE
-- AYNI "DB-first referans katalog" deseni — yeni bir kod eklemek yalnızca
-- bu tabloya (VE eşzamanlı olarak recycling-waste-code-catalog.ts'e) bir
-- INSERT'tir, migration/CHECK değişikliği gerekmez.
--
-- KASITLI OLARAK HARİÇ (görev bölüm 9, "özel/yüksek riskli atıklar"): EK-4
-- bölüm 18 (tıbbi/enfeksiyöz atık) bu tabloda HİÇ YOKTUR — MALSEVK kapsamı
-- dışı, seçilebilir bir kod olarak var olamaz. Radyoaktif materyaller EK-4'te
-- ayrı bir bölüm değildir ve bu 18 atık-türü kovasının hiçbirine dahil
-- edilmedi. Asbest (17 06 05*) GERÇEK bir kod olarak vardır (İnşaat/Yıkım
-- Atığı altında) — özel rejimi, "her kod bağımsız onaylanır" ilkesiyle
-- (BÖLÜM 14) sağlanır, bu tablonun kendisinde ayrı bir bayrak GEREKMEZ.
-- -----------------------------------------------------------------------------
create table if not exists public.recycling_waste_codes (
  code text primary key,
  description text not null,
  hazardous boolean not null,
  group_code text not null,
  group_label text not null,
  waste_type_ids text[] not null default '{}'
);

comment on table public.recycling_waste_codes is
  'app/_lib/recycling-waste-code-catalog.ts#WASTE_CODE_ENTRIES ile ELLE senkron tutulan resmî EK-4 atık kodu referans kataloğu — TEK sunucu-tarafı doğruluk kaynağı ("geçerli kod mu" + "tehlikeli mi"). Kaynak/kapsam açıklaması o dosyanın kendi başlık dokümanındadır.';

revoke all on public.recycling_waste_codes from authenticated, anon;
grant select on public.recycling_waste_codes to authenticated, anon;

alter table public.recycling_waste_codes enable row level security;

drop policy if exists recycling_waste_codes_select_all on public.recycling_waste_codes;
create policy recycling_waste_codes_select_all on public.recycling_waste_codes
  for select to authenticated, anon
  using (true);

comment on policy recycling_waste_codes_select_all on public.recycling_waste_codes is
  'service_categories_select_all (0002) İLE AYNI desen — herkese açık, salt-okunur referans katalog verisi. INSERT/UPDATE/DELETE hiçbir role GRANT edilmedi (yalnızca migration''ın kendi seed''i yazar).';

insert into public.recycling_waste_codes (code, description, hazardous, group_code, group_label, waste_type_ids) values
  ('02 01 03', 'Bitki dokusu atıkları', false, '02 01', '02 01 — Tarım, Bahçıvanlık, Su Ürünleri Üretimi, Ormancılık, Avcılık ve Balıkçılıktan Kaynaklanan Atıklar', array['organik-atik']),
  ('02 01 06', 'Ayrı toplanmış ve saha dışında işlem görecek hayvan dışkısı, idrar ve tezek (kirlenmiş toprak dahil), ayrı toplanmış ve saha dışında işlem gören sıvı atıklar', false, '02 01', '02 01 — Tarım, Bahçıvanlık, Su Ürünleri Üretimi, Ormancılık, Avcılık ve Balıkçılıktan Kaynaklanan Atıklar', array['organik-atik']),
  ('03 01 04', 'Tehlikeli maddeler içeren talaş, yonga, kıymık, ahşap, kontraplak ve kaplamalar', true, '03 01', '03 01 — Ağaç İşlemeden ve Sunta ve Mobilya Üretiminden Kaynaklanan Atıklar', array['ahsap']),
  ('03 01 05', '03 01 04 dışındaki talaş, yonga, kıymık, ahşap, kontraplak ve kaplamalar', false, '03 01', '03 01 — Ağaç İşlemeden ve Sunta ve Mobilya Üretiminden Kaynaklanan Atıklar', array['ahsap']),
  ('03 03 08', 'Geri dönüşüme gitmek üzere sınıflandırılan kağıt ve kartondan kaynaklanan atıklar', false, '03 03', '03 03 — Kağıt Hamuru, Kağıt ve Kartonun Üretim ve İşlenmesinden Kaynaklanan Atıklar', array['kagit-karton']),
  ('04 02 21', 'İşlenmemiş tekstil elyafı atıkları', false, '04 02', '04 02 — Tekstil Endüstrisinden Kaynaklanan Atıklar', array['tekstil']),
  ('04 02 22', 'İşlenmiş tekstil elyafı atıkları', false, '04 02', '04 02 — Tekstil Endüstrisinden Kaynaklanan Atıklar', array['tekstil']),
  ('07 02 13', 'Atık plastik', false, '07 02', '07 02 — Plastik, Sentetik Kauçuk ve Yapay Elyafların İmalatı, Formülasyonu, Tedariki ve Kullanımından Kaynaklanan Atıklar', array['plastik']),
  ('08 01 11', 'Organik çözücüler ya da diğer tehlikeli maddeler içeren atık boya ve vernikler', true, '08 01', '08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar', array['boya-vernik-solvent']),
  ('08 01 12', '08 01 11 dışındaki atık boya ve vernikler', false, '08 01', '08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar', array['boya-vernik-solvent']),
  ('08 01 13', 'Organik çözücüler ya da diğer tehlikeli maddeler içeren boya ya da vernik çamurları', true, '08 01', '08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar', array['boya-vernik-solvent']),
  ('08 01 14', '08 01 13 dışındaki boya ya da vernik çamurları', false, '08 01', '08 01 — Boya ve Verniğin Üretimi, Formülasyonu, Tedariki ve Kullanımından (İFTK) Kaynaklanan Atıklar', array['boya-vernik-solvent']),
  ('12 01 01', 'Demir metal çapakları ve talaşları', false, '12 01', '12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar', array['metal-hurda']),
  ('12 01 14', 'Tehlikeli maddeler içeren işleme çamurları', true, '12 01', '12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar', array['endustriyel-camur']),
  ('12 01 15', '12 01 14 dışındaki işleme çamurları', false, '12 01', '12 01 — Metallerin ve Plastiklerin Fiziki ve Mekanik Yüzey İşlemlerinden Kaynaklanan Atıklar', array['endustriyel-camur']),
  ('13 01 10', 'Mineral esaslı klor içermeyen hidrolik yağlar', true, '13 01', '13 01 — Atık Hidrolik Yağlar', array['atik-yag']),
  ('13 02 04', 'Mineral esaslı klor içeren motor, şanzıman ve yağlama yağları', true, '13 02', '13 02 — Atık Motor, Şanzıman ve Yağlama Yağları', array['atik-yag']),
  ('13 02 05', 'Mineral esaslı klor içermeyen motor, şanzıman ve yağlama yağları', true, '13 02', '13 02 — Atık Motor, Şanzıman ve Yağlama Yağları', array['atik-yag']),
  ('13 02 08', 'Diğer motor, şanzıman ve yağlama yağları', true, '13 02', '13 02 — Atık Motor, Şanzıman ve Yağlama Yağları', array['atik-yag']),
  ('14 06 03', 'Diğer çözücüler ve çözücü karışımları', true, '14 06', '14 06 — Atık Organik Çözücüler, Soğutucular ve Köpük/Aerosol İtici Gazlar', array['boya-vernik-solvent']),
  ('15 01 01', 'Kağıt ve karton ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['kagit-karton']),
  ('15 01 02', 'Plastik ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['plastik']),
  ('15 01 03', 'Ahşap ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['ahsap']),
  ('15 01 04', 'Metalik ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['metal-hurda']),
  ('15 01 07', 'Cam ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['cam']),
  ('15 01 09', 'Tekstil ambalaj', false, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['tekstil']),
  ('15 01 10', 'Tehlikeli maddelerin kalıntılarını içeren ya da tehlikeli maddelerle kontamine olmuş ambalajlar', true, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['kimyasal-bulasmis-ambalaj']),
  ('15 01 11', 'Boş basınçlı konteynerler dahil, tehlikeli gözenekli katı yapı (örneğin asbest) içeren metalik ambalaj, boşaltıcı bir cihaz da içerebilir', true, '15 01', '15 01 — Ambalaj (Ayrılmış Kentsel Atıklar Dahil)', array['kimyasal-bulasmis-ambalaj']),
  ('15 02 02', 'Tehlikeli maddelerle kirlenmiş emiciler, filtre malzemeleri (başka bir şekilde tanımlanmamışsa yağ filtreleri), temizleme bezleri, koruyucu giysiler', true, '15 02', '15 02 — Emiciler, Filtre Malzemeleri, Temizleme Bezleri ve Koruyucu Giysiler', array['kontamine-bez-emici-malzeme']),
  ('15 02 03', '15 02 02 dışındaki emiciler, filtre malzemeleri, temizleme bezleri, koruyucu giysiler', false, '15 02', '15 02 — Emiciler, Filtre Malzemeleri, Temizleme Bezleri ve Koruyucu Giysiler', array['kontamine-bez-emici-malzeme']),
  ('16 01 03', 'Ömrünü tamamlamış lastikler', false, '16 01', '16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar', array['lastik']),
  ('16 01 17', 'Demir metaller', false, '16 01', '16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar', array['metal-hurda']),
  ('16 01 18', 'Demir olmayan metaller', false, '16 01', '16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar', array['metal-hurda']),
  ('16 01 19', 'Plastik', false, '16 01', '16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar', array['plastik']),
  ('16 01 20', 'Cam', false, '16 01', '16 01 — Çeşitli Taşıma Türlerindeki Ömrünü Tamamlamış Araçlar ve Sökülen Araçların Bakımından Kaynaklanan Atıklar', array['cam']),
  ('16 02 09', 'PCB''ler içeren transformatörler ve kapasitörler', true, '16 02', '16 02 — Elektrikli ve Elektronik Ekipman Atıkları', array['elektronik-atik']),
  ('16 02 10', '16 02 09 dışındaki, PCB içeren ya da PCB ile kontamine olmuş ıskarta ekipmanlar', true, '16 02', '16 02 — Elektrikli ve Elektronik Ekipman Atıkları', array['elektronik-atik']),
  ('16 02 13', '16 02 09''dan 16 02 12''ye kadar olanların dışındaki tehlikeli parçalar içeren ıskarta ekipmanlar', true, '16 02', '16 02 — Elektrikli ve Elektronik Ekipman Atıkları', array['elektronik-atik']),
  ('16 02 14', '16 02 09''dan 16 02 13''e kadar olanların dışındaki ıskarta ekipmanlar', false, '16 02', '16 02 — Elektrikli ve Elektronik Ekipman Atıkları', array['elektronik-atik']),
  ('16 05 06', 'Laboratuvar kimyasalları karışımları dahil, tehlikeli maddelerden oluşan ya da tehlikeli maddeler içeren laboratuvar kimyasalları', true, '16 05', '16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar', array['kimyasal-atik']),
  ('16 05 07', 'Tehlikeli maddeler içeren ya da bunlardan oluşan ıskarta inorganik kimyasallar', true, '16 05', '16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar', array['kimyasal-atik']),
  ('16 05 08', 'Tehlikeli maddeler içeren ya da bunlardan oluşan ıskarta organik kimyasallar', true, '16 05', '16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar', array['kimyasal-atik']),
  ('16 05 09', '16 05 06, 16 05 07 ya da 16 05 08 dışındaki ıskarta kimyasallar', false, '16 05', '16 05 — Basınçlı Kaplardaki Gazlar ve Iskartaya Çıkmış Kimyasallar', array['kimyasal-atik']),
  ('16 06 01', 'Kurşunlu piller ve akümülatörler', true, '16 06', '16 06 — Piller ve Akümülatörler', array['pil-aku']),
  ('16 06 02', 'Nikel kadmiyum piller', true, '16 06', '16 06 — Piller ve Akümülatörler', array['pil-aku']),
  ('16 06 03', 'Cıva içeren piller', true, '16 06', '16 06 — Piller ve Akümülatörler', array['pil-aku']),
  ('16 06 04', 'Alkali piller (16 06 03 hariç)', false, '16 06', '16 06 — Piller ve Akümülatörler', array['pil-aku']),
  ('16 06 05', 'Diğer piller ve akümülatörler', false, '16 06', '16 06 — Piller ve Akümülatörler', array['pil-aku']),
  ('17 01 01', 'Beton', false, '17 01', '17 01 — Beton, Tuğla, Kiremit ve Seramik', array['insaat-yikim-atigi']),
  ('17 01 07', '17 01 06 dışındaki beton, tuğla, kiremit ve seramik karışımları ya da ayrılmış fraksiyonları', false, '17 01', '17 01 — Beton, Tuğla, Kiremit ve Seramik', array['insaat-yikim-atigi']),
  ('17 02 01', 'Ahşap', false, '17 02', '17 02 — Ahşap, Cam ve Plastik', array['ahsap']),
  ('17 02 02', 'Cam', false, '17 02', '17 02 — Ahşap, Cam ve Plastik', array['cam']),
  ('17 02 03', 'Plastik', false, '17 02', '17 02 — Ahşap, Cam ve Plastik', array['plastik']),
  ('17 04 01', 'Bakır, bronz, pirinç', false, '17 04', '17 04 — Metaller (Alaşımları Dahil)', array['metal-hurda']),
  ('17 04 05', 'Demir ve çelik', false, '17 04', '17 04 — Metaller (Alaşımları Dahil)', array['metal-hurda']),
  ('17 04 09', 'Tehlikeli maddelerle kontamine olmuş metal atıkları', true, '17 04', '17 04 — Metaller (Alaşımları Dahil)', array['metal-hurda']),
  ('17 06 05', 'Asbest içeren inşaat malzemeleri', true, '17 06', '17 06 — Yalıtım Malzemeleri ve Asbest İçeren İnşaat Malzemeleri', array['insaat-yikim-atigi']),
  ('17 09 04', '17 09 01, 17 09 02 ve 17 09 03 dışındaki karışık inşaat ve yıkıntı atıkları', false, '17 09', '17 09 — Diğer İnşaat ve Yıkıntı Atıkları', array['insaat-yikim-atigi']),
  ('19 08 05', 'Kentsel atıksuyun arıtılmasından kaynaklanan çamurlar', false, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['endustriyel-camur']),
  ('19 08 09', 'Yağ ve su ayrışmasından kaynaklanan, sadece yenilebilir yağlar içeren yağ karışımları ve gres', false, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['bitkisel-atik-yagi']),
  ('19 08 11', 'Endüstriyel atıksuyun biyolojik arıtılmasından kaynaklanan tehlikeli maddeler içeren çamurlar', true, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['endustriyel-camur']),
  ('19 08 12', '19 08 11 dışındaki, endüstriyel atıksuyun biyolojik arıtılmasından kaynaklanan çamurlar', false, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['endustriyel-camur']),
  ('19 08 13', 'Endüstriyel atıksuyun diğer arıtılmasından kaynaklanan tehlikeli maddeler içeren çamurlar', true, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['endustriyel-camur']),
  ('19 08 14', '19 08 13 dışındaki, endüstriyel atıksuyun diğer arıtılmasından kaynaklanan çamurlar', false, '19 08', '19 08 — Atıksu Arıtma Tesislerinden Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['endustriyel-camur']),
  ('19 12 01', 'Kağıt ve karton', false, '19 12', '19 12 — Atıkların Mekanik Arıtımından (Örneğin Elle Ayırma, Kırma, Sıkıştırma, Pelet Yapma) Kaynaklanan Atıklar (Başka Bir Şekilde Tanımlanmamış)', array['kagit-karton']),
  ('20 01 01', 'Kâğıt ve karton', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['kagit-karton']),
  ('20 01 02', 'Cam', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['cam']),
  ('20 01 08', 'Biyolojik olarak bozunabilir mutfak ve kantin atıkları', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['organik-atik']),
  ('20 01 10', 'Giysiler', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['tekstil']),
  ('20 01 11', 'Tekstil ürünleri', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['tekstil']),
  ('20 01 13', 'Çözücüler', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['boya-vernik-solvent']),
  ('20 01 14', 'Asitler', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['kimyasal-atik']),
  ('20 01 15', 'Alkalinler', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['kimyasal-atik']),
  ('20 01 21', 'Flüoresan lambalar ve diğer cıva içeren atıklar', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['elektronik-atik']),
  ('20 01 25', 'Yenilebilir sıvı ve katı yağlar', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['bitkisel-atik-yagi']),
  ('20 01 26', '20 01 25 dışındaki sıvı ve katı yağlar', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['atik-yag']),
  ('20 01 27', 'Tehlikeli maddeler içeren boya, mürekkepler, yapıştırıcılar ve reçineler', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['boya-vernik-solvent']),
  ('20 01 33', '16 06 01, 16 06 02 veya 16 06 03''ün altında geçen pil ve akümülatörler ve bu pilleri içeren sınıflandırılmamış karışık pil ve akümülatörler', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['pil-aku']),
  ('20 01 34', '20 01 33 dışındaki pil ve akümülatörler', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['pil-aku']),
  ('20 01 35', '20 01 21 ve 20 01 23 dışındaki, tehlikeli parçalar içeren ıskartaya çıkmış elektrikli ve elektronik ekipmanlar', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['elektronik-atik']),
  ('20 01 36', '20 01 21, 20 01 23 ve 20 01 35 dışındaki ıskarta elektrikli ve elektronik ekipmanlar', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['elektronik-atik']),
  ('20 01 37', 'Tehlikeli maddeler içeren ahşap', true, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['ahsap']),
  ('20 01 38', '20 01 37 dışındaki ahşap', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['ahsap']),
  ('20 01 39', 'Plastikler', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['plastik']),
  ('20 01 40', 'Metaller', false, '20 01', '20 01 — Ayrı Toplanan Fraksiyonlar (Ambalaj Hariç)', array['metal-hurda']),
  ('20 02 01', 'Biyolojik olarak bozunabilir atıklar', false, '20 02', '20 02 — Bahçe ve Parklardan Kaynaklanan Atıklar (Mezarlıklardan Kaynaklanan Atıklar Dahil)', array['organik-atik'])
on conflict (code) do update set
  description = excluded.description, hazardous = excluded.hazardous,
  group_code = excluded.group_code, group_label = excluded.group_label, waste_type_ids = excluded.waste_type_ids;

-- -----------------------------------------------------------------------------
-- BÖLÜM 4 — derive_recycling_hazardous: recycling_waste_codes'a karşı düz
-- bir lookup. p_waste_code null/boş ise (kod bilinmiyor ya da kategori
-- kapsam dışı) null döner — "tehlikesiz" ASLA varsayılan DEĞİLDİR (görev
-- talimatının kendi kesin kuralı: "sistem belirsizliği kendiliğinden
-- tehlikesiz kabul etmemeli"). recycling_waste_codes'ta olmayan/uydurma bir
-- kod da null döner — HER yazma noktası (BÖLÜM 18/19/20/21) bundan ÖNCE
-- assert_valid_recycling_waste_code ile kodun gerçekten var olduğunu zaten
-- doğrular, bu fonksiyon yalnızca hazardous DEĞERİNİ okur.
-- -----------------------------------------------------------------------------
create or replace function public.derive_recycling_hazardous(p_waste_code text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select hazardous from public.recycling_waste_codes where code = p_waste_code;
$function$;

comment on function public.derive_recycling_hazardous(text) is
  'recycling_waste_codes''in TEK okuma noktası — jobs.recycling_hazardous HİÇBİR ZAMAN istemciden doğrudan yazılmaz, her zaman bu fonksiyonla yeniden hesaplanır (bkz. bu migration''ın başlık dokümanı).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 5 — Sunucu tarafı doğrulayıcılar: assert_valid_recycling_waste_code
-- (recycling_waste_codes'a karşı GERÇEK varlık kontrolü), assert_valid_
-- recycling_requested_operation, assert_valid_recycling_activities,
-- assert_valid_recycling_hazard_properties — assert_valid_storage_risk_
-- groups (0068) İLE AYNI desen, ELLE senkron tutulan sabit id kümeleri
-- (recycling-catalog.ts/recycling-waste-code-catalog.ts ile).
-- -----------------------------------------------------------------------------
create or replace function public.assert_valid_recycling_waste_code(p_code text, p_unknown boolean)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(p_unknown, false) then
    return;
  end if;
  if p_code is null or p_code = '' then
    return;
  end if;
  if not exists (select 1 from public.recycling_waste_codes where code = p_code) then
    raise exception 'ML140: recycling_waste_code must be a known official waste code (got %)', p_code using errcode = 'ML140';
  end if;
end;
$function$;

create or replace function public.assert_valid_recycling_requested_operation(p_operation text)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if p_operation is null then
    return;
  end if;
  if not (p_operation = any(array[
    'atik-tahliyesi-tasima', 'geri-donusum-geri-kazanim', 'bertaraf', 'tahliye-geri-kazanim', 'tahliye-bertaraf'
  ])) then
    raise exception 'ML141: recycling_requested_operation must be a canonical operation id (got %)', p_operation using errcode = 'ML141';
  end if;
end;
$function$;

create or replace function public.assert_valid_recycling_activities(p_activities text[])
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_activity text;
begin
  if p_activities is null then
    return;
  end if;
  foreach v_activity in array p_activities loop
    if not (v_activity = any(array['tasima', 'geri-kazanim', 'bertaraf'])) then
      raise exception 'ML142: recycling activity must be one of tasima/geri-kazanim/bertaraf (got %)', v_activity using errcode = 'ML142';
    end if;
  end loop;
end;
$function$;

create or replace function public.assert_valid_recycling_hazard_properties(p_properties text[])
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_property text;
begin
  if p_properties is null then
    return;
  end if;
  foreach v_property in array p_properties loop
    if not (v_property = any(array['yanici', 'asindirici', 'zehirli', 'oksitleyici', 'reaktif', 'cevreye-zararli'])) then
      raise exception 'ML143: recycling hazard property must be a canonical id (got %)', v_property using errcode = 'ML143';
    end if;
  end loop;
end;
$function$;

comment on function public.assert_valid_recycling_waste_code(text, boolean) is
  'recycling_waste_codes''a karşı GERÇEK varlık kontrolü (uydurma bir kod her zaman reddedilir) — p_unknown=true ya da p_code boş/null iken no-op.';
comment on function public.assert_valid_recycling_requested_operation(text) is
  'app/_lib/recycling-catalog.ts#RECYCLING_REQUESTED_OPERATION_OPTIONS ile ELLE senkron (5 sabit id).';
comment on function public.assert_valid_recycling_activities(text[]) is
  'app/_lib/recycling-catalog.ts#RECYCLING_ACTIVITY_OPTIONS ile ELLE senkron (3 sabit id: tasima/geri-kazanim/bertaraf).';
comment on function public.assert_valid_recycling_hazard_properties(text[]) is
  'app/_lib/recycling-waste-code-catalog.ts#WASTE_HAZARD_PROPERTY_OPTIONS ile ELLE senkron (6 sabit id).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 6 — provider_documents: depocunun/geri dönüşüm firmasının belge
-- yüklerken KENDİSİNİN talep ettiği faaliyetler ve atık kodları (admin
-- onayından ÖNCEKİ durum — otomatik yetki VERMEZ, provider_documents.
-- requested_storage_risk_groups (0068) İLE AYNI ilke).
-- -----------------------------------------------------------------------------
alter table public.provider_documents
  add column if not exists requested_recycling_activities text[] null,
  add column if not exists requested_recycling_waste_codes text[] null;

comment on column public.provider_documents.requested_recycling_activities is
  'app/_lib/recycling-catalog.ts#RecyclingActivityId ile birebir — firmanın belge yüklerken KENDİSİNİN seçtiği, gerçekleştirebileceğini iddia ettiği faaliyetler. Bu seçim OTOMATİK YETKİ VERMEZ.';
comment on column public.provider_documents.requested_recycling_waste_codes is
  'recycling_waste_codes.code ile birebir — firmanın hizmet verebileceğini iddia ettiği atık kodları. Bu seçim de OTOMATİK YETKİ VERMEZ — review_provider_document''in p_approved_recycling_waste_codes''u (BÖLÜM 13) admin''in AYRI kararıdır.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 7 — provider_service_authorizations: 1 yeni sütun (recycling_
-- activities) — storage_activity_scopes/imo_class_codes (0059) İLE AYNI
-- desen: Geri Dönüşüm & Atık Tahliye kategorisinin TEK aktif yetkilendirme
-- satırının ÜZERİNDE, kategoriye özel bir text[]. KASITLI OLARAK NULL =
-- YETKİSİZ (0068'in storage_risk_groups'undaki AYNI fail-closed varsayım,
-- 0059'un storage_activity_scopes'undaki NULL=SINIRSIZ geriye dönük
-- uyumluluk varsayımından FARKLI) — bu tamamen YENİ bir özellik, korunması
-- gereken bir "önceden sınırsız yetkilendirilmiş" küme yok.
-- -----------------------------------------------------------------------------
alter table public.provider_service_authorizations
  add column if not exists recycling_activities text[] null;

comment on column public.provider_service_authorizations.recycling_activities is
  'app/_lib/recycling-catalog.ts#RecyclingActivityId ile birebir — YALNIZCA service_category_id = ''geri-donusum-atik-tahliye'' olan satırda anlamlıdır. NULL/boş = provider bu kategoride HİÇBİR faaliyet için yetkili DEĞİLDİR (fail-closed, storage_activity_scopes''un NULL=SINIRSIZ varsayımından KASITLI OLARAK FARKLI — bkz. provider_storage_risk_authorizations''ın (0068) aynı gerekçesi).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 8 — provider_recycling_waste_code_authorizations: YENİ, BAĞIMSIZ
-- tablo — provider_storage_risk_authorizations (0068) İLE AYNI şekil/RLS/
-- audit deseni, risk_group_id yerine waste_code ile anahtarlanır. FK delete
-- davranışı 0043'ün sınıflandırmasıyla BİREBİR AYNI (provider_id: Grup 1;
-- authorized_by/revoked_by: Grup 2/ON DELETE SET NULL).
-- -----------------------------------------------------------------------------
create table if not exists public.provider_recycling_waste_code_authorizations (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.profiles (id),
  waste_code text not null references public.recycling_waste_codes (code),

  authorized_at timestamptz not null default now(),
  authorized_by uuid references public.profiles (id) on delete set null,
  source_document_id uuid references public.provider_documents (id),
  authorize_reason text,

  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  constraint provider_recycling_waste_code_auth_revoked_fields_consistent
    check ((revoked_at is null) = (revoked_by is null)),

  updated_at timestamptz not null default now()
);

comment on table public.provider_recycling_waste_code_authorizations is
  'Bir provider''ın hangi resmî atık kodu (recycling_waste_codes.code) için admin tarafından AYRI AYRI yetkilendirildiğinin tam tarihçesi. revoked_at IS NULL = şu an aktif/yetkili. provider_documents.requested_recycling_waste_codes (talep) ile KASITLI OLARAK AYRI — seçim otomatik yetki VERMEZ. provider_service_authorizations.recycling_activities (faaliyet ekseni) İLE BAĞIMSIZ, İKİNCİ bir eksen — provider_can_view_job (BÖLÜM 14) ikisini de AYRI AYRI kontrol eder (görev bölüm 4 örnek A/B/C/D). storage risk gruplarından (provider_storage_risk_authorizations) da TAMAMEN BAĞIMSIZDIR — depolama yetkisi atık yetkisi yerine ASLA kabul edilmez.';

create unique index if not exists provider_recycling_waste_code_auth_one_active
  on public.provider_recycling_waste_code_authorizations (provider_id, waste_code)
  where revoked_at is null;

drop trigger if exists trg_provider_recycling_waste_code_auth_set_updated_at on public.provider_recycling_waste_code_authorizations;
create trigger trg_provider_recycling_waste_code_auth_set_updated_at
  before update on public.provider_recycling_waste_code_authorizations
  for each row execute function public.set_updated_at();

revoke all on public.provider_recycling_waste_code_authorizations from authenticated, anon;
grant select on public.provider_recycling_waste_code_authorizations to authenticated;
-- INSERT/UPDATE(revoke) yalnızca authorize_provider_recycling_waste_code()/
-- revoke_provider_recycling_waste_code() üzerinden (BÖLÜM 11), ikisi de admin-only.

alter table public.provider_recycling_waste_code_authorizations enable row level security;

drop policy if exists provider_recycling_waste_code_auth_select_own_or_admin on public.provider_recycling_waste_code_authorizations;
create policy provider_recycling_waste_code_auth_select_own_or_admin on public.provider_recycling_waste_code_authorizations
  for select to authenticated
  using (provider_id = auth.uid() or public.is_admin());

comment on policy provider_recycling_waste_code_auth_select_own_or_admin on public.provider_recycling_waste_code_authorizations is
  'provider_storage_risk_authorizations_select_own_or_admin (0068) ile AYNI kısıt seviyesi — provider kendi satırlarını HER ZAMAN canlı/doğrudan Supabase''ten okur (localStorage aynası DEĞİL).';

-- -----------------------------------------------------------------------------
-- BÖLÜM 9 — notifications.type CHECK: +2 yeni tip (0038/0068'deki AYNI
-- genişletme deseni — mevcut satırlar/tipler DEĞİŞMEDİ). Faaliyet (recycling_
-- activities) provider_service_authorizations'ın ÜZERİNDEKİ bir sütun
-- olduğu için authorize_provider_service'in KENDİ mevcut 'service_authorized'
-- bildirimini paylaşır (0059'un storage_activity_scopes/imo_class_codes'unun
-- da yaptığı gibi) — yalnızca atık KODU ekseni (ayrı tablo) YENİ bir
-- bildirim tipi gerektirir.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'yeni_teklif', 'teklif_kabul_edildi', 'teklif_reddedildi', 'is_basladi',
  'anlasma_saglanamadi', 'baska_hizmet_verenle_anlasildi', 'ilan_yeniden_yayinda',
  'tamamlanma_onayi_bekleniyor', 'is_tamamlandi', 'tamamlanma_onaylandi',
  'tamamlanma_itiraz_edildi', 'itiraz_kaydedildi', 'is_iptal_edildi',
  'teklif_geri_cekildi', 'hizmet_kalemi_kaldirildi', 'ilan_kapatildi',
  'ilan_yayin_suresi_doldu', 'belge_onaylandi', 'belge_reddedildi', 'belge_revizyon_istendi',
  'service_document_required', 'service_authorized', 'service_authorization_revoked',
  'storage_risk_group_authorized', 'storage_risk_group_authorization_revoked',
  'recycling_waste_code_authorized', 'recycling_waste_code_authorization_revoked'
));

-- -----------------------------------------------------------------------------
-- BÖLÜM 10 — authorize_provider_service: +1 opsiyonel parametre (6 -> 7,
-- p_recycling_activities) — storage_activity_scopes/imo_class_codes İLE
-- AYNI coalesce-üzerine-yaz deseni. İMZA GENİŞLEDİ (drop gerekmez, 0068'in
-- BÖLÜM 6A'sı zaten `create or replace` ile güvenli olduğunu kanıtladı —
-- ama parametre SAYISI değiştiği için PostgREST'in "hangi overload"
-- belirsizliğine düşmemesi adına ÖNCEKİ 6 parametrelik imza AÇIKÇA drop
-- edilir, 0032/0033/0034'ün dersi).
-- -----------------------------------------------------------------------------
drop function if exists public.authorize_provider_service(uuid, text, uuid, text, text[], text[]);

create or replace function public.authorize_provider_service(
  p_provider_id uuid, p_service_category_id text, p_source_document_id uuid default null::uuid,
  p_reason text default null::text, p_storage_activity_scopes text[] default null::text[],
  p_imo_class_codes text[] default null::text[], p_recycling_activities text[] default null::text[]
)
returns provider_service_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_service_authorizations;
  v_existing public.provider_service_authorizations;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if not exists (select 1 from public.service_categories where id = p_service_category_id) then
    raise exception 'MLK94: unknown service_category_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_service_authorizations.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.provider_documents where id = p_source_document_id and provider_id = p_provider_id
  ) then
    raise exception 'MLK76: source document not found for this provider' using errcode = 'MLK76';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_imo_class_codes);
  perform public.assert_valid_recycling_activities(p_recycling_activities);

  select * into v_existing from public.provider_service_authorizations
    where provider_id = p_provider_id and service_category_id = p_service_category_id and revoked_at is null;

  if found then
    update public.provider_service_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason),
      storage_activity_scopes = coalesce(p_storage_activity_scopes, storage_activity_scopes),
      imo_class_codes = coalesce(p_imo_class_codes, imo_class_codes),
      recycling_activities = coalesce(p_recycling_activities, recycling_activities)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_service_authorizations
      (provider_id, service_category_id, authorized_by, source_document_id, authorize_reason, storage_activity_scopes, imo_class_codes, recycling_activities)
    values
      (p_provider_id, p_service_category_id, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''), p_storage_activity_scopes, p_imo_class_codes, p_recycling_activities)
    returning * into v_row;
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_authorized', null, null, null,
    'Hizmet Yetkiniz Onaylandı',
    (select name from public.service_categories where id = p_service_category_id) ||
      ' hizmetiniz onaylandı. Artık bu hizmete ait ilanları görüntüleyebilir ve teklif verebilirsiniz.',
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('authorize_provider_service', 'provider_service_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id));

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 11 — authorize_provider_recycling_waste_code / revoke_provider_
-- recycling_waste_code: authorize_provider_storage_risk_group/revoke (0068)
-- İLE BİREBİR AYNI admin-only desen, risk_group_id yerine waste_code ile
-- anahtarlanır. `FOUND` KULLANIR (composite-row IS NOT NULL tuzağı 0068'in
-- BÖLÜM 6A'sında bulunup düzeltildi — burada baştan doğru yazılır).
-- -----------------------------------------------------------------------------
create or replace function public.authorize_provider_recycling_waste_code(
  p_provider_id uuid, p_waste_code text, p_source_document_id uuid default null::uuid,
  p_reason text default null::text
)
returns provider_recycling_waste_code_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_recycling_waste_code_authorizations;
  v_existing public.provider_recycling_waste_code_authorizations;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if not exists (select 1 from public.recycling_waste_codes where code = p_waste_code) then
    raise exception 'ML140: recycling_waste_code must be a known official waste code (got %)', p_waste_code using errcode = 'ML140';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_recycling_waste_code_authorizations.provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;
  if p_source_document_id is not null and not exists (
    select 1 from public.provider_documents where id = p_source_document_id and provider_id = p_provider_id
  ) then
    raise exception 'MLK76: source document not found for this provider' using errcode = 'MLK76';
  end if;

  select * into v_existing from public.provider_recycling_waste_code_authorizations
    where provider_id = p_provider_id and waste_code = p_waste_code and revoked_at is null;

  if found then
    update public.provider_recycling_waste_code_authorizations set
      authorized_at = now(), authorized_by = auth.uid(),
      source_document_id = coalesce(p_source_document_id, source_document_id),
      authorize_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), authorize_reason)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.provider_recycling_waste_code_authorizations
      (provider_id, waste_code, authorized_by, source_document_id, authorize_reason)
    values
      (p_provider_id, p_waste_code, auth.uid(), p_source_document_id, nullif(trim(coalesce(p_reason, '')), ''))
    returning * into v_row;
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'recycling_waste_code_authorized', null, null, null,
    'Atık Kodu Yetkiniz Onaylandı',
    'Bir resmî atık kodu (' || p_waste_code || ') için yetkiniz onaylandı. Artık bu koda ait Geri Dönüşüm & Atık Tahliye ilanlarına teklif verebilirsiniz.',
    jsonb_build_object('waste_code', p_waste_code)
  );

  perform public.log_audit_event('authorize_provider_recycling_waste_code', 'provider_recycling_waste_code_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'waste_code', p_waste_code));

  return v_row;
end;
$function$;

create or replace function public.revoke_provider_recycling_waste_code(
  p_provider_id uuid, p_waste_code text, p_reason text
)
returns provider_recycling_waste_code_authorizations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_recycling_waste_code_authorizations;
  v_trimmed_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if v_trimmed_reason is null then
    raise exception 'MLK75: a reason is required to revoke this authorization' using errcode = 'MLK75';
  end if;

  update public.provider_recycling_waste_code_authorizations set
    revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_trimmed_reason
  where provider_id = p_provider_id and waste_code = p_waste_code and revoked_at is null
  returning * into v_row;

  if v_row is null then
    raise exception 'MLK76: no active authorization found for this provider and waste code' using errcode = 'MLK76';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'recycling_waste_code_authorization_revoked', null, null, null,
    'Atık Kodu Yetkiniz Kaldırıldı',
    'Bir resmî atık kodu (' || p_waste_code || ') için yetkiniz kaldırıldı: ' || v_trimmed_reason,
    jsonb_build_object('waste_code', p_waste_code)
  );

  perform public.log_audit_event('revoke_provider_recycling_waste_code', 'provider_recycling_waste_code_authorizations', v_row.id,
    null, jsonb_build_object('provider_id', p_provider_id, 'waste_code', p_waste_code));

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 12 — create_provider_document: +2 opsiyonel parametre (10 -> 12).
-- STALE OVERLOAD KORUMASI (0032/0033/0034'ün dersi).
-- -----------------------------------------------------------------------------
drop function if exists public.create_provider_document(text, text, text, text, text, bigint, text, text[], text[], text[]);

create or replace function public.create_provider_document(
  p_document_type text, p_storage_path text, p_original_file_name text, p_mime_type text,
  p_extension text, p_size_bytes bigint, p_service_category_id text default null::text,
  p_storage_activity_scopes text[] default null::text[], p_imo_class_codes text[] default null::text[],
  p_requested_storage_risk_groups text[] default null::text[],
  p_requested_recycling_activities text[] default null::text[],
  p_requested_recycling_waste_codes text[] default null::text[]
)
returns provider_documents
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.provider_documents;
  v_code text;
begin
  perform public.assert_active_user();
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to upload a document' using errcode = 'MLK93';
  end if;
  if p_document_type not in ('genel', 'gumruk-musaviri-izin-belgesi', 'depo-hizmetleri-belgesi', 'operator-is-makinesi-belgesi') then
    raise exception 'MLK94: invalid document_type' using errcode = 'MLK94';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_imo_class_codes);
  perform public.assert_valid_storage_risk_groups(p_requested_storage_risk_groups);
  perform public.assert_valid_recycling_activities(p_requested_recycling_activities);
  if p_requested_recycling_waste_codes is not null then
    foreach v_code in array p_requested_recycling_waste_codes loop
      if not exists (select 1 from public.recycling_waste_codes where code = v_code) then
        raise exception 'ML140: recycling_waste_code must be a known official waste code (got %)', v_code using errcode = 'ML140';
      end if;
    end loop;
  end if;

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id, storage_activity_scopes, imo_class_codes, requested_storage_risk_groups, requested_recycling_activities, requested_recycling_waste_codes)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id, p_storage_activity_scopes, p_imo_class_codes, p_requested_storage_risk_groups, p_requested_recycling_activities, p_requested_recycling_waste_codes)
  returning * into v_row;

  return v_row;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 13 — review_provider_document: +2 opsiyonel parametre (6 -> 8).
-- KASITLI OLARAK, storage risk gruplarıyla (0068) AYNI ilke: hem faaliyetler
-- hem atık kodları, otomatik-yetkilendirme zincirinin (0041/0044) BİR
-- PARÇASI DEĞİL — admin AÇIKÇA p_approved_recycling_activities/p_approved_
-- recycling_waste_codes içinde göndermezse hiçbir şey yetkilendirilmez
-- (genel belge onayı KENDİLİĞİNDEN faaliyet/kod yetkilendirmez).
-- -----------------------------------------------------------------------------
drop function if exists public.review_provider_document(uuid, text, text, text[], text[], text[]);

create or replace function public.review_provider_document(
  p_document_id uuid, p_status text, p_note text default null::text,
  p_approved_storage_activity_scopes text[] default null::text[],
  p_approved_imo_class_codes text[] default null::text[],
  p_approved_storage_risk_groups text[] default null::text[],
  p_approved_recycling_activities text[] default null::text[],
  p_approved_recycling_waste_codes text[] default null::text[]
)
returns provider_documents
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
  v_risk_group text;
  v_waste_code text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('approved', 'rejected', 'revision_requested') then
    raise exception 'MLK71: invalid review status' using errcode = 'MLK71';
  end if;
  if p_status in ('rejected', 'revision_requested') and v_trimmed_note is null then
    raise exception 'MLK75: a note is required for rejection or revision requests' using errcode = 'MLK75';
  end if;
  perform public.assert_valid_storage_activity_scopes(p_approved_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_approved_imo_class_codes);
  perform public.assert_valid_storage_risk_groups(p_approved_storage_risk_groups);
  perform public.assert_valid_recycling_activities(p_approved_recycling_activities);
  if p_approved_recycling_waste_codes is not null then
    foreach v_waste_code in array p_approved_recycling_waste_codes loop
      if not exists (select 1 from public.recycling_waste_codes where code = v_waste_code) then
        raise exception 'ML140: recycling_waste_code must be a known official waste code (got %)', v_waste_code using errcode = 'ML140';
      end if;
    end loop;
  end if;

  select * into v_document from public.provider_documents where id = p_document_id;
  if v_document is null then
    raise exception 'MLK76: document not found' using errcode = 'MLK76';
  end if;

  update public.provider_documents set
    current_review_status = p_status, current_review_note = v_trimmed_note,
    reviewed_at = now(), reviewed_by = auth.uid()
  where id = p_document_id
  returning * into v_document;

  insert into public.provider_document_reviews (document_id, provider_id, admin_id, action, note)
    values (p_document_id, v_document.provider_id, auth.uid(), p_status, v_trimmed_note);

  perform public.create_notification(
    v_document.provider_id, auth.uid(),
    case p_status when 'approved' then 'belge_onaylandi' when 'rejected' then 'belge_reddedildi' else 'belge_revizyon_istendi' end,
    null, null, null,
    case p_status when 'approved' then 'Belgeniz Onaylandı' when 'rejected' then 'Belgeniz Reddedildi' else 'Belge Güncellemesi Gerekiyor' end,
    coalesce('"' || v_document.original_file_name || '" belgeniz ' ||
      case p_status when 'approved' then 'onaylandı.' when 'rejected' then 'reddedildi: ' || v_trimmed_note else 'için yeniden yükleme isteniyor: ' || v_trimmed_note end,
      ''),
    null
  );

  perform public.log_audit_event('review_provider_document', 'provider_documents', p_document_id,
    jsonb_build_object('current_review_status', 'pending'),
    jsonb_build_object('current_review_status', p_status));

  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
        );
      elsif v_document.document_type = 'gumruk-musaviri-izin-belgesi' then
        perform public.authorize_provider_service(
          v_document.provider_id, 'gumruk-musavirligi', p_document_id,
          'Gümrük Müşaviri İzin Belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
        );
      elsif v_document.document_type = 'operator-is-makinesi-belgesi' then
        foreach v_target_category_id in array array[
          'forklift', 'reach-stacker', 'vinc', 'manlift',
          'forklift-operatoru', 'reach-stacker-operatoru', 'vinc-operatoru', 'manlift-operatoru'
        ]
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Operatör veya İş Makinesi Hizmeti belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).'
          );
        end loop;
      elsif v_document.document_type = 'depo-hizmetleri-belgesi' then
        foreach v_target_category_id in array array[
          'ellecleme', 'genel-depolama', 'acik-saha-depolama', 'kapali-depolama',
          'antrepo-gumruklu', 'gecici-depolama', 'konteyner-depolama', 'dokme-yuk-depolama',
          'proje-yuku-depolama', 'soguk-hava-depolama', 'kimyasal-depolama', 'tehlikeli-madde-depolama'
        ]
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Depo Hizmetleri belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
          );
        end loop;
      else
        for v_target_category_id in
          select service_category_id from public.provider_services
          where provider_id = v_document.provider_id and service_category_id <> 'gumruk-musavirligi'
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end,
            case when v_target_category_id = 'geri-donusum-atik-tahliye' then p_approved_recycling_activities else null end
          );
        end loop;
      end if;

      -- BU MİGRATION: risk grupları/atık kodları/faaliyetler, YUKARIDAKİ
      -- zincirin BİR PARÇASI DEĞİL — genel kategori/belge onayı bunları
      -- kendiliğinden yetkilendirmez (görev bölüm 3'ün kendi kesin kuralı).
      if p_approved_storage_risk_groups is not null then
        foreach v_risk_group in array p_approved_storage_risk_groups loop
          perform public.authorize_provider_storage_risk_group(
            v_document.provider_id, v_risk_group, p_document_id,
            'Belge incelemesi sırasında admin tarafından ayrı ayrı onaylandı (review_provider_document, migration 0068).'
          );
        end loop;
      end if;
      if p_approved_recycling_waste_codes is not null then
        foreach v_waste_code in array p_approved_recycling_waste_codes loop
          perform public.authorize_provider_recycling_waste_code(
            v_document.provider_id, v_waste_code, p_document_id,
            'Belge incelemesi sırasında admin tarafından ayrı ayrı onaylandı (review_provider_document, migration 0069).'
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 14 — provider_can_view_job: +3 opsiyonel parametre (5 -> 8). YENİ
-- dal: Geri Dönüşüm & Atık Tahliye — FAIL-CLOSED (bkz. bu migration'ın
-- başlık dokümanı): (1) kod bilinmiyorsa/boşsa kimseye açılmaz; (2) talep
-- edilen işlemin gerektirdiği HER faaliyet için provider_service_
-- authorizations.recycling_activities'te aktif karşılık aranır; (3) ilanın
-- KENDİ atık kodu için provider_recycling_waste_code_authorizations'ta
-- AYRI, aktif bir satır aranır — genel kategori/faaliyet yetkisi kod
-- eşleşmesini ASLA yerine geçmez (görev bölüm 4 örnek A/B, "her ikisi de
-- gerekli"). storage_hazardous/storage_risk_groups dalı (0068) DEĞİŞMEDİ.
--
-- BAĞIMLILIK NOTU: jobs_select_visible RLS politikası eski (uuid,text,jsonb,
-- boolean,text[]) imzasını `USING` ifadesinde DOĞRUDAN çağırdığı için düz
-- bir `drop function` 2BP01 ile başarısız olur — policy ÖNCE kaldırılır
-- (BÖLÜM 15'te AYNI çatıyla yeniden oluşturulur, 0035/0068'in kendi tanımı).
-- -----------------------------------------------------------------------------
drop policy if exists jobs_select_visible on public.jobs;
drop function if exists public.provider_can_view_job(uuid, text, jsonb, boolean, text[]);

create or replace function public.provider_can_view_job(
  p_provider_id uuid, p_category_id text, p_storage_container_groups jsonb,
  p_storage_hazardous boolean default null::boolean, p_storage_risk_groups text[] default null::text[],
  p_recycling_requested_operation text default null::text, p_recycling_waste_code text default null::text,
  p_recycling_waste_code_unknown boolean default null::boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    -- FAIL-CLOSED: kod bilinmiyorsa/yoksa HİÇBİR hizmet verene açılmaz —
    -- "sistem kullanıcı yerine tahminî kod üretmesin/otomatik eşleşme
    -- açılmasın" (görev bölüm 1.C).
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
$function$;

comment on function public.provider_can_view_job(uuid, text, jsonb, boolean, text[], text, text, boolean) is
  'provider_can_view_category''yi sarar (o fonksiyon DEĞİŞMEDİ). Konteyner Depolama/Kimyasal-Tehlikeli Madde Depolama dalları 0059/0068''den DEĞİŞMEDEN taşındı. YENİ dal (0069): Geri Dönüşüm & Atık Tahliye''de FAIL-CLOSED — kod bilinmiyorsa asla eşleşmez; talep edilen işlemin gerektirdiği HER faaliyet provider_service_authorizations.recycling_activities''te aktif olmalı; ilanın KENDİ atık kodu provider_recycling_waste_code_authorizations''ta AYRI aktif bir satırla eşleşmeli (depolama yetkisi bu eşleşmeyi ASLA sağlamaz). jobs_select_visible RLS, get_visible_job/get_visible_jobs, create_offer''in MLK60 kapısı VE accept_offer''in yeniden-kontrolü tarafından paylaşılır — TEK doğruluk kaynağı.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 15 — jobs_select_visible RLS politikası: BÖLÜM 14'te kaldırılan
-- policy, 0035/0068'in kendi çatısıyla, provider_can_view_job çağrısına +3
-- argüman eklenerek yeniden oluşturulur.
-- -----------------------------------------------------------------------------
create policy jobs_select_visible on public.jobs
  for select to authenticated, anon
  using (
    (deleted_at is null) and (
      (requester_id = auth.uid()) or is_admin() or (
        (moderation_status = 'approved'::text) and (
          (current_user_role() is distinct from 'hizmet-veren'::text)
          or provider_can_view_job(
            auth.uid(), category_id, storage_container_groups, storage_hazardous, storage_risk_groups,
            recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown
          )
        )
      )
    )
  );

comment on policy jobs_select_visible on public.jobs is
  '0035/0059/0068''den devam — moderation_status=''approved'' olmayan bir ilan sahibi/admin dışında kimseye görünmez; onay üzerine provider_can_view_job (0069''da +recycling_requested_operation/+recycling_waste_code/+recycling_waste_code_unknown argümanlarıyla genişledi) kategori/kapsam/risk-grubu/faaliyet/atık-kodu uygunluğunu kontrol eder.';

-- -----------------------------------------------------------------------------
-- BÖLÜM 16 — get_visible_job/get_visible_jobs: gövde-içi (yalnızca), AYNI
-- İMZA — provider_can_view_job çağrılarına +3 argüman.
-- -----------------------------------------------------------------------------
create or replace function public.get_visible_job(p_job_id uuid)
 returns jobs
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
        and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(
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
$function$;

create or replace function public.get_visible_jobs()
 returns setof jobs
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
          and (v_role is distinct from 'hizmet-veren' or public.provider_can_view_job(
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
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 17 — create_offer: +1 opsiyonel parametre (5 -> 6, p_commercial_
-- direction). "Teklifin Ticari Yönü" YALNIZCA Geri Dönüşüm & Atık Tahliye
-- ilanlarında zorunludur (estimated_duration/Nakliye İLE AYNI "yalnızca
-- ilgili kategoride toplanır" ilkesi) — diğer kategorilerde her zaman null.
-- MLK60 kapısındaki provider_can_view_job çağrısına +3 argüman.
-- -----------------------------------------------------------------------------
create or replace function public.create_offer(
  p_job_id uuid, p_amount numeric, p_currency text, p_description text,
  p_estimated_duration integer default null::integer, p_commercial_direction text default null::text
)
 returns offers
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_job public.jobs;
  v_latest_offer public.offers;
  v_offer public.offers;
  v_requires_estimated_duration boolean;
  v_estimated_duration integer;
  v_requires_commercial_direction boolean;
  v_commercial_direction text;
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-veren' then
    raise exception 'MLK50: only hizmet-veren accounts may create an offer' using errcode = 'MLK50';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text || ':create_offer'));

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null or not public.provider_can_view_job(
    auth.uid(), v_job.category_id, v_job.storage_container_groups, v_job.storage_hazardous, v_job.storage_risk_groups,
    v_job.recycling_requested_operation, v_job.recycling_waste_code, v_job.recycling_waste_code_unknown
  ) or v_job.moderation_status <> 'approved' then
    raise exception 'MLK60: job not found or not available for offers' using errcode = 'MLK60';
  end if;

  if exists (
    select 1 from public.provider_services ps
    join public.service_categories sc on sc.id = ps.service_category_id
    where ps.provider_id = auth.uid() and sc.id = 'gumruk-musavirligi'
  ) and not exists (
    select 1 from public.provider_documents
    where provider_id = auth.uid() and document_type = 'gumruk-musaviri-izin-belgesi' and current_review_status = 'approved'
  ) then
    raise exception 'MLK61: customs broker license must be approved before offering' using errcode = 'MLK61';
  end if;

  select * into v_latest_offer from public.offers
    where job_id = p_job_id and provider_id = auth.uid()
    order by created_at desc limit 1;
  if v_latest_offer is not null then
    if v_latest_offer.status in ('withdrawn', 'rejected', 'agreement_failed') then
      if v_latest_offer.updated_at + interval '3 days' > now() then
        raise exception 'MLK62: re-offer cooldown still active for this job' using errcode = 'MLK62';
      end if;
    else
      raise exception 'MLK63: an offer for this job already exists and cannot be repeated' using errcode = 'MLK63';
    end if;
  end if;

  if v_job.listing_status <> 'yayinda'
     or public.is_job_closed_to_new_offers(p_job_id)
     or v_job.closed_at is not null
     or public.is_job_listing_expired(p_job_id) then
    raise exception 'MLK64: this job is not open for new offers' using errcode = 'MLK64';
  end if;

  if public.has_reached_active_job_limit(auth.uid()) then
    raise exception 'MLK65: active job capacity reached' using errcode = 'MLK65';
  end if;

  v_requires_estimated_duration := (v_job.category_id = 'nakliye');
  if v_requires_estimated_duration and (
    p_estimated_duration is null or p_estimated_duration < 1 or p_estimated_duration > 60
  ) then
    raise exception 'MLK66: estimated_duration must be an integer between 1 and 60 for Nakliye jobs' using errcode = 'MLK66';
  end if;
  v_estimated_duration := case when v_requires_estimated_duration then p_estimated_duration else null end;

  v_requires_commercial_direction := (v_job.category_id = 'geri-donusum-atik-tahliye');
  if v_requires_commercial_direction and not (
    p_commercial_direction in ('hizmet-bedeli', 'atik-satin-alma', 'ucretsiz-alim')
  ) then
    raise exception 'ML144: commercial_direction must be one of hizmet-bedeli/atik-satin-alma/ucretsiz-alim for Geri Donusum jobs' using errcode = 'ML144';
  end if;
  v_commercial_direction := case when v_requires_commercial_direction then p_commercial_direction else null end;
  if v_commercial_direction = 'ucretsiz-alim' and p_amount <> 0 then
    raise exception 'ML145: amount must be 0 when commercial_direction is ucretsiz-alim' using errcode = 'ML145';
  end if;
  if v_commercial_direction is distinct from 'ucretsiz-alim' and p_amount <= 0 then
    raise exception 'MLK96: amount must be a positive number' using errcode = 'MLK96';
  end if;

  insert into public.offers (job_id, provider_id, amount, currency, description, estimated_duration, commercial_direction)
  values (p_job_id, auth.uid(), p_amount, p_currency, p_description, v_estimated_duration, v_commercial_direction)
  returning * into v_offer;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (v_offer.id, null, 'pending', auth.uid());

  perform public.create_notification(v_job.requester_id, auth.uid(), 'yeni_teklif', p_job_id, v_offer.id, v_job.operation_id,
    null, 'İlanınıza yeni teklif geldi: ' || v_job.title, null);

  return v_offer;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 18 — accept_offer: gövde-içi (yalnızca), AYNI İMZA. Kabul anındaki
-- yeniden kontrol (0060/0061/0068'in kendi ilkesi) artık Geri Dönüşüm &
-- Atık Tahliye'yi de kapsıyor — teklif geçmişte oluşturulabilmiş olması tek
-- başına kabul edilmesi için yeterli olmasın (faaliyet/atık kodu yetkisi
-- teklif SONRASINDA geri alınmış/reddedilmiş olabilir).
-- -----------------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
 returns offers
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_offer public.offers;
  v_job public.jobs;
begin
  perform public.assert_active_user();
  select * into v_offer from public.offers where id = p_offer_id;
  select * into v_job from public.jobs j where j.id = v_offer.job_id;
  if v_offer is null or v_job.requester_id <> auth.uid() then
    raise exception 'MLK56: not the owner of this offer''s job' using errcode = 'MLK56';
  end if;
  if v_offer.status <> 'pending' then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;
  if public.is_offer_pending_action_blocked(p_offer_id) then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end if;
  if v_job.category_id in ('konteyner-depolama', 'kimyasal-depolama', 'tehlikeli-madde-depolama', 'geri-donusum-atik-tahliye')
     and not public.provider_can_view_job(
       v_offer.provider_id, v_job.category_id, v_job.storage_container_groups, v_job.storage_hazardous, v_job.storage_risk_groups,
       v_job.recycling_requested_operation, v_job.recycling_waste_code, v_job.recycling_waste_code_unknown
     )
  then
    raise exception 'MLK87: provider no longer meets this job''s activity/IMO/risk-group requirements' using errcode = 'MLK87';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_offer.provider_id::text || ':accept_offer'));
  if public.has_reached_active_job_limit(v_offer.provider_id) then
    raise exception 'MLK65: provider has reached active job capacity' using errcode = 'MLK65';
  end if;

  begin
    update public.offers set status = 'accepted', accepted_at = now()
      where id = p_offer_id and status = 'pending'
      returning * into v_offer;
  exception when unique_violation then
    raise exception 'MLK67: another offer on this job is already engaged' using errcode = 'MLK67';
  end;
  if v_offer is null then
    raise exception 'MLK68: this offer has already been decided' using errcode = 'MLK68';
  end if;

  insert into public.offer_status_history (offer_id, previous_status, new_status, changed_by)
    values (p_offer_id, 'pending', 'accepted', auth.uid());
  perform public.create_notification(v_offer.provider_id, auth.uid(), 'teklif_kabul_edildi', v_offer.job_id, p_offer_id, v_job.operation_id,
    null, 'Hizmet Alan teklifinizi kabul etti.', null);

  return v_offer;
end;
$function$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 19 — create_job: +4 opsiyonel parametre (52 -> 56). recycling_
-- hazardous İSTEMCİDEN ASLA yazılmaz — derive_recycling_hazardous ile
-- sunucu tarafında hesaplanır.
-- -----------------------------------------------------------------------------
drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date,
  integer, numeric, text, text, uuid, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, jsonb,
  text, text, text, text, jsonb, jsonb, jsonb, jsonb,
  boolean, text[]
);

create or replace function public.create_job(
  p_category_id text,
  p_title text,
  p_description text,
  p_operation_details text,
  p_province text,
  p_district text,
  p_work_location_type text,
  p_work_date date,
  p_photos jsonb,
  p_facility_id text default null,
  p_location_mode text default 'catalog',
  p_address_text text default '',
  p_neighborhood text default null,
  p_location_url text default null,
  p_directions_note text default null,
  p_work_end_date date default null,
  p_product_quantity integer default null,
  p_product_tonnage numeric default null,
  p_product_type text default null,
  p_customs_product_type text default null,
  p_client_id uuid default null,
  p_delivery_province text default null,
  p_delivery_district text default null,
  p_delivery_location_type text default null,
  p_delivery_facility_id text default null,
  p_delivery_facility_name text default null,
  p_delivery_address_text text default null,
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null,
  p_recycling_requested_operation text default null,
  p_recycling_waste_code text default null,
  p_recycling_waste_code_unknown boolean default null,
  p_recycling_hazard_properties text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_photo jsonb;
  v_photo_count integer;
  v_order integer := 0;
  v_storage_hazardous boolean;
  v_recycling_hazardous boolean;
  v_recycling_hazard_properties text[];
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_photo_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_photo_count < 1 or v_photo_count > 10 then
    raise exception 'MLK51: a job requires between 1 and 10 photos (got %)', v_photo_count using errcode = 'MLK51';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);
  perform public.assert_valid_recycling_requested_operation(p_recycling_requested_operation);
  perform public.assert_valid_recycling_waste_code(p_recycling_waste_code, p_recycling_waste_code_unknown);
  perform public.assert_valid_recycling_hazard_properties(p_recycling_hazard_properties);

  v_storage_hazardous := case when p_category_id = 'tehlikeli-madde-depolama' then true else p_storage_hazardous end;
  v_recycling_hazardous := case
    when coalesce(p_recycling_waste_code_unknown, false) then null
    else public.derive_recycling_hazardous(p_recycling_waste_code)
  end;
  v_recycling_hazard_properties := case when v_recycling_hazardous then p_recycling_hazard_properties else null end;

  insert into public.jobs (
    id, requester_id, category_id, title, description, operation_details, province, district,
    work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
    directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
    customs_product_type, delivery_province, delivery_district, delivery_location_type,
    delivery_facility_id, delivery_facility_name, delivery_address_text,
    recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
    recycling_unit, recycling_material_condition, recycling_material_condition_note,
    recycling_scope_of_work, customs_transaction_type, customs_requested_services,
    storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
    product_tonnage_unit, storage_container_groups,
    nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
    nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
    nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
    storage_hazardous, storage_risk_groups,
    recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown,
    recycling_hazardous, recycling_hazard_properties,
    moderation_status
  ) values (
    coalesce(p_client_id, gen_random_uuid()), auth.uid(), p_category_id, p_title, p_description, p_operation_details, p_province, p_district,
    p_work_location_type, p_facility_id, p_location_mode, p_address_text, p_neighborhood, p_location_url,
    p_directions_note, p_work_date, p_work_end_date, p_product_quantity, p_product_tonnage, p_product_type,
    p_customs_product_type, p_delivery_province, p_delivery_district, p_delivery_location_type,
    p_delivery_facility_id, p_delivery_facility_name, p_delivery_address_text,
    p_recycling_material_category_id, p_recycling_material_subtype_id, p_recycling_quantity,
    p_recycling_unit, p_recycling_material_condition, p_recycling_material_condition_note,
    p_recycling_scope_of_work, p_customs_transaction_type, p_customs_requested_services,
    p_storage_product_type, p_storage_product_quantity, p_storage_product_unit, p_storage_product_tonnage,
    p_product_tonnage_unit, p_storage_container_groups,
    p_nakliye_load_preparation_type, p_nakliye_load_preparation_custom_text,
    p_nakliye_loading_method, p_nakliye_loading_method_custom_text, p_nakliye_measurement_info,
    p_nakliye_hazmat, p_nakliye_container_transport, p_nakliye_cargo_groups,
    v_storage_hazardous, p_storage_risk_groups,
    p_recycling_requested_operation, p_recycling_waste_code, coalesce(p_recycling_waste_code_unknown, false),
    v_recycling_hazardous, v_recycling_hazard_properties,
    'pending_review'
  )
  returning * into v_job;

  for v_photo in select * from jsonb_array_elements(p_photos) loop
    insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
    values (
      v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
      (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
      v_order, auth.uid()
    );
    v_order := v_order + 1;
  end loop;

  perform public.append_job_activity_event(v_job.id, null, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

  return v_job;
end;
$$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 20 — create_operation_with_jobs: gövde-içi (yalnızca), AYNI İMZA
-- (per-service alanlar zaten p_services jsonb dizisinden okunuyor). AYNI
-- sunucu tarafı hazardous türetmesi her servis için ayrı ayrı uygulanır.
-- -----------------------------------------------------------------------------
create or replace function public.create_operation_with_jobs(
  p_province text,
  p_operation_details text,
  p_services jsonb,
  p_photos_by_service_index jsonb,
  p_client_operation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.operations;
  v_service jsonb;
  v_index integer := 0;
  v_service_count integer;
  v_category_ids text[];
  v_job public.jobs;
  v_job_ids uuid[] := '{}';
  v_photo jsonb;
  v_photo_count integer;
  v_order integer;
  v_service_client_id uuid;
  v_service_province text;
  v_service_container_groups jsonb;
  v_service_measurement_info jsonb;
  v_service_hazmat jsonb;
  v_service_container_transport jsonb;
  v_service_cargo_groups jsonb;
  v_service_storage_risk_groups text[];
  v_service_storage_hazardous boolean;
  v_service_recycling_waste_code text;
  v_service_recycling_waste_code_unknown boolean;
  v_service_recycling_hazardous boolean;
  v_service_recycling_hazard_properties text[];
begin
  perform public.assert_active_user();
  if public.current_user_role() <> 'hizmet-alan' then
    raise exception 'MLK50: only hizmet-alan accounts may create a job' using errcode = 'MLK50';
  end if;

  v_service_count := jsonb_array_length(coalesce(p_services, '[]'::jsonb));
  if v_service_count < 2 then
    raise exception 'MLK53: an operation requires at least 2 services (got %)', v_service_count using errcode = 'MLK53';
  end if;

  select array_agg(s->>'category_id') into v_category_ids from jsonb_array_elements(p_services) s;
  if (select count(distinct x) from unnest(v_category_ids) x) <> v_service_count then
    raise exception 'MLK54: an operation cannot select the same category more than once' using errcode = 'MLK54';
  end if;

  insert into public.operations (id, requester_id)
  values (coalesce(p_client_operation_id, gen_random_uuid()), auth.uid())
  returning * into v_operation;

  for v_service in select * from jsonb_array_elements(p_services) loop
    if (v_service->>'work_end_date') is not null
       and (v_service->>'work_end_date')::date < (v_service->>'work_date')::date then
      raise exception 'MLK52: work_end_date cannot be before work_date (service %)', v_index using errcode = 'MLK52';
    end if;

    v_photo_count := jsonb_array_length(coalesce(p_photos_by_service_index -> v_index::text, '[]'::jsonb));
    if v_photo_count < 1 or v_photo_count > 10 then
      raise exception 'MLK51: a job requires between 1 and 10 photos (service %, got %)', v_index, v_photo_count using errcode = 'MLK51';
    end if;

    v_service_client_id := nullif(v_service->>'client_id', '')::uuid;
    v_service_province := coalesce(nullif(v_service->>'province', ''), p_province);
    v_service_container_groups := v_service->'storage_container_groups';
    v_service_measurement_info := v_service->'nakliye_measurement_info';
    v_service_hazmat := v_service->'nakliye_hazmat';
    v_service_container_transport := v_service->'nakliye_container_transport';
    v_service_cargo_groups := v_service->'nakliye_cargo_groups';
    v_service_storage_risk_groups := (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'storage_risk_groups', '[]'::jsonb)) x);
    perform public.validate_storage_container_groups(v_service_container_groups);
    perform public.validate_nakliye_measurement_info(v_service_measurement_info);
    perform public.validate_nakliye_hazmat(v_service_hazmat);
    perform public.validate_nakliye_container_transport(v_service_container_transport);
    perform public.validate_nakliye_cargo_groups(v_service_cargo_groups);
    perform public.assert_valid_storage_risk_groups(v_service_storage_risk_groups);
    perform public.assert_valid_recycling_requested_operation(v_service->>'recycling_requested_operation');
    v_service_recycling_waste_code := v_service->>'recycling_waste_code';
    v_service_recycling_waste_code_unknown := coalesce((v_service->>'recycling_waste_code_unknown')::boolean, false);
    perform public.assert_valid_recycling_waste_code(v_service_recycling_waste_code, v_service_recycling_waste_code_unknown);
    v_service_recycling_hazard_properties := (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'recycling_hazard_properties', '[]'::jsonb)) x);
    perform public.assert_valid_recycling_hazard_properties(v_service_recycling_hazard_properties);

    v_service_storage_hazardous := case
      when v_service->>'category_id' = 'tehlikeli-madde-depolama' then true
      else nullif(v_service->>'storage_hazardous', '')::boolean
    end;
    v_service_recycling_hazardous := case
      when v_service_recycling_waste_code_unknown then null
      else public.derive_recycling_hazardous(v_service_recycling_waste_code)
    end;
    v_service_recycling_hazard_properties := case when v_service_recycling_hazardous then v_service_recycling_hazard_properties else null end;

    insert into public.jobs (
      id, operation_id, requester_id, category_id, title, description, operation_details, province, district,
      work_location_type, facility_id, location_mode, address_text, neighborhood, location_url,
      directions_note, work_date, work_end_date, product_quantity, product_tonnage, product_type,
      customs_product_type, delivery_province, delivery_district, delivery_location_type,
      delivery_facility_id, delivery_facility_name, delivery_address_text,
      recycling_material_category_id, recycling_material_subtype_id, recycling_quantity,
      recycling_unit, recycling_material_condition, recycling_material_condition_note,
      recycling_scope_of_work, customs_transaction_type, customs_requested_services,
      storage_product_type, storage_product_quantity, storage_product_unit, storage_product_tonnage,
      product_tonnage_unit, storage_container_groups,
      nakliye_load_preparation_type, nakliye_load_preparation_custom_text,
      nakliye_loading_method, nakliye_loading_method_custom_text, nakliye_measurement_info,
      nakliye_hazmat, nakliye_container_transport, nakliye_cargo_groups,
      storage_hazardous, storage_risk_groups,
      recycling_requested_operation, recycling_waste_code, recycling_waste_code_unknown,
      recycling_hazardous, recycling_hazard_properties,
      moderation_status
    ) values (
      coalesce(v_service_client_id, gen_random_uuid()), v_operation.id, auth.uid(), v_service->>'category_id', v_service->>'title', v_service->>'description',
      p_operation_details, v_service_province, v_service->>'district', v_service->>'work_location_type',
      v_service->>'facility_id', coalesce(v_service->>'location_mode', 'catalog'), coalesce(v_service->>'address_text', ''),
      v_service->>'neighborhood', v_service->>'location_url', v_service->>'directions_note',
      (v_service->>'work_date')::date, (v_service->>'work_end_date')::date,
      nullif(v_service->>'product_quantity', '')::integer, nullif(v_service->>'product_tonnage', '')::numeric,
      v_service->>'product_type', v_service->>'customs_product_type',
      v_service->>'delivery_province', v_service->>'delivery_district', v_service->>'delivery_location_type',
      v_service->>'delivery_facility_id', v_service->>'delivery_facility_name', v_service->>'delivery_address_text',
      v_service->>'recycling_material_category_id', v_service->>'recycling_material_subtype_id',
      nullif(v_service->>'recycling_quantity', '')::numeric, v_service->>'recycling_unit',
      v_service->>'recycling_material_condition', v_service->>'recycling_material_condition_note',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'recycling_scope_of_work', '[]'::jsonb)) x),
      v_service->>'customs_transaction_type',
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_service->'customs_requested_services', '[]'::jsonb)) x),
      v_service->>'storage_product_type', nullif(v_service->>'storage_product_quantity', '')::numeric,
      v_service->>'storage_product_unit', nullif(v_service->>'storage_product_tonnage', '')::numeric,
      v_service->>'product_tonnage_unit', v_service_container_groups,
      v_service->>'nakliye_load_preparation_type', v_service->>'nakliye_load_preparation_custom_text',
      v_service->>'nakliye_loading_method', v_service->>'nakliye_loading_method_custom_text', v_service_measurement_info,
      v_service_hazmat, v_service_container_transport, v_service_cargo_groups,
      v_service_storage_hazardous, v_service_storage_risk_groups,
      v_service->>'recycling_requested_operation', v_service_recycling_waste_code, v_service_recycling_waste_code_unknown,
      v_service_recycling_hazardous, v_service_recycling_hazard_properties,
      'pending_review'
    )
    returning * into v_job;

    v_order := 0;
    for v_photo in select * from jsonb_array_elements(p_photos_by_service_index -> v_index::text) loop
      insert into public.job_photos (job_id, storage_path, original_file_name, mime_type, size_bytes, width, height, sort_order, uploaded_by)
      values (
        v_job.id, v_photo->>'storage_path', v_photo->>'original_file_name', v_photo->>'mime_type',
        (v_photo->>'size_bytes')::bigint, (v_photo->>'width')::integer, (v_photo->>'height')::integer,
        v_order, auth.uid()
      );
      v_order := v_order + 1;
    end loop;

    perform public.append_job_activity_event(v_job.id, v_operation.id, auth.uid(), 'job_created', 'İlan oluşturuldu', null, null, 'public');

    v_job_ids := array_append(v_job_ids, v_job.id);
    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('operation_id', v_operation.id, 'job_ids', v_job_ids);
end;
$$;

-- -----------------------------------------------------------------------------
-- BÖLÜM 21 — update_job_as_admin / update_job_as_requester: +4 opsiyonel
-- parametre. STALE OVERLOAD KORUMASI. recycling_hazardous, kod/bilinmiyor
-- bayrağı GERÇEKTEN değiştiyse yeniden türetilir (job-store.ts#
-- applyAdminJobEdit'in İSTEMCİ tarafındaki AYNI "yalnızca kod değiştiyse
-- yeniden hesapla" ilkesi) — aksi halde mevcut değer korunur (coalesce
-- deseni, diğer tüm alanlarla AYNI).
-- -----------------------------------------------------------------------------
drop function if exists public.update_job_as_admin(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb,
  boolean, text[]
);

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
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null,
  p_recycling_requested_operation text default null,
  p_recycling_waste_code text default null,
  p_recycling_waste_code_unknown boolean default null,
  p_recycling_hazard_properties text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
  v_storage_hazardous boolean;
  v_recycling_code_changed boolean;
  v_recycling_hazardous boolean;
  v_recycling_hazard_properties text[];
begin
  perform public.assert_active_user();
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
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);
  perform public.assert_valid_recycling_requested_operation(p_recycling_requested_operation);
  perform public.assert_valid_recycling_waste_code(p_recycling_waste_code, p_recycling_waste_code_unknown);
  perform public.assert_valid_recycling_hazard_properties(p_recycling_hazard_properties);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';
  v_storage_hazardous := case when v_job.category_id = 'tehlikeli-madde-depolama' then true else coalesce(p_storage_hazardous, v_job.storage_hazardous) end;

  v_recycling_code_changed := p_recycling_waste_code is not null or p_recycling_waste_code_unknown is not null;
  if v_recycling_code_changed then
    v_recycling_hazardous := case
      when coalesce(p_recycling_waste_code_unknown, v_job.recycling_waste_code_unknown, false) then null
      else public.derive_recycling_hazardous(coalesce(p_recycling_waste_code, v_job.recycling_waste_code))
    end;
    v_recycling_hazard_properties := case when v_recycling_hazardous then coalesce(p_recycling_hazard_properties, v_job.recycling_hazard_properties) else null end;
  else
    v_recycling_hazardous := v_job.recycling_hazardous;
    v_recycling_hazard_properties := coalesce(p_recycling_hazard_properties, v_job.recycling_hazard_properties);
  end if;

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
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
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups),
    storage_hazardous = v_storage_hazardous,
    storage_risk_groups = coalesce(p_storage_risk_groups, storage_risk_groups),
    recycling_requested_operation = coalesce(p_recycling_requested_operation, recycling_requested_operation),
    recycling_waste_code = case when p_recycling_waste_code_unknown = true then null else coalesce(p_recycling_waste_code, recycling_waste_code) end,
    recycling_waste_code_unknown = coalesce(p_recycling_waste_code_unknown, recycling_waste_code_unknown),
    recycling_hazardous = v_recycling_hazardous,
    recycling_hazard_properties = v_recycling_hazard_properties
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan admin tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_admin', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;

drop function if exists public.update_job_as_requester(
  uuid, text, text, text, text, text, text, date, date, integer, numeric, text, text,
  text, text, text, text, text, text, text, text,
  text, text, numeric, text, text, text, text[], text, text[],
  text, numeric, text, numeric, text, timestamptz, jsonb, text, text, text, text, jsonb, jsonb, jsonb, jsonb,
  boolean, text[]
);

create or replace function public.update_job_as_requester(
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
  p_recycling_material_category_id text default null,
  p_recycling_material_subtype_id text default null,
  p_recycling_quantity numeric default null,
  p_recycling_unit text default null,
  p_recycling_material_condition text default null,
  p_recycling_material_condition_note text default null,
  p_recycling_scope_of_work text[] default null,
  p_customs_transaction_type text default null,
  p_customs_requested_services text[] default null,
  p_storage_product_type text default null,
  p_storage_product_quantity numeric default null,
  p_storage_product_unit text default null,
  p_storage_product_tonnage numeric default null,
  p_product_tonnage_unit text default null,
  p_expected_updated_at timestamptz default null,
  p_storage_container_groups jsonb default null,
  p_nakliye_load_preparation_type text default null,
  p_nakliye_load_preparation_custom_text text default null,
  p_nakliye_loading_method text default null,
  p_nakliye_loading_method_custom_text text default null,
  p_nakliye_measurement_info jsonb default null,
  p_nakliye_hazmat jsonb default null,
  p_nakliye_container_transport jsonb default null,
  p_nakliye_cargo_groups jsonb default null,
  p_storage_hazardous boolean default null,
  p_storage_risk_groups text[] default null,
  p_recycling_requested_operation text default null,
  p_recycling_waste_code text default null,
  p_recycling_waste_code_unknown boolean default null,
  p_recycling_hazard_properties text[] default null
)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
  v_container_mode boolean;
  v_storage_hazardous boolean;
  v_recycling_code_changed boolean;
  v_recycling_hazardous boolean;
  v_recycling_hazard_properties text[];
begin
  perform public.assert_active_user();

  select * into v_job from public.jobs where id = p_job_id and deleted_at is null;
  if v_job is null then
    raise exception 'ML129: job not found' using errcode = 'ML129';
  end if;
  if v_job.requester_id <> auth.uid() then
    raise exception 'ML130: only the job owner may edit this job' using errcode = 'ML130';
  end if;
  if v_job.moderation_status <> 'pending_review' then
    raise exception 'ML131: only a job awaiting review can be edited this way' using errcode = 'ML131';
  end if;
  if p_expected_updated_at is not null and v_job.updated_at <> p_expected_updated_at then
    raise exception 'ML118: this job was modified since it was opened for editing, please reload' using errcode = 'ML118';
  end if;
  if p_work_end_date is not null and p_work_end_date < p_work_date then
    raise exception 'MLK52: work_end_date cannot be before work_date' using errcode = 'MLK52';
  end if;
  perform public.validate_storage_container_groups(p_storage_container_groups);
  perform public.validate_nakliye_measurement_info(p_nakliye_measurement_info);
  perform public.validate_nakliye_hazmat(p_nakliye_hazmat);
  perform public.validate_nakliye_container_transport(p_nakliye_container_transport);
  perform public.validate_nakliye_cargo_groups(p_nakliye_cargo_groups);
  perform public.assert_valid_storage_risk_groups(p_storage_risk_groups);
  perform public.assert_valid_recycling_requested_operation(p_recycling_requested_operation);
  perform public.assert_valid_recycling_waste_code(p_recycling_waste_code, p_recycling_waste_code_unknown);
  perform public.assert_valid_recycling_hazard_properties(p_recycling_hazard_properties);

  v_container_mode := coalesce(p_nakliye_container_transport ->> 'status', '') = 'evet';
  v_storage_hazardous := case when v_job.category_id = 'tehlikeli-madde-depolama' then true else coalesce(p_storage_hazardous, v_job.storage_hazardous) end;

  v_recycling_code_changed := p_recycling_waste_code is not null or p_recycling_waste_code_unknown is not null;
  if v_recycling_code_changed then
    v_recycling_hazardous := case
      when coalesce(p_recycling_waste_code_unknown, v_job.recycling_waste_code_unknown, false) then null
      else public.derive_recycling_hazardous(coalesce(p_recycling_waste_code, v_job.recycling_waste_code))
    end;
    v_recycling_hazard_properties := case when v_recycling_hazardous then coalesce(p_recycling_hazard_properties, v_job.recycling_hazard_properties) else null end;
  else
    v_recycling_hazardous := v_job.recycling_hazardous;
    v_recycling_hazard_properties := coalesce(p_recycling_hazard_properties, v_job.recycling_hazard_properties);
  end if;

  update public.jobs set
    title = p_title, description = p_description,
    province = p_province, district = p_district, work_location_type = p_work_location_type, address_text = p_address_text,
    work_date = p_work_date, work_end_date = p_work_end_date,
    product_quantity = case when v_container_mode then null else coalesce(p_product_quantity, product_quantity) end,
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
    delivery_district = coalesce(p_delivery_district, delivery_district),
    recycling_material_category_id = coalesce(p_recycling_material_category_id, recycling_material_category_id),
    recycling_material_subtype_id = coalesce(p_recycling_material_subtype_id, recycling_material_subtype_id),
    recycling_quantity = coalesce(p_recycling_quantity, recycling_quantity),
    recycling_unit = coalesce(p_recycling_unit, recycling_unit),
    recycling_material_condition = coalesce(p_recycling_material_condition, recycling_material_condition),
    recycling_material_condition_note = coalesce(p_recycling_material_condition_note, recycling_material_condition_note),
    recycling_scope_of_work = coalesce(p_recycling_scope_of_work, recycling_scope_of_work),
    customs_transaction_type = coalesce(p_customs_transaction_type, customs_transaction_type),
    customs_requested_services = coalesce(p_customs_requested_services, customs_requested_services),
    storage_product_type = coalesce(p_storage_product_type, storage_product_type),
    storage_product_quantity = coalesce(p_storage_product_quantity, storage_product_quantity),
    storage_product_unit = coalesce(p_storage_product_unit, storage_product_unit),
    storage_product_tonnage = coalesce(p_storage_product_tonnage, storage_product_tonnage),
    product_tonnage_unit = coalesce(p_product_tonnage_unit, product_tonnage_unit),
    storage_container_groups = coalesce(p_storage_container_groups, storage_container_groups),
    nakliye_load_preparation_type = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_type, nakliye_load_preparation_type) end,
    nakliye_load_preparation_custom_text = case when v_container_mode then null else coalesce(p_nakliye_load_preparation_custom_text, nakliye_load_preparation_custom_text) end,
    nakliye_loading_method = coalesce(p_nakliye_loading_method, nakliye_loading_method),
    nakliye_loading_method_custom_text = coalesce(p_nakliye_loading_method_custom_text, nakliye_loading_method_custom_text),
    nakliye_measurement_info = case when v_container_mode then null else coalesce(p_nakliye_measurement_info, nakliye_measurement_info) end,
    nakliye_hazmat = coalesce(p_nakliye_hazmat, nakliye_hazmat),
    nakliye_container_transport = coalesce(p_nakliye_container_transport, nakliye_container_transport),
    nakliye_cargo_groups = coalesce(p_nakliye_cargo_groups, nakliye_cargo_groups),
    storage_hazardous = v_storage_hazardous,
    storage_risk_groups = coalesce(p_storage_risk_groups, storage_risk_groups),
    recycling_requested_operation = coalesce(p_recycling_requested_operation, recycling_requested_operation),
    recycling_waste_code = case when p_recycling_waste_code_unknown = true then null else coalesce(p_recycling_waste_code, recycling_waste_code) end,
    recycling_waste_code_unknown = coalesce(p_recycling_waste_code_unknown, recycling_waste_code_unknown),
    recycling_hazardous = v_recycling_hazardous,
    recycling_hazard_properties = v_recycling_hazard_properties
  where id = p_job_id
  returning * into v_job;

  perform public.append_job_activity_event(p_job_id, v_job.operation_id, auth.uid(), 'job_updated', 'İlan sahibi tarafından güncellendi', null, null, 'requester_only');
  perform public.log_audit_event('update_job_as_requester', 'jobs', p_job_id, null, jsonb_build_object('title', p_title));

  return v_job;
end;
$$;
