"use client";

import { useEffect, useState } from "react";
import { getPhotoBlob } from "./photo-blob-store";

/**
 * Bir JobPhoto.storageKey'ini, IndexedDB'den okunan blob'dan üretilmiş bir
 * object URL'e çözer. Bileşen unmount olduğunda veya storageKey değiştiğinde
 * eski URL bellek sızıntısı olmaması için serbest bırakılır (revoke edilir).
 */
export function useJobPhotoUrl(storageKey: string | null): string | null {
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!storageKey) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    getPhotoBlob(storageKey)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ key: storageKey, url: objectUrl });
      })
      .catch(() => {
        // çözülemedi; render sırasında null döndürülmeye devam eder
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [storageKey]);

  if (!storageKey || resolved?.key !== storageKey) return null;
  return resolved.url;
}
