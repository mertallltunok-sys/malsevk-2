import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";
import { formatFileSize } from "../_lib/photo-validation";

export function JobPhotoCard({
  previewUrl,
  fileName,
  fileSize,
  isCover,
  status,
  errorMessage,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  previewUrl: string | null;
  fileName: string;
  fileSize: number;
  isCover: boolean;
  status: "processing" | "ready" | "error";
  errorMessage?: string;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  return (
    <div
      data-photo-filename={fileName}
      className="relative flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md"
    >
      {isCover && status !== "error" && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
          Kapak Fotoğrafı
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        aria-label={`${fileName} fotoğrafını sil`}
        className="absolute right-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-8 sm:w-8"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      <div className="flex aspect-square w-full items-center justify-center bg-background">
        {status === "processing" && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        )}
        {status === "error" && (
          <ImageOff className="h-8 w-8 text-danger" aria-hidden="true" />
        )}
        {status === "ready" && previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- yerel blob/object URL, next/image optimizasyonuna uygun değil
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>

      <div className="flex flex-col gap-1 p-3">
        <p className="truncate text-xs font-medium text-foreground" title={fileName}>
          {fileName}
        </p>
        {status === "error" ? (
          <p className="text-xs text-danger">{errorMessage ?? "Fotoğraf işlenemedi."}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{formatFileSize(fileSize)}</p>
        )}
      </div>

      {(onMoveUp || onMoveDown) && status === "ready" && (
        <div className="flex items-center justify-center gap-1 border-t border-border p-1.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            aria-label="Sırada öne al"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 sm:h-7 sm:w-7"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            aria-label="Sırada geri al"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40 sm:h-7 sm:w-7"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
