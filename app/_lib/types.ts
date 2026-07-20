export type UserRole = "hizmet-alan" | "hizmet-veren";

export type Session = {
  id: string;
  name: string;
  role: UserRole;
};

export type Currency = "TRY" | "USD";

export type JobStatus = "yayinda" | "tamamlandi" | "iptal";

export type JobPhoto = {
  id: string;
  /** 0 tabanlı sıra; 0 olan kapak fotoğrafıdır. */
  order: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** photo-blob-store.ts (IndexedDB) içindeki asıl dosyanın anahtarı. */
  storageKey: string;
};

export type Job = {
  id: string;
  title: string;
  category: string;
  province: string;
  district: string;
  workLocationType: string;
  workDate: string;
  description: string;
  operationDetails: string;
  status: JobStatus;
  /** İlanı oluşturan Hizmet Alan kullanıcısının id'si. Sabit örnek ilanlar için null. */
  requesterId: string | null;
  /** Sıralı operasyon fotoğrafları. Eski/sabit ilanlarda boş dizi olabilir. */
  photos: JobPhoto[];
};

export type OfferStatus = "pending" | "accepted" | "rejected";

export type Offer = {
  id: string;
  jobId: string;
  providerId: string;
  amount: number;
  currency: Currency;
  description: string;
  estimatedDuration: string;
  status: OfferStatus;
  createdAt: string;
  updatedAt: string;
};
