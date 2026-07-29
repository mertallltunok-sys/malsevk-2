import { readJson, writeJson } from "./local-storage";
import type { LegalDocumentId } from "./legal-documents";
import { getLegalDocumentMeta } from "./legal-documents";

const LEGAL_CONSENTS_STORAGE_KEY = "malsevk.legal_consents.v1";

/**
 * Bir hukuki metnin belirli bir SÜRÜMÜNE verilen tek bir kabul kaydı.
 * MERKEZİ, Supabase'e taşınmaya HAZIR yapı: bu tip aynen bir Supabase
 * tablosunun (ör. `legal_consents`) satır şemasına karşılık gelecek şekilde
 * tasarlanmıştır — `userId`/`ipAddress`/`deviceInfo` bugün için `null`
 * placeholder'dır (bu alanları gerçek anlamda dolduracak kimlik doğrulama
 * sunucusu/HTTP isteği bağlamı henüz yok, bkz. CLAUDE.md "No real backend"),
 * ancak alan adları ve tipleri ileride gerçek değerlerle doldurulacak
 * şekilde ŞİMDİDEN sabittir — geçişte şema değişikliği gerekmez, yalnızca
 * bu üç alanın nasıl doldurulduğu (localStorage yerine sunucu tarafı) değişir.
 */
export type LegalConsentRecord = {
  /** Hangi belge (privacy_policy/terms_of_service/kvkk) — bkz. LegalDocumentId. */
  documentId: LegalDocumentId;
  /** Kabul edilen SÜRÜM — legal-documents.ts'deki `version` ile aynı kaynaktan okunur, burada asla elle yazılmaz. */
  version: string;
  /** ISO 8601 zaman damgası (`new Date().toISOString()`). */
  acceptedAt: string;
  /** İleride: giriş yapmış/yeni kaydolmuş kullanıcının `StoredUser.id`'si. Anonim (ör. footer'dan salt okuma) kabullerde `null`. */
  userId: string | null;
  /** PLACEHOLDER — İleride: sunucu tarafı bir istekten okunacak istemci IP adresi. Tarayıcıdan güvenilir şekilde okunamaz, bu yüzden şimdilik her zaman `null`. */
  ipAddress: string | null;
  /** PLACEHOLDER — İleride: sunucu tarafında ayrıştırılacak User-Agent/cihaz bilgisi özeti. Şimdilik `null`; bilerek `navigator.userAgent` gibi istemci taraflı bir değer YAZILMAZ çünkü bu alan gerçek anlamda sunucu tarafı doğrulama için düşünülmüştür. */
  deviceInfo: string | null;
};

function readConsents(): LegalConsentRecord[] {
  return readJson<LegalConsentRecord[]>(LEGAL_CONSENTS_STORAGE_KEY) ?? [];
}

function writeConsents(consents: LegalConsentRecord[]): void {
  writeJson(LEGAL_CONSENTS_STORAGE_KEY, consents);
}

/**
 * Tek bir belge için, o belgenin GÜNCEL sürümüne bir kabul kaydı ekler ve
 * ekleneni döner. `legal-documents.ts#getLegalDocumentMeta` üzerinden okunan
 * sürüm, tek doğruluk kaynağıdır — çağıran taraf sürüm numarasını ASLA elle
 * geçirmez, bu yüzden bir metin güncellendiğinde (version artırıldığında)
 * yeni kabuller otomatik olarak doğru sürüme karşı kaydedilir.
 */
export function recordLegalConsent(
  documentId: LegalDocumentId,
  userId: string | null = null,
): LegalConsentRecord {
  const record: LegalConsentRecord = {
    documentId,
    version: getLegalDocumentMeta(documentId).version,
    acceptedAt: new Date().toISOString(),
    userId,
    // Bkz. yukarıdaki alan dokümantasyonu — bu ikisi bilinçli olarak
    // placeholder'dır, gerçek bir sunucu bağlamı olmadan doldurulamaz.
    ipAddress: null,
    deviceInfo: null,
  };
  writeConsents([...readConsents(), record]);
  return record;
}

/**
 * Kayıt formundaki TEK birleşik onay kutusu (bkz. login-form.tsx) üç metnin
 * de kabul edildiği anlamına geldiği için, kayıt başarılı olduğunda HER üç
 * belge için AYRI birer kabul kaydı üretir — "her metin için ayrı kabul
 * kaydı tutulabilsin" gereksinimi, tek bir onay eyleminden üç bağımsız
 * kayıt üretilerek karşılanır (üçü de aynı `acceptedAt` anına sahip olur).
 */
export function recordConsentForAllLegalDocuments(userId: string | null = null): LegalConsentRecord[] {
  const documentIds: LegalDocumentId[] = ["privacy_policy", "terms_of_service", "kvkk"];
  return documentIds.map((documentId) => recordLegalConsent(documentId, userId));
}

export function getLegalConsents(): LegalConsentRecord[] {
  return readConsents();
}

/** Debug/gelecekteki Supabase geçişi için: "privacy_policy_v1" biçiminde okunabilir bir anahtar üretir (bkz. görev örnekleri) — depolanan VERİ değil, yalnızca bir GÖRÜNTÜLEME yardımcısıdır. */
export function getConsentDisplayKey(record: Pick<LegalConsentRecord, "documentId" | "version">): string {
  return `${record.documentId}_v${record.version}`;
}
