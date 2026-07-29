"use client";

import { useEffect, useRef } from "react";

const SIZE_CLASSES = {
  // Mevcut, DEĞİŞTİRİLMEMİŞ boyut — offer-outcome-panel.tsx/job-rating-modal.tsx
  // hâlâ bunu (varsayılan) kullanır, görünümleri bu değişiklikten ETKİLENMEZ.
  md: "max-w-md",
  // Hukuki metin modalları (bkz. legal-document-modal.tsx) için: büyük
  // başlık + tarih/sürüm satırı + uzun metin + onay alanının tamamı TEK bir
  // kaydırılabilir kutu içinde kalır (`max-h-[90vh] overflow-y-auto`) — bu
  // sayede mobilde de içerik viewport'u asla aşmaz, ayrı bir "sticky footer"
  // karmaşıklığına gerek kalmadan.
  lg: "max-w-3xl max-h-[90vh] overflow-y-auto",
} as const;

/**
 * Uygulamadaki onay diyaloglarının (bkz. offer-outcome-panel.tsx) ortak
 * kabuğu: hafif arka plan, ESC ile kapanma, dış tıklamayla kapanma, açılışta
 * odak. Tamamlama onay modalıyla değerlendirme modalının (job-rating-modal.tsx)
 * birebir aynı görünüme sahip olması için buradan paylaşılır — iki ayrı/uyumsuz
 * modal kabuğu yok. `size` (varsayılan `"md"`) yalnızca genişlik/yükseklik
 * sınıflarını değiştirir; kapanma/odak/erişilebilirlik davranışı her iki
 * boyutta da birebir aynıdır.
 */
export function DialogShell({
  labelledBy,
  onClose,
  size = "md",
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  size?: keyof typeof SIZE_CLASSES;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 focus:outline-none"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full rounded-card border border-border bg-surface p-6 shadow-md ${SIZE_CLASSES[size]}`}
      >
        {children}
      </div>
    </div>
  );
}
