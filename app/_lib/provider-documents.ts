import { getProviderAuthorizationGroupByDocumentType } from "./service-catalog";
import { readJson, writeJson } from "./local-storage";
import type { ProviderDocumentReviewStatus } from "./types";

const PROVIDER_DOCUMENTS_STORAGE_KEY = "malsevk.provider_documents.v1";

/**
 * Bir belgenin HANGİ amaçla yüklendiği — "genel" (Faaliyet Belgesi/Raporu,
 * her Hizmet Veren kaydında zorunlu, mevcut/eski davranış), "gumruk-musaviri-izin-belgesi"
 * (yalnızca Gümrük Müşavirliği seçildiğinde EK olarak zorunlu, bkz.
 * customs-license.ts), ve BELGE/YETKİ SADELEŞTİRMESİ'nin (migration 0044,
 * bkz. service-catalog.ts#PROVIDER_AUTHORIZATION_GROUPS) iki YENİ grup
 * belgesi — "depo-hizmetleri-belgesi"/"operator-is-makinesi-belgesi" —
 * arasında ayrım yapar. Bu alan eklenmeden ÖNCE yazılmış TÜM kayıtlarda
 * (Nakliyeci demo hesabı dahil) yoktur — `readAll` bunu her zaman "genel"
 * olarak normalize eder (aynı `locationMode` eksikse "catalog" varsayılan
 * deseni, bkz. job-store.ts#normalizeStoredJob), bu yüzden geriye dönük
 * hiçbir kayıt bozulmaz/yanlış sınıflandırılmaz.
 */
export type ProviderDocumentType = "genel" | "gumruk-musaviri-izin-belgesi" | "depo-hizmetleri-belgesi" | "operator-is-makinesi-belgesi";
export const GENERAL_DOCUMENT_TYPE: ProviderDocumentType = "genel";
export const CUSTOMS_LICENSE_DOCUMENT_TYPE: ProviderDocumentType = "gumruk-musaviri-izin-belgesi";
export const STORAGE_SERVICES_DOCUMENT_TYPE: ProviderDocumentType = "depo-hizmetleri-belgesi";
export const EQUIPMENT_OPERATOR_DOCUMENT_TYPE: ProviderDocumentType = "operator-is-makinesi-belgesi";

function isProviderDocumentType(value: unknown): value is ProviderDocumentType {
  return (
    value === GENERAL_DOCUMENT_TYPE ||
    value === CUSTOMS_LICENSE_DOCUMENT_TYPE ||
    value === STORAGE_SERVICES_DOCUMENT_TYPE ||
    value === EQUIPMENT_OPERATOR_DOCUMENT_TYPE
  );
}

/**
 * Admin "Firma Belgeleri" ekranlarının (admin-document-review-detail.tsx,
 * admin-company-documents-panel.tsx) TEK ortak etiket kaynağı — ikisi de
 * artık kendi ternary'lerini KOPYALAMAK yerine BURAYA delege eder.
 */
export function getProviderDocumentTypeLabel(documentType: string): string {
  if (documentType === CUSTOMS_LICENSE_DOCUMENT_TYPE) return "Gümrük Müşaviri İzin Belgesi";
  const group = getProviderAuthorizationGroupByDocumentType(documentType);
  if (group) return group.label;
  return "Faaliyet Belgesi/Raporu";
}

/** Yalnızca grup belgeleri için admin'e "onay ne açar" açıklaması döner — genel/gümrük belgeleri için `null` (zaten tek, apaçık bir kategoriye bağlılar). */
export function getProviderDocumentTypeAdminDescription(documentType: string): string | null {
  return getProviderAuthorizationGroupByDocumentType(documentType)?.adminApprovalDescription ?? null;
}

/**
 * Bir Hizmet Veren'in yüklediği Faaliyet Belgesi/Raporu'nun METADATA'sı —
 * asıl dosya İÇERİĞİ burada DEĞİL, IndexedDB'de (bkz.
 * photo-blob-store.ts — ilan fotoğraflarıyla PAYLAŞILAN aynı blob deposu,
 * `indexedDbStorageKey` o depodaki anahtardır) tutulur; localStorage'ın
 * boyut kotası bunu kaldıramaz (bkz. photo-blob-store.ts'in kendi
 * dokümantasyonu, aynı gerekçe).
 *
 * `reviewStatus`/`reviewNote`/`reviewedAt`/`reviewedByAdminId` bu kaydın
 * GÜNCEL (denormalize edilmiş) inceleme durumudur — geçmiş inceleme
 * AKSİYONLARININ (kim, ne zaman, hangi kararı verdi) tam günlüğü ayrı bir
 * tabloda tutulur (bkz. provider-document-reviews.ts); ikisi aynı veriyi
 * TEKRARLAMAZ, biri "şu an ne durumda" biri "geçmişte ne oldu" sorusunu
 * yanıtlar (Offer.status'un GÜNCEL durumu, notifications.ts'in onu YALNIZCA
 * o anki değerinden türetmesiyle aynı ilişki).
 */
export type StoredProviderDocument = {
  id: string;
  userId: string;
  originalFileName: string;
  mimeType: string;
  extension: string;
  size: number;
  indexedDbStorageKey: string;
  uploadedAt: string;
  reviewStatus: ProviderDocumentReviewStatus;
  reviewNote?: string;
  reviewedAt?: string;
  reviewedByAdminId?: string;
  documentType: ProviderDocumentType;
};

export type NewProviderDocumentInput = {
  originalFileName: string;
  mimeType: string;
  extension: string;
  size: number;
  indexedDbStorageKey: string;
  /** Belirtilmezse "genel" (Faaliyet Belgesi/Raporu) sayılır — mevcut tüm çağıranlar bu varsayılanla değişmeden çalışır. */
  documentType?: ProviderDocumentType;
};

function isReviewStatus(value: unknown): value is ProviderDocumentReviewStatus {
  return value === "pending" || value === "approved" || value === "rejected" || value === "revision_requested";
}

function readAll(): StoredProviderDocument[] {
  const raw = readJson<unknown[]>(PROVIDER_DOCUMENTS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value.id === "string" &&
        typeof value.userId === "string" &&
        typeof value.originalFileName === "string" &&
        typeof value.mimeType === "string" &&
        typeof value.extension === "string" &&
        typeof value.size === "number" &&
        typeof value.indexedDbStorageKey === "string" &&
        typeof value.uploadedAt === "string" &&
        isReviewStatus(value.reviewStatus),
    )
    .map((value) => ({
      ...(value as unknown as StoredProviderDocument),
      documentType: isProviderDocumentType(value.documentType) ? value.documentType : GENERAL_DOCUMENT_TYPE,
    }));
}

function writeAll(rows: StoredProviderDocument[]): boolean {
  return writeJson(PROVIDER_DOCUMENTS_STORAGE_KEY, rows);
}

export function getProviderDocumentsForUser(userId: string): StoredProviderDocument[] {
  return readAll().filter((row) => row.userId === userId);
}

export function getProviderDocumentById(documentId: string): StoredProviderDocument | null {
  return readAll().find((row) => row.id === documentId) ?? null;
}

/** Admin belge kontrolü ekranı için — TÜM hizmet-veren belgelerini döner. */
export function getAllProviderDocuments(): StoredProviderDocument[] {
  return readAll();
}

/**
 * Bir kullanıcı için birden fazla belge metadata kaydını TEK bir yazmayla
 * ekler (kayıt formunda aynı anda birkaç dosya yüklenmiş olabilir) — kısmi
 * yazım riski taşımaz. Geri alma (rollback) provider-registration.ts'in
 * sorumluluğundadır, bu fonksiyon yalnızca yazar.
 */
export function addProviderDocuments(userId: string, documents: NewProviderDocumentInput[]): boolean {
  if (documents.length === 0) return true;
  const now = new Date().toISOString();
  const newRows: StoredProviderDocument[] = documents.map((doc) => ({
    id: crypto.randomUUID(),
    userId,
    originalFileName: doc.originalFileName,
    mimeType: doc.mimeType,
    extension: doc.extension,
    size: doc.size,
    indexedDbStorageKey: doc.indexedDbStorageKey,
    uploadedAt: now,
    reviewStatus: "pending",
    documentType: doc.documentType ?? GENERAL_DOCUMENT_TYPE,
  }));
  return writeAll([...readAll(), ...newRows]);
}

/** Yalnızca provider-registration.ts'in kayıt geri alma (rollback) senaryosunda kullanılır. */
export function deleteProviderDocumentsForUser(userId: string): boolean {
  return writeAll(readAll().filter((row) => row.userId !== userId));
}

export type ApplyProviderDocumentReviewInput = {
  documentId: string;
  status: ProviderDocumentReviewStatus;
  note?: string;
  adminId: string;
};

/**
 * Bir belgenin denormalize edilmiş GÜNCEL inceleme alanlarını günceller —
 * yalnızca provider-document-reviews.ts#recordProviderDocumentReview
 * tarafından, o fonksiyonun kendi günlük (log) satırını yazmasıyla AYNI
 * mantıksal işlemin bir parçası olarak çağrılmalıdır; başka hiçbir yerden
 * doğrudan çağrılmamalıdır (tek yazma yolu, tutarsız durum riskini önler).
 */
export function updateProviderDocumentReviewFields(
  input: ApplyProviderDocumentReviewInput,
): StoredProviderDocument | null {
  const all = readAll();
  const existing = all.find((row) => row.id === input.documentId);
  if (!existing) return null;

  const updated: StoredProviderDocument = {
    ...existing,
    reviewStatus: input.status,
    reviewNote: input.note,
    reviewedAt: new Date().toISOString(),
    reviewedByAdminId: input.adminId,
  };
  if (!writeAll(all.map((row) => (row.id === input.documentId ? updated : row)))) return null;
  return updated;
}
