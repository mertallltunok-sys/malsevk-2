-- =============================================================================
-- MALSEVK — migration 0045: Geri Dönüşüm & Atık Tahliye hizmet kategorisi
-- =============================================================================
-- AMAÇ: yeni ana hizmet "Geri Dönüşüm & Atık Tahliye" için TEK yeni
-- `service_categories` (0002) satırı — app/_lib/service-catalog.ts'e eklenen
-- yeni tek-kategorili grubun (Nakliye/Gümrük Müşavirliği ile AYNI desen)
-- birebir Supabase karşılığı. `id`: 'geri-donusum-atik-tahliye'.
--
-- İKİNCİ BİR SİSTEM İCAT EDİLMEDİ: bu satır eklendiği an, 0038'in tamamen
-- jenerik `provider_can_view_category()`/`provider_service_authorizations`
-- mekanizması (her kategori artık admin onaylı yetkilendirme olmadan
-- görünmez/teklif alamaz — visibility_scope kolonu zaten 0038'den beri
-- OKUNMUYOR, bkz. o migration'ın kendi başlığı) bu yeni kategoriyi de hiçbir
-- ek kod olmadan kapsar. Aynı şekilde 0038/0041'in belge-onayı ->
-- otomatik-yetkilendirme zinciri (`create_provider_document`/
-- `review_provider_document`) `service_category_id` doldurulmuş herhangi bir
-- 'genel' belge için zaten jenerik çalışıyor — bu kategori için de YENİ bir
-- document_type/RPC gerekmiyor.
--
-- ÜRÜN KARARI (görev geçmişi): bu hizmet İLK taslakta hem normal hizmet
-- satın alma hem "hurda alım teklifi" (tersine fiyatlandırma) modelini
-- destekleyecekti — bu model TAMAMEN İPTAL EDİLDİ. MALSEVK bir mal
-- alım-satım pazaryeri DEĞİLDİR; Geri Dönüşüm & Atık Tahliye de her diğer
-- hizmet gibi TEK bir modele bağlıdır (ilan -> normal hizmet teklifi ->
-- kabul -> mevcut operasyon süreci). Bu yüzden `offers` tablosunda/
-- `create_offer` RPC'sinde HİÇBİR değişiklik yoktur — bkz. 0046/0047'nin
-- kendi başlıkları.
-- =============================================================================

insert into public.service_categories (id, slug, name, group_slug, group_name, visibility_scope, sort_order) values
  ('geri-donusum-atik-tahliye', 'geri-donusum-atik-tahliye', 'Geri Dönüşüm & Atık Tahliye', 'geri-donusum-hizmetleri', 'Geri Dönüşüm & Hizmetleri', 'standard', 27)
on conflict (id) do nothing;
