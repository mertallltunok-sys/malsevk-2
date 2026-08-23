import { getServiceAuthorizationsForAdmin, type ServiceAuthorizationRow } from "./admin-companies";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * FİRMA YETKİ KONTROLÜ (görev bölüm 10) — ikinci bir yetkilendirme
 * mekanizması İCAT ETMEZ. Tamamen `admin-companies.ts#getServiceAuthorizationsForAdmin`
 * (ZATEN var olan belge->kategori çözümleme + provider_service_authorizations
 * okuma) ve `profiles.account_status` üzerine kuruludur — burada hiçbir yeni
 * Supabase tablosu/RPC'si yoktur, yalnızca bu ikisinin okunabilir bir
 * "neden" metnine dönüştürülmesi.
 *
 * Kasıtlı kapsam sınırı: bu, KATEGORİ düzeyinde bir açıklamadır (bir firma
 * belirli bir hizmet kategorisi için neden yetkili/yetkisiz), TEK bir ilana
 * özgü bir kontrol DEĞİLDİR (ör. "bu spesifik ilanın atık kodu bilinmiyor"
 * gibi bir gerekçe, o ilanın kendi admin detay ekranında zaten görünür —
 * bkz. proje raporu, bu kasıtlı sınır orada da belirtilir).
 */

export type ProviderCategoryAccessStatus =
  | "hesap-askida"
  | "onayli"
  | "onay-bekliyor"
  | "ek-belge-gerekli"
  | "reddedildi"
  | "belge-yok"
  | "senkron-hatasi"
  | "yetkisiz";

export type ProviderCategoryAccessRow = {
  serviceCategoryId: string;
  serviceCategoryLabel: string;
  status: ProviderCategoryAccessStatus;
  reasonText: string;
};

export type ProviderAccessDiagnosis = {
  providerId: string;
  accountStatus: "active" | "suspended" | "banned";
  categories: ProviderCategoryAccessRow[];
  /** "Bu firma neden ilgili ilanları göremiyor?" — gerçek verilerden üretilmiş, tahmini/uydurma OLMAYAN özet. */
  summaryText: string;
};

function deriveCategoryStatus(row: ServiceAuthorizationRow, accountActive: boolean): { status: ProviderCategoryAccessStatus; reasonText: string } {
  if (!accountActive) {
    return { status: "hesap-askida", reasonText: "Hesap askıya alınmış — hesap aktif olmadan hiçbir kategori için yetki kullanılamaz." };
  }
  if (row.authorized) {
    return { status: "onayli", reasonText: "Admin tarafından onaylandı, ilgili ilanları görebilir ve teklif verebilir." };
  }
  switch (row.documentStatus) {
    case "approved":
      return {
        status: "senkron-hatasi",
        reasonText: "Belge onaylandı ama karşılığında aktif bir hizmet yetkisi oluşmamış — bu beklenmeyen bir tutarsızlıktır, Firma Belgeleri ekranından incelenmelidir.",
      };
    case "pending":
      return { status: "onay-bekliyor", reasonText: "Belge yüklendi, admin onayı bekleniyor." };
    case "revision_requested":
      return { status: "ek-belge-gerekli", reasonText: "Admin bu kategori için ek/revize belge istedi, firma henüz yeniden yüklemedi." };
    case "rejected":
      return { status: "reddedildi", reasonText: "Yüklenen belge reddedildi, firma yeni bir belge yüklemeli." };
    case "none":
    default:
      return { status: "belge-yok", reasonText: "Bu kategori seçilmiş ama hiç belge yüklenmemiş." };
  }
}

export async function getProviderAccessDiagnosis(providerId: string): Promise<ProviderAccessDiagnosis | null> {
  const supabase = createSupabaseBrowserClient();
  const [{ data: profileRow }, authorizationRows] = await Promise.all([
    supabase.from("profiles").select("account_status").eq("id", providerId).maybeSingle(),
    getServiceAuthorizationsForAdmin(providerId),
  ]);
  if (!profileRow) return null;

  const accountStatus = (profileRow as { account_status: "active" | "suspended" | "banned" }).account_status;
  const accountActive = accountStatus === "active";

  const selectedRows = authorizationRows.filter((row) => row.selected);
  const categories: ProviderCategoryAccessRow[] = selectedRows.map((row) => {
    const { status, reasonText } = deriveCategoryStatus(row, accountActive);
    return { serviceCategoryId: row.serviceCategoryId, serviceCategoryLabel: row.serviceCategoryLabel, status, reasonText };
  });

  const summaryText = buildSummary(accountStatus, categories);

  return { providerId, accountStatus, categories, summaryText };
}

function buildSummary(accountStatus: "active" | "suspended" | "banned", categories: ProviderCategoryAccessRow[]): string {
  if (accountStatus !== "active") {
    return "Bu firmanın hesabı askıya alınmış olduğu için hiçbir hizmet kategorisinde ilan göremez veya teklif veremez, kategori bazlı belge/yetki durumundan bağımsız olarak.";
  }
  if (categories.length === 0) {
    return "Bu firma henüz hiçbir hizmet kategorisi seçmemiş — Hizmet Bilgilerim / Belge Yükleme akışını tamamlamadığı için hiçbir ilanı göremez.";
  }
  const blocked = categories.filter((category) => category.status !== "onayli");
  if (blocked.length === 0) {
    return "Bu firma seçtiği tüm kategorilerde onaylı — herhangi bir kategoride ilan görememe durumu tespit edilmedi.";
  }
  const parts = blocked.map((category) => `${category.serviceCategoryLabel} (${category.reasonText})`);
  return `Bu firma şu kategorilerde ilgili ilanları göremiyor: ${parts.join("; ")}.`;
}
