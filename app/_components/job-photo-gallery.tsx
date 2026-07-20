"use client";

import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JobPhoto } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";

function PhotoImage({
  storageKey,
  alt,
  className,
}: {
  storageKey: string;
  alt: string;
  className?: string;
}) {
  const url = useJobPhotoUrl(storageKey);
  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-background ${className ?? ""}`}>
        <ImageOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- yerel IndexedDB blob'undan üretilmiş object URL
  return <img src={url} alt={alt} className={className} />;
}

export function JobPhotoGallery({ photos, jobTitle }: { photos: JobPhoto[]; jobTitle: string }) {
  const sorted = [...photos].sort((a, b) => a.order - b.order);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (lightboxIndex !== null) dialogRef.current?.focus();
  }, [lightboxIndex]);

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-card border border-dashed border-border bg-surface p-10 text-sm text-muted-foreground">
        Bu ilan için fotoğraf eklenmemiş.
      </div>
    );
  }

  const cover = sorted[0];
  const rest = sorted.slice(1);

  return (
    <div>
      <button
        type="button"
        onClick={() => setLightboxIndex(0)}
        className="block w-full overflow-hidden rounded-xl border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <PhotoImage
          storageKey={cover.storageKey}
          alt={`${jobTitle} - kapak fotoğrafı`}
          className="aspect-video w-full object-cover"
        />
      </button>

      {rest.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {rest.map((photo, index) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setLightboxIndex(index + 1)}
              className="aspect-square overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <PhotoImage
                storageKey={photo.storageKey}
                alt={`${jobTitle} - fotoğraf ${index + 2}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {lightboxIndex !== null && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Fotoğraf görüntüleyici"
          tabIndex={-1}
          onClick={() => setLightboxIndex(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLightboxIndex(null);
            if (event.key === "ArrowRight") {
              setLightboxIndex((current) =>
                current === null ? current : Math.min(current + 1, sorted.length - 1),
              );
            }
            if (event.key === "ArrowLeft") {
              setLightboxIndex((current) => (current === null ? current : Math.max(current - 1, 0)));
            }
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 focus:outline-none"
        >
          <button
            type="button"
            onClick={() => setLightboxIndex(null)}
            aria-label="Kapat"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>

          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setLightboxIndex((current) => (current === null ? current : current - 1));
              }}
              aria-label="Önceki fotoğraf"
              className="absolute left-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          {lightboxIndex < sorted.length - 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setLightboxIndex((current) => (current === null ? current : current + 1));
              }}
              aria-label="Sonraki fotoğraf"
              className="absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          )}

          <div onClick={(event) => event.stopPropagation()} className="max-h-full max-w-full">
            <PhotoImage
              storageKey={sorted[lightboxIndex].storageKey}
              alt={`${jobTitle} - fotoğraf ${lightboxIndex + 1}`}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
          </div>

          <p className="absolute bottom-4 text-sm text-white/80">
            {lightboxIndex + 1} / {sorted.length}
          </p>
        </div>
      )}
    </div>
  );
}
