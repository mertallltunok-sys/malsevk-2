"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";
import { reportSystemError } from "../_lib/system-health";

/**
 * Admin bölgesindeki bir React render hatasını yakalayan error boundary
 * (Next.js App Router route-segment `error.tsx` sözleşmesi) — bu depodaki
 * İLK error boundary (bkz. Sistem Sağlığı görevinin analiz notu: daha önce
 * hiç yoktu). `/admin/*` altındaki her sayfayı kapsar (bu segment
 * ağacındaki en yakın `error.tsx`). Yakalanan hata Sistem Sağlığı'na
 * bildirilir, sonra kullanıcıya (admin) sade bir "tekrar dene" ekranı
 * gösterilir — ham stack trace ASLA doğrudan render edilmez.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportSystemError({
      message: error.message || "Bilinmeyen admin arayüz hatası",
      source: "client",
      affectedScreen: typeof window !== "undefined" ? window.location.pathname : null,
      stackExcerpt: error.stack ?? null,
      requestId: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-card border border-danger/30 bg-surface p-6 text-center sm:p-8">
        <AlertTriangle className="mx-auto h-10 w-10 text-danger" aria-hidden="true" />
        <p className="mt-4 text-base font-bold text-foreground">Bir şeyler ters gitti</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Bu ekranda beklenmeyen bir hata oluştu. Hata Sistem Sağlığı modülüne otomatik olarak kaydedildi.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Tekrar Dene
        </button>
      </div>
    </div>
  );
}
