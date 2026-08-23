-- =============================================================================
-- 0039 — request_provider_document (görev bölüm 31: "Belge Talep Et")
--
-- 0038, `notifications.type` CHECK'ine `service_document_required`i EKLEMİŞTİ
-- ama onu GERÇEKTEN oluşturan hiçbir RPC yazılmamıştı — bu migration o
-- eksik ucu tamamlıyor. Amaç: admin, bir provider'ın HENÜZ belge yüklemediği
-- (ya da hiç seçmediği) bir hizmet için proaktif olarak "belge yükleyin"
-- bildirimi gönderebilsin — authorize_provider_service/revoke_provider_
-- service_authorization (0038) ile AYNI admin-only desen, ama bu fonksiyon
-- `provider_service_authorizations`e HİÇBİR satır YAZMAZ (yalnızca bir
-- bildirim) — "talep etmek" bir yetkilendirme kararı değildir, EYLEM
-- İSTEĞİDİR. EN'nin (mevcut) create_notification()'ı (0016) dışında YENİ bir
-- bildirim altyapısı İCAT EDİLMEDİ (görev gereksinimi: "mevcut bildirim
-- sistemini kullanarak").
--
-- Yeni SQLSTATE kodu YOK — üç doğrulama da (admin-only, bilinmeyen kategori,
-- provider hizmet-veren değil) authorize_provider_service'in KENDİ, zaten
-- var olan kodlarıyla (MLK50/MLK94/ML106) birebir aynı anlamı taşıyor,
-- projenin "aynı anlam = aynı kod" ilkesi (bkz. proje raporu) burada da
-- geçerli.
-- =============================================================================

create or replace function public.request_provider_document(
  p_provider_id uuid,
  p_service_category_id text,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_name text;
begin
  if not public.is_admin() then
    raise exception 'MLK50: admin role required' using errcode = 'MLK50';
  end if;
  select name into v_category_name from public.service_categories where id = p_service_category_id;
  if v_category_name is null then
    raise exception 'MLK94: unknown service_category_id' using errcode = 'MLK94';
  end if;
  if not exists (select 1 from public.profiles where id = p_provider_id and role = 'hizmet-veren') then
    raise exception 'ML106: provider_id must belong to a hizmet-veren profile' using errcode = 'ML106';
  end if;

  perform public.create_notification(
    p_provider_id, auth.uid(), 'service_document_required', null, null, null,
    'Belge Yüklemeniz Gerekiyor',
    v_category_name || ' hizmeti için faaliyet belgenizi yüklemeniz gerekiyor.' ||
      case when nullif(trim(coalesce(p_message, '')), '') is not null then ' ' || trim(p_message) else '' end,
    jsonb_build_object('service_category_id', p_service_category_id)
  );

  perform public.log_audit_event('request_provider_document', 'profiles', p_provider_id,
    null, jsonb_build_object('provider_id', p_provider_id, 'service_category_id', p_service_category_id));
end;
$$;

comment on function public.request_provider_document(uuid, text, text) is
  '0039: Admin-only, belgesiz bir hizmet için proaktif "belge yükleyin" bildirimi — provider_service_authorizations''a hiçbir satır yazmaz, yalnızca notifications (0016#create_notification). Görev bölüm 31.';

revoke all on function public.request_provider_document(uuid, text, text) from public, anon;
grant execute on function public.request_provider_document(uuid, text, text) to authenticated;
