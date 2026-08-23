-- =============================================================================
-- MALSEVK — Faz 1 migration 0024: provider_documents belge yaşam döngüsü ve
--           mükerrer kayıt koruması
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- KÖKEN: Gerçek dev Supabase projesine karşı canlı doğrulanan bir görev
-- ("belge yaşam döngüsü ve mükerrer kayıt koruması") — 0001-0023'ün HİÇBİR
-- dosyası değiştirilmedi. Bu migration, `create_provider_document` (0023) ve
-- `review_provider_document`in (0016) davranışını `CREATE OR REPLACE
-- FUNCTION` ile (İMZA DEĞİŞMEDEN) evrimleştirir — tam olarak 0022'nin 0015'te
-- tanımlanan offer RPC'lerini aynı yöntemle düzelttiği desen.
--
-- CANLI DOĞRULANAN BULGULAR (görevin "önce raporla" adımı, migration
-- uygulanmadan ÖNCE gerçek projede iki eşzamanlı `create_provider_document`
-- çağrısıyla doğrudan test edildi):
--   1. Aynı provider+document_type için birden fazla `pending` satır
--      OLUŞABİLİYORDU — hiçbir UNIQUE kısıt/RPC kontrolü yoktu (iki eşzamanlı
--      Promise.all çağrısı, ikisi de `ok:true` döndü, iki ayrı `id`).
--   2. `create_provider_document` sibling'lerin durumuna hiç bakmıyor — bu
--      yüzden `approved` bir belge varken yeni belge yüklemek zaten
--      SERBESTTİ (bu, KASITLI olarak SERBEST KALIR — yıllık belge yenileme
--      senaryosu; görev yalnızca "aynı anda birden fazla PENDING" durumunu
--      yasaklıyor, "approved varken pending" durumunu değil).
--   3. `review_provider_document` yalnızca `where id = p_document_id` ile
--      hedef satırı günceller — aynı provider+document_type için ÖNCEDEN
--      `approved` başka bir satır varsa o satır SONSUZA DEK `approved`
--      kalıyordu (iki "geçerli" onaylı belge aynı anda var olabiliyordu).
--   4. Aynı yükleme isteği iki kez gönderilirse (çift tık/ağ yeniden
--      denemesi) hem DB'de hem Storage'da mükerrer kayıt oluşuyordu — (1)
--      ile aynı kök neden, `create_provider_document`'te hiçbir
--      idempotency/dedup kontrolü yoktu.
--   5. Reddedilen belgelerin tarihçesi ZATEN korunuyordu — hiçbir kod yolu
--      `provider_documents` satırı SİLMİYOR (yalnızca `current_review_status`
--      güncelleniyor); bu davranış bu migrationdan ETKİLENMEDİ/değişmedi.
--
-- ÇÖZÜM:
--   A) `current_review_status` CHECK kısıtına yeni bir tarihçe değeri
--      eklenir: 'superseded' — bir belge SİLİNMEZ, yalnızca yerini alan yeni
--      bir belge onaylandığında bu duruma geçer (bkz. Bölüm 2).
--   B) KISMİ (partial) UNIQUE INDEX — `(provider_id, document_type) WHERE
--      current_review_status = 'pending' AND deleted_at IS NULL` — bu, (1)
--      ve (4)'ü VERİTABANI SEVİYESİNDE, uygulama kodundaki bir "önce
--      kontrol et sonra ekle" (TOCTOU) yarışına açık olmayan, Postgres'in
--      kendi satır-seviyesi kilitlemesiyle atomik olarak çözer.
--   C) `create_provider_document`, bu yeni indeksin `unique_violation`
--      (23505) hatasını yakalayıp temiz bir MLK81 istisnasına çevirir —
--      istemci tarafındaki mevcut "Storage'a yükle, RPC başarısızsa sil"
--      yetim-temizleme akışı (uploadAndRegisterProviderDocument,
--      app/_lib/supabase-provider-documents.ts) HİÇ DEĞİŞMEDEN bu yeni hata
--      yolunu da kapsar (herhangi bir RPC hatasında zaten Storage'daki
--      dosyayı siliyordu) — bu migration İSTEMCİ KODUNU DEĞİŞTİRMEYİ
--      GEREKTİRMEZ.
--   D) `review_provider_document`, `p_status = 'approved'` olduğunda AYNI
--      provider+document_type için başka bir `approved` satır varsa (yeni
--      onaylanan satırın kendisi HARİÇ) onu `superseded`e çevirir — silme
--      YOK, `provider_document_reviews`e ayrı bir log satırı da YAZILMAZ
--      (bu, bir admin'in O satır üzerinde ayrı bir kararı değil, YENİ
--      belgenin onayının bir yan etkisidir — iz zaten yeni belgenin kendi
--      review log satırında ve superseded satırın `updated_at`
--      zaman damgasında mevcuttur).
--
-- Hata kodu aralığı: MLK81 (MLK10-99 havuzunda BOŞ olduğu doğrudan grep ile
-- doğrulandı — bkz. 0023'ün kendi notu, aynı yöntem tekrarlandı).
-- =============================================================================


-- =============================================================================
-- BÖLÜM 1 — current_review_status: 'superseded' tarihçe değeri eklenir
-- =============================================================================
alter table public.provider_documents
  drop constraint provider_documents_current_review_status_check;

alter table public.provider_documents
  add constraint provider_documents_current_review_status_check
  check (current_review_status in ('pending', 'approved', 'rejected', 'revision_requested', 'superseded'));

comment on column public.provider_documents.current_review_status is
  '0024: ''superseded'' eklendi — bir belge hiçbir zaman SİLİNMEZ; yerini alan YENİ bir belge onaylandığında eski ''approved'' satır buna geçer (bkz. review_provider_document). Client bu sütuna hiçbir şekilde doğrudan yazamaz (yalnızca SELECT GRANT, bkz. 0007) — tek yazma yolu review_provider_document (admin, approved geçişinin yan etkisi) veya provider''ın kendi create_provider_document''ıdır (yalnızca ''pending'' varsayılanı).';


-- =============================================================================
-- BÖLÜM 2 — Aynı provider+document_type için en fazla bir PENDING belge
-- =============================================================================
-- KISMİ indeks: yalnızca pending+silinmemiş satırları kapsar — approved/
-- rejected/revision_requested/superseded satırlar (tarihçe) bu kısıtın HİÇ
-- dışında kalır, istediği kadar birikebilir. Bu, uygulama kodunun "önce SELECT
-- ile var mı diye bak, yoksa INSERT et" deseninden YAPISAL OLARAK daha
-- güvenlidir — iki eşzamanlı transaction aynı anda SELECT'i "boş" görüp
-- ikisi de INSERT edebilir (TOCTOU); bir UNIQUE INDEX bunun yerine Postgres'in
-- kendi satır kilitleme/çakışma tespitine dayanır, ikinci INSERT WHENEVER
-- COMMIT edilirse edilsin her zaman 23505 ile reddedilir.
create unique index if not exists provider_documents_one_pending_per_provider_type
  on public.provider_documents (provider_id, document_type)
  where current_review_status = 'pending' and deleted_at is null;

comment on index public.provider_documents_one_pending_per_provider_type is
  '0024: bir provider + document_type için aynı anda en fazla bir pending belge — çift tık/ağ yeniden denemesi/gerçek eşzamanlı istek fark etmeksizin veritabanı seviyesinde garanti edilir. create_provider_document (aşağı bkz.) bu indeksin unique_violation''ını yakalayıp MLK81''e çevirir.';


-- =============================================================================
-- BÖLÜM 3 — create_provider_document: mükerrer pending denemesi temiz bir
-- hataya çevrilir (0023'ün orijinaline TEK ekleme: iç içe begin/exception)
-- =============================================================================
create or replace function public.create_provider_document(
  p_document_type text,
  p_storage_path text,
  p_original_file_name text,
  p_mime_type text,
  p_extension text,
  p_size_bytes bigint
)
returns public.provider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.provider_documents;
begin
  if auth.uid() is null then
    raise exception 'MLK93: sign-in required to upload a document' using errcode = 'MLK93';
  end if;
  if p_document_type not in ('genel', 'gumruk-musaviri-izin-belgesi') then
    raise exception 'MLK94: invalid document_type' using errcode = 'MLK94';
  end if;
  if p_storage_path is null or p_storage_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'MLK80: storage_path must be within your own folder' using errcode = 'MLK80';
  end if;

  begin
    insert into public.provider_documents
      (provider_id, document_type, storage_path, original_file_name, mime_type, extension, size_bytes)
    values
      (auth.uid(), p_document_type, p_storage_path, p_original_file_name, p_mime_type, p_extension, p_size_bytes)
    returning * into v_row;
  exception when unique_violation then
    -- provider_documents_one_pending_per_provider_type (Bölüm 2) ihlali —
    -- istemci (uploadAndRegisterProviderDocument) bu hatayı ALDIĞINDA zaten
    -- az önce Storage'a yazdığı dosyayı siler (mevcut, DEĞİŞTİRİLMEMİŞ yetim-
    -- temizleme yolu) — burada Storage'a dokunmuyoruz, yalnızca DB yazımını
    -- reddediyoruz.
    raise exception 'MLK81: a pending document of this type already exists' using errcode = 'MLK81';
  end;

  return v_row;
end;
$$;

comment on function public.create_provider_document(text, text, text, text, text, bigint) is
  '0023''ün TEK yazma yolu tanımı geçerliliğini korur — 0024 yalnızca provider_documents_one_pending_per_provider_type''ın unique_violation''ını MLK81''e çevirir, başka HİÇBİR davranış değişmedi.';

revoke all on function public.create_provider_document(text, text, text, text, text, bigint) from public, anon;
grant execute on function public.create_provider_document(text, text, text, text, text, bigint) to authenticated;


-- =============================================================================
-- BÖLÜM 4 — review_provider_document: bir belge onaylandığında AYNI türdeki
-- ÖNCEKİ onaylı belge 'superseded'e geçer (0016'nın orijinaline TEK ekleme)
-- =============================================================================
create or replace function public.review_provider_document(p_document_id uuid, p_status text, p_note text default null)
returns public.provider_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
begin
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

  -- YENİ (0024): bu belge onaylandıysa, AYNI provider+document_type için
  -- ÖNCEDEN onaylanmış (ve hâlâ 'approved' durumda) başka bir satır varsa
  -- (yenilenen/yeniden yüklenen bir belge senaryosu) o satır SİLİNMEZ,
  -- 'superseded'e geçer — `id <> p_document_id` az önce güncellediğimiz
  -- satırın kendisini asla etkilemez. Reddedilen/incelenen/zaten-superseded
  -- satırlar bu UPDATE'in WHERE'ine hiç girmediği için dokunulmaz kalır
  -- (görev gereksinimi: reddedilen belgelerin tarihçesi korunur).
  if p_status = 'approved' then
    update public.provider_documents
      set current_review_status = 'superseded'
      where provider_id = v_document.provider_id
        and document_type = v_document.document_type
        and id <> p_document_id
        and current_review_status = 'approved';
  end if;

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

  return v_document;
end;
$$;

comment on function public.review_provider_document(uuid, text, text) is
  '0016''nın orijinal davranışı (is_admin() zorunlu, reddetme/yeniden-belge-isteme için not zorunlu, append-only review log, bildirim, audit log) TAMAMEN korunur — 0024 yalnızca p_status=''approved'' dalına, AYNI provider+document_type''ın önceki approved satırını ''superseded''e çeviren bir adım ekler. Hiçbir satır silinmez.';

revoke all on function public.review_provider_document(uuid, text, text) from public, anon;
grant execute on function public.review_provider_document(uuid, text, text) to authenticated;
