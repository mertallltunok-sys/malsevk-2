-- =============================================================================
-- MALSEVK — migration 0081: askıya alınmış hesapların doğrudan tablo
-- yazımıyla güvenlik kontrollerini aşmasını engelle
-- =============================================================================
-- KÖK NEDEN (bu görevin kendi canlı/gerçek Development doğrulamasında
-- bulundu — yalnızca migration dosyaları okunarak DEĞİL): `assert_active_user()`
-- (0042) yalnızca RPC'lere eklenmişti — `public.profiles` üzerindeki
-- `profiles_update_own` RLS politikası (0013) `account_status`ı hiç
-- kontrol etmiyordu. `updateMyProfileRemote`/`updateMyContactVisibilityRemote`
-- (app kodu) `profiles`e DOĞRUDAN `.update(...)` çağrısı yaptığı için (RPC
-- değil), askıya alınmış bir kullanıcı kendi ad/telefon/firma/iletişim-
-- gizliliği tercihini hâlâ değiştirebiliyordu.
--
-- =============================================================================
-- BÖLÜM 1 — profiles: RLS'e account_status = 'active' şartı eklendi
-- =============================================================================
-- Yeni bir yetkilendirme sistemi İCAT EDİLMEDİ — var olan `profiles_update_own`
-- politikasının KENDİSİ genişletildi (aynı desen: id = auth.uid()). role/
-- account_status/onboarding_completed sütunları zaten `authenticated`e hiç
-- GRANT edilmemişti (0003) — bu kişi ne kadar aktif olursa olsun bu alanları
-- hiçbir zaman yazamaz; bu migration o katmana dokunmuyor, yalnızca YAZILABİLEN
-- (full_name/phone/company_name/company_type/province/district/
-- show_email_after_agreement/show_phone_after_agreement) sütunlar için askıya
-- alınmış bir hesabın satırı GÜNCELLEMESİNİ tamamen engelliyor. Aktif bir
-- kullanıcı için `account_status` zaten 'active'dir ve bu UPDATE'in kendisi
-- onu değiştirmez (sütun grant'i yok) — davranış aktif kullanıcılar için
-- BİREBİR aynı kalır. `suspend_user`/`reinstate_user` (0016) SECURITY DEFINER
-- RPC'lerdir, tablo sahibi olarak çalışırlar ve RLS'e hiç tabi değildirler —
-- bu politika değişikliği admin'in askıya alma/yeniden etkinleştirme akışını
-- ETKİLEMEZ. Basit bir sütun eşitliği kontrolü olduğu için RLS recursion/
-- performans riski yoktur.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() and account_status = 'active')
  with check (id = auth.uid() and account_status = 'active');

comment on policy profiles_update_own on public.profiles is
  'id = auth.uid() İLE AYNI, artık account_status = ''active'' de zorunlu (0081) — askıya alınmış bir hesap kendi yazılabilir sütunlarını bile doğrudan UPDATE ile değiştiremez. role/account_status/onboarding_completed zaten hiç GRANT edilmedi (0003), bu politika onları ETKİLEMEZ.';

-- =============================================================================
-- BÖLÜM 2 — jobs / provider_profiles: sahipsiz, belgelenmemiş, kullanılmayan
-- doğrudan UPDATE grant'leri geri alındı
-- =============================================================================
-- KÖK NEDEN (aynı canlı doğrulamada bulundu, GÖREV 1'in "aynı açık başka
-- doğrudan yazımlarda var mı" talimatı): Development veritabanında
-- `public.jobs` (title/description/province/district/work_location_type/
-- address_text/work_date/work_end_date/facility_id/location_mode/neighborhood/
-- location_url/directions_note/operation_details) ve `public.provider_profiles`
-- (bio/founded_year/experience_range/regions/service_features/logo_path)
-- üzerinde `authenticated`e GERÇEKTEN VERİLMİŞ sütun-seviyeli UPDATE grant'leri
-- bulundu — ama bu grant'ler HİÇBİR migration dosyasında YOKTUR (0004/0003
-- tam tersini, `revoke update ... from authenticated`i yazar) ve uygulama
-- kodunda (`app/_lib/**`) bu iki tabloya doğrudan `.update(...)` yapan TEK BİR
-- çağrı sitesi bile yoktur (tüm gerçek yazma yolu `update_job_as_requester`/
-- `update_job_as_admin`/`create_job`/`upsert_provider_profile`/
-- `set_provider_profile_logo_path` RPC'leridir — hepsi SECURITY DEFINER,
-- RLS/grant'lere hiç ihtiyaç duymaz). Bu, migration geçmişinde hiç
-- kayıtlı olmayan, önceki bir oturumda doğrudan/geçici olarak çalıştırılmış
-- ve hiç geri alınmamış bir yetki sızıntısıydı — belgelenen mimariyle
-- (RPC-only düzenleme) DOĞRUDAN ÇELİŞİYORDU. Etkisi askıya alınmış hesapla
-- sınırlı değildi: HERHANGİ bir aktif kullanıcı bile bu grant'i kullanarak
-- `update_job_as_requester`in `moderation_status = 'pending_review'` şartını,
-- `p_expected_updated_at` iyimser eşzamanlılık kontrolünü ve
-- `work_end_date >= work_date` doğrulamasını TAMAMEN atlayıp zaten onaylanmış
-- bir ilanı yeniden incelemeye düşürmeden doğrudan değiştirebilirdi. Hiçbir
-- uygulama kodu bu grant'e bağımlı olmadığı için geri almak sıfır risklidir —
-- yalnızca belgelenen, amaçlanan mimariye geri dönüştür.
revoke update on public.jobs from authenticated;
revoke update on public.provider_profiles from authenticated;

-- =============================================================================
-- BÖLÜM 3 — update_system_error_status: eksik assert_active_user() eklendi
-- =============================================================================
-- KÖK NEDEN: bu admin-only RPC yalnızca `is_admin()` kontrol ediyordu —
-- `is_admin()` yalnızca `role = 'admin'`e bakar, `account_status`a hiç
-- bakmaz (kendi tanımı, doğrulandı). `suspend_user` (0016) SON aktif admin'i
-- askıya almayı engeller ama askıya alınmış BİR admin (aktif başka bir admin
-- varsa) hâlâ mevcuttur — bu RPC 0042'nin "admin RPC'leri de dahil, 18 admin
-- RPC'si" kapsamına GİRMESİ gerekirken canlı doğrulamada eksik bulundu (diğer
-- 17 admin RPC'si zaten çağırıyor). Tek satır eklenerek AYNI desen tamamlandı
-- — yeni bir kontrol mekanizması icat edilmedi.
create or replace function public.update_system_error_status(p_error_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_status text;
begin
  perform public.assert_active_user();
  if not public.is_admin() then
    raise exception 'ML152: admin role required' using errcode = 'ML152';
  end if;
  if p_status not in ('yeni', 'inceleniyor', 'cozuldu') then
    raise exception 'ML153: status must be yeni/inceleniyor/cozuldu' using errcode = 'ML153';
  end if;

  select status into v_old_status from public.system_error_logs where id = p_error_id;
  if v_old_status is null then
    raise exception 'ML154: error record not found' using errcode = 'ML154';
  end if;

  update public.system_error_logs
  set status = p_status,
      resolved_at = case when p_status = 'cozuldu' then now() else null end,
      resolved_by = case when p_status = 'cozuldu' then auth.uid() else null end
  where id = p_error_id;

  perform public.log_audit_event(
    'update_system_error_status',
    'system_error_log',
    p_error_id,
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_status)
  );
end;
$$;
