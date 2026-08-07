-- =============================================================================
-- MALSEVK — Faz 1 migration 0027: job_customs_documents altyapısının kaldırılması
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri. 0001-0026'nın HİÇBİRİ değiştirilmedi/
-- yeniden yazılmadı — bu, İLERİYE DÖNÜK bir düzeltme migration'ıdır (0022'nin
-- 0015'i, 0024'ün 0007'yi düzelttiği YÖNTEMİN AYNISI: uygulanmış bir migration
-- asla geriye dönük düzenlenmez, yalnızca yeni bir migration onu evrimleştirir/
-- geri alır).
--
-- KÖKEN: "Kapsam düzeltmesi" — 0025'in Bölüm 1'i (job_customs_documents +
-- create_job_customs_document + delete_job_customs_document) ve 0026'nın
-- TAMAMI (job-customs-documents bucket + 3 Storage politikası) YANLIŞ
-- kapsamda eklenmişti: MALSEVK'te ilan/teklif/operasyon sırasında hiçbir
-- gümrük destekleyici belgesi (konşimento, fatura, çeki listesi, menşe
-- belgesi vb.) TUTULMAYACAK — belge yükleme yalnızca hizmet veren FİRMANIN
-- kayıt sırasında/sonrasında yüklediği firma doğrulama belgeleri (provider_
-- documents, 0007) içindir. Bu migration YALNIZCA bu yanlış kapsamı geri
-- alır.
--
-- BU MİGRASYON NE YAPMAZ (kullanıcıyla netleştirildi, kesinlikle KALACAK):
--   * provider_documents / provider_document_reviews / provider_document_
--     consents (0007) ve provider-documents private Storage bucket'ı (0019) —
--     HİÇBİR DROP/ALTER YOK, bu dosyada bir kez bile adı geçmiyor DDL
--     bağlamında.
--   * badge_types / provider_badges (0025 Bölüm 2/3), Mavi Tik/Altın Tik seed
--     satırları, grant_provider_badge()/revoke_provider_badge() RPC'leri —
--     HİÇBİR DROP/ALTER YOK.
--   * 0025/0026 dosyalarının kendisi bu migration'la BİRLİKTE HİÇ
--     düzenlenmedi/silinmedi — onlar tarihte olduğu gibi kalır, yalnızca bu
--     dosya onların Bölüm 1'ini/tamamını geri alır.
--
-- GÜVENLİ BAĞIMLILIK SIRASI (CASCADE KULLANILMADAN — her bağımlılık önce
-- açıkça tespit edilip kendi adıyla kaldırılır):
--   1) storage.objects üzerindeki 3 job-customs-documents politikası (adları
--      ile, DROP POLICY IF EXISTS) — storage.objects hiçbir zaman drop
--      edilmeyen paylaşılan bir tablo olduğu için bu adım her zaman güvenli/
--      idempotent'tir.
--   2) create_job_customs_document / delete_job_customs_document RPC'leri
--      (DROP FUNCTION IF EXISTS, tam imza ile) — hiçbir başka fonksiyon/
--      trigger bunları çağırmıyor (0025-0026 dışında hiçbir dosyada
--      referans yok, doğrudan grep ile doğrulandı), CASCADE gerekmez.
--   3) public.job_customs_documents tablosu (DROP TABLE IF EXISTS) — kendi
--      RLS politikası ve jobs(id) FK'si tabloyla BİRLİKTE otomatik kaldırılır
--      (policy bir tabloya ait bir alt-nesnedir, ayrı DROP POLICY adımı
--      GEREKMEZ); hiçbir başka tablo job_customs_documents'a FK ile bağlı
--      değildir (doğrudan grep ile doğrulandı — bu tablo baştan beri bir
--      "leaf" tablo olarak tasarlanmıştı), bu yüzden CASCADE gerekmez.
--
-- BİLEREK BURADA YAPILMAYAN BİR ŞEY — GERÇEK, KEŞFEDİLMİŞ BİR PLATFORM
-- KISITI, TASARIM TERCİHİ DEĞİL: `storage.buckets`'tan job-customs-documents
-- satırının kendisini (ve ona ait olabilecek `storage.objects` satırlarını)
-- SQL ile DELETE etmeye çalışmak, bu migration'ın kendi yerel Docker
-- doğrulamasında GERÇEK bir çalışma zamanı hatası verdi: "ERROR: Direct
-- deletion from storage tables is not allowed. Use the Storage API instead."
-- (SQLSTATE 42501) — Supabase, storage.objects/storage.buckets üzerinde
-- doğrudan SQL DELETE'i platform seviyesinde ENGELLER (asıl S3-destekli
-- dosyanın/bucket'ın gerçek Storage servisi dışında, bookkeeping'i atlayarak
-- silinmesini önlemek için); yalnızca Storage (Admin) API (service_role
-- anahtarıyla `deleteBucket`/`emptyBucket`) bunu yapabilir — bu, 0019'un
-- kendi "Postgres tek başına Storage nesnelerini silemez" notuyla AYNI
-- ailede ama ONDAN DAHA GENİŞ bir kısıt (yalnızca client RPC'leri değil,
-- migration'ın kendisi de dahil). Bu yüzden bu migration'ın kapsamı BİLEREK
-- yalnızca SQL ile güvenle yapılabilenle sınırlıdır: üç Storage POLİTİKASINI
-- kaldırmak (aşağıda) — bucket satırının kendisi bu migration'dan SONRA
-- `storage.buckets`'ta boş/erişimsiz bir kalıntı olarak kalır (hiçbir
-- politika kalmadığı için RLS varsayılan-red uygular, service_role hariç
-- KİMSE ona erişemez). Satırın fiziksel olarak kaldırılması, service_role
-- anahtarıyla Storage Admin API üzerinden AYRI, bu migration'ın dışında bir
-- operasyonel adımdır — bkz. bu görevin kendi teknik raporu "Kalan riskler".
--
-- İDEMPOTENCY: her adım IF EXISTS ile korunur — bu migration hem sıfırdan bir
-- `supabase db reset`te (0025/0026 onları oluşturduktan hemen sonra bu dosya
-- kaldırır) hem de yalnızca bu dosyanın tek başına tekrar çalıştırılmaya
-- çalışıldığı bir senaryoda (nesneler zaten yoksa) hatasız tamamlanır.
-- =============================================================================


-- =============================================================================
-- ADIM 1 — Storage: job-customs-documents bucket'ının 3 politikası
-- =============================================================================
-- Yalnızca bu üç, ADI İLE — başka hiçbir bucket'ın (job-photos/provider-
-- logos/provider-documents) politikası bu dosyada ADI GEÇMİYOR, dolayısıyla
-- dokunulmuyor. Politikalar kaldırıldıktan sonra bucket satırı kalıcı olarak
-- erişimsizdir (yukarıdaki platform-kısıtı notuna bkz.).
drop policy if exists job_customs_documents_bucket_read_own_or_admin on storage.objects;
drop policy if exists job_customs_documents_bucket_write_own_folder on storage.objects;
drop policy if exists job_customs_documents_bucket_delete_own_folder on storage.objects;


-- =============================================================================
-- ADIM 2 — RPC'ler
-- =============================================================================
drop function if exists public.create_job_customs_document(uuid, text, text, text, text, bigint);
drop function if exists public.delete_job_customs_document(uuid);


-- =============================================================================
-- ADIM 3 — Tablo (kendi RLS politikası ve FK'si tabloyla birlikte gider)
-- =============================================================================
drop table if exists public.job_customs_documents;

-- =============================================================================
-- Bilerek burada YOK: badge_types, provider_badges, provider_documents,
-- provider_document_reviews, provider_document_consents, provider-documents
-- bucket'ı, job_photos, jobs, operations — bunların hiçbirine bu dosyada
-- DDL/DML ile dokunulmadı.
-- =============================================================================
