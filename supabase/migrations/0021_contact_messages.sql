-- =============================================================================
-- MALSEVK — Faz 1 migration 0021: contact_messages ("Bize Ulaşın")
-- =============================================================================
-- STATUS: FAZ 1 — Çekirdek Pazaryeri.
--
-- YENİ TABLO (SUPABASE-MIGRATION-VALIDATION.md §14/§20, madde 5 — YÜKSEK):
-- Faz 1 setinin ilk 20 dosyası "Bize Ulaşın" özelliğinin (app/_lib/
-- contact-messages.ts) hiçbir veritabanı karşılığını içermiyordu. Bu dosya
-- onu ekler — 0001-0020 sırasını bozmadan sona eklenmiştir (yalnızca
-- public.profiles ve public.set_updated_at()'e bağımlı, ikisi de zaten
-- mevcut, dosya numaralandırması/bağımlılık sırası bozulmadı).
--
-- Kaynak: app/_lib/contact-messages.ts#StoredContactMessage/
-- submitContactMessage/reviewContactMessage (satır satır doğrulanmıştır).
-- Hata kodu aralığı: MLK93-99 (bu dosya; MLK93-94 aslında 0007'de de
-- kullanılıyor — provider_document_consents/legal_consents RPC'leri için —
-- her ikisi de bu göçün AYNI turunda eklendi, ayrı bir çakışma değil, aynı
-- "eksik yazma yolu" düzeltme setinin parçası).
-- =============================================================================

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),

  -- Kullanıcıya gösterilen, insan-okur kayıt numarası ("BU-<yıl>-<sıra>") —
  -- GERÇEK kimlik id'dir (bkz. contact-messages.ts#generateReferenceNumber'ın
  -- kendi yorumu: "tekilliği garanti eden asıl kimlik id'dir"), bu yüzden
  -- burada UNIQUE kısıtı YOK (kasıtlı, kaynakla aynı).
  reference_number text not null,

  -- Gönderim anında oturum açıksa o kullanıcının id'si; misafirse NULL.
  -- Misafir gönderimi desteklenir (submit_contact_message hem anon hem
  -- authenticated'e açık — bkz. aşağıdaki GRANT).
  user_id uuid references public.profiles (id),
  user_role text check (user_role is null or user_role in ('hizmet-alan', 'hizmet-veren', 'admin')),

  name text not null check (char_length(trim(name)) > 0),
  -- '' = girilmedi (bkz. contact-messages.ts — en az biri zorunlu, aşağıdaki
  -- constraint'e bkz.).
  email text not null default '',
  phone text not null default '' check (phone = '' or phone ~ '^\+905\d{9}$'),
  constraint contact_messages_email_or_phone_required
    check (char_length(email) > 0 or char_length(phone) > 0),

  subject text not null check (subject in (
    'genel-bilgi', 'teknik-destek', 'ilan-ve-teklif-islemleri', 'hesap-islemleri',
    'odeme-ve-abonelik', 'sikayet', 'dilek-ve-oneri', 'is-birligi', 'diger'
  )),
  message text not null check (char_length(message) between 10 and 2000),

  status text not null default 'yeni'
    check (status in ('yeni', 'inceleniyor', 'yanit-bekliyor', 'cozuldu', 'arsivlendi')),
  admin_note text,
  reviewed_by_admin_id uuid references public.profiles (id),

  -- Kaynakta bugün karşılığı olmayan, ileriye dönük iki nullable alan (görev
  -- tanımının açıkça değerlendirilmesini istediği alanlar) — hiçbir RPC
  -- bugün bunları otomatik doldurmuyor (kaynakta karşılığı olmayan bir iş
  -- akışı icat edilmedi), yalnızca şema tamlığı için hazır tutulur.
  read_at timestamptz,
  responded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.contact_messages is
  'Maps app/_lib/contact-messages.ts#StoredContactMessage field-for-field, plus read_at/responded_at (schema-completeness additions with no current source-app write path — see column comments). Misafir (anon) gönderimi desteklenir.';
comment on column public.contact_messages.read_at is
  'Kaynakta (contact-messages.ts) karşılığı yoktur — "yeni" durumundaki mesaj sayısı zaten status üzerinden türetiliyor (bkz. contact-messages-admin-panel.tsx). Bu alan hiçbir Faz 1 RPC''si tarafından otomatik doldurulmaz; ileride gerçek bir "okundu" akışı istenirse review_contact_message() buraya yazacak şekilde genişletilebilir.';
comment on column public.contact_messages.responded_at is
  'Bkz. read_at üzerindeki not — aynı gerekçe, aynı durum.';

drop trigger if exists trg_contact_messages_set_updated_at on public.contact_messages;
create trigger trg_contact_messages_set_updated_at
  before update on public.contact_messages
  for each row execute function public.set_updated_at();

create index if not exists idx_contact_messages_user_id
  on public.contact_messages (user_id)
  where user_id is not null;
create index if not exists idx_contact_messages_status_created_at
  on public.contact_messages (status, created_at desc);

revoke all on public.contact_messages from authenticated, anon;
grant select on public.contact_messages to authenticated;
-- INSERT yalnızca submit_contact_message() ile (anon dahil); UPDATE yalnızca
-- review_contact_message() ile (admin-only) — aşağıda. Ne INSERT ne UPDATE
-- hiçbir role doğrudan grant edilmemiştir.

-- -----------------------------------------------------------------------------
-- submit_contact_message — hem misafir hem oturum açık kullanıcı için
-- -----------------------------------------------------------------------------
create or replace function public.submit_contact_message(
  p_name text, p_email text, p_phone text, p_subject text, p_message text
)
returns public.contact_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := trim(coalesce(p_email, ''));
  v_phone text := trim(coalesce(p_phone, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_reference_number text;
  v_sequence integer;
  v_row public.contact_messages;
begin
  if char_length(v_name) = 0 then
    raise exception 'MLK95: name is required' using errcode = 'MLK95';
  end if;
  if p_subject not in (
    'genel-bilgi', 'teknik-destek', 'ilan-ve-teklif-islemleri', 'hesap-islemleri',
    'odeme-ve-abonelik', 'sikayet', 'dilek-ve-oneri', 'is-birligi', 'diger'
  ) then
    raise exception 'MLK96: invalid subject' using errcode = 'MLK96';
  end if;
  if char_length(v_message) < 10 or char_length(v_message) > 2000 then
    raise exception 'MLK97: message must be between 10 and 2000 characters' using errcode = 'MLK97';
  end if;
  if v_email = '' and v_phone = '' then
    raise exception 'MLK98: at least one of email or phone is required' using errcode = 'MLK98';
  end if;

  select count(*) + 1 into v_sequence from public.contact_messages
    where extract(year from created_at) = extract(year from now());
  v_reference_number := 'BU-' || extract(year from now())::text || '-' || lpad(v_sequence::text, 5, '0');

  insert into public.contact_messages (
    reference_number, user_id, user_role, name, email, phone, subject, message
  ) values (
    v_reference_number, auth.uid(), public.current_user_role(), v_name, v_email, v_phone, p_subject, v_message
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.submit_contact_message(text, text, text, text, text) is
  'user_id/user_role HER ZAMAN sunucu tarafında auth.uid()/current_user_role() ile belirlenir — çağıran bunları parametre olarak asla geçiremez (başka bir kullanıcı adına mesaj oluşturulamaz).';

revoke all on function public.submit_contact_message(text, text, text, text, text) from public;
grant execute on function public.submit_contact_message(text, text, text, text, text) to authenticated, anon;

-- -----------------------------------------------------------------------------
-- review_contact_message — yalnızca admin
-- -----------------------------------------------------------------------------
create or replace function public.review_contact_message(p_id uuid, p_status text, p_admin_note text default null)
returns public.contact_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contact_messages;
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  if p_status not in ('yeni', 'inceleniyor', 'yanit-bekliyor', 'cozuldu', 'arsivlendi') then
    raise exception 'MLK99: invalid status' using errcode = 'MLK99';
  end if;

  select * into v_row from public.contact_messages where id = p_id;
  if v_row is null then
    raise exception 'MLK76: message not found' using errcode = 'MLK76';
  end if;

  -- p_admin_note NULL = mevcut notu koru; boş/dolu metin = notu güncelle
  -- (kaynağın `adminNote !== undefined ? ... : target.adminNote` deseninin
  -- en yakın SQL karşılığı — bkz. contact-messages.ts#reviewContactMessage).
  update public.contact_messages set
    status = p_status,
    admin_note = case when p_admin_note is null then admin_note else nullif(trim(p_admin_note), '') end,
    reviewed_by_admin_id = auth.uid()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.review_contact_message(uuid, text, text) from public, anon;
grant execute on function public.review_contact_message(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_select_own_or_admin on public.contact_messages;
create policy contact_messages_select_own_or_admin on public.contact_messages
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

comment on policy contact_messages_select_own_or_admin on public.contact_messages is
  'Misafir (anon) gönderimlerin user_id''si NULL olduğu için hiçbir SELECT politikası anon''a açılmamıştır — bir misafir kendi gönderdiği mesajı bu şema üzerinden geri okuyamaz (kaynak uygulamada da böyle bir ekran yok); yalnızca oturum açmış kullanıcılar kendi (user_id = auth.uid()) mesajlarını, adminler tümünü görebilir.';
-- INSERT/UPDATE/DELETE için hiçbir policy YOK — tüm yazımlar yukarıdaki iki
-- RPC üzerinden (submit_contact_message / review_contact_message); tablo
-- grant'i yalnızca SELECT (yukarıda), INSERT/UPDATE hiçbir role doğrudan
-- grant edilmemiştir.
-- =============================================================================
