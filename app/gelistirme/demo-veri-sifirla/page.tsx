import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoDataResetPanel } from "../../_components/demo-data-reset-panel";

export const metadata: Metadata = {
  title: "Demo Veri Sıfırlama | MALSEVK.COM",
  robots: { index: false, follow: false },
};

/**
 * Dev-only araç: yalnızca demo/seed hesaplara (bkz.
 * app/_lib/users.ts#DEV_ACCOUNT_EMAILS) ait ilan/teklif/bildirim/fotoğraf
 * verilerini temizler — manuel test öncesi sıfırdan başlamak için.
 * `seedDevAccountsIfNeeded` ile AYNI kesin kapıyı kullanır: yalnızca
 * `next dev` altında (NODE_ENV==="development") erişilebilir; `next build`
 * + `next start` ile çalışan hiçbir ortamda (Vercel preview/production
 * dahil) bu route hiç var olmaz, 404 döner. Kalıcı, production'a görünür
 * bir "Tüm verileri sil" özelliği DEĞİLDİR.
 */
export default function DemoVeriSifirlaPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Demo Veri Sıfırlama
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Manuel test öncesi yalnızca demo hesaplara ait işlem verilerini güvenle sıfırlar.
        </p>
        <div className="mt-10">
          <DemoDataResetPanel />
        </div>
      </div>
    </section>
  );
}
