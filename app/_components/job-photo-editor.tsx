"use client";

import { useEffect, useState } from "react";
import { MAX_PHOTOS } from "../_lib/photo-validation";
import type { Job, JobPhoto } from "../_lib/types";
import { useJobPhotoUrl } from "../_lib/use-job-photo-url";
import { JobPhotoCard } from "./job-photo-card";
import { JobPhotoUpload, type ReadyJobPhoto } from "./job-photo-upload";

function ExistingPhotoCard({
  photo,
  isCover,
  onDelete,
}: {
  photo: JobPhoto;
  isCover: boolean;
  onDelete: () => void;
}) {
  const previewUrl = useJobPhotoUrl(photo.storageKey);
  return (
    <JobPhotoCard
      previewUrl={previewUrl}
      fileName={photo.fileName}
      fileSize={photo.fileSize}
      isCover={isCover}
      status="ready"
      onDelete={onDelete}
    />
  );
}

/**
 * İlan düzenleme ekranındaki fotoğraf yönetimi: mevcut fotoğraflar (yalnızca
 * silinebilir, yeniden yüklenmez) + yeni fotoğraf ekleme için mevcut, hiç
 * değiştirilmemiş `JobPhotoUpload` bileşeni. Kapak fotoğrafı her zaman ilk
 * SIRADAKİ (korunmuş varsa mevcut, yoksa yeni) fotoğraftır.
 */
export function JobPhotoEditor({
  job,
  onChange,
  onBusyChange,
  errorId,
}: {
  job: Job;
  onChange: (state: { keptPhotoIds: string[]; newPhotos: ReadyJobPhoto[] }) => void;
  onBusyChange?: (busy: boolean) => void;
  errorId?: string;
}) {
  const [keptPhotos, setKeptPhotos] = useState<JobPhoto[]>(
    () => [...job.photos].sort((a, b) => a.order - b.order),
  );
  const [newPhotos, setNewPhotos] = useState<ReadyJobPhoto[]>([]);

  // job-request-form.tsx'teki kanıtlanmış desenle aynı: JobPhotoUpload'a
  // doğrudan state setter'ları (referans kimliği hiç değişmeyen) verilir.
  // Ebeveyne bildirim ayrı bir efektle, yalnızca gerçek state değiştiğinde
  // yapılır — her render'da yeniden oluşturulan bir closure'ı
  // JobPhotoUpload'ın onPhotosChange bağımlılığına vermek sonsuz
  // render döngüsüne yol açıyordu ("Maximum update depth exceeded").
  useEffect(() => {
    onChange({ keptPhotoIds: keptPhotos.map((photo) => photo.id), newPhotos });
  }, [keptPhotos, newPhotos, onChange]);

  function handleDeleteExisting(photoId: string) {
    setKeptPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  const remainingSlots = Math.max(0, MAX_PHOTOS - keptPhotos.length);

  return (
    <div>
      {keptPhotos.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {keptPhotos.map((photo, index) => (
            <ExistingPhotoCard
              key={photo.id}
              photo={photo}
              isCover={index === 0}
              onDelete={() => handleDeleteExisting(photo.id)}
            />
          ))}
        </div>
      )}

      {remainingSlots > 0 ? (
        <div className={keptPhotos.length > 0 ? "mt-4" : ""}>
          <JobPhotoUpload
            role="hizmet-alan"
            onPhotosChange={setNewPhotos}
            onBusyChange={onBusyChange}
            errorId={errorId}
            existingCount={keptPhotos.length}
          />
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          En fazla {MAX_PHOTOS} fotoğraf yükleyebilirsiniz. Yeni fotoğraf eklemek için önce mevcut
          bir fotoğrafı silin.
        </p>
      )}
    </div>
  );
}
