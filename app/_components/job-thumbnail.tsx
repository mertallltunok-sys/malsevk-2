"use client";

import { Anchor, HardHat, Package, Truck, Warehouse } from "lucide-react";
import Image from "next/image";
import { SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import type { JobPhoto } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";

const ICON_CLASS = "h-5 w-5 text-muted-foreground";

/**
 * service-catalog.ts#SERVICE_CATEGORY_GROUPS'a bakarak bir kategori id'sinin
 * ait olduğu grubun ikonunu render eder — yeni bir taksonomi eklenmez,
 * mevcut olan okunur. Her dal SABİT bir JSX etiketi döndürür (değişkene
 * atanmış bir bileşen render sırasında JSX etiketi olarak KULLANILMAZ) —
 * react-hooks/static-components kuralının aradığı desen budur.
 */
function CategoryFallbackIcon({ categoryId }: { categoryId: string }) {
  const group = SERVICE_CATEGORY_GROUPS.find((candidate) =>
    candidate.categories.some((category) => category.id === categoryId),
  );

  switch (group?.id) {
    case "liman-hizmetleri":
      return <Anchor className={ICON_CLASS} aria-hidden="true" />;
    case "depo-hizmetleri":
      return <Warehouse className={ICON_CLASS} aria-hidden="true" />;
    case "is-makinesi-hizmetleri":
      return <Truck className={ICON_CLASS} aria-hidden="true" />;
    case "operator-hizmetleri":
      return <HardHat className={ICON_CLASS} aria-hidden="true" />;
    default:
      return <Package className={ICON_CLASS} aria-hidden="true" />;
  }
}

/**
 * İlanın kapak fotoğrafı için sabit boyutlu (CLS oluşturmayan), tembel
 * yüklenen thumbnail: fotoğraf hiç yoksa hizmet grubuna göre bir ikon,
 * fotoğraf çözülene kadar (bkz. use-job-photo-url.ts, IndexedDB'den
 * asenkron okuma) bir iskelet (skeleton) — bu ikiyi ayrı durumlar olarak
 * ele alır (job-photo-gallery.tsx'teki PhotoImage ikisini "url yok" olarak
 * birleştirir, tek fotoğraflu galeri için sorun değildir ama onlarca satırın
 * aynı anda yüklendiği bir listede "yükleniyor" ile "fotoğraf yok" farkı
 * görsel olarak önemlidir). Birden fazla fotoğraf varsa "+N" rozeti.
 * `unoptimized`/`animate-photo-fade` deseni job-photo-gallery.tsx ile aynı
 * (blob: URL'ler next/image tarafından sunucuda optimize edilemez).
 */
export function JobThumbnail({
  photo,
  photoCount,
  category,
  alt,
  size = 64,
}: {
  photo: JobPhoto | null;
  photoCount: number;
  category: string;
  alt: string;
  size?: 64 | 72;
}) {
  const url = useJobPhotoUrl(photo?.storageKey ?? null);

  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-md border border-border bg-background"
      style={{ width: size, height: size }}
    >
      {!photo ? (
        <div className="flex h-full w-full items-center justify-center">
          <CategoryFallbackIcon categoryId={category} />
        </div>
      ) : !url ? (
        <div className="h-full w-full animate-pulse bg-border/60" aria-hidden="true" />
      ) : (
        <Image
          src={url}
          alt={alt}
          fill
          unoptimized
          loading="lazy"
          sizes={`${size}px`}
          className="object-cover animate-photo-fade motion-reduce:animate-none"
        />
      )}

      {photoCount > 1 && (
        <span
          className="absolute bottom-0.5 right-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground"
          aria-hidden="true"
        >
          +{photoCount - 1}
        </span>
      )}
    </div>
  );
}
