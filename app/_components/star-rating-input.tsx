"use client";

import { Star } from "lucide-react";
import { useState } from "react";

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

/**
 * Sade 1-5 yıldız puanlama girişi (bkz. Bölüm 8) — alt kategori yok, yalnızca
 * yıldızlar. Boş yıldız: şeffaf iç + belirgin altın sarısı kontur. Dolu
 * yıldız: altın sarısı. Hover ile önizleme animasyonu vardır.
 */
export function StarRatingInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const displayValue = hovered ?? value;

  return (
    <div
      className="flex items-center gap-1"
      onMouseLeave={() => setHovered(null)}
      role="radiogroup"
      aria-label="Hizmet puanı"
    >
      {STAR_VALUES.map((star) => {
        const filled = star <= displayValue;
        return (
          <button
            key={star}
            type="button"
            disabled={disabled}
            onMouseEnter={() => setHovered(star)}
            onFocus={() => setHovered(star)}
            onBlur={() => setHovered(null)}
            onClick={() => onChange(star)}
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} yıldız`}
            className="rounded-sm p-1 transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            <Star
              className="h-8 w-8 text-rating transition-colors"
              fill={filled ? "currentColor" : "transparent"}
              strokeWidth={1.75}
            />
          </button>
        );
      })}
    </div>
  );
}
