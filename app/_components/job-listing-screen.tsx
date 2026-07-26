"use client";

import { useSession } from "../_lib/use-session";
import { GuestAccessCard } from "./guest-access-card";
import { JobList } from "./job-list";
import { ProviderJobListing } from "./provider-job-listing";

/**
 * `/ilanlar` sayfasının rol bazlı giriş noktası. Oturum yoksa (bkz.
 * guest-access-card.tsx) "Hizmet Talebi Oluştur" sayfasıyla aynı tasarım
 * sistemini paylaşan tam sayfa giriş-gerekli kartı gösterilir — modal
 * DEĞİLDİR. Hizmet Veren için tek listeli "Aktif İlanlar" ekranı (bkz.
 * provider-job-listing.tsx — eski "Teklife Açık"/"Teklife Kapalı" iki
 * bölümlü görünüm tamamen kaldırıldı); diğer tüm durumlarda (Hizmet Alan,
 * henüz hidrasyon tamamlanmadı) mevcut, değişmemiş tek-grid görünüm
 * (`JobList`) korunur. Bu bileşen kendi section+kapsayıcı sarmalayıcısını
 * taşıyor — `page.tsx` yalnızca ince bir kabuk (bkz. app/ilanlar/page.tsx) —
 * çünkü giriş-gerekli kartı (max-w-3xl) ile gerçek ilan listesi (max-w-7xl)
 * farklı genişlikte kapsayıcılara ihtiyaç duyuyor.
 */
export function JobListingScreen() {
  const session = useSession();

  if (!session) {
    return (
      <GuestAccessCard
        pageTitle="İş İlanlarını İncele"
        pageDescription="Uzmanlık alanınıza uygun lojistik hizmet taleplerini inceleyin ve uygun işlere teklif verin."
        cardTitle="İlanları görüntülemek için giriş yapmalısınız."
        cardDescription="İş ilanlarını incelemek ve hizmet taleplerine teklif verebilmek için hesabınıza giriş yapın veya yeni bir hesap oluşturun."
        redirectTo="/ilanlar"
      />
    );
  }

  if (session.role === "hizmet-veren") {
    return (
      <section className="bg-background">
        {/* Yalnızca bu ekranda (Aktif İlanlar): "Aktif İlanlar" başlığı/açıklaması
            ve header ile filtre arasındaki büyük boşluk tamamen kaldırıldı —
            kompakt filtre araç çubuğu header'ın hemen altında başlar, kullanıcı
            sayfayı açar açmaz ilan kartlarını görsün diye (bkz. provider-job-listing.tsx).
            Diğer sayfaların py-16 kuralı değişmedi. */}
        <div className="mx-auto max-w-7xl px-4 pt-4 pb-16 sm:px-6 lg:px-8">
          <ProviderJobListing session={session} />
        </div>
      </section>
    );
  }

  return (
    <section className="bg-background">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            İş İlanları
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Uzmanlığınıza uygun lojistik hizmet ilanlarını inceleyin, ilan
            detayında teklifinizi gönderin.
          </p>
        </div>

        <JobList />
      </div>
    </section>
  );
}
