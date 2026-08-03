-- =============================================================================
-- MALSEVK — Faz 1 migration 0020: seed data (service_categories)
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- DUZELTME (SUPABASE-MIGRATION-VALIDATION.md paragraf 20, madde 4 - KRITIK):
-- onceki taslak "8 grup, 37 kategori" iddia ediyordu ama app/_lib/
-- service-catalog.ts'in GUNCEL halinden dogrudan kopyalanmamisti -- kodun
-- REMOVED_CATEGORY_IDS olarak isaretledigi 10 eski kategoriyi (liman-
-- personeli, depo-personeli, depo-duzenleme, paletleme, etiketleme,
-- sayim-hizmeti, paletli-urun-depolama, agir-yuk-depolama, vardiyali-
-- calisma, proje-yuku) aktif satir olarak tasiyordu VE Liman Hizmetleri'nin
-- BIRLESTIRME-ONCESI 6 ayri kategorisini (lashing, unlashing, konteyner-
-- dolum, konteyner-bosaltim, yukleme-gozetimi, bosaltma-gozetimi) icin
-- guncel birlesik id'leri (lashing-unlashing, konteyner-dolum-bosaltim,
-- gozetim-hizmetleri) HIC icermiyordu. jobs.category_id/provider_services.
-- service_category_id'nin service_categories(id)'e FK'si oldugu icin, GUNCEL
-- kod bu birlesik id'lerden birini yazmaya calistiginda FK ihlali olusurdu.
--
-- Bu dosya artik app/_lib/service-catalog.ts#SERVICE_CATEGORY_GROUPS'un
-- (RAW_SERVICE_CATEGORY_GROUPS, satir satir okunmus) TAM, birebir kopyasidir
-- -- 7 grup, 27 kategori. sort_order, SERVICE_CATEGORY_ORDER_INDEX'in ayni
-- mantigini izler: SERVICE_CATEGORY_GROUPS'un (zaten `order` alanina gore
-- sirali) flatMap'i, 0'dan baslayan kesintisiz bir sayac.
--
-- visibility_scope yalniz iki id icin 'isolated': 'nakliye'
-- (service-catalog.ts#NAKLIYE_SERVICE_CATEGORY_ID) ve 'gumruk-musavirligi'
-- (service-catalog.ts#GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID) --
-- job-visibility.ts#ISOLATED_SERVICE_CATEGORY_IDS ile birebir.
-- =============================================================================

insert into public.service_categories (id, slug, name, group_slug, group_name, visibility_scope, sort_order) values
  -- Nakliye Hizmetleri (order 1) — İZOLE
  ('nakliye', 'nakliye', 'Nakliye', 'nakliye-hizmetleri', 'Nakliye Hizmetleri', 'isolated', 0),

  -- Gümrük Hizmetleri (order 2) — İZOLE
  ('gumruk-musavirligi', 'gumruk-musavirligi', 'Gümrük Müşavirliği', 'gumruk-hizmetleri', 'Gümrük Hizmetleri', 'isolated', 1),

  -- Liman Hizmetleri (order 3) — 3 kategori (birleştirme SONRASI)
  ('lashing-unlashing', 'lashing-unlashing', 'Lashing / Unlashing', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 2),
  ('gozetim-hizmetleri', 'gozetim-hizmetleri', 'Gözetim Hizmetleri', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 3),
  ('konteyner-dolum-bosaltim', 'konteyner-dolum-bosaltim', 'Konteyner Dolum / Boşaltım', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 4),

  -- İş Makinesi Hizmetleri (order 4)
  ('forklift', 'forklift', 'Forklift', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 5),
  ('reach-stacker', 'reach-stacker', 'Reach Stacker', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 6),
  ('vinc', 'vinc', 'Vinç', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 7),
  ('manlift', 'manlift', 'Manlift', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 8),

  -- Operatör Hizmetleri (order 5)
  ('forklift-operatoru', 'forklift-operatoru', 'Forklift Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 9),
  ('reach-stacker-operatoru', 'reach-stacker-operatoru', 'Reach Stacker Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 10),
  ('vinc-operatoru', 'vinc-operatoru', 'Vinç Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 11),
  ('manlift-operatoru', 'manlift-operatoru', 'Manlift Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 12),

  -- Depo Hizmetleri (order 6) — 12 kategori (REMOVED_CATEGORY_IDS'in 7'si
  -- burada kaldirildi: depo-personeli, depo-duzenleme, paletleme,
  -- etiketleme, sayim-hizmeti, paletli-urun-depolama, agir-yuk-depolama)
  ('ellecleme', 'ellecleme', 'Elleçleme', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 13),
  ('genel-depolama', 'genel-depolama', 'Genel Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 14),
  ('acik-saha-depolama', 'acik-saha-depolama', 'Açık Saha Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 15),
  ('kapali-depolama', 'kapali-depolama', 'Kapalı Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 16),
  ('antrepo-gumruklu', 'antrepo-gumruklu', 'Antrepo (Gümrüklü)', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 17),
  ('gecici-depolama', 'gecici-depolama', 'Geçici Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 18),
  ('konteyner-depolama', 'konteyner-depolama', 'Konteyner Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 19),
  ('dokme-yuk-depolama', 'dokme-yuk-depolama', 'Dökme Yük Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 20),
  ('proje-yuku-depolama', 'proje-yuku-depolama', 'Proje Yükü Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 21),
  ('soguk-hava-depolama', 'soguk-hava-depolama', 'Soğuk Hava Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 22),
  ('kimyasal-depolama', 'kimyasal-depolama', 'Kimyasal Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 23),
  ('tehlikeli-madde-depolama', 'tehlikeli-madde-depolama', 'Tehlikeli Madde Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 24),

  -- Diğer Hizmetler (order 7) — 2 kategori (vardiyali-calisma ve
  -- proje-yuku-hizmetleri grubunun tamami — proje-yuku
  -- REMOVED_CATEGORY_IDS'te — kaldırıldı; "proje-yuku-hizmetleri" diye
  -- ayrı bir grup güncel katalogda hiç yok)
  ('personel-temini', 'personel-temini', 'Personel Temini', 'diger-hizmetler', 'Diğer Hizmetler', 'standard', 25),
  ('acil-operasyon-destegi', 'acil-operasyon-destegi', 'Acil Operasyon Desteği', 'diger-hizmetler', 'Diğer Hizmetler', 'standard', 26)
on conflict (id) do nothing;
