"use client";

import { FileUp, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS } from "../_lib/customs-brokerage-catalog";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_SIZE_BYTES,
  getFileExtension,
  isAllowedDocumentExtension,
  validateDocumentClientSide,
  type DocumentExtension,
} from "../_lib/document-validation";
import { ProviderDocumentCard } from "./provider-document-card";

/** job-store.ts#ProcessedPhotoInput ile BİREBİR aynı şekil — job-request-form.tsx/job-edit-form.tsx doğrudan bu diziyi createJob/createJobsForOperation/updateJob'a iletir. */
export type ReadyJobCustomsDocument = {
  blob: Blob;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

type DocumentItem = {
  clientId: string;
  fileName: string;
  fileSize: number;
  status: "validating" | "ready" | "error";
  errorMessage?: string;
  ready?: { blob: Blob; mimeType: string; extension: string };
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
 * Gümrük Müşavirliği ilanına eklenen destekleyici evraklar (Ticari Fatura,
 * Packing List, ATR, EUR.1, Menşe Şahadetnamesi vb.) için yükleme alanı —
 * `job-photo-upload.tsx` ile AYNI mimari (istemci ön-kontrol -> sunucu
 * doğrulama -> hazır blob'u YEREL state'te tut, IndexedDB'ye YAZMA
 * ertelenir) — `provider-document-upload.tsx`'in AKSİNE: o bileşen
 * doğrulanan belgeyi hemen IndexedDB'ye yazar (kayıt formunun çok adımlı
 * akışında önizleme/silme için gerekli), ama unmount'ta o blob'ları otomatik
 * SİLER — bu iş ilanı oluşturma/düzenleme formunda (tek adımlı submit)
 * gereksiz ve riskli olurdu (başarılı bir gönderimden hemen sonra bileşen
 * unmount olduğunda, az önce ilana bağlanmış blob'lar silinebilirdi). Bu
 * yüzden evrak bayt içeriği yalnızca `createJob`/`createJobsForOperation`/
 * `updateJob` GERÇEKTEN çağrıldığında (job-store.ts#persistPhotosOrRollback
 * ile, fotoğraflarla AYNI fonksiyon) IndexedDB'ye yazılır; bu bileşen hiç
 * IndexedDB'ye dokunmaz, unmount'ta yalnızca yerel state boşalır.
 *
 * Sunucu (job-photos/process'in aksine) dosya baytlarını HİÇ DÖNÜŞTÜRMEZ,
 * yalnızca doğrular — bu yüzden yerel state'te tutulan blob orijinal
 * `File`in kendisidir (photo-upload'daki gibi sunucudan dönen yeni bytes
 * değil).
 */
export function JobCustomsDocumentUpload({
  onDocumentsChange,
  onBusyChange,
  disabled = false,
  errorId,
  existingCount = 0,
}: {
  onDocumentsChange: (documents: ReadyJobCustomsDocument[]) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  errorId?: string;
  /** Düzenleme ekranında zaten korunan mevcut evrak sayısı — MAX_DOCUMENTS sınırına dahil edilir. */
  existingCount?: number;
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
    const ready = items
      .filter((item) => item.status === "ready" && item.ready)
      .map((item) => ({
        blob: item.ready!.blob,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.ready!.mimeType,
      }));
    onDocumentsChange(ready);
    onBusyChange?.(items.some((item) => item.status === "validating"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const processOne = useCallback(async (clientId: string, file: File) => {
    const result = await validateOnServer(file);
    if (!result.ok) {
      setItems((current) => current.filter((item) => item.clientId !== clientId));
      setUploadErrors((errors) => [...errors, `${file.name}: ${result.error}`]);
      return;
    }
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId
          ? {
              ...item,
              fileName: result.sanitizedFileName,
              status: "ready",
              ready: { blob: file, mimeType: result.mimeType, extension: result.extension },
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
        if (existingCount + currentCount + toQueue.length >= MAX_DOCUMENTS) {
          errors.push(`En fazla ${MAX_DOCUMENTS} belge yükleyebilirsiniz.`);
          break;
        }

        const extension = getFileExtension(file.name);
        if (!isAllowedDocumentExtension(extension) || !CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS.includes(extension as DocumentExtension)) {
          errors.push(
            `${file.name}: Bu alan için yalnızca ${CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", ")} dosyaları kabul edilir.`,
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
    [disabled, processOne, existingCount],
  );

  function handleDelete(clientId: string) {
    setItems((current) => current.filter((item) => item.clientId !== clientId));
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

  const totalCount = existingCount + items.length;
  const remainingSlots = Math.max(0, MAX_DOCUMENTS - totalCount);

  return (
    <div>
      {remainingSlots > 0 ? (
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
            Ticari Fatura, Packing List, ATR, EUR.1, Menşe Şahadetnamesi gibi destekleyici evrakları buraya sürükleyin
            veya dosya seçin.
          </p>
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
            multiple
            accept={CUSTOMS_DOCUMENT_ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(",")}
            disabled={disabled}
            onChange={handleInputChange}
            aria-describedby={errorId}
            className="sr-only"
          />
          <p className="text-xs text-muted-foreground">
            {totalCount} / {MAX_DOCUMENTS} belge yüklendi · PDF, JPG, PNG, DOCX, XLSX · en fazla{" "}
            {Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB · isteğe bağlı
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          En fazla {MAX_DOCUMENTS} belge yükleyebilirsiniz. Yeni belge eklemek için önce mevcut bir belgeyi silin.
        </p>
      )}

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
              previewUrl={null}
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
