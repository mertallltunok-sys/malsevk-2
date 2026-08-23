-- =============================================================================
-- MALSEVK — migration 0055: Geri Dönüşüm & Atık Tahliye "Hizmet Kapsamı" sadeleştirmesi
-- =============================================================================
-- AMAÇ: "Geri Dönüşüm Hizmet Kapsamı Sadeleştirmesi" görev talimatı. Eski 4
-- seçenek (sahadan-toplama/yukleme/tesisten-tahliye/tasima) yerine 4 YENİ,
-- birbirini dışlamayan işlem: sahadan-toplama (değişmedi) / araca-yukleme
-- (eski "yukleme"nin yeniden adlandırılmış hâli) / tasima (değişmedi) /
-- tesise-teslim (yeni — "tesisten-tahliye"nin YERİNE, onunla eşlenerek DEĞİL).
--
-- "tesisten-tahliye" NEDEN topluca "tesise-teslim"e ÇEVRİLMEDİ: görev
-- talimatı kanıtsız bir dönüşümü açıkça yasaklıyor. Development'ta doğrudan
-- Postgres bağlantısıyla GERÇEK bir kontrol yapıldı — `select id,
-- recycling_scope_of_work from public.jobs where recycling_scope_of_work is
-- not null` — TEK bir ilan bulundu (`["sahadan-toplama","yukleme"]`),
-- "tesisten-tahliye" HİÇ kullanılmamış. Bu yüzden bu migration onu ne
-- dönüştürüyor ne siliyor — yalnızca artık YENİ yazımlarda kabul edilen
-- değerler listesine dahil DEĞİL (app kodu zaten hiçbir formda seçenek
-- olarak sunmuyor, bkz. recycling-catalog.ts), CHECK constraint'i ESKİ
-- değeri hâlâ İZİN VERİYOR (bir gün ham SQL'le ya da eski bir istemci
-- sürümüyle yazılırsa reddedilmesin diye, veri kaybı riski sıfıra indirilir)
-- — yalnızca ARTIK app kodu tarafından hiç YAZILMIYOR.
--
-- Bu yüzden CHECK constraint SALT ADDITIVE (genişletici) güncelleniyor: eski
-- 4 değer + yeni 2 değer (araca-yukleme, tesise-teslim) birlikte kabul
-- edilir — hiçbir eski değer listeden ÇIKARILMADI, bu yüzden eski ilanlar
-- (ör. tek gerçek kayıt, "yukleme" içeren) bu migration'dan SONRA da
-- constraint'i sorunsuz geçmeye devam eder, herhangi bir UPDATE/re-save
-- tetiklenmeden.
--
-- "Tüm Süreç" (recycling-fields.tsx'in UI kısayolu) 5. bir DEĞER OLARAK BU
-- CONSTRAINT'E HİÇ EKLENMEDİ — asla `jobs.recycling_scope_of_work`e
-- yazılmaz, salt istemci tarafı bir toplu-seçim/toplu-kaldırma kısayolu
-- (bkz. o bileşenin kendi dokümanı).
--
-- create_job/create_operation_with_jobs/update_job_as_admin/
-- update_job_as_requester RPC'lerinin HİÇBİRİNİN imzası DEĞİŞMİYOR —
-- recycling_scope_of_work zaten `text[]` idi, tip/parametre adı aynı kalıyor,
-- yalnızca kolon seviyesindeki CHECK genişliyor. Bu yüzden 0032-0034/0053/
-- 0054'ün "drop function if exists + create or replace" disiplini burada
-- GEREKMİYOR — hiçbir RPC dosyası bu migrationda DOKUNULMADI.
-- =============================================================================

alter table public.jobs drop constraint if exists jobs_recycling_scope_of_work_valid;

alter table public.jobs add constraint jobs_recycling_scope_of_work_valid
  check (
    recycling_scope_of_work is null
    or recycling_scope_of_work <@ array[
      'sahadan-toplama', 'yukleme', 'tesisten-tahliye', 'tasima',
      'araca-yukleme', 'tesise-teslim'
    ]::text[]
  );

comment on column public.jobs.recycling_scope_of_work is
  'types.ts#Job.recyclingScopeOfWork ile birebir — "Hizmet Kapsamı" çoklu seçimi. 0055 SONRASI yeni ilanlar yalnızca sahadan-toplama/araca-yukleme/tasima/tesise-teslim yazar (bkz. recycling-catalog.ts#RECYCLING_SCOPE_OF_WORK_OPTIONS); eski yukleme/tesisten-tahliye değerleri CHECK''te (geriye dönük uyumluluk için) hâlâ İZİN VERİLİR ama artık hiçbir formda SEÇENEK olarak sunulmaz — "yukleme" görüntülemede "araca-yukleme"ye eşlenir (recycling-catalog.ts#LEGACY_SCOPE_OF_WORK_ALIASES), "tesisten-tahliye" kanıtsız eşleme yasağı nedeniyle KENDİ eski etiketiyle gösterilmeye devam eder. Hiçbir seçenek ayrı bir ilan/iş OLUŞTURMAZ, yalnızca bu TEK ilanın kapsamını kaydeder.';
