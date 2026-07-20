"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Dışına tıklama ve Escape ile kapanan, tetikleyicisine tekrar
 * basıldığında da kapanabilen açılır menü/panel davranışı. Mobil menü ve
 * profil/bildirim menüleri aynı mantığı paylaşır.
 */
export function useDropdown<T extends HTMLElement = HTMLDivElement>(): {
  open: boolean;
  setOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  containerRef: RefObject<T | null>;
} {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
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
  }, [open]);

  return { open, setOpen, containerRef };
}
