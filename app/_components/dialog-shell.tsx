"use client";

import { useEffect, useRef } from "react";

/**
 * Uygulamadaki onay diyaloglarının (bkz. offer-outcome-panel.tsx) ortak
 * kabuğu: hafif arka plan, ESC ile kapanma, dış tıklamayla kapanma, açılışta
 * odak. Tamamlama onay modalıyla değerlendirme modalının (job-rating-modal.tsx)
 * birebir aynı görünüme sahip olması için buradan paylaşılır — iki ayrı/uyumsuz
 * modal kabuğu yok.
 */
export function DialogShell({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
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
        className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-md"
      >
        {children}
      </div>
    </div>
  );
}
