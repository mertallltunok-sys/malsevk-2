"use client";

import { useEffect, useState } from "react";
import { getMyServiceAuthorizations, type MyServiceAuthorizationRow } from "./supabase-my-service-authorizations";

/**
 * `getMyServiceAuthorizations`in reaktif/hook hâli — provider-job-listing.tsx
 * (§12-19/§46: "erişiminiz aktif değil"/"onay bekliyor"/"onaylanmadı" üç
 * ayrı boş-durum mesajı) ve document-upload-content.tsx (hangi kategoriler
 * hâlâ eklenebilir/belge-yüklenebilir) TARAFINDAN paylaşılır — ikisi de AYNI
 * "TÜM katalog kategorileri, durumlarıyla birlikte" veriye ihtiyaç duyar, bu
 * yüzden fetch+loading state'i burada TEK bir yerde yazılır.
 *
 * `loading` yalnızca `true -> false` yönünde hareket eder (bkz.
 * provider-service-status-card.tsx'in AYNI, projedeki hâlihazırda kabul
 * edilmiş deseni) — `providerId` değişirse (ör. çıkış yapıp başka bir
 * hesapla giriş) `loading` senkron olarak tekrar `true`ya ÇEVRİLMEZ, yalnızca
 * yeni fetch'in `.then()`i bir önceki `rows`un üzerine yazar; bir effect
 * gövdesinde senkron `setState`i yasaklayan proje kuralı (react-hooks/
 * set-state-in-effect) bu deseni gerektirir.
 */
export type MyServiceAuthorizationsResult = { loading: boolean; rows: MyServiceAuthorizationRow[] };

export function useMyServiceAuthorizations(providerId: string | undefined): MyServiceAuthorizationsResult {
  const [rows, setRows] = useState<MyServiceAuthorizationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    void getMyServiceAuthorizations(providerId).then((result) => {
      if (cancelled) return;
      setRows(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  return { loading: Boolean(providerId) && loading, rows };
}
