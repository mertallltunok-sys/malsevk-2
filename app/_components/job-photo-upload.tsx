"use client";

import { ImagePlus, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ACCEPTED_FILE_INPUT,
  DUPLICATE_PHOTO_MESSAGE,
  MAX_PHOTOS,
  MAX_PHOTO_SIZE_BYTES,
  hashFileContent,
  validatePhotoFile,
} from "../_lib/photo-validation";
import { JobPhotoCard } from "./job-photo-card";

export type ReadyJobPhoto = {
  blob: Blob;
  mimeType: string;
  fileName: string;
  fileSize: number;
};

type PhotoItem = {
  clientId: string;
  fileName: string;
  fileSize: number;
  contentHash: string;
  status: "processing" | "ready" | "error";
  errorMessage?: string;
  processed?: { blob: Blob; mimeType: string; previewUrl: string };
};

async function uploadAndProcess(
  file: File,
  role: string,
): Promise<{ ok: true; blob: Blob; mimeType: string } | { ok: false; error: string }> {
  const formData = new FormData();
  formData.append("role", role);
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/job-photos/process", { method: "POST", body: formData });
  } catch {
    return { ok: false, error: "Fotoğraf işlenirken bir sorun oluştu. Lütfen tekrar deneyin." };
  }

  if (!response.ok) {
    let error = "Fotoğraf işlenirken bir sorun oluştu. Lütfen tekrar deneyin.";
    try {
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string") {
        error = (data as { error: string }).error;
      }
    } catch {
      // yanıt gövdesi ayrıştırılamadı, genel mesaj kullanılır
    }
    return { ok: false, error };
  }

  const blob = await response.blob();
  const mimeType = response.headers.get("Content-Type") ?? blob.type;
  return { ok: true, blob, mimeType };
}

export function JobPhotoUpload({
  role,
  onPhotosChange,
  onBusyChange,
  disabled = false,
  errorId,
}: {
  role: string;
  onPhotosChange: (photos: ReadyJobPhoto[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  errorId?: string;
}) {
  const [items, setItems] = useState<PhotoItem[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<PhotoItem[]>(items);

  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) {
        if (item.processed) URL.revokeObjectURL(item.processed.previewUrl);
      }
    };
  }, []);

  // İlgili tüketici bileşene (JobRequestForm) bildirim, `items` her
  // değiştiğinde bir efekt aracılığıyla yapılır — bir state güncelleyicisi
  // (setItems) İÇİNDEN farklı bir bileşenin state'ini senkron olarak
  // güncellemek React tarafından hatalı kabul edilir ("Cannot update a
  // component while rendering a different component").
  useEffect(() => {
    const ready = items
      .filter((item) => item.status === "ready" && item.processed)
      .map((item) => ({
        blob: item.processed!.blob,
        mimeType: item.processed!.mimeType,
        fileName: item.fileName,
        fileSize: item.processed!.blob.size,
      }));
    onPhotosChange(ready);
    onBusyChange?.(items.some((item) => item.status === "processing"));
  }, [items, onPhotosChange, onBusyChange]);

  const processOne = useCallback(
    async (clientId: string, file: File) => {
      const result = await uploadAndProcess(file, role);
      setItems((current) => {
        if (result.ok) {
          const previewUrl = URL.createObjectURL(result.blob);
          return current.map((item) =>
            item.clientId === clientId
              ? { ...item, status: "ready", processed: { blob: result.blob, mimeType: result.mimeType, previewUrl } }
              : item,
          );
        }
        setUploadErrors((errors) => [...errors, `${file.name}: ${result.error}`]);
        return current.filter((item) => item.clientId !== clientId);
      });
    },
    [role],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (disabled) return;
      const incoming = Array.from(fileList);
      const errors: string[] = [];
      const toQueue: { file: File; hash: string }[] = [];
      const currentCount = itemsRef.current.length;
      const knownHashes = new Set(itemsRef.current.map((item) => item.contentHash));

      for (const file of incoming) {
        if (currentCount + toQueue.length >= MAX_PHOTOS) {
          errors.push(`En fazla ${MAX_PHOTOS} fotoğraf yükleyebilirsiniz.`);
          break;
        }

        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const fileCheck = validatePhotoFile({ size: file.size }, header);
        if (!fileCheck.ok) {
          errors.push(`${file.name}: ${fileCheck.error}`);
          continue;
        }

        const fullBytes = await file.arrayBuffer();
        const hash = await hashFileContent(fullBytes);
        if (knownHashes.has(hash)) {
          errors.push(`${file.name}: ${DUPLICATE_PHOTO_MESSAGE}`);
          continue;
        }

        knownHashes.add(hash);
        toQueue.push({ file, hash });
      }

      if (errors.length > 0) setUploadErrors((current) => [...current, ...errors]);
      if (toQueue.length === 0) return;

      const newItems: PhotoItem[] = toQueue.map(({ file, hash }) => ({
        clientId: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        contentHash: hash,
        status: "processing",
      }));

      setItems((current) => [...current, ...newItems]);

      for (let i = 0; i < newItems.length; i++) {
        void processOne(newItems[i].clientId, toQueue[i].file);
      }
    },
    [disabled, processOne],
  );

  function handleDelete(clientId: string) {
    setItems((current) => {
      const target = current.find((item) => item.clientId === clientId);
      if (target?.processed) URL.revokeObjectURL(target.processed.previewUrl);
      return current.filter((item) => item.clientId !== clientId);
    });
  }

  function handleMove(clientId: string, direction: -1 | 1) {
    setItems((current) => {
      const index = current.findIndex((item) => item.clientId === clientId);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = current.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void handleFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (disabled) return;
    if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
  }

  const readyOrProcessingCount = items.length;

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragActive ? "border-primary bg-accent-soft" : "border-border bg-surface"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Fotoğrafları buraya sürükleyin veya dosya seçin.
        </p>
        <label
          htmlFor={inputId}
          className={`inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent ${
            disabled ? "pointer-events-none" : "cursor-pointer"
          }`}
        >
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
          Dosya Seç
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPTED_FILE_INPUT}
          disabled={disabled}
          onChange={handleInputChange}
          aria-describedby={errorId}
          className="sr-only"
        />
        <p className="text-xs text-muted-foreground">
          {readyOrProcessingCount} / {MAX_PHOTOS} fotoğraf yüklendi · JPG, PNG, WEBP, HEIC/HEIF ·
          en fazla {Math.round(MAX_PHOTO_SIZE_BYTES / (1024 * 1024))} MB
        </p>
      </div>

      {uploadErrors.length > 0 && (
        <ul role="alert" className="mt-3 flex flex-col gap-1">
          {uploadErrors.map((message, index) => (
            <li key={`${message}-${index}`} className="text-sm text-danger">
              {message}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <JobPhotoCard
              key={item.clientId}
              previewUrl={item.processed?.previewUrl ?? null}
              fileName={item.fileName}
              fileSize={item.processed?.blob.size ?? item.fileSize}
              isCover={index === 0}
              status={item.status}
              errorMessage={item.errorMessage}
              onDelete={() => handleDelete(item.clientId)}
              onMoveUp={() => handleMove(item.clientId, -1)}
              onMoveDown={() => handleMove(item.clientId, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

