import { readJson, writeJson } from "./local-storage";

const PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY = "malsevk.provider_document_consents.v1";

/**
 * Bu tabloda kaydı tutulan beyan METİNLERİNİN kimliği — her biri kendi
 * sürümüyle bağımsız olarak kabul edilir/izlenir (legal-consent.ts'teki
 * `documentId` ile AYNI ilke, yalnızca kayıt formunun kendi bağlamında
 * gösterilen tek cümlelik beyanlar için). "belge-dogruluk-beyani" TÜM
 * Hizmet Veren kayıtlarında zorunlu, mevcut/eski davranıştır — bu alan
 * eklenmeden ÖNCE yazılmış kayıtlarda yoktur, `readAll` bunları her zaman bu
 * değere normalize eder (geriye dönük hiçbir kayıt bozulmaz). "gumruk-musaviri-belge-beyani"
 * yalnızca Gümrük Müşavirliği seçildiğinde EK olarak istenen, farklı metinli
 * ayrı bir beyandır (bkz. CUSTOMS_LICENSE_DECLARATION_TEXT) — aynı kullanıcı
 * için iki statementId de bağımsız birer satır olarak var olabilir.
 */
export type ProviderDocumentStatementId = "belge-dogruluk-beyani" | "gumruk-musaviri-belge-beyani";
export const GENERAL_DOCUMENT_STATEMENT_ID: ProviderDocumentStatementId = "belge-dogruluk-beyani";
export const CUSTOMS_LICENSE_STATEMENT_ID: ProviderDocumentStatementId = "gumruk-musaviri-belge-beyani";

function isStatementId(value: unknown): value is ProviderDocumentStatementId {
  return value === GENERAL_DOCUMENT_STATEMENT_ID || value === CUSTOMS_LICENSE_STATEMENT_ID;
}

/**
 * Her beyanın METNİ ve GÜNCEL SÜRÜMÜ — legal-documents.ts'teki registry ile
 * AYNI "tek doğruluk kaynağı" ilkesini izler. Bir metin değişirse yalnızca
 * ilgili sürüm burada artırılır.
 */
export const PROVIDER_DOCUMENT_DECLARATION_VERSION = "1.0";
export const PROVIDER_DOCUMENT_DECLARATION_TEXT =
  "Yüklediğim belgelerin güncel, geçerli ve gerçeğe uygun olduğunu; yanlış veya yanıltıcı belge paylaşmam halinde hesabımın askıya alınabileceğini kabul ve beyan ediyorum.";

export const CUSTOMS_LICENSE_DECLARATION_VERSION = "1.0";
export const CUSTOMS_LICENSE_DECLARATION_TEXT = "Yüklediğim belge bana aittir ve günceldir.";

const STATEMENT_VERSIONS: Readonly<Record<ProviderDocumentStatementId, string>> = {
  [GENERAL_DOCUMENT_STATEMENT_ID]: PROVIDER_DOCUMENT_DECLARATION_VERSION,
  [CUSTOMS_LICENSE_STATEMENT_ID]: CUSTOMS_LICENSE_DECLARATION_VERSION,
};

export type StoredProviderDocumentConsent = {
  id: string;
  userId: string;
  acceptedAt: string;
  statementVersion: string;
  statementId: ProviderDocumentStatementId;
};

function readAll(): StoredProviderDocumentConsent[] {
  const raw = readJson<unknown[]>(PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value.id === "string" &&
        typeof value.userId === "string" &&
        typeof value.acceptedAt === "string" &&
        typeof value.statementVersion === "string",
    )
    .map((value) => ({
      ...(value as unknown as StoredProviderDocumentConsent),
      statementId: isStatementId(value.statementId) ? value.statementId : GENERAL_DOCUMENT_STATEMENT_ID,
    }));
}

function writeAll(rows: StoredProviderDocumentConsent[]): boolean {
  return writeJson(PROVIDER_DOCUMENT_CONSENTS_STORAGE_KEY, rows);
}

/** `statementId` verilmezse "genel" Belge Doğruluk Beyanı sayılır — mevcut tüm çağıranlar değişmeden çalışır. */
export function getProviderDocumentConsent(
  userId: string,
  statementId: ProviderDocumentStatementId = GENERAL_DOCUMENT_STATEMENT_ID,
): StoredProviderDocumentConsent | null {
  return readAll().find((row) => row.userId === userId && row.statementId === statementId) ?? null;
}

export function hasAcceptedProviderDocumentDeclaration(
  userId: string,
  statementId: ProviderDocumentStatementId = GENERAL_DOCUMENT_STATEMENT_ID,
): boolean {
  return getProviderDocumentConsent(userId, statementId) !== null;
}

/**
 * İlgili beyanın GÜNCEL sürümüne bir kabul kaydı ekler — sürüm numarası
 * çağıran tarafından ASLA elle geçirilmez (legal-consent.ts#recordLegalConsent
 * ile aynı ilke). `statementId` verilmezse "genel" Belge Doğruluk Beyanı
 * kabul edilmiş sayılır (mevcut/eski davranış, tek çağrı noktası
 * provider-registration.ts idi). Yazma başarısız olursa `false` döner;
 * provider-registration.ts bu durumda TÜM kaydı (kullanıcı + hizmetler +
 * belgeler dahil) geri alır.
 */
export function recordProviderDocumentConsent(
  userId: string,
  statementId: ProviderDocumentStatementId = GENERAL_DOCUMENT_STATEMENT_ID,
): boolean {
  const record: StoredProviderDocumentConsent = {
    id: crypto.randomUUID(),
    userId,
    acceptedAt: new Date().toISOString(),
    statementVersion: STATEMENT_VERSIONS[statementId],
    statementId,
  };
  return writeAll([...readAll(), record]);
}

/** Yalnızca provider-registration.ts'in kayıt geri alma (rollback) senaryosunda kullanılır — kullanıcının TÜM beyan kayıtlarını (hangi statementId olursa olsun) siler. */
export function deleteProviderDocumentConsentForUser(userId: string): boolean {
  return writeAll(readAll().filter((row) => row.userId !== userId));
}
