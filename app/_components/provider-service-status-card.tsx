"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getMyServiceAuthorizations, type MyServiceAuthorizationRow } from "../_lib/supabase-my-service-authorizations";
import { StatusBadge } from "./status-badge";

/**
 * "Hizmet Yetkileri" — Panel > Profilim. Sağlayıcının hangi hizmet
 * kategorilerinde teklif verebileceğinin TEK, salt okunur gösterimi.
 *
 * DÜZELTME ("Profilim/Hesap Ayarları Sadeleştirmesi" görevi — çekirdek
 * kural: "Profilde yalnız admin tarafından onaylanmış ve aktif durumdaki
 * hizmet yetkileri gösterilir."): bu kart eskiden 7 durumun (document_
 * required/document_pending/approved_awaiting_authorization/document_
 * rejected/revoked/not_selected dahil) TAMAMINI, her biri kendi durum
 * rozeti ve yönlendirme metniyle listeliyordu — bu, "yalnız aktif
 * yetkiler gösterilir" kuralıyla ÇELİŞİYORDU (bekleyen/reddedilen/
 * seçilmemiş hizmetler de görünüyordu). Artık YALNIZCA `status ===
 * "authorized"` satırları gösterilir; diğer altı durum (belge gerekli,
 * admin onayı bekleniyor, reddedildi, yetki kaldırıldı, seçilmedi, vb.)
 * bu karttan TAMAMEN kaldırıldı — o bilgi hâlâ `/panel/belge-yukleme`
 * ekranında mevcuttur (görev kapsamı dışı, dokunulmadı), yalnızca burada
 * TEKRAR edilmiyor. Veri kaynağı DEĞİŞMEDİ: hâlâ AYNI
 * `getMyServiceAuthorizations` → `provider_service_authorizations` +
 * `review_provider_document`'ın otomatik yetkilendirme zinciri (bkz.
 * CLAUDE.md "Service Authorization") — ikinci bir yetkilendirme sistemi
 * İCAT EDİLMEDİ, yalnızca bu bileşenin SUNUMU daraltıldı.
 */
export function ProviderServiceStatusCard({ providerId }: { providerId: string }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<MyServiceAuthorizationRow[]>([]);

  useEffect(() => {
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

  const authorizedRows = rows.filter((row) => row.status === "authorized");

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-lg font-bold tracking-heading leading-tight text-foreground">Hizmet Yetkileri</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
        Yalnızca admin tarafından onaylanmış ve aktif durumdaki hizmet yetkileriniz gösterilir — bu
        kategorilere ait ilanları görebilir ve teklif verebilirsiniz.
      </p>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor...
        </div>
      ) : authorizedRows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Admin tarafından onaylanmış aktif hizmet yetkiniz bulunmuyor.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {authorizedRows.map((row) => (
            <div key={row.serviceCategoryId} className="rounded-md border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{row.serviceCategoryLabel}</p>
                <StatusBadge label="Aktif" tone="success" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
