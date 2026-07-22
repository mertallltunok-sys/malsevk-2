"use client";

import { useState } from "react";
import {
  DISAGREEMENT_REASON_OPTIONS,
  confirmCompletion,
  disputeCompletion,
  recordAgreementFailure,
  resolveCompletionDispute,
  startWorkForOffer,
} from "../_lib/offers";
import { getCompletionDeadlineIso } from "../_lib/time-remaining";
import type { DisagreementReason, Offer, Session } from "../_lib/types";
import { CompletionCountdown } from "./completion-countdown";
import { DialogShell } from "./dialog-shell";

const START_WORK_CONFIRM_TEXT =
  "Bu işin başladığını onaylıyor musunuz? Bu işlemden sonra ilan yeniden teklif alamaz.";
const AGREEMENT_FAILED_CONFIRM_TEXT =
  "Anlaşma sağlanamadığında bu ilan yeniden yayına alınacaktır. Önceki kabul edilen teklif kapanacak ve iletişim bilgileri tekrar gizlenecektir. Devam etmek istiyor musunuz?";
const CONFIRM_COMPLETION_TEXT =
  "İşin gerçekten tamamlandığını onaylıyor musunuz? Bu işlemden sonra iş kapanacak ve Hizmet Veren'in aktif iş kapasitesinden düşecektir.";
const RESOLVE_COMPLETED_TEXT = "Sonuç olarak işin tamamlandığını kabul ediyor musunuz?";
const RESOLVE_CANCELLED_TEXT = "Bu işi iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.";

function StartWorkDialog({
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell labelledBy="isebaslandi-baslik" onClose={onCancel}>
      <h2 id="isebaslandi-baslik" className="text-lg font-semibold text-foreground">
        İşe Başlandı
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{START_WORK_CONFIRM_TEXT}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "İşleniyor..." : "Evet, İşe Başlandı"}
        </button>
      </div>
    </DialogShell>
  );
}

function AgreementFailedDialog({
  reason,
  note,
  submitting,
  error,
  onReasonChange,
  onNoteChange,
  onConfirm,
  onCancel,
}: {
  reason: DisagreementReason | "";
  note: string;
  submitting: boolean;
  error: string | null;
  onReasonChange: (value: DisagreementReason) => void;
  onNoteChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell labelledBy="anlasma-saglanamadi-baslik" onClose={onCancel}>
      <h2 id="anlasma-saglanamadi-baslik" className="text-lg font-semibold text-foreground">
        Anlaşma Sağlanamadı
      </h2>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-foreground">Neden seçin</legend>
        <div className="mt-2 flex flex-col gap-2">
          {DISAGREEMENT_REASON_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm transition-colors ${
                reason === option.value
                  ? "border-primary bg-accent-soft text-primary"
                  : "border-border text-foreground hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="disagreement-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => onReasonChange(option.value)}
                className="h-4 w-4 accent-primary focus-visible:outline-none"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {reason === "diger" && (
        <div className="mt-4">
          <label htmlFor="disagreement-note" className="text-sm font-medium text-foreground">
            Kısa açıklama (opsiyonel)
          </label>
          <textarea
            id="disagreement-note"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            maxLength={500}
            rows={3}
            className="mt-2 w-full rounded-md border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      )}

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {AGREEMENT_FAILED_CONFIRM_TEXT}
      </p>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || !reason}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "İşleniyor..." : "Anlaşma Sağlanamadı Olarak İşaretle"}
        </button>
      </div>
    </DialogShell>
  );
}

/** İşe Başlandı/Tamamlandığını Onayla/Sonuç Belirle gibi tek adımlı onay diyalogları için ortak gövde. */
function SimpleConfirmDialog({
  labelledBy,
  title,
  message,
  confirmLabel,
  confirmingLabel,
  tone,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  labelledBy: string;
  title: string;
  message: string;
  confirmLabel: string;
  confirmingLabel: string;
  tone: "success" | "danger";
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell labelledBy={labelledBy} onClose={onCancel}>
      <h2 id={labelledBy} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className={
            tone === "success"
              ? "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
              : "inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {submitting ? confirmingLabel : confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

function DisputeCompletionDialog({
  note,
  submitting,
  error,
  onNoteChange,
  onConfirm,
  onCancel,
}: {
  note: string;
  submitting: boolean;
  error: string | null;
  onNoteChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <DialogShell labelledBy="itiraz-et-baslik" onClose={onCancel}>
      <h2 id="itiraz-et-baslik" className="text-lg font-semibold text-foreground">
        İtiraz Et
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Hizmet Veren&apos;in tamamlandı bildirimine itiraz ediyorsunuz. Lütfen nedenini kısaca
        açıklayın.
      </p>
      <div className="mt-4">
        <label htmlFor="itiraz-not" className="text-sm font-medium text-foreground">
          İtiraz Açıklaması
        </label>
        <textarea
          id="itiraz-not"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Örn: İş henüz tamamlanmadı, eksikler var..."
          className="mt-2 w-full rounded-md border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || note.trim().length < 10}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "İşleniyor..." : "İtiraz Et"}
        </button>
      </div>
    </DialogShell>
  );
}

type ModalState =
  | "none"
  | "start-work"
  | "agreement-failed"
  | "confirm-completion"
  | "dispute-completion"
  | "resolve-completed"
  | "resolve-cancelled";

/**
 * İş kabul edildikten sonraki tüm karar adımları — "Görüşme Sonucu"
 * (accepted), "Tamamlandı Onayı" (completion_requested) ve "İtiraz
 * Sonucu" (completion_disputed). Yalnızca çağıran taraf
 * (incoming-offer-card.tsx) bunu bu üç durumdan biri olduğunda render
 * eder — bu bileşenin kendisi ek bir görünürlük kontrolü yapmaz, tek
 * doğruluk kaynağı çağıranın kontrolüdür. Ayrıca yerel bir state
 * senkronizasyonu gerekmez: offers.ts yazma işlemleri `notify()` çağırır,
 * bu da `useAllOffers()`'ı (mevcut useSyncExternalStore zinciri) tetikleyip
 * ebeveyni yeniden render eder — `offer.status` değiştiğinde bu bileşen
 * doğru dalı kendiliğinden render eder ya da ağaçtan kalkar.
 *
 * `onCompleted`: yalnızca `confirmCompletion` GERÇEKTEN başarılı olduktan
 * SONRA (iş `completed` olduktan, kapasite/bildirim işlemleri tamamlandıktan
 * ve onay modalı kapandıktan sonra) çağrılır — hemen ardından açılması
 * gereken değerlendirme modalını tetiklemek için (bkz. incoming-offer-card.tsx/
 * job-requests-panel.tsx). Bu bileşen bilerek modalı kendisi açmaz: offer
 * "completed" olduğu an bu bileşen ENGAGED_OFFER_STATUSES dışına düştüğü
 * için çağıranın ağacından kalkar (bkz. yukarıdaki not) — yerel bir state
 * burada tutulsaydı değerlendirme modalı da onunla birlikte kaybolurdu. Bu
 * yüzden değerlendirme modalının state'i çağıranda (üst bileşende) tutulur.
 */
export function OfferOutcomePanel({
  offer,
  session,
  onCompleted,
}: {
  offer: Offer;
  session: Session;
  onCompleted?: (offer: Offer) => void;
}) {
  const [modal, setModal] = useState<ModalState>("none");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<DisagreementReason | "">("");
  const [note, setNote] = useState("");
  const [disputeNote, setDisputeNote] = useState("");

  function closeModal() {
    if (submitting) return;
    setModal("none");
    setError(null);
    setReason("");
    setNote("");
    setDisputeNote("");
  }

  function handleStartWork() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = startWorkForOffer(session, offer.id);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal("none");
  }

  function handleAgreementFailed() {
    if (submitting || !reason) return;
    setSubmitting(true);
    setError(null);
    const result = recordAgreementFailure(session, offer.id, reason, note);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal("none");
  }

  function handleConfirmCompletion() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = confirmCompletion(session, offer.id);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal("none");
    onCompleted?.(result.offer);
  }

  function handleDisputeCompletion() {
    if (submitting || disputeNote.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    const result = disputeCompletion(session, offer.id, disputeNote);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal("none");
  }

  function handleResolveDispute(resolution: "completed" | "cancelled") {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const result = resolveCompletionDispute(session, offer.id, resolution);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setModal("none");
  }

  if (offer.status === "accepted") {
    return (
      <div className="mt-4 rounded-card border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">Görüşme Sonucu</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          İletişim bilgileriniz karşı tarafla paylaşılmıştır. Görüşme sonucuna göre işlemin
          durumunu seçin.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setModal("start-work")}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İşe Başlandı
          </button>
          <button
            type="button"
            onClick={() => setModal("agreement-failed")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Anlaşma Sağlanamadı
          </button>
        </div>

        {modal === "start-work" && (
          <StartWorkDialog
            submitting={submitting}
            error={error}
            onConfirm={handleStartWork}
            onCancel={closeModal}
          />
        )}

        {modal === "agreement-failed" && (
          <AgreementFailedDialog
            reason={reason}
            note={note}
            submitting={submitting}
            error={error}
            onReasonChange={setReason}
            onNoteChange={setNote}
            onConfirm={handleAgreementFailed}
            onCancel={closeModal}
          />
        )}
      </div>
    );
  }

  if (offer.status === "completion_requested") {
    return (
      <div className="mt-4 rounded-card border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">Tamamlandı Onayı Bekleniyor</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Hizmet Veren işin tamamlandığını bildirdi. Kontrol edip onaylayın ya da bir sorun varsa
          itiraz edin.
        </p>
        {offer.completionRequestedAt && (
          <CompletionCountdown deadlineIso={getCompletionDeadlineIso(offer.completionRequestedAt)} />
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setModal("confirm-completion")}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Tamamlandığını Onayla
          </button>
          <button
            type="button"
            onClick={() => setModal("dispute-completion")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İtiraz Et
          </button>
        </div>

        {modal === "confirm-completion" && (
          <SimpleConfirmDialog
            labelledBy="tamamlandi-onayla-baslik"
            title="Tamamlandığını Onayla"
            message={CONFIRM_COMPLETION_TEXT}
            confirmLabel="Evet, Onaylıyorum"
            confirmingLabel="İşleniyor..."
            tone="success"
            submitting={submitting}
            error={error}
            onConfirm={handleConfirmCompletion}
            onCancel={closeModal}
          />
        )}

        {modal === "dispute-completion" && (
          <DisputeCompletionDialog
            note={disputeNote}
            submitting={submitting}
            error={error}
            onNoteChange={setDisputeNote}
            onConfirm={handleDisputeCompletion}
            onCancel={closeModal}
          />
        )}
      </div>
    );
  }

  if (offer.status === "completion_disputed") {
    return (
      <div className="mt-4 rounded-card border border-border bg-background p-4">
        <p className="text-sm font-semibold text-foreground">İtiraz Edildi</p>
        <p className="mt-1 break-words text-sm leading-relaxed text-muted-foreground">
          Bu iş için itiraz ettiniz
          {offer.completionDisputeNote ? `: "${offer.completionDisputeNote}"` : "."} Sonucu
          belirleyin.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setModal("resolve-completed")}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Tamamlandı Olarak Kapat
          </button>
          <button
            type="button"
            onClick={() => setModal("resolve-cancelled")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-danger px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            İşi İptal Et
          </button>
        </div>

        {modal === "resolve-completed" && (
          <SimpleConfirmDialog
            labelledBy="anlasmazlik-tamamlandi-baslik"
            title="Tamamlandı Olarak Kapat"
            message={RESOLVE_COMPLETED_TEXT}
            confirmLabel="Evet, Tamamlandı Olarak Kapat"
            confirmingLabel="İşleniyor..."
            tone="success"
            submitting={submitting}
            error={error}
            onConfirm={() => handleResolveDispute("completed")}
            onCancel={closeModal}
          />
        )}

        {modal === "resolve-cancelled" && (
          <SimpleConfirmDialog
            labelledBy="anlasmazlik-iptal-baslik"
            title="İşi İptal Et"
            message={RESOLVE_CANCELLED_TEXT}
            confirmLabel="Evet, İşi İptal Et"
            confirmingLabel="İşleniyor..."
            tone="danger"
            submitting={submitting}
            error={error}
            onConfirm={() => handleResolveDispute("cancelled")}
            onCancel={closeModal}
          />
        )}
      </div>
    );
  }

  return null;
}
