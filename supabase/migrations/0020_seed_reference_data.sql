-- =============================================================================
-- MALSEVK — Faz 1 migration 0020: seed data (service_categories)
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- app/_lib/service-catalog.ts#SERVICE_CATEGORY_GROUPS'un TAM, doğrulanmış
-- kopyası — 8 grup, 37 kategori (önceki tasarımın "ör. 5-7 kategori"
-- TAHMİNİNİN aksine, gerçek dosyadan sayılmıştır). visibility_scope yalnız
-- iki id için 'isolated': 'nakliye' (job-visibility.ts#
-- NAKLIYE_SERVICE_CATEGORY_ID) ve 'gumruk-musavirligi' (job-visibility.ts#
-- GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID) — job-visibility.ts#
-- ISOLATED_SERVICE_CATEGORY_IDS ile birebir.
--
-- sort_order, SERVICE_CATEGORY_GROUPS'taki (grup sırası, sonra grup içi
-- sıra) sabit konumu yansıtır (service-catalog.ts#CATEGORY_SORT_ORDER'ın
-- kaynağı ile aynı mantık) — 0'dan başlayan, kesintisiz bir sayaçtır.
-- =============================================================================

insert into public.service_categories (id, slug, name, group_slug, group_name, visibility_scope, sort_order) values
  -- Liman Hizmetleri
  ('lashing', 'lashing', 'Lashing', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 0),
  ('unlashing', 'unlashing', 'Unlashing', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 1),
  ('konteyner-dolum', 'konteyner-dolum', 'Konteyner Dolum', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 2),
  ('konteyner-bosaltim', 'konteyner-bosaltim', 'Konteyner Boşaltım', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 3),
  ('yukleme-gozetimi', 'yukleme-gozetimi', 'Yükleme Gözetimi', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 4),
  ('bosaltma-gozetimi', 'bosaltma-gozetimi', 'Boşaltma Gözetimi', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 5),
  ('liman-personeli', 'liman-personeli', 'Liman Personeli', 'liman-hizmetleri', 'Liman Hizmetleri', 'standard', 6),

  -- Depo Hizmetleri
  ('depo-personeli', 'depo-personeli', 'Depo Personeli', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 7),
  ('depo-duzenleme', 'depo-duzenleme', 'Depo Düzenleme', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 8),
  ('ellecleme', 'ellecleme', 'Elleçleme', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 9),
  ('paletleme', 'paletleme', 'Paletleme', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 10),
  ('etiketleme', 'etiketleme', 'Etiketleme', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 11),
  ('sayim-hizmeti', 'sayim-hizmeti', 'Sayım Hizmeti', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 12),
  ('genel-depolama', 'genel-depolama', 'Genel Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 13),
  ('acik-saha-depolama', 'acik-saha-depolama', 'Açık Saha Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 14),
  ('kapali-depolama', 'kapali-depolama', 'Kapalı Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 15),
  ('antrepo-gumruklu', 'antrepo-gumruklu', 'Antrepo (Gümrüklü)', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 16),
  ('gecici-depolama', 'gecici-depolama', 'Geçici Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 17),
  ('konteyner-depolama', 'konteyner-depolama', 'Konteyner Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 18),
  ('paletli-urun-depolama', 'paletli-urun-depolama', 'Paletli Ürün Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 19),
  ('dokme-yuk-depolama', 'dokme-yuk-depolama', 'Dökme Yük Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 20),
  ('agir-yuk-depolama', 'agir-yuk-depolama', 'Ağır Yük Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 21),
  ('proje-yuku-depolama', 'proje-yuku-depolama', 'Proje Yükü Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 22),
  ('soguk-hava-depolama', 'soguk-hava-depolama', 'Soğuk Hava Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 23),
  ('kimyasal-depolama', 'kimyasal-depolama', 'Kimyasal Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 24),
  ('tehlikeli-madde-depolama', 'tehlikeli-madde-depolama', 'Tehlikeli Madde Depolama', 'depo-hizmetleri', 'Depo Hizmetleri', 'standard', 25),

  -- İş Makinesi Hizmetleri
  ('forklift', 'forklift', 'Forklift', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 26),
  ('reach-stacker', 'reach-stacker', 'Reach Stacker', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 27),
  ('vinc', 'vinc', 'Vinç', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 28),
  ('manlift', 'manlift', 'Manlift', 'is-makinesi-hizmetleri', 'İş Makinesi Hizmetleri', 'standard', 29),

  -- Operatör Hizmetleri
  ('forklift-operatoru', 'forklift-operatoru', 'Forklift Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 30),
  ('reach-stacker-operatoru', 'reach-stacker-operatoru', 'Reach Stacker Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 31),
  ('vinc-operatoru', 'vinc-operatoru', 'Vinç Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 32),
  ('manlift-operatoru', 'manlift-operatoru', 'Manlift Operatörü', 'operator-hizmetleri', 'Operatör Hizmetleri', 'standard', 33),

  -- Diğer Hizmetler
  ('personel-temini', 'personel-temini', 'Personel Temini', 'diger-hizmetler', 'Diğer Hizmetler', 'standard', 34),
  ('vardiyali-calisma', 'vardiyali-calisma', 'Vardiyalı Çalışma', 'diger-hizmetler', 'Diğer Hizmetler', 'standard', 35),
  ('acil-operasyon-destegi', 'acil-operasyon-destegi', 'Acil Operasyon Desteği', 'diger-hizmetler', 'Diğer Hizmetler', 'standard', 36),

  -- Proje Yükü Hizmetleri
  ('proje-yuku', 'proje-yuku', 'Proje Yük', 'proje-yuku-hizmetleri', 'Proje Yükü Hizmetleri', 'standard', 37),

  -- Nakliye Hizmetleri — İZOLE (job-visibility.ts#ISOLATED_SERVICE_CATEGORY_IDS)
  ('nakliye', 'nakliye', 'Nakliye', 'nakliye-hizmetleri', 'Nakliye Hizmetleri', 'isolated', 38),

  -- Gümrük Hizmetleri — İZOLE (job-visibility.ts#ISOLATED_SERVICE_CATEGORY_IDS)
  ('gumruk-musavirligi', 'gumruk-musavirligi', 'Gümrük Müşavirliği', 'gumruk-hizmetleri', 'Gümrük Hizmetleri', 'isolated', 39)
on conflict (id) do nothing;
