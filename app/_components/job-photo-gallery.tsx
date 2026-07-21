"use client";

import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { JobPhoto } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";

const SWIPE_THRESHOLD_PX = 40;

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
      sizes="(min-width: 1024px) 768px, 100vw"
      className="animate-photo-fade object-cover"
    />
  );
}

export function JobPhotoGallery({ photos, jobTitle }: { photos: JobPhoto[]; jobTitle: string }) {
  const sorted = [...photos].sort((a, b) => a.order - b.order);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (lightboxOpen) dialogRef.current?.focus();
  }, [lightboxOpen]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border bg-surface p-10 text-center">
        <ImageOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Bu ilan için fotoğraf eklenmemiş.</p>
      </div>
    );
  }

  function clampIndex(index: number): number {
    return Math.min(Math.max(index, 0), sorted.length - 1);
  }
  function showNext() {
    setActiveIndex((current) => clampIndex(current + 1));
  }
  function showPrevious() {
    setActiveIndex((current) => clampIndex(current - 1));
  }

  function handleTouchStart(event: React.TouchEvent) {
    touchStartX.current = event.touches[0].clientX;
  }
  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current === null) return;
    const deltaX = event.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (deltaX > SWIPE_THRESHOLD_PX) showPrevious();
    else if (deltaX < -SWIPE_THRESHOLD_PX) showNext();
  }

  const activePhoto = sorted[activeIndex];

  return (
    <div>
      <button
        type="button"
        onClick={() => setLightboxOpen(true)}
        aria-label={`Fotoğrafı büyüt (${activeIndex + 1}/${sorted.length}): ${jobTitle}`}
        className="relative block aspect-video w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MainPhoto
          photo={activePhoto}
          alt={`${jobTitle} - fotoğraf ${activeIndex + 1}`}
          priority={activeIndex === 0}
        />
      </button>

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
                className={`relative h-16 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-20 sm:w-20 ${
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

      {lightboxOpen && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Fotoğraf görüntüleyici"
          tabIndex={-1}
          onClick={() => setLightboxOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLightboxOpen(false);
            if (event.key === "ArrowRight") showNext();
            if (event.key === "ArrowLeft") showPrevious();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 focus:outline-none"
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Kapat"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          {activeIndex > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showPrevious();
              }}
              aria-label="Önceki fotoğraf"
              className="absolute left-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {activeIndex < sorted.length - 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showNext();
              }}
              aria-label="Sonraki fotoğraf"
              className="absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          <div
            onClick={(event) => event.stopPropagation()}
            className="relative h-[85vh] max-h-full w-full max-w-4xl"
          >
            <PhotoImage
              storageKey={activePhoto.storageKey}
              alt={`${jobTitle} - fotoğraf ${activeIndex + 1}`}
              sizes="100vw"
              className="rounded-lg object-contain"
            />
          </div>

          <p className="absolute bottom-4 text-sm text-white/80">
            {activeIndex + 1} / {sorted.length}
          </p>
        </div>
      )}
    </div>
  );
}
