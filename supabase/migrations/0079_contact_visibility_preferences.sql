-- =============================================================================
-- MALSEVK — migration 0079: İletişim Bilgisi Görünürlüğü tercihlerini
-- Supabase'e taşı ve get_offer_contact'ta sunucu tarafında uygula
-- =============================================================================
-- KÖK NEDEN (önceki "Canlıya Geçiş Öncesi Son Durum Analizi" raporu, Konu 2):
-- `StoredUser.showPhoneAfterAgreement`/`showEmailAfterAgreement` (users.ts#
-- updateContactVisibility) yalnızca localStorage'a yazılıyordu. `get_offer_contact`
-- (migration 0078) bu tercihi hiç bilmediği için HAM phone/email döndürüyordu —
-- karşı taraf temiz bir cihazdan giriş yaptığında, kullanıcının "gizle" tercihi
-- hiç uygulanmadan bilgisi sızıyordu. Bu migration YENİ bir yetkilendirme
-- mantığı İCAT ETMEZ — `get_offer_contact`in var olan `can_view_offer_contact`
-- yetkilendirmesini KORUR, yalnızca döndürdüğü alanları sahibinin kendi
-- (artık gerçek sütunlarda saklanan) tercihine göre süzer.
--
-- Varsayılan `true` (görünür) — özellik eklenmeden ÖNCEki davranışla (her
-- ikisi de her zaman gösteriliyordu) BİREBİR aynı sonucu verir, mevcut
-- kullanıcıların iletişim akışı bozulmaz (bkz. users.ts#StoredUser'ın
-- `?? true` ile aynı ilke, şimdi sütun seviyesinde).
-- =============================================================================

alter table public.profiles
  add column if not exists show_email_after_agreement boolean not null default true,
  add column if not exists show_phone_after_agreement boolean not null default true;

comment on column public.profiles.show_email_after_agreement is
  'Hesap Ayarları > "İletişim Bilgisi Görünürlüğü" — bir teklif kabul edilip taraflar birbirinin iletişim bilgisini görebilir hale geldiğinde, bu kullanıcının e-postasının karşı tarafa gösterilip gösterilmeyeceği. get_offer_contact() (0078/bu migration) bu sütuna göre email alanını süzer.';
comment on column public.profiles.show_phone_after_agreement is
  'Bkz. show_email_after_agreement üstündeki yorum — AYNI kural, telefon numarası için.';

-- Diğer 6 "self-service" alanla (0003) AYNI dar kapsamlı kalıp: yalnızca
-- sahibi (RLS'in profiles_update_own politikası, 0013 — id = auth.uid())
-- KENDİ satırındaki bu iki sütunu güncelleyebilir. role/account_status gibi
-- admin-only alanlara HİÇBİR yeni erişim açılmaz.
grant update (show_email_after_agreement, show_phone_after_agreement)
  on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- get_offer_contact — sahibinin kendi görünürlük tercihine göre süz
-- -----------------------------------------------------------------------------
-- `language sql`den `language plpgsql`e geçirildi: yalnızca bu, mevcut
-- `assert_active_user()` (0042) assertion'ını `perform` ile çağırabilmek
-- için gerekli mekanik değişiklik — TEK amaçlı dar RPC kuralı (0078) ve
-- `can_view_offer_contact` yetkilendirmesi AYNEN korunur.
--
-- KASITLI, DAR KAPSAMLI İSTİSNA (0042'nin kendi "yalnızca mutation'lar
-- kapsanır, salt-okunur uçlar askıya-alma kontrolüne tabi değildir" genel
-- ilkesine): iletişim bilgisi ifşası (gerçek telefon/e-posta) sıradan bir
-- "kendi verimi görüntüleme" okuması değil, hassas bir ifşa eylemidir — bu
-- yüzden burada KASITLI OLARAK assert_active_user() eklendi (askıya alınmış
-- bir hesap artık hiçbir tarafın iletişim bilgisine erişemez). Diğer HİÇBİR
-- salt-okunur RLS politikası/yardımcı fonksiyon bu migration ile değişmedi.
create or replace function public.get_offer_contact(p_offer_id uuid)
returns table (
  provider_name text, provider_phone text, provider_email text,
  requester_name text, requester_phone text, requester_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_active_user();

  return query
  select
    pp.full_name,
    case when coalesce(pp.show_phone_after_agreement, true) then pp.phone else null end,
    case when coalesce(pp.show_email_after_agreement, true) then pu.email else null end,
    rp.full_name,
    case when coalesce(rp.show_phone_after_agreement, true) then rp.phone else null end,
    case when coalesce(rp.show_email_after_agreement, true) then ru.email else null end
  from public.offers o
  join public.jobs j on j.id = o.job_id
  join public.profiles pp on pp.id = o.provider_id
  join public.profiles rp on rp.id = j.requester_id
  join auth.users pu on pu.id = o.provider_id
  join auth.users ru on ru.id = j.requester_id
  where o.id = p_offer_id and public.can_view_offer_contact(p_offer_id);
end;
$$;

comment on function public.get_offer_contact(uuid) is
  'contact-access.ts#getRevealedContactForOffer''in tek, güvenli sunucu okuma yolu — can_view_offer_contact (0012) yetkilendirmesini kullanır. İletişim Bilgisi Görünürlüğü tercihi artık profiles.show_email_after_agreement/show_phone_after_agreement''ta (bu migration) saklanır ve BURADA, sunucu tarafında uygulanır — gizlenen alan bu RPC''nin ham cevabında hiç bulunmaz, yalnızca istemci tarafında filtrelenmez. Askıya alınmış bir hesap (assert_active_user(), 0042) için ML127 ile reddedilir.';

revoke all on function public.get_offer_contact(uuid) from public, anon;
grant execute on function public.get_offer_contact(uuid) to authenticated;
