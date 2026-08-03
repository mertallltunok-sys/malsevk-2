"use client";

import { FileUp, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ALLOWED_EXTENSIONS,
  MAX_DOCUMENTS,
  MAX_DOCUMENT_SIZE_BYTES,
  getFileExtension,
  isAllowedDocumentExtension,
  isPreviewableImageExtension,
  validateDocumentClientSide,
  type DocumentExtension,
} from "../_lib/document-validation";
import { deletePhotoBlob, putPhotoBlob } from "../_lib/photo-blob-store";
import { ProviderDocumentCard } from "./provider-document-card";

/** Kayıt formunun (login-form.tsx) elinde tuttuğu, artık IndexedDB'ye yazılmış ve sunucu tarafından doğrulanmış belge. */
export type ReadyProviderDocument = {
  clientId: string;
  indexedDbStorageKey: string;
  originalFileName: string;
  mimeType: string;
  extension: string;
  size: number;
};

type DocumentItem = {
  clientId: string;
  fileName: string;
  fileSize: number;
  status: "validating" | "ready" | "error";
  errorMessage?: string;
  ready?: {
    storageKey: string;
    mimeType: string;
    extension: string;
    previewUrl: string | null;
  };
};

async function validateOnServer(
  file: File,
): Promise<{ ok: true; sanitizedFileName: string; mimeType: string; extension: string } | { ok: false; error: string }> {
  const formData = new FormData();
  formData.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/provider-documents/validate", { method: "POST", body: formData });
  } catch {
    return { ok: false, error: "Belge doğrulanırken bir sorun oluştu. Lütfen tekrar deneyin." };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: "Belge doğrulanırken bir sorun oluştu. Lütfen tekrar deneyin." };
  }

  if (!response.ok || typeof data !== "object" || data === null || (data as { ok?: unknown }).ok !== true) {
    const error =
      typeof data === "object" && data !== null && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Belge doğrulanırken bir sorun oluştu. Lütfen tekrar deneyin.";
    return { ok: false, error };
  }

  const result = data as { sanitizedFileName: string; mimeType: string; extension: string };
  return { ok: true, sanitizedFileName: result.sanitizedFileName, mimeType: result.mimeType, extension: result.extension };
}

/**
 * Faaliyet Belgesi/Raporu yükleme alanı — job-photo-upload.tsx ile AYNI
 * mimari (sürükle-bırak + dosya seç, her dosya için istemci ön-kontrol ->
 * sunucu doğrulama -> IndexedDB'ye yazma sırası, `items` yerel state'i,
 * "ready" olanların bir efektle dışarı bildirilmesi). İki fark: (1) sunucu
 * (job-photos/process'in tersine) dosya baytlarını HİÇ DÖNÜŞTÜRMEZ, yalnızca
 * doğrular — bu yüzden IndexedDB'ye yazılan, sunucudan dönen değil orijinal
 * `File`'ın kendisidir; (2) önizleme yalnızca tarayıcının doğrudan
 * render edebildiği biçimler (jpg/png/webp) için üretilir — HEIC/HEIF/TIFF
 * gibi biçimler tarayıcıda önizlenemez (bkz. document-validation.ts#
 * IMAGE_PREVIEWABLE_EXTENSIONS), bunlar yerine jenerik bir dosya simgesi
 * gösterilir; PDF/Office belgeleri zaten hiçbir zaman "resim" sayılmaz.
 */
export function ProviderDocumentUpload({
  onDocumentsChange,
  onBusyChange,
  disabled = false,
  errorId,
  allowedExtensions = ALLOWED_EXTENSIONS,
  maxFiles = MAX_DOCUMENTS,
  dropHintText = "Faaliyet belgesi/raporunuzu buraya sürükleyin veya dosya seçin.",
  formatsHintText = "PDF, DOC(X), XLS(X), ODT, JPG, PNG, WEBP, HEIC/HEIF, TIF",
}: {
  onDocumentsChange: (documents: ReadyProviderDocument[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  errorId?: string;
  /** Bu alanın kabul ettiği DAR bir alt küme — belirtilmezse document-validation.ts#ALLOWED_EXTENSIONS'ın TAMAMI (mevcut/eski davranış). */
  allowedExtensions?: readonly DocumentExtension[];
  /** Belirtilmezse document-validation.ts#MAX_DOCUMENTS (mevcut/eski davranış) — 1 verilirse tekil belge alanı olarak davranır (input `multiple` değildir). */
  maxFiles?: number;
  /** Sürükle-bırak alanının üst açıklama metni — belirtilmezse Faaliyet Belgesi'nin mevcut/eski metni. */
  dropHintText?: string;
  /** Alt satırdaki desteklenen biçim listesi metni — belirtilmezse Faaliyet Belgesi'nin mevcut/eski metni. */
  formatsHintText?: string;
}) {
  const [items, setItems] = useState<DocumentItem[]>([]);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputId = useId();
  const itemsRef = useRef<DocumentItem[]>(items);

  useEffect(() => {
    itemsRef.current = items;
  });

  useEffect(() => {
    return () => {
      // Bileşen unmount olduğunda (ör. rol Hizmet Alan'a değiştirildi/kayıt
      // formu terk edildi), henüz hiçbir kullanıcıya bağlanmamış IndexedDB
      // blob'ları sahipsiz kalmasın diye silinir (görev gereksinimi).
      const readyKeys = itemsRef.current
        .filter((item) => item.ready)
        .map((item) => item.ready!.storageKey);
      for (const key of readyKeys) void deletePhotoBlob(key);
      for (const item of itemsRef.current) {
        if (item.ready?.previewUrl) URL.revokeObjectURL(item.ready.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    const ready = items
      .filter((item) => item.status === "ready" && item.ready)
      .map((item) => ({
        clientId: item.clientId,
        indexedDbStorageKey: item.ready!.storageKey,
        originalFileName: item.fileName,
        mimeType: item.ready!.mimeType,
        extension: item.ready!.extension,
        size: item.fileSize,
      }));
    onDocumentsChange(ready);
    onBusyChange?.(items.some((item) => item.status === "validating"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const processOne = useCallback(async (clientId: string, file: File) => {
    const serverResult = await validateOnServer(file);
    if (!serverResult.ok) {
      setItems((current) => current.filter((item) => item.clientId !== clientId));
      setUploadErrors((errors) => [...errors, serverResult.error]);
      return;
    }

    const storageKey = crypto.randomUUID();
    try {
      await putPhotoBlob(storageKey, file);
    } catch {
      setItems((current) => current.filter((item) => item.clientId !== clientId));
      setUploadErrors((errors) => [...errors, `${file.name}: Belge kaydedilemedi. Lütfen tekrar deneyin.`]);
      return;
    }

    const previewUrl = isPreviewableImageExtension(serverResult.extension) ? URL.createObjectURL(file) : null;
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId
          ? {
              ...item,
              fileName: serverResult.sanitizedFileName,
              status: "ready",
              ready: { storageKey, mimeType: serverResult.mimeType, extension: serverResult.extension, previewUrl },
            }
          : item,
      ),
    );
  }, []);

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (disabled) return;
      const incoming = Array.from(fileList);
      const errors: string[] = [];
      const toQueue: File[] = [];
      const currentCount = itemsRef.current.length;

      for (const file of incoming) {
        if (currentCount + toQueue.length >= maxFiles) {
          errors.push(`En fazla ${maxFiles} belge yükleyebilirsiniz.`);
          break;
        }

        const extension = getFileExtension(file.name);
        if (!isAllowedDocumentExtension(extension)) {
          errors.push(`${file.name}: Desteklenmeyen dosya türü.`);
          continue;
        }
        if (!allowedExtensions.includes(extension as DocumentExtension)) {
          errors.push(
            `${file.name}: Bu alan için yalnızca ${allowedExtensions.map((ext) => ext.toUpperCase()).join(", ")} dosyaları kabul edilir.`,
          );
          continue;
        }

        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const check = validateDocumentClientSide({ name: file.name, size: file.size }, header);
        if (!check.ok) {
          errors.push(check.error);
          continue;
        }

        toQueue.push(file);
      }

      if (errors.length > 0) setUploadErrors((current) => [...current, ...errors]);
      if (toQueue.length === 0) return;

      const newItems: DocumentItem[] = toQueue.map((file) => ({
        clientId: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        status: "validating",
      }));

      setItems((current) => [...current, ...newItems]);

      for (let i = 0; i < newItems.length; i++) {
        void processOne(newItems[i].clientId, toQueue[i]);
      }
    },
    [disabled, processOne, maxFiles, allowedExtensions],
  );

  function handleDelete(clientId: string) {
    setItems((current) => {
      const target = current.find((item) => item.clientId === clientId);
      if (target?.ready) {
        void deletePhotoBlob(target.ready.storageKey);
        if (target.ready.previewUrl) URL.revokeObjectURL(target.ready.previewUrl);
      }
      return current.filter((item) => item.clientId !== clientId);
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
        <p className="text-sm text-muted-foreground">{dropHintText}</p>
        <label
          htmlFor={inputId}
          className={`inline-flex items-center gap-2 rounded-full border border-border bg-background px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent ${
            disabled ? "pointer-events-none" : "cursor-pointer"
          }`}
        >
          <FileUp className="h-4 w-4" aria-hidden="true" />
          Dosya Seç
        </label>
        <input
          id={inputId}
          type="file"
          multiple={maxFiles > 1}
          accept={allowedExtensions.map((ext) => `.${ext}`).join(",")}
          disabled={disabled}
          onChange={handleInputChange}
          aria-describedby={errorId}
          className="sr-only"
        />
        <p className="text-xs text-muted-foreground">
          {items.length} / {maxFiles} belge yüklendi · {formatsHintText} · en fazla{" "}
          {Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB
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
          {items.map((item) => (
            <ProviderDocumentCard
              key={item.clientId}
              fileName={item.fileName}
              fileSize={item.fileSize}
              extension={item.ready?.extension ?? getFileExtension(item.fileName) ?? ""}
              previewUrl={item.ready?.previewUrl ?? null}
              status={item.status}
              errorMessage={item.errorMessage}
              onDelete={() => handleDelete(item.clientId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
