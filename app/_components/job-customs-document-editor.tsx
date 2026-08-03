"use client";

import { useEffect, useState } from "react";
import { MAX_DOCUMENTS } from "../_lib/document-validation";
import type { JobCustomsDocument } from "../_lib/types";
import { ProviderDocumentCard } from "./provider-document-card";
import { JobCustomsDocumentUpload, type ReadyJobCustomsDocument } from "./job-customs-document-upload";

/**
 * İlan düzenleme ekranındaki Gümrük Müşavirliği evrak yönetimi —
 * `job-photo-editor.tsx` ile AYNI desen (mevcut evraklar yalnızca
 * silinebilir/yeniden yüklenmez + yeni evrak eklemek için değiştirilmemiş
 * `JobCustomsDocumentUpload`), önizleme URL'i çözümlenmez (evraklar çoğunlukla
 * görsel olmayan dosyalardır — bkz. JobCustomsDocumentUpload'ın kendi
 * dokümantasyonu, taze yüklenen evraklar için de aynı sebeple önizleme yok).
 */
export function JobCustomsDocumentEditor({
  existingDocuments,
  onChange,
  onBusyChange,
  errorId,
}: {
  existingDocuments: JobCustomsDocument[];
  onChange: (state: { keptCustomsDocumentIds: string[]; newCustomsDocuments: ReadyJobCustomsDocument[] }) => void;
  onBusyChange?: (busy: boolean) => void;
  errorId?: string;
}) {
  const [keptDocuments, setKeptDocuments] = useState<JobCustomsDocument[]>(existingDocuments);
  const [newDocuments, setNewDocuments] = useState<ReadyJobCustomsDocument[]>([]);

  // job-photo-editor.tsx'teki kanıtlanmış desenle aynı: ebeveyne bildirim
  // ayrı bir efektle yapılır (bir state güncelleyicisi içinden farklı bir
  // bileşenin state'ini senkron güncellemek React tarafından hatalı kabul
  // edilir).
  useEffect(() => {
    onChange({ keptCustomsDocumentIds: keptDocuments.map((doc) => doc.id), newCustomsDocuments: newDocuments });
  }, [keptDocuments, newDocuments, onChange]);

  function handleDeleteExisting(documentId: string) {
    setKeptDocuments((current) => current.filter((doc) => doc.id !== documentId));
  }

  const remainingSlots = Math.max(0, MAX_DOCUMENTS - keptDocuments.length);

  return (
    <div>
      {keptDocuments.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {keptDocuments.map((doc) => (
            <ProviderDocumentCard
              key={doc.id}
              fileName={doc.fileName}
              fileSize={doc.fileSize}
              extension={doc.fileName.split(".").pop() ?? ""}
              previewUrl={null}
              status="ready"
              onDelete={() => handleDeleteExisting(doc.id)}
            />
          ))}
        </div>
      )}

      {remainingSlots > 0 ? (
        <div className={keptDocuments.length > 0 ? "mt-4" : ""}>
          <JobCustomsDocumentUpload
            onDocumentsChange={setNewDocuments}
            onBusyChange={onBusyChange}
            errorId={errorId}
            existingCount={keptDocuments.length}
          />
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          En fazla {MAX_DOCUMENTS} belge yükleyebilirsiniz. Yeni belge eklemek için önce mevcut bir belgeyi silin.
        </p>
      )}
    </div>
  );
}
