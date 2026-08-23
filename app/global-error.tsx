"use client";

import { useEffect } from "react";
import { reportSystemError } from "./_lib/system-health";

/**
 * Kök düzeyde (root layout dahil) yakalanmamış bir hatayı karşılayan son
 * çare error boundary (Next.js App Router `global-error.tsx` sözleşmesi) —
 * kendi `<html>`/`<body>`sini render ETMEK ZORUNDADIR, çünkü root layout'un
 * kendisi bu noktada zaten devre dışı kalmış olabilir. `/admin/*` için
 * `app/admin/error.tsx` daha yakın bir sınır olduğundan normalde bu dosyaya
 * hiç düşmez — bu, panel/herkese açık site tarafının kendi karşılığıdır.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportSystemError({
      message: error.message || "Bilinmeyen genel uygulama hatası",
      source: "client",
      affectedScreen: typeof window !== "undefined" ? window.location.pathname : null,
      stackExcerpt: error.stack ?? null,
      requestId: error.digest ?? null,
    });
  }, [error]);

  return (
    <html lang="tr">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", padding: "1rem", fontFamily: "sans-serif" }}>
          <div style={{ maxWidth: "28rem", textAlign: "center" }}>
            <p style={{ fontSize: "1.125rem", fontWeight: 700 }}>Bir şeyler ters gitti</p>
            <p style={{ marginTop: "0.5rem", color: "#6b7280" }}>
              Sayfa beklenmedik bir hatayla karşılaştı. Lütfen tekrar deneyin.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "1.5rem",
                borderRadius: "9999px",
                background: "#10233f",
                color: "#ffffff",
                padding: "0.625rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              Tekrar Dene
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
