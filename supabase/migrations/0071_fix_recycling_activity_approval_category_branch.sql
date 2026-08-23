-- =============================================================================
-- MALSEVK — migration 0071: review_provider_document'in "tek kategori" onay
-- dalındaki GERÇEK, çalıştırma-zamanı hatasını düzeltir (0069'un kapsamı
-- dışında bulundu — gerçek tarayıcı testiyle tespit edildi).
-- =============================================================================
-- STATUS: "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevinin
-- devamı — 0069 hosted dev'e uygulandıktan SONRA, gerçek bir Playwright
-- akışıyla (belge yükle -> admin onayla -> provider_service_authorizations'ı
-- kontrol et) tespit edilen bir hata. 0069 KENDİSİ düzenlenmedi (yerleşik
-- ilke: uygulanmış bir migration asla geriye dönük düzenlenmez).
--
-- KÖK NEDEN: `review_provider_document`in onay zincirinde İKİ AYRI dal var —
-- `v_document.service_category_id is not null` (TEK bir kategoriye bağlı
-- belge, ör. bu görevdeki Geri Dönüşüm & Atık Tahliye belgesi) VE `else`
-- (genel/kategorisiz belge, provider'ın SEÇTİĞİ TÜM kategoriler için döngü).
-- 0069, `p_approved_recycling_activities`i yalnızca İKİNCİ (else/döngü) dala
-- ekledi — Geri Dönüşüm belgesi normal akışta HER ZAMAN `service_category_id
-- = 'geri-donusum-atik-tahliye'` ile yüklendiği için (document-upload-
-- content.tsx#handlePickCategory, TEK kategori seçimi — Geri Dönüşüm hiçbir
-- PROVIDER_AUTHORIZATION_GROUPS grubuna dahil değil) pratikte HER ZAMAN
-- BİRİNCİ dal çalışır, ve o dal `authorize_provider_service`'i faaliyet
-- parametresi HİÇ GÖNDERMEDEN çağırıyordu — admin belgeyi onaylasa bile
-- provider_service_authorizations.recycling_activities NULL kalıyordu
-- (fail-closed tasarım gereği bu da provider'ı kalıcı olarak engelliyordu).
--
-- DÜZELTME: birinci daldaki `authorize_provider_service` çağrısına, ikinci
-- daldakiyle AYNI koşullu (`v_document.service_category_id =
-- 'geri-donusum-atik-tahliye'` iken) 7. parametre eklenir. `create or
-- replace` ile gövde-içi düzeltme — imza DEĞİŞMEDİ, drop gerekmez.
-- =============================================================================

create or replace function public.review_provider_document(
  p_document_id uuid, p_status text, p_note text default null::text,
  p_approved_storage_activity_scopes text[] default null::text[],
  p_approved_imo_class_codes text[] default null::text[],
  p_approved_storage_risk_groups text[] default null::text[],
  p_approved_recycling_activities text[] default null::text[],
  p_approved_recycling_waste_codes text[] default null::text[]
)
returns provider_documents
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_document public.provider_documents;
  v_trimmed_note text := nullif(trim(coalesce(p_note, '')), '');
  v_target_category_id text;
  v_risk_group text;
  v_waste_code text;
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
  perform public.assert_valid_storage_activity_scopes(p_approved_storage_activity_scopes);
  perform public.assert_valid_imo_class_codes(p_approved_imo_class_codes);
  perform public.assert_valid_storage_risk_groups(p_approved_storage_risk_groups);
  perform public.assert_valid_recycling_activities(p_approved_recycling_activities);
  if p_approved_recycling_waste_codes is not null then
    foreach v_waste_code in array p_approved_recycling_waste_codes loop
      if not exists (select 1 from public.recycling_waste_codes where code = v_waste_code) then
        raise exception 'ML140: recycling_waste_code must be a known official waste code (got %)', v_waste_code using errcode = 'ML140';
      end if;
    end loop;
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

  if p_status = 'approved' then
    begin
      if v_document.service_category_id is not null then
        -- DÜZELTME (0071): +1 argüman — Geri Dönüşüm & Atık Tahliye belgesi
        -- HER ZAMAN bu dala düşer (kendi tek kategorisine bağlı olarak
        -- yüklenir, hiçbir gruba dahil değil) — 0069'da bu dal faaliyet
        -- parametresini HİÇ GÖNDERMİYORDU, admin onayı sonrası provider
        -- kalıcı olarak "yetkisiz" kalıyordu (gerçek testte bulunan hata).
        perform public.authorize_provider_service(
          v_document.provider_id, v_document.service_category_id, p_document_id,
          'Belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
          case when v_document.service_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end,
          case when v_document.service_category_id = 'geri-donusum-atik-tahliye' then p_approved_recycling_activities else null end
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
            'Depo Hizmetleri belgesi onayıyla otomatik yetkilendirildi (review_provider_document, migration 0044).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end
          );
        end loop;
      else
        for v_target_category_id in
          select service_category_id from public.provider_services
          where provider_id = v_document.provider_id and service_category_id <> 'gumruk-musavirligi'
        loop
          perform public.authorize_provider_service(
            v_document.provider_id, v_target_category_id, p_document_id,
            'Genel belge onayıyla otomatik yetkilendirildi (review_provider_document, migration 0041).',
            case when v_target_category_id = 'konteyner-depolama' then p_approved_storage_activity_scopes else null end,
            case when v_target_category_id = 'konteyner-depolama' then p_approved_imo_class_codes else null end,
            case when v_target_category_id = 'geri-donusum-atik-tahliye' then p_approved_recycling_activities else null end
          );
        end loop;
      end if;

      if p_approved_storage_risk_groups is not null then
        foreach v_risk_group in array p_approved_storage_risk_groups loop
          perform public.authorize_provider_storage_risk_group(
            v_document.provider_id, v_risk_group, p_document_id,
            'Belge incelemesi sırasında admin tarafından ayrı ayrı onaylandı (review_provider_document, migration 0068).'
          );
        end loop;
      end if;
      if p_approved_recycling_waste_codes is not null then
        foreach v_waste_code in array p_approved_recycling_waste_codes loop
          perform public.authorize_provider_recycling_waste_code(
            v_document.provider_id, v_waste_code, p_document_id,
            'Belge incelemesi sırasında admin tarafından ayrı ayrı onaylandı (review_provider_document, migration 0069).'
          );
        end loop;
      end if;
    exception when others then
      raise warning 'review_provider_document: auto-authorization failed for document %, provider %: %', p_document_id, v_document.provider_id, sqlerrm;
    end;
  end if;

  return v_document;
end;
$function$;
