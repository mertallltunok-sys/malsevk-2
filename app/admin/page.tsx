import type { Metadata } from "next";
import { AdminDashboardContent } from "../_components/admin-dashboard-content";
import { AdminShell } from "../_components/admin-shell";
import { requireAdminOrRedirect } from "../_lib/require-admin";

export const metadata: Metadata = {
  title: "Yönetim Paneli | MALSEVK.COM",
  description: "MALSEVK yönetim paneli — kullanıcı, firma ve belge özet göstergeleri.",
};

/**
 * Bu sayfa, ADMIN PANELİ MODÜLERLEŞMESİ göreviyle "Hizmet Veren Belge
 * Kontrolü" tek-ekranından "Dashboard"a dönüştürüldü — o ekranın işlevi
 * (provider_documents inceleme) artık daha zengin bir sürümüyle
 * `/admin/firma-belgeleri` modülünde yaşıyor (sekmeler, İncele ekranı, tam
 * inceleme geçmişi — bkz. o sayfanın kendi dokümantasyonu). Eski
 * `AdminProviderDocumentReviewPanel` (localStorage) ve
 * `AdminProviderDocumentReviewPanelRemote` (Supabase, yalnız "pending")
 * bileşen DOSYALARI bilerek SİLİNMEDİ (bu görevin kapsamı dışı, ayrı bir
 * karar gerektirir) — yalnızca bu sayfadan artık import edilmiyorlar.
 */
export default async function AdminPage() {
  await requireAdminOrRedirect("/admin");
  return (
    <section className="bg-background">
      <AdminShell title="Yönetim Özeti">
        <AdminDashboardContent />
      </AdminShell>
    </section>
  );
}
