-- =============================================================================
-- 0040 — provider_documents_one_pending_per_provider_type: hizmet bazına
-- genişletilir (görev bölüm 4-7/44: gerçek UI testiyle bulunan bir bug)
--
-- 0024, "(provider_id, document_type) için aynı anda en fazla bir pending
-- belge" kısıtını GETİRMİŞTİ — o zaman document_type ('genel'/'gumruk-
-- musaviri-izin-belgesi') tek ayrım eksenidir ve bir provider'ın TEK bir
-- "genel" belgesi olabileceği varsayılıyordu. 0038, provider_documents'e
-- service_category_id ekleyerek "her hizmetin KENDİ belgesi" modelini
-- getirdi ama BU indeksi güncellemeyi UNUTTU — sonuç: iki farklı hizmet
-- (ör. Gözetim Hizmetleri VE Lashing/Unlashing) için art arda yüklenen iki
-- "genel" belge, service_category_id'leri FARKLI olsa bile aynı
-- (provider_id, document_type='genel') çiftini paylaştığı için ikinci INSERT
-- HER ZAMAN 23505 (MLK81) ile reddediliyordu — GERÇEK Playwright testiyle
-- canlı Development projesinde doğrudan gözlemlendi (hata metni: "duplicate
-- key value violates unique constraint
-- \"provider_documents_one_pending_per_provider_type\""), tahmin/varsayım
-- DEĞİL.
--
-- ÇÖZÜM: indeks `service_category_id`yi de kapsayacak şekilde genişletilir —
-- artık "aynı provider + aynı document_type + AYNI service_category_id" için
-- aynı anda en fazla bir pending belge kuralı geçerli, "aynı document_type
-- ama FARKLI service_category_id" artık serbestçe eş zamanlı pending olabilir
-- (bu tam olarak görev bölüm 6/7'nin istediği: her hizmetin belgesi
-- bağımsız). BİLİNEN, KASITLI SINIRLAMA: `service_category_id IS NULL` olan
-- (hizmete bağlanmamış, "genel/örtük" eski tarz) belgeler için PostgreSQL'in
-- NULL <> NULL kuralı gereği bu indeks artık iki NULL satırı ÇAKIŞMA
-- SAYMAZ — 0024'ün orijinal korumasının dar bir alt kümesi (yalnızca
-- service_category_id=NULL belgeler) artık DB seviyesinde garanti edilmiyor.
-- Kabul edilebilir: (a) yeni Belge Yükleme akışı (document-upload-content.tsx)
-- HER ZAMAN gerçek bir service_category_id gönderir, NULL asla üretmez;
-- (b) registration'ın eski, service_category_id=NULL üreten yolu artık
-- kayıt formundan tamamen kaldırıldığı için (görev bölüm 2) pratikte
-- ÇAĞRILMIYOR. Yeni bir kod YOK — create_provider_document'in kendi MLK81
-- yakalama bloğu (0024) DEĞİŞMEDEN aynı unique_violation'ı yakalamaya devam
-- eder, yalnızca indeksin KAPSAMI genişledi.
-- =============================================================================

drop index if exists public.provider_documents_one_pending_per_provider_type;

create unique index provider_documents_one_pending_per_provider_type
  on public.provider_documents (provider_id, document_type, service_category_id)
  where current_review_status = 'pending' and deleted_at is null;

comment on index public.provider_documents_one_pending_per_provider_type is
  '0040: service_category_id eklendi — artık bir provider + document_type + service_category_id üçlüsü için aynı anda en fazla bir pending belge (0024''ün orijinal (provider_id, document_type) kapsamı, migration 0038''in "her hizmetin kendi belgesi" modeliyle uyumsuzdu, gerçek UI testiyle bulundu). NULL service_category_id için iki satır ÇAKIŞMA sayılmaz (Postgres NULL semantiği) — bilinçli, dar kapsamlı bir sınırlama, bkz. dosya başlığı.';
