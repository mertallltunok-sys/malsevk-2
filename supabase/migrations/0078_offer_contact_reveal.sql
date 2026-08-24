-- =============================================================================
-- MALSEVK — migration 0078: get_offer_contact (İletişim Bilgilerinin
-- Görünürlüğü görevi)
-- =============================================================================
-- KÖK NEDEN: app/_lib/contact-access.ts#getRevealedContactForOffer bugüne
-- kadar karşı tarafın (Hizmet Alan <-> Hizmet Veren) phone/email bilgisini
-- yalnızca YEREL `StoredUser` tablosundan (users.ts#findUserById) okuyordu —
-- bu tablo yalnızca "bu tarayıcının kendi giriş yaptığı kullanıcının"
-- profilini hidratlar (bkz. hydrate-provider-mirror.ts), KARŞI TARAFIN
-- profilini asla içermez. Sonuç: teklif kabul edilse bile, farklı bir
-- cihazdaki taraf karşı tarafın iletişim bilgisini HİÇBİR ZAMAN göremiyordu
-- — RLS'in kendisi de buna izin vermiyordu (profiles_select_own_or_admin,
-- 0013 — "own row or admin" dışında hiçbir SELECT yolu yok).
--
-- `public.can_view_offer_contact(p_offer_id)` (migration 0012) bu görev için
-- ÖNCEDEN yazılmış, kendi yorumunda "Mirrors contact-access.ts#
-- getRevealedContactForOffer exactly" diyen bir predicate — ama hiçbir RPC/
-- policy onu hiç ÇAĞIRMIYORDU (ölü kod, çağıran bekliyordu). Bu migration
-- YENİ bir yetkilendirme mantığı İCAT ETMEZ — yalnızca `get_job_address`
-- (0014) ile BİREBİR AYNI kalıpta (SECURITY DEFINER, tek amaçlı, dar kapsamlı
-- RPC), o var olan predicate'i gerçekten bir çağırana bağlar.
--
-- `email`, `public.profiles`ta hiç YOKTUR (0003'ün kendi belgesi: "Maps
-- StoredUser minus passwordHash/email — both owned by Supabase Auth") —
-- yalnızca `auth.users.email`de bulunur. Bu fonksiyon SECURITY DEFINER
-- olduğu için (migration'ı uygulayan `postgres` rolünün sahipliğinde çalışır)
-- `auth.users`i okuyabilir; `authenticated` rolüne bu tabloya DOĞRUDAN hiçbir
-- erişim verilmez — tek yol bu dar RPC'dir.
create or replace function public.get_offer_contact(p_offer_id uuid)
returns table (
  provider_name text, provider_phone text, provider_email text,
  requester_name text, requester_phone text, requester_email text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pp.full_name, pp.phone, pu.email,
    rp.full_name, rp.phone, ru.email
  from public.offers o
  join public.jobs j on j.id = o.job_id
  join public.profiles pp on pp.id = o.provider_id
  join public.profiles rp on rp.id = j.requester_id
  join auth.users pu on pu.id = o.provider_id
  join auth.users ru on ru.id = j.requester_id
  where o.id = p_offer_id and public.can_view_offer_contact(p_offer_id);
$$;

comment on function public.get_offer_contact(uuid) is
  'contact-access.ts#getRevealedContactForOffer''in tek, güvenli sunucu okuma yolu — can_view_offer_contact (0012) yetkilendirmesini kullanır. İletişim Bilgisi Görünürlüğü tercihi (StoredUser.showPhoneAfterAgreement/showEmailAfterAgreement) Supabase''e hiç taşınmadı (yalnızca localStorage''da var) — bu RPC HAM phone/email döner, o tercih hâlâ yalnızca istemci tarafında, en-iyi-çaba olarak uygulanır (bkz. ratings/offers senkron dosyalarının aksine, bu BİLİNEN ve belgelenmiş bir sınırdır, YENİ bir migration bu görevin kapsamı dışıdır).';

revoke all on function public.get_offer_contact(uuid) from public, anon;
grant execute on function public.get_offer_contact(uuid) to authenticated;
