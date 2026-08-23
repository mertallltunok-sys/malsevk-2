-- =============================================================================
-- MALSEVK — migration 0044: belge yükleme / hizmet yetkilendirme sadeleştirmesi
-- =============================================================================
-- AMAÇ: bir Hizmet Veren'in /panel/belge-yukleme'de kaç AYRI belge yüklemesi
-- gerektiğini azaltmak — İLAN TAKSONOMİSİNE (service_categories, jobs.
-- category_id) HİÇ DOKUNULMADI, 20 alt kategorinin hiçbiri birleştirilmedi/
-- kaldırılmadı; Hizmet Alan hâlâ Forklift/Vinç/Kapalı Depolama/... için ayrı
-- ayrı ilan açabiliyor. Yalnızca PROVIDER YETKİLENDİRME akışı sadeleşiyor:
-- iki büyük alt-kategori kümesi ("İş Makinesi Hizmetleri" + "Operatör
-- Hizmetleri" birlikte; "Depo Hizmetleri" tek başına) artık TEK bir belge
-- ile yetkilendirilebiliyor.
--
-- İKİNCİ BİR YETKİLENDİRME SİSTEMİ İCAT EDİLMEDİ: provider_service_
-- authorizations (0038) hâlâ TEK kaynak, hâlâ (provider_id, service_
-- category_id) bazlı satırlar. Değişen tek şey, review_provider_document'in
-- (0041) otomatik yetkilendirme zincirinin artık İKİ YENİ document_type
-- değeri için TEK kategori yerine BİRDEN FAZLA kategoriyi aynı anda
-- yetkilendirmesi — aynen "gumruk-musaviri-izin-belgesi"nin zaten yaptığı
-- "sabit document_type -> sabit kategori" deseninin çoğul hâli, mevcut
-- authorize_provider_service RPC'si DEĞİŞMEDEN, döngü içinde tekrar
-- çağrılarak.
--
-- KATEGORİ LİSTELERİ — TEK doğruluk kaynağı app/_lib/service-catalog.ts#
-- PROVIDER_AUTHORIZATION_GROUPS'tur; PL/pgSQL TypeScript'i içe aktaramadığı
-- için aşağıdaki iki dizi ORADAN BİREBİR KOPYALANMIŞTIR (aynı "gumruk-
-- musavirligi" sabitinin SQL'de de ayrıca yazılması gereken durumuyla AYNI,
-- var olan bir sınırlama, yeni bir tasarım hatası değil). Bu iki taraf
-- gelecekte AYRI AYRI değişirse, biri diğerini otomatik yansıtmaz — kod
-- incelemesinde ikisinin birlikte güncellenmesi gerekir:
--   operator-is-makinesi-belgesi -> is-makinesi-hizmetleri (forklift,
--     reach-stacker, vinc, manlift) + operator-hizmetleri (forklift-
--     operatoru, reach-stacker-operatoru, vinc-operatoru, manlift-operatoru)
--   depo-hizmetleri-belgesi -> depo-hizmetleri grubunun TAMAMI (ellecleme,
--     genel-depolama, acik-saha-depolama, kapali-depolama, antrepo-gumruklu,
--     gecici-depolama, konteyner-depolama, dokme-yuk-depolama, proje-yuku-
--     depolama, soguk-hava-depolama, kimyasal-depolama, tehlikeli-madde-
--     depolama)
--
-- GERİYE DÖNÜK UYUMLULUK (görev bölüm 10): bu migration hiçbir mevcut satırı
-- DEĞİŞTİRMEZ/SİLMEZ — yalnızca yeni document_type değerlerini CHECK'e ekler
-- ve iki fonksiyonu (aynı imzayla create or replace, GRANT'ler otomatik
-- korunur) genişletir. Development'ta halihazırda 6 eski "genel" + NULL
-- service_category_id belgesi var (2026-08-03'ten önceki kayıt akışından) —
-- bunlar review_provider_document'in ZATEN VAR OLAN son `else` dalına
-- (provider'ın o an seçili TÜM gümrük-dışı kategorilerini yetkilendiren
-- eski "tek genel belge" davranışı) düşmeye devam eder, YENİ eklenen iki
-- `elsif` dalı yalnızca YENİ document_type değerleriyle eşleşir, bu 6 eski
-- kaydı hiç etkilemez. OTOMATİK GENİŞ YETKİ VERME KARARI (görev bölüm 10'un
-- kendi sorusu): önceden TEK bir alt kategori için onaylanmış bir provider
-- (ör. yalnızca "kapali-depolama"), bu migration'la KENDİLİĞİNDEN tüm Depo
-- Hizmetleri grubuna genişletilmez — bu, kanıtlanmamış bir yetkinlik
-- iddiasını (ör. "tehlikeli-madde-depolama" için sigorta/uygunluk kanıtı
-- olmayan bir firmaya o kategoriyi de açmak) otomatik olarak üstlenmek
-- olurdu; iş kuralı gereği GÜVENLİ DEĞİL. Mevcut dar yetkiler AYNEN kalır;
-- geniş yetki isteyen bir provider yeni grup belgesini YÜKLEMELİDİR (görev
-- bölüm 8'in "provider zaten geçerli bir belgeye sahipse tekrar istenmemeli"
-- ilkesi yalnızca AYNI document_type için geçerlidir, farklı kapsamlı bir
-- yetkiye kendiliğinden terfi ETMEZ).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) document_type CHECK'i iki yeni değerle genişlet
-- -----------------------------------------------------------------------------
alter table public.provider_documents drop constraint provider_documents_document_type_check;
alter table public.provider_documents add constraint provider_documents_document_type_check
  check (document_type = any (array['genel', 'gumruk-musaviri-izin-belgesi', 'depo-hizmetleri-belgesi', 'operator-is-makinesi-belgesi']));

-- -----------------------------------------------------------------------------
-- 2) create_provider_document — yalnızca MLK94 doğrulama listesi genişledi,
--    geri kalan gövde (0038'in kendi yorumunun dediği gibi) DEĞİŞMEDİ.
-- -----------------------------------------------------------------------------
create or replace function public.create_provider_document("p_document_type" text, "p_storage_path" text, "p_original_file_name" text, "p_mime_type" text, "p_extension" text, "p_size_bytes" bigint, "p_service_category_id" text default null::text) returns public.provider_documents
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_row public.provider_documents;
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
  -- Görev bölüm 6/41: bir belge yalnızca ÇAĞIRANIN KENDİ seçtiği bir
  -- hizmetle ilişkilendirilebilir — başka bir provider'ın hizmetine ya da
  -- kataloğun kendisinde olmayan bir kategoriye sahte bağlama girişimini
  -- engeller. Grup belgeleri (0044) p_service_category_id'yi hiç
  -- GÖNDERMEDİĞİ (NULL) için bu kontrol onları hiç etkilemez.
  if p_service_category_id is not null and not exists (
    select 1 from public.provider_services where provider_id = auth.uid() and service_category_id = p_service_category_id
  ) then
    raise exception 'ML124: service_category_id must be one of your own selected services' using errcode = 'ML124';
  end if;

  insert into public.provider_documents
    (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes, service_category_id)
  values
    (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes, p_service_category_id)
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_provider_document(text, text, text, text, text, bigint, text) is
  '0044: p_document_type doğrulaması iki grup belgesi değerini de kabul eder (depo-hizmetleri-belgesi/operator-is-makinesi-belgesi) — bu ikisi HER ZAMAN p_service_category_id=NULL ile çağrılır (ML124 kontrolü bu yüzden onları hiç etkilemez). 0038/0023''ün geri kalan tüm davranışı DEĞİŞMEDİ.';

-- -----------------------------------------------------------------------------
-- 3) review_provider_document — otomatik yetkilendirme zincirine (0041) iki
--    yeni dal eklendi, TEK bir satır bile yeniden yazılmadı (yalnızca ekleme).
-- -----------------------------------------------------------------------------
create or replace function public.review_provider_document("p_document_id" uuid, "p_status" text, "p_note" text default null::text) returns public.provider_documents
    language plpgsql security definer
    set search_path to 'public'
    as $$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
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

  -- 0041: belge onaylandığında, desteklediği hizmet(ler) için OTOMATİK
  -- olarak authorize_provider_service (0038) çağrılır — bu çağrı AYNI
  -- (zaten is_admin() doğrulanmış) admin oturumu bağlamında çalıştığı için
  -- authorize_provider_service'in kendi is_admin() kontrolü de doğal olarak
  -- geçer, ikinci bir yetki kontrolü İCAT EDİLMEDİ. BEST-EFFORT: bu blok
  -- başarısız olursa (ör. beklenmeyen veri durumu) yalnızca bir WARNING
  -- loglanır, asıl belge onayı (yukarıdaki tüm yazmalar) ASLA geri alınmaz.
  --
  -- 0044: iki YENİ dal (operator-is-makinesi-belgesi / depo-hizmetleri-
  -- belgesi) eklendi — TEK belge, BİRDEN FAZLA kategori. Kategori listeleri
  -- bu dosyanın kendi başlığında da açıklandığı gibi app/_lib/service-
  -- catalog.ts#PROVIDER_AUTHORIZATION_GROUPS ile SENKRON tutulmalıdır.
  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
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
            'Depo Hizmetleri belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).'
          );
        end loop;
      else
        -- Yalnızca service_category_id'siz ESKİ genel belgeler (yeni
        -- /panel/belge-yukleme akışı artık her zaman gönderir) — provider'ın
        -- o anda seçili gümrük-dışı TÜM kategorilerini yetkilendir (eski
        -- "tek genel belge = tüm seçili hizmetler" örtük varsayımı).
        for v_target_category_id in
          select service_category_id from public.provider_services
          where provider_id = v_document.provider_id and service_category_id <> 'gumruk-musavirligi'
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).'
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$$;

comment on function public.review_provider_document(uuid, text, text) is
  '0044: operator-is-makinesi-belgesi/depo-hizmetleri-belgesi onayı artık TEK belgeyle BİRDEN FAZLA kategoriyi yetkilendiriyor (authorize_provider_service döngü içinde tekrar çağrılıyor, ikinci bir yetki sistemi yok). Kategori listeleri app/_lib/service-catalog.ts#PROVIDER_AUTHORIZATION_GROUPS ile senkron tutulmalı. 0041''in davranışının geri kalanı DEĞİŞMEDİ.';

-- -----------------------------------------------------------------------------
-- 4) Duplicate koruması (görev bölüm 13) — grup belgeleri için AYRI bir
--    partial unique index: mevcut provider_documents_one_pending_per_
--    provider_type (0040) NULL service_category_id'yi zaten "ayrı" saydığı
--    için (Postgres varsayılanı: NULL'lar birbirinden farklıdır) iki grup
--    belgesini engellemez — bu yeni index YALNIZCA iki yeni document_type
--    değeri için, service_category_id IS NULL olduğunda devreye girer;
--    6 eski "genel"+NULL-kategori belgesine (2026-08-03 öncesi kayıtlar)
--    HİÇ dokunmaz (onlar bu index'in document_type filtresine hiç girmez).
-- -----------------------------------------------------------------------------
create unique index provider_documents_one_pending_per_provider_group
  on public.provider_documents (provider_id, document_type)
  where (
    service_category_id is null
    and document_type in ('depo-hizmetleri-belgesi', 'operator-is-makinesi-belgesi')
    and current_review_status = 'pending'
    and deleted_at is null
  );

comment on index public.provider_documents_one_pending_per_provider_group is
  '0044: aynı provider aynı GRUP belgesini (depo-hizmetleri-belgesi/operator-is-makinesi-belgesi) ikinci kez pending olarak yükleyemez. provider_documents_one_pending_per_provider_type (0040) ile TAMAMLAYICI, çakışmaz (o, service_category_id dolu satırlar için; bu, grup belgelerinin NULL kategori satırları için).';
