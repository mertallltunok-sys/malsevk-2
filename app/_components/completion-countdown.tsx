"use client";

import { useEffect, useState } from "react";
import { computeRemainingTime, type RemainingTime } from "../_lib/time-remaining";

const UPDATE_INTERVAL_MS = 60 * 1000;

/**
 * "completion_requested" durumundaki bir teklif için otomatik tamamlanmaya
 * kalan süreyi gösterir. Bu bileşen SAYAÇ'tır — yalnızca UI'dır, hiçbir iş
 * kuralını değiştirmez; gerçek otomatik geçişi
 * offers.ts#applyExpiredCompletionAutoApprovals yapar (bkz. use-offers.ts).
 * `Date.now()` istemciye özgü olduğu için (server/client hydration
 * uyuşmazlığı olmasın diye) ilk render'da hiçbir şey göstermez — değer
 * yalnızca mount sonrası dolar, dakikada bir güncellenir.
 */
export function CompletionCountdown({ deadlineIso }: { deadlineIso: string }) {
  const [remaining, setRemaining] = useState<RemainingTime | null>(null);

  useEffect(() => {
    function tick() {
      setRemaining(computeRemainingTime(deadlineIso));
    }
    // İlk değer de (mount anında) bir zamanlayıcı geri çağrısı üzerinden
    // set edilir — effect gövdesinde doğrudan senkron setState çağrısından
    // kaçınmak için (bkz. react-hooks/set-state-in-effect).
    const immediate = setTimeout(tick, 0);
    const interval = setInterval(tick, UPDATE_INTERVAL_MS);
    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [deadlineIso]);

  if (!remaining) return null;

  return (
    <p className={`mt-2 text-sm font-medium ${remaining.isUrgent ? "text-danger" : "text-warning"}`}>
      Kalan Süre: {remaining.label}
    </p>
  );
}
