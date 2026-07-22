/** Bildirim silme animasyonu gibi JS-tetiklemeli geçişlerin süresini kısmak için — CSS `motion-reduce:` varyantının tek doğruluk kaynağı olarak JS tarafındaki eşdeğeri. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
