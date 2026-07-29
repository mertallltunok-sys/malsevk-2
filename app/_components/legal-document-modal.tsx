"use client";

import { useId, useState } from "react";
import { recordLegalConsent } from "../_lib/legal-consent";
import type { LegalDocumentId } from "../_lib/legal-documents";
import { useSession } from "../_lib/use-session";
import { DialogShell } from "./dialog-shell";
import { LegalDocumentContent } from "./legal-document-content";

/**
 * Bir hukuki metnin (Gizlilik Politikası/Kullanım Koşulları/KVKK Aydınlatma
 * Metni) TEK ortak modalı — footer'daki bağlantılardan VE kayıt formundaki
 * üç tıklanabilir başlıktan (bkz. login-form.tsx) AYNI bileşen açılır, iki
 * ayrı modal/görünüm YOKTUR. `DialogShell`in mevcut `"md"` boyutu yerine
 * `"lg"` kullanır (bkz. dialog-shell.tsx) — uzun hukuki metin için daha
 * geniş ve kaydırılabilir bir kutu, ESC/dış tıklama/Kapat davranışı diğer
 * tüm modallarla birebir aynı kalır.
 *
 * `mode` iki kullanım senaryosunu AYNI bileşen/içerik üzerinden ayırır —
 * ikinci bir belge bileşeni/kopya içerik OLUŞTURULMAZ:
 *  - `"readonly"` (footer'daki "Yasal" bağlantıları, oturum açık olsun ya da
 *    olmasın): belge yalnızca okunur, alttaki "Okudum, anladım." kutusu ve
 *    "Onaylıyorum" butonu hiç RENDER edilmez — yalnızca "Kapat" kalır, hiçbir
 *    kabul kaydı üretilmez.
 *  - `"consent"` (kayıt formu, bkz. login-form.tsx): mevcut davranış birebir
 *    korunur — "Okudum, anladım." kutusu işaretlenmeden "Onaylıyorum" pasiftir.
 *    Onay verildiğinde `legal-consent.ts#recordLegalConsent` ile localStorage'a
 *    bu belgenin GÜNCEL sürümü için bir kabul kaydı yazılır (anonim kayıt
 *    formu akışında `null` kullanıcı kimliğiyle işaretlenir).
 * Her iki modda da "Kapat" hiçbir kayıt üretmeden (ESC/dış tıklama ile
 * birebir aynı) kapatır.
 */
export function LegalDocumentModal({
  documentId,
  mode,
  onClose,
  onAccepted,
}: {
  documentId: LegalDocumentId;
  /** "readonly": yalnızca okuma + Kapat. "consent": onay kutusu + Onaylıyorum (mevcut davranış). */
  mode: "readonly" | "consent";
  onClose: () => void;
  /**
   * İsteğe bağlı — yalnızca "Onaylıyorum" ile GERÇEK bir kabul verildiğinde
   * (Kapat/ESC/dış tıklamada ÇAĞRILMAZ) tetiklenir; `mode: "readonly"`de hiç
   * çağrılmaz (o modda "Onaylıyorum" zaten render edilmez). Kayıt formu bu
   * callback'i kullanmaz (formun kendi TEK birleşik onay kutusu üç metni
   * birden kapsar, bkz. login-form.tsx) — ileride bir ekranın "bu belgeyi az
   * önce kabul etti mi" bilgisine ihtiyaç duyması için hazır bırakılmıştır.
   */
  onAccepted?: () => void;
}) {
  const session = useSession();
  const titleId = useId();
  const [acknowledged, setAcknowledged] = useState(false);

  function handleAccept() {
    if (!acknowledged) return;
    recordLegalConsent(documentId, session?.id ?? null);
    onAccepted?.();
    onClose();
  }

  return (
    <DialogShell labelledBy={titleId} onClose={onClose} size="lg">
      <LegalDocumentContent documentId={documentId} titleId={titleId} />

      <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
        {mode === "consent" && (
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
            />
            <span className="text-sm leading-relaxed text-foreground">Okudum, anladım.</span>
          </label>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Kapat
          </button>
          {mode === "consent" && (
            <button
              type="button"
              onClick={handleAccept}
              disabled={!acknowledged}
              aria-disabled={!acknowledged}
              className="inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Onaylıyorum
            </button>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
