"use client";

import { AuthGateNotice } from "./auth-gate-notice";
import { DialogShell } from "./dialog-shell";

/**
 * Anasayfadaki oturum açılmamış "İş İlanlarını İncele" CTA'larının (Hero,
 * RoleCardsSection, FinalCtaSection) ortak giriş-gerekli modalı. Yeni bir
 * modal tasarımı icat etmez — mevcut `DialogShell` (onay diyaloglarının
 * paylaşılan kabuğu) ile "Hizmet Talebi Oluştur" akışında zaten kullanılan
 * `AuthGateNotice`'i birlikte kullanır. `loginRedirect`/`registerRedirect`
 * "/ilanlar" olduğu için giriş/kayıt sonrası kullanıcı doğrudan gitmek
 * istediği ilanlar sayfasına yönlendirilir (mevcut redirect mekanizması).
 */
export function JobListingsAuthGateDialog({ onClose }: { onClose: () => void }) {
  return (
    <DialogShell labelledBy="ilanlari-goruntule-giris-baslik" onClose={onClose}>
      <h2 id="ilanlari-goruntule-giris-baslik" className="sr-only">
        Giriş gerekli
      </h2>
      <AuthGateNotice
        message="İlanları görüntülemek için giriş yapmalısınız."
        description="İş ilanlarını incelemek ve teklif vermek için hesabınıza giriş yapın veya yeni hesap oluşturun."
        loginRedirect="/ilanlar"
        registerRedirect="/ilanlar"
      />
    </DialogShell>
  );
}
