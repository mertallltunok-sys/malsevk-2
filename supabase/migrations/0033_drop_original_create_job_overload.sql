-- =============================================================================
-- MALSEVK — tam uçtan uca regresyon testi migration 0033: create_job'ın
-- ORİJİNAL (0014) 16 parametreli overload'ını da kaldırır
-- =============================================================================
-- STATUS: "Özellik eklemeye başlamadan önce tam bir uçtan uca regresyon
-- testi" görevi sırasında BULUNAN, gerçek ve önceden var olan bir hata —
-- 0031/0032 tarafından değil, bu regresyon taramasının kendisiyle (gerçek
-- bir RPC çağrısı, statik inceleme DEĞİL) yakalandı. 0032 (bu görevden bir
-- önceki fazda yazıldı) yalnızca 0028'in 21 parametreli overload'ını
-- kaldırmıştı; ORİJİNAL 0014'ün 16 parametreli overload'ı o zaman fark
-- edilmeden canlıda kalmaya devam etmişti — 0028'in "eski imza ayrı bir
-- overload olarak KALMAZ" varsayımı (0032'nin kendi başlığının zaten
-- belgelediği gibi) hem 16→21 hem 21→27 geçişinde YANLIŞ çıktı, yalnızca
-- ikincisi 0032'de düzeltildi.
--
-- NASIL BULUNDU: scripts/tmp-admin-panel-phase2-seed-local.mjs (Faz 2'den
-- kalma, önceden var olan bir seed script'i) yalnızca 16 parametreyle
-- `create_job` çağırıyor — bu çağrı şekli hem 0014'ün 16 parametreli
-- overload'ıyla HEM DE 0031'in 27 parametreli overload'ıyla (tüm yeni
-- alanlar opsiyonel/default olduğu için) eşleşiyor, PostgREST'in aynı
-- PGRST203 "Could not choose the best candidate function" hatasını
-- üretmesine yol açıyordu.
--
-- DÜZELTME: kalan orijinal 16 parametreli imza `drop function` ile açıkça
-- kaldırılır — 0032'nin AYNI deseni. Bundan sonra `create_job` için TEK bir
-- overload (27 parametreli, 0031) kalır. `supabase-job-sync.ts` zaten her
-- zaman tüm 27 parametreyi gönderiyor, bu yüzden hiçbir gerçek uygulama
-- çağıranı bundan ETKİLENMEZ — yalnızca eski/kısmi parametre listesiyle
-- çağıran script'ler (ör. yukarıdaki seed script'i) artık tek, doğru adaya
-- düşer.
--
-- Hata kodu değişikliği yok.
-- =============================================================================

drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date
);
