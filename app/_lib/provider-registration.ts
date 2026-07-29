import { STORAGE_WRITE_ERROR_MESSAGE } from "./local-storage";
import { deletePhotoBlobs } from "./photo-blob-store";
import {
  recordProviderDocumentConsent,
  deleteProviderDocumentConsentForUser,
} from "./provider-document-consents";
import { addProviderDocuments, deleteProviderDocumentsForUser } from "./provider-documents";
import { deleteProviderServicesForUser, setProviderServiceCategoryIds } from "./provider-services";
import { isServiceCategoryId } from "./service-catalog";
import { deleteUserById, registerUser, type RegisterInput, type RegisterResult } from "./users";

/**
 * Kayıt sırasında (kullanıcı kaydı tamamlanmadan ÖNCE) zaten doğrulanıp
 * IndexedDB'ye yazılmış (bkz. photo-blob-store.ts, provider-document-upload.tsx)
 * bir Faaliyet Belgesi/Raporu — bu tip, henüz hiçbir kullanıcıya
 * BAĞLANMAMIŞ bir dosyayı temsil eder.
 */
export type ProviderRegistrationDocumentInput = {
  indexedDbStorageKey: string;
  originalFileName: string;
  mimeType: string;
  extension: string;
  size: number;
};

export type RegisterProviderInput = RegisterInput & {
  serviceCategoryIds: string[];
  documents: ProviderRegistrationDocumentInput[];
  /** Kullanıcı "Belge Doğruluk Beyanı" kutusunu işaretlemiş olmalıdır — burada da (arayüzden bağımsız) tekrar doğrulanır. */
  documentDeclarationAccepted: boolean;
};

/**
 * Hizmet Veren kaydının TÜM adımlarını (kullanıcı + hizmet seçimi + belge
 * metadata'sı + doğruluk beyanı) TEK bir "hepsi ya da hiçbiri" işlem gibi
 * yürüten servis katmanı — UI (login-form.tsx) doğrudan users.ts/
 * provider-services.ts/provider-documents.ts/provider-document-consents.ts'i
 * ayrı ayrı çağırmaz, yalnızca bu TEK fonksiyonu çağırır (görev gereksinimi:
 * "typed repository/service katmanı arkasında kur").
 *
 * Bu depoda gerçek bir veritabanı transaction'ı YOKTUR (bkz. CLAUDE.md "No
 * real backend") — atomiklik burada ELLE, sırayla yazıp herhangi bir adım
 * başarısız olduğunda o ana kadar yazılmış OLAN HER ŞEYİ (kullanıcı kaydı
 * dahil) geri alarak SİMÜLE edilir. job-store.ts#createJobsForOperation'daki
 * "kısmi yazımdan sonra geri al" deseniyle AYNI mantık, yalnızca tek bir
 * tabloya değil dört tabloya (+ IndexedDB blob'larına) yayılmış hâli.
 *
 * Belgeler bu fonksiyon çağrılmadan ÖNCE zaten IndexedDB'ye yazılmıştır
 * (kullanıcı formu doldururken görebilsin/silebilsin diye, bkz.
 * provider-document-upload.tsx) — bu yüzden HER başarısızlık yolunda
 * (registerUser'ın kendisi dahil) bu blob'lar da silinir; "Dosya yüklenip
 * kullanıcı kaydı tamamlanamazsa yüklenen geçici dosyalar temizlenir"
 * gereksinimini karşılayan tek nokta burasıdır.
 */
export async function registerProviderAccount(input: RegisterProviderInput): Promise<RegisterResult> {
  const documentStorageKeys = input.documents.map((doc) => doc.indexedDbStorageKey);

  async function failWithCleanup(error: string): Promise<RegisterResult> {
    await deletePhotoBlobs(documentStorageKeys);
    return { ok: false, error };
  }

  if (input.role !== "hizmet-veren") {
    return failWithCleanup("Bu kayıt yolu yalnızca Hizmet Veren hesapları içindir.");
  }

  const validServiceIds = input.serviceCategoryIds.filter(isServiceCategoryId);
  if (validServiceIds.length === 0) {
    return failWithCleanup("En az bir hizmet seçmelisiniz.");
  }
  if (input.documents.length === 0) {
    return failWithCleanup("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.");
  }
  if (!input.documentDeclarationAccepted) {
    return failWithCleanup("Belge doğruluk beyanını kabul etmelisiniz.");
  }

  const userResult = await registerUser(input);
  if (!userResult.ok) {
    return failWithCleanup(userResult.error);
  }
  const userId = userResult.user.id;

  async function rollbackUser(error: string): Promise<RegisterResult> {
    await deleteUserById(userId);
    deleteProviderServicesForUser(userId);
    deleteProviderDocumentsForUser(userId);
    deleteProviderDocumentConsentForUser(userId);
    await deletePhotoBlobs(documentStorageKeys);
    return { ok: false, error };
  }

  if (!setProviderServiceCategoryIds(userId, validServiceIds)) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  const documentsOk = addProviderDocuments(
    userId,
    input.documents.map((doc) => ({
      originalFileName: doc.originalFileName,
      mimeType: doc.mimeType,
      extension: doc.extension,
      size: doc.size,
      indexedDbStorageKey: doc.indexedDbStorageKey,
    })),
  );
  if (!documentsOk) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  if (!recordProviderDocumentConsent(userId)) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  return { ok: true, user: userResult.user };
}
