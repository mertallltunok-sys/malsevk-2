"use client";

import { useEffect, useState } from "react";
import { getPhotoBlob } from "./photo-blob-store";
import { SUPABASE_PUBLIC_PHOTO_PREFIX } from "./supabase-job-reads";

/**
 * Bir JobPhoto.storageKey'ini, IndexedDB'den okunan blob'dan üretilmiş bir
 * object URL'e çözer. Bileşen unmount olduğunda veya storageKey değiştiğinde
 * eski URL bellek sızıntısı olmaması için serbest bırakılır (revoke edilir).
 *
 * `SUPABASE_PUBLIC_PHOTO_PREFIX` ile başlayan bir storageKey — yalnızca
 * `supabase-job-reads.ts`in ürettiği, bu tarayıcının IndexedDB'sinde hiç
 * blob'u olmayan (yerelde hiç oluşturulmamış, yalnızca Supabase Storage'ta
 * var olan) bir ilanın fotoğrafı için — hiç IndexedDB'ye bakmadan, önekten
 * sonraki genel URL'i olduğu gibi döner. Bu SAF/senkron dönüşüm bilerek
 * effect'in DIŞINDA, render gövdesinde yapılır (`react-hooks/set-state-in-effect`
 * kuralı zaten bir effect'in gövdesinde doğrudan senkron `setState`i
 * yasaklıyor — burada da gerçek bir dış sisteme abone olma/asenkron iş
 * yok, yalnızca bir string dönüşümü, bu yüzden bir effect'e hiç gerek yok).
 * Bu tek dal dışında hiçbir mevcut çağıran (gerçek IndexedDB storageKey'leri)
 * etkilenmez.
 */
export function useJobPhotoUrl(storageKey: string | null): string | null {
  const isSupabasePublicUrl = storageKey?.startsWith(SUPABASE_PUBLIC_PHOTO_PREFIX) ?? false;
  const indexedDbKey = isSupabasePublicUrl ? null : storageKey;

  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!indexedDbKey) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    getPhotoBlob(indexedDbKey)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setResolved({ key: indexedDbKey, url: objectUrl });
      })
      .catch(() => {
        // çözülemedi; render sırasında null döndürülmeye devam eder
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [indexedDbKey]);

  if (!storageKey) return null;
  if (isSupabasePublicUrl) return storageKey.slice(SUPABASE_PUBLIC_PHOTO_PREFIX.length);
  return resolved?.key === storageKey ? resolved.url : null;
}
