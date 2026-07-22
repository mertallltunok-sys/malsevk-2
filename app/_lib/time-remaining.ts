/**
 * Bir zaman damgasına (ör. tamamlanma talebi + 7 gün) kalan süreyi "X gün Y
 * saat" biçiminde formatlar. Saf bir fonksiyondur, `Date.now()` çağıranın
 * sorumluluğundadır (bkz. completion-countdown.tsx) — bu dosya bilerek
 * hiçbir yan etki (state, zamanlayıcı) içermez.
 */
import { COMPLETION_AUTO_APPROVE_DAYS, REOFFER_COOLDOWN_DAYS } from "./job-requests";

export type RemainingTime = {
  label: string;
  /** Son 24 saat içindeyse true — UI bunu farklı renkte gösterebilir. */
  isUrgent: boolean;
  isExpired: boolean;
};

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

export function computeRemainingTime(deadlineIso: string, nowMs: number = Date.now()): RemainingTime {
  const deadlineMs = new Date(deadlineIso).getTime();
  const diffMs = deadlineMs - nowMs;

  if (diffMs <= 0) {
    return { label: "Süre doldu", isUrgent: true, isExpired: true };
  }

  const totalMinutes = Math.floor(diffMs / ONE_MINUTE_MS);
  const days = Math.floor(diffMs / ONE_DAY_MS);
  const hours = Math.floor((diffMs % ONE_DAY_MS) / ONE_HOUR_MS);
  const minutes = totalMinutes % 60;
  const isUrgent = diffMs < ONE_DAY_MS;

  let label: string;
  if (days > 0) {
    label = `${days} gün ${hours} saat`;
  } else if (hours > 0) {
    label = `${hours} saat ${minutes} dakika`;
  } else {
    label = `${Math.max(minutes, 1)} dakika`;
  }

  return { label, isUrgent, isExpired: false };
}

/** `Offer.completionRequestedAt`'ten, otomatik tamamlanma son tarihini (COMPLETION_AUTO_APPROVE_DAYS sonrası) üretir. */
export function getCompletionDeadlineIso(completionRequestedAt: string): string {
  return new Date(
    new Date(completionRequestedAt).getTime() + COMPLETION_AUTO_APPROVE_DAYS * ONE_DAY_MS,
  ).toISOString();
}

/** `Offer.updatedAt`'ten (withdrawn/rejected/agreement_failed anı), yeniden teklife izin verilecek tarihi üretir. */
export function getReofferEligibleAtIso(updatedAt: string): string {
  return new Date(new Date(updatedAt).getTime() + REOFFER_COOLDOWN_DAYS * ONE_DAY_MS).toISOString();
}
