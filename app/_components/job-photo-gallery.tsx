"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { JobPhoto } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";

/**
 * `storageKey`, IndexedDB'de (photo-blob-store.ts) tutulan bir blob'a işaret
 * eder; `useJobPhotoUrl` bunu bir `blob:` object URL'ine çözer. next/image
 * bu URL'i sunucu tarafında yeniden boyutlandıramaz (blob URL yalnızca bu
 * sekmenin belleğinde anlamlıdır) — bu yüzden `unoptimized` zorunludur.
 * Gerçek optimizasyon zaten yükleme sırasında sunucuda (api/job-photos/process,
 * sharp ile) yapılıyor; burada next/image yalnızca lazy/priority yükleme ve
 * düzen kararlılığı (`fill`) için kullanılıyor.
 */
function PhotoImage({
  storageKey,
  alt,
  priority = false,
  sizes,
  className,
}: {
  storageKey: string;
  alt: string;
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const url = useJobPhotoUrl(storageKey);
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  return (
    <Image
      src={url}
      alt={alt}
      fill
      unoptimized
      priority={priority}
      sizes={sizes}
      className={className}
    />
  );
}

/**
 * Ana fotoğraf değişirken çok hafif bir fade-in uygular. `key={photo.id}`
 * fotoğraf değiştiğinde bu elemanı yeniden mount eder, `animate-photo-fade`
 * (globals.css, yalnızca 300ms'lik bir opacity geçişi) her mount'ta baştan
 * oynar — React state/effect gerekmez.
 */
function MainPhoto({
  photo,
  alt,
  priority,
}: {
  photo: JobPhoto;
  alt: string;
  priority: boolean;
}) {
  return (
    <PhotoImage
      key={photo.id}
      storageKey={photo.storageKey}
      alt={alt}
      priority={priority}
      sizes="(min-width: 1024px) 900px, 100vw"
      className="animate-photo-fade object-contain motion-reduce:animate-none"
    />
  );
}

/**
 * Büyük ana fotoğraf yalnızca görüntülenir — tıklanamaz, büyümez, lightbox/
 * modal açmaz. Fotoğrafı değiştirmenin TEK yolu alttaki küçük önizlemelere
 * tıklamaktır (bkz. proje talimatı: "sadece küçük fotoğraflara tıklanınca
 * büyük fotoğraf değişsin").
 */
export function JobPhotoGallery({ photos, jobTitle }: { photos: JobPhoto[]; jobTitle: string }) {
  const sorted = [...photos].sort((a, b) => a.order - b.order);
  const [activeIndex, setActiveIndex] = useState(0);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface p-10 text-center">
        <ImageOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Bu ilan için fotoğraf eklenmemiş.</p>
      </div>
    );
  }

  const activePhoto = sorted[activeIndex];

  return (
    <div>
      {/* Masaüstünde (lg+) sabit yükseklik — ilan detay sayfası masaüstü
          tek-ekran yoğunlaştırma görevi (3. tur): başlık artık AYRI bir
          şeride taşındığı için (bkz. job-detail-content.tsx) bu kart,
          fotoğraf+bilgi satırının EN UZUN elemanı hâline geldi — satırın
          (dolayısıyla sayfanın) toplam yüksekliğini DOĞRUDAN belirliyor
          (gerçek Playwright ölçümüyle doğrulandı: 240px azaltma, ölçülen
          sayfa yüksekliğini BİREBİR aynı miktarda düşürdü). Bu yüzden
          bilerek "yaklaşık 300-320px" hedefinin altında, 230-260px
          aralığında tutuluyor — 1366×768'de sıfır kaydırma önceliği,
          görsel referansın tam fotoğraf yüksekliğinden daha ağır basıyor
          (bkz. proje raporu, çelişki çözümü). `aspect-video`in genişliğe
          bağımlı, kontrolsüz büyüyen yüksekliği yerine geçer. `object-contain`
          korunur (kırpma/bozulma yok) — dikey/geniş fotoğraflar bu sabit
          kutu içinde mektup kutusu gibi (letterbox) görünür, hiçbir zaman
          kırpılmaz. Mobil/tablette (`lg` altı) davranış DEĞİŞMEDİ. */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-background lg:aspect-auto lg:h-[230px] xl:h-[245px] 2xl:h-[260px]">
        <MainPhoto
          photo={activePhoto}
          alt={`${jobTitle} - fotoğraf ${activeIndex + 1}`}
          priority={activeIndex === 0}
        />
      </div>

      {sorted.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Fotoğraf küçük resimleri">
          {sorted.map((photo, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={photo.id}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`${index + 1}. fotoğrafı göster`}
                aria-current={isActive ? "true" : undefined}
                className={`relative h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isActive ? "border-primary" : "border-border hover:border-primary/40"
                }`}
              >
                <PhotoImage
                  storageKey={photo.storageKey}
                  alt={`${jobTitle} - küçük fotoğraf ${index + 1}`}
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
