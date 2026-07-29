import { readJson, writeJson } from "./local-storage";

const PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY = "malsevk.provider_document_consents.v1";

/**
 * Belge Doğruluk Beyanı'nın METNİ ve SÜRÜMÜ — legal-documents.ts'teki
 * registry ile AYNI "tek doğruluk kaynağı" ilkesini izler, ama tam bir
 * LegalDocumentMeta (çok bölümlü, kendi sayfası olan bir hukuki metin)
 * DEĞİLDİR: bu, kayıt formunun kendi bağlamında gösterilen TEK bir cümledir,
 * ayrı bir sayfa/route'a ihtiyacı yoktur. Metin değişirse yalnızca
 * `PROVIDER_DOCUMENT_DECLARATION_VERSION` artırılır ve metin burada güncellenir.
 */
export const PROVIDER_DOCUMENT_DECLARATION_VERSION = "1.0";
export const PROVIDER_DOCUMENT_DECLARATION_TEXT =
  "Yüklediğim belgelerin güncel, geçerli ve gerçeğe uygun olduğunu; yanlış veya yanıltıcı belge paylaşmam halinde hesabımın askıya alınabileceğini kabul ve beyan ediyorum.";

export type StoredProviderDocumentConsent = {
  id: string;
  userId: string;
  acceptedAt: string;
  statementVersion: string;
};

function readAll(): StoredProviderDocumentConsent[] {
  const raw = readJson<unknown[]>(PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is StoredProviderDocumentConsent => {
    if (typeof item !== "object" || item === null) return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.id === "string" &&
      typeof value.userId === "string" &&
      typeof value.acceptedAt === "string" &&
      typeof value.statementVersion === "string"
    );
  });
}

function writeAll(rows: StoredProviderDocumentConsent[]): boolean {
  return writeJson(PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY, rows);
}

export function getProviderDocumentConsent(userId: string): StoredProviderDocumentConsent | null {
  return readAll().find((row) => row.userId === userId) ?? null;
}

export function hasAcceptedProviderDocumentDeclaration(userId: string): boolean {
  return getProviderDocumentConsent(userId) !== null;
}

/**
 * Beyanın GÜNCEL sürümüne bir kabul kaydı ekler — sürüm numarası çağıran
 * tarafından ASLA elle geçirilmez (legal-consent.ts#recordLegalConsent ile
 * aynı ilke). Yazma başarısız olursa `false` döner; provider-registration.ts
 * bu durumda TÜM kaydı (kullanıcı + hizmetler + belgeler dahil) geri alır.
 */
export function recordProviderDocumentConsent(userId: string): boolean {
  const record: StoredProviderDocumentConsent = {
    id: crypto.randomUUID(),
    userId,
    acceptedAt: new Date().toISOString(),
    statementVersion: PROVIDER_DOCUMENT_DECLARATION_VERSION,
  };
  return writeAll([...readAll(), record]);
}

/** Yalnızca provider-registration.ts'in kayıt geri alma (rollback) senaryosunda kullanılır. */
export function deleteProviderDocumentConsentForUser(userId: string): boolean {
  return writeAll(readAll().filter((row) => row.userId !== userId));
}
