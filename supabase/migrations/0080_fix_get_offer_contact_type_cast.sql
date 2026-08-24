-- =============================================================================
-- MALSEVK — migration 0080: get_offer_contact tip uyuşmazlığı düzeltmesi
-- =============================================================================
-- KÖK NEDEN (aynı görevin kendi GERÇEK testinde bulundu — RPC'yi doğrudan
-- çağıran bir istemciden `structure of query does not match function result
-- type` hatası döndü): `auth.users.email` sütunu `character varying`dir,
-- `text` DEĞİL (`pg_typeof` ile doğrulandı). 0079'un `get_offer_contact`i
-- `language sql`den `language plpgsql`e geçirirken (yalnızca `assert_active_
-- user()`ı `perform` ile çağırabilmek için), `case when ... then pu.email
-- else null end` ifadesinin çıkarılan tipi `character varying` olarak
-- kaldı — PL/pgSQL'in `return query select ...`u, adi bir `language sql`
-- fonksiyonunun aksine, `returns table (...)`daki bildirilen `text` sütunlarına
-- örtük/zorlamasız bir coercion YAPMIYOR, bu yüzden her çağrı 42804 ile
-- reddediliyordu. Yalnızca bir tip düzeltmesi — 0079'un yetkilendirme/
-- görünürlük mantığının TAMAMI (can_view_offer_contact, assert_active_user,
-- show_email/phone_after_agreement süzgeci) BİREBİR AYNI kalır.
-- =============================================================================

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
    pp.full_name::text,
    case when coalesce(pp.show_phone_after_agreement, true) then pp.phone::text else null end,
    case when coalesce(pp.show_email_after_agreement, true) then pu.email::text else null end,
    rp.full_name::text,
    case when coalesce(rp.show_phone_after_agreement, true) then rp.phone::text else null end,
    case when coalesce(rp.show_email_after_agreement, true) then ru.email::text else null end
  from public.offers o
  join public.jobs j on j.id = o.job_id
  join public.profiles pp on pp.id = o.provider_id
  join public.profiles rp on rp.id = j.requester_id
  join auth.users pu on pu.id = o.provider_id
  join auth.users ru on ru.id = j.requester_id
  where o.id = p_offer_id and public.can_view_offer_contact(p_offer_id);
end;
$$;

revoke all on function public.get_offer_contact(uuid) from public, anon;
grant execute on function public.get_offer_contact(uuid) to authenticated;
