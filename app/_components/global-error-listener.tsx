"use client";

import { useEffect } from "react";
import { reportSystemError } from "../_lib/system-health";

/**
 * SİSTEM SAĞLIĞI (görev bölüm 11) — "Yakalanmamış promise hataları" ve
 * event-handler'lar içinde oluşup React'in render-fazı `error.tsx`/
 * `global-error.tsx` sınırlarının (yalnızca render sırasında atılan hataları
 * yakalar) hiç GÖRMEDİĞİ hataları yakalar. `whatsapp-support-button.tsx`/
 * `navigation-history-tracker.tsx` ile AYNI "tek amaçlı, `null` render eden,
 * köke bir kez eklenen bileşen" deseni — kendi görsel çıktısı yok, yalnızca
 * bir yan etki (event listener) kaydeder.
 */
export function GlobalErrorListener() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Yakalanmamış promise hatası";
      reportSystemError({
        message,
        source: "client",
        stackExcerpt: reason instanceof Error ? (reason.stack ?? null) : null,
      });
    }

    function handleWindowError(event: ErrorEvent) {
      // React'in kendi error boundary'leri (app/admin/error.tsx, app/global-
      // error.tsx) render-fazı hatalarını zaten yakalayıp bildiriyor — bu
      // dinleyici SADECE onların dışında kalan (event handler/async) hataları
      // kapsar. Aynı hatanın iki kez raporlanması zararsızdır: RPC tarafında
      // fingerprint aynı olduğundan yeni satır değil, yalnızca occurrence_count
      // artışı olur (bkz. migration 0072).
      reportSystemError({
        message: event.message || "Yakalanmamış bir istemci hatası",
        source: "client",
        sourceFile: event.filename || null,
        lineNumber: typeof event.lineno === "number" ? event.lineno : null,
        stackExcerpt: event.error instanceof Error ? (event.error.stack ?? null) : null,
      });
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  return null;
}
