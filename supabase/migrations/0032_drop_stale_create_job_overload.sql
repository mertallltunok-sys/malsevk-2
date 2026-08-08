-- =============================================================================
-- MALSEVK — Supabase Geçişi Faz 4 migration 0032: eski create_job overload'ını
-- kaldırır (0031'in gerçek çalıştırma-zamanı hatası)
-- =============================================================================
-- STATUS: Supabase Geçişi Faz 4'ün devamı — 0031 hosted dev'e uygulandıktan
-- SONRA, gerçek bir RPC çağrısıyla tespit edilen çalıştırma-zamanı hatası
-- (statik SQL incelemesiyle YAKALANAMAZDI — yalnızca PostgREST'in gerçek
-- fonksiyon çözümlemesiyle ortaya çıktı). 0031 KENDİSİ düzenlenmedi
-- (yerleşik ilke: uygulanmış bir migration asla geriye dönük düzenlenmez —
-- bkz. 0022'nin 0001-0021'i, 0030'un 0028'i AYNI şekilde bir SONRAKİ
-- migration'la düzelttiği emsal).
--
-- KÖK NEDEN: `create or replace function` yalnızca AYNI parametre
-- imzasıyla (tip+sırayla) bir fonksiyonu GERÇEKTEN değiştirir. 0031,
-- `create_job`'ı 0028'in 21 parametreli imzasına 6 YENİ parametre EKLEYEREK
-- tanımladı — bu Postgres için FARKLI bir imza, dolayısıyla "replace"
-- değil, İKİNCİ bir overload'un CREATE edilmesiydi; 0028'in kendi (yanlış)
-- varsayımının aksine (bkz. o dosyanın "eski imza ayrı bir overload OLARAK
-- KALMAZ" notu — bu iddia burada YANLIŞ çıktı), eski 21 parametreli
-- `create_job` de canlıda kalmaya devam etti. Sonuç: `supabase-job-sync.ts`
-- HARİÇ (o zaten TÜM 27 parametreyi gönderiyor, tek adaya düşüyor) — yalnızca
-- 21 parametreyle (yeni 6 delivery alanı olmadan) çağıran HERHANGİ bir
-- istemci (ör. bu fazın kendi RPC-seviyeli test script'inin ESKİ çağrıları)
-- PostgREST'in PGRST203 "Could not choose the best candidate function"
-- hatasıyla karşılaşıyordu — doğrudan gerçek bir çağrıyla yakalandı.
--
-- DÜZELTME: eski 21 parametreli imza `drop function` ile açıkça kaldırılır.
-- `supabase-job-sync.ts` (ve bu fazın güncellenmiş test script'leri) zaten
-- her zaman TÜM 27 parametreyi (yeni 6'sı dahil, hepsi `default null` ile
-- opsiyonel) gönderiyor — bu yüzden kalan 27 parametreli `create_job`
-- hiçbir gerçek çağıranı KIRMAZ. `create_operation_with_jobs` bu sorunu HİÇ
-- yaşamadı (0031 onun DIŞ imzasını hiç değiştirmedi, yeni alanlar zaten var
-- olan `p_services` JSONB'sinin içinden okunuyor) — bu migration yalnızca
-- `create_job`'ı kapsar.
--
-- Hata kodu değişikliği yok.
-- =============================================================================

drop function if exists public.create_job(
  text, text, text, text, text, text, text, date, jsonb, text, text, text, text, text, text, date,
  integer, numeric, text, text, uuid
);

-- Kalan (27 parametreli, 0031) create_job için grant zaten 0031'de verildi —
-- burada tekrarlanmasına gerek yok, drop işlemi onu etkilemez.
