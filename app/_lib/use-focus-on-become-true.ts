import { useEffect, useRef } from "react";

/**
 * Bir koşul false'tan true'ya geçtiğinde (İLK render'da DEĞİL — bir ilan
 * düzenlenirken başlangıç durumu zaten true olsa bile sayfa yüklenir
 * yüklenmez odak çalınmaz) döndürülen ref'in bağlı olduğu elemana kaydırıp
 * odaklanır. "Liman / Sanayi / OSB" seçicisinde "Listede yok, kendim
 * gireceğim" seçildiğinde ortaya çıkan manuel ad input'una otomatik
 * odaklanmak için kullanılır — nakliye-location-fields.tsx (Nakliye'nin Yük
 * Alınacak Yer/Teslim Edilecek Yer'i) VE Nakliye dışındaki kategorilerin
 * kendi konum alanı (job-request-form.tsx/job-edit-form.tsx) AYNI bu hook'u
 * paylaşır — davranış üç çağıran arasında asla farklılaşamaz.
 */
export function useFocusOnBecomeTrue<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    if (active) {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      ref.current?.focus({ preventScroll: true });
    }
  }, [active]);

  return ref;
}
