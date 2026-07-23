"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Dışına tıklama ve Escape ile kapanan, tetikleyicisine tekrar
 * basıldığında da kapanabilen açılır menü/panel davranışı. Mobil menü ve
 * profil/bildirim menüleri aynı mantığı paylaşır.
 *
 * `extraRefs`: React portal ile `document.body`'ye taşınan içerik (ör.
 * mobil menü paneli), gerçek DOM'da artık `containerRef`'in içinde
 * DEĞİLDİR — `Node.contains()` onu "dışarı" sayar. Bu tür bir portal
 * kökü varsa buraya ekleyin ki dışına-tıklama algısı yanlışlıkla panelin
 * kendi içeriğine tıklamayı da "dışarı" saymasın.
 */
export function useDropdown<T extends HTMLElement = HTMLDivElement>(
  extraRefs: RefObject<HTMLElement | null>[] = [],
): {
  open: boolean;
  setOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  containerRef: RefObject<T | null>;
} {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const insideContainer = containerRef.current?.contains(target) ?? false;
      const insideExtra = extraRefs.some((ref) => ref.current?.contains(target));
      if (!insideContainer && !insideExtra) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, extraRefs]);

  return { open, setOpen, containerRef };
}
