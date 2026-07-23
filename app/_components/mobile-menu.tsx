"use client";

import { Menu, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useDropdown } from "../_lib/use-dropdown";
import { useScrollLock } from "../_lib/use-scroll-lock";
import { HeaderAuthActions } from "./header-auth-actions";

// Panel açılana kadar (veya buton henüz ölçülemediyse) kullanılan tek
// kare süren yedek değer — panel o an zaten `opacity-0` olduğundan görünür
// değildir, bu yüzden 1px'lik hassasiyet önemli değil.
const FALLBACK_HEADER_HEIGHT_PX = 64;
// Hamburger butonunun alt kenarı ile panelin üst kenarı arasındaki, tasarıma
// uygun küçük boşluk.
const PANEL_GAP_PX = 4;

// `document.body` portal hedefi yalnızca client'ta var — SSR'da hiç
// render edilmemeli (hydration mismatch olmaması için sunucu anlık
// görüntüsü hep `false` döner). `useEffect` + `setState` yerine
// `useSyncExternalStore` kullanılıyor çünkü proje ESLint kuralı
// (`react-hooks/set-state-in-effect`) effect gövdesinde senkron
// `setState` çağrısını engelliyor — bu hiç değişmeyen bir "abonelik"
// olduğu için subscribe hiçbir zaman tetiklenmez.
function subscribeNever() {
  return () => {};
}
function getIsMountedSnapshot() {
  return true;
}
function getIsMountedServerSnapshot() {
  return false;
}

/**
 * Header artık layout.tsx içinde yaşadığı için sayfa geçişlerinde yeniden
 * monte olmuyor. Menü, linke tıklayınca, dışına/karartılmış alana
 * tıklayınca veya Escape'e basınca kapanır (kapatma mantığının çoğu
 * use-dropdown.ts'te — bildirim zili ve profil menüsü de aynı hook'u
 * kullanıyor). Panel + perde `document.body`'ye React portal ile render
 * edilir ki header'ın kendi `position`/`overflow`/`backdrop-filter`
 * zincirinden (containing-block bakımından) TAMAMEN bağımsız, saf
 * viewport-fixed konumlansınlar — bu yüzden `useDropdown`'a `portalRef`
 * `extraRefs` olarak veriliyor: portal içeriği artık gerçek DOM'da
 * `containerRef`'in (hamburger butonu) çocuğu DEĞİL, yoksa dışına-tıklama
 * algısı panelin kendi içeriğine tıklamayı da "dışarı" sayardı. Üst konum
 * sabit bir `rem` tahmini değil, her açılışta ve pencere yeniden
 * boyutlanırken/yön değişirken hamburger butonunun gerçek
 * `getBoundingClientRect().bottom` değeri + küçük bir boşlukla ölçülür.
 *
 * İçerik yalnızca hesap işlemlerinden ibarettir (bkz. HeaderAuthActions'ın
 * "mobile" dalı) — üst navigasyon bağlantısı veya CTA'sı hiç yok;
 * `site-header.tsx`'in orta bölümü artık boş, hiçbir oturumda bir şey
 * render etmiyor.
 */
export function MobileMenu() {
  const portalRef = useRef<HTMLDivElement>(null);
  // Ref nesnesinin kendisi (useRef sayesinde) render'lar arasında zaten
  // sabit — bu diziyi useMemo ile sabitlemek, useDropdown'un içindeki
  // effect'in yalnızca `open` gerçekten değiştiğinde yeniden abone
  // olmasını sağlar (her render'da yeni bir dizi literal'i geçmek yerine).
  const extraRefs = useMemo(() => [portalRef], []);
  const { open, setOpen, containerRef } = useDropdown<HTMLButtonElement>(extraRefs);
  useScrollLock(open);
  const mounted = useSyncExternalStore(
    subscribeNever,
    getIsMountedSnapshot,
    getIsMountedServerSnapshot,
  );
  const [panelTop, setPanelTop] = useState(FALLBACK_HEADER_HEIGHT_PX);

  useEffect(() => {
    if (!open) return;

    function measure() {
      const bottom = containerRef.current?.getBoundingClientRect().bottom;
      setPanelTop(bottom != null ? Math.round(bottom) + PANEL_GAP_PX : FALLBACK_HEADER_HEIGHT_PX);
    }

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open, containerRef]);

  function closeIfLinkClicked(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("a")) setOpen(false);
  }

  return (
    <>
      <button
        ref={containerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="mobil-menu-panel"
        className="flex h-10 w-10 items-center justify-center rounded-md border border-border text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 md:hidden"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
        <span className="sr-only">{open ? "Menüyü kapat" : "Menüyü aç"}</span>
      </button>

      {mounted &&
        createPortal(
          <div ref={portalRef} className="contents">
            {/* Karartılmış perde: header'ın gerçek alt kenarından başlar,
                sayfanın geri kalanını kaplar. Header'a değil, doğrudan
                viewport'a bağlıdır. */}
            <div
              aria-hidden="true"
              onClick={() => setOpen(false)}
              style={{ top: panelTop }}
              className={`fixed inset-x-0 bottom-0 z-40 bg-black/50 transition-opacity duration-200 ease-out motion-reduce:transition-none md:hidden ${
                open ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            />

            <div
              id="mobil-menu-panel"
              role="navigation"
              aria-label="Mobil menü"
              inert={!open}
              onClick={closeIfLinkClicked}
              style={{ top: panelTop, maxHeight: `calc(100dvh - ${panelTop}px)` }}
              className={`fixed inset-x-0 z-50 overflow-y-auto overscroll-contain border-b border-border bg-surface shadow-md transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none md:hidden ${
                open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
              }`}
            >
              <div className="flex flex-col gap-1 p-4">
                <HeaderAuthActions layout="mobile" />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
