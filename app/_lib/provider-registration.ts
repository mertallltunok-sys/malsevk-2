import { STORAGE_WRITE_ERROR_MESSAGE } from "./local-storage";
import { deletePhotoBlobs } from "./photo-blob-store";
import {
  recordProviderDocumentConsent,
  deleteProviderDocumentConsentForUser,
  CUSTOMS_LICENSE_STATEMENT_ID,
} from "./provider-document-consents";
import {
  addProviderDocuments,
  deleteProviderDocumentsForUser,
  CUSTOMS_LICENSE_DOCUMENT_TYPE,
} from "./provider-documents";
import { deleteProviderServicesForUser, setProviderServiceCategoryIds } from "./provider-services";
import { isServiceCategoryId } from "./service-catalog";
import { deleteUserById, registerUser, type RegisterInput, type RegisterResult } from "./users";
import { isCustomsBrokerProvider, isGeneralDocumentRequired } from "./customs-license";

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
  /**
   * Yalnızca `serviceCategoryIds` Gümrük Müşavirliği içeriyorsa anlamlıdır ve
   * ZORUNLUDUR (bkz. customs-license.ts) — genel `documents` listesinden
   * AYRI tutulur çünkü kendi belge türüyle (CUSTOMS_LICENSE_DOCUMENT_TYPE)
   * etiketlenmesi ve kendi beyanıyla (customsLicenseDeclarationAccepted)
   * eşleşmesi gerekir. Seçilen hizmet kümesi TAMAMEN Gümrük Müşavirliği'nden
   * ibaretse (bkz. customs-license.ts#isCustomsOnlyRegistration) genel
   * Faaliyet Belgesi zorunluluğunun YERİNE geçer; başka bir kategori de
   * seçiliyse (ör. Gümrük + Lashing) genel belge kuralı diğer kategoriler
   * için zaten geçerli olduğundan bu ONUN YANINA eklenir.
   */
  customsLicenseDocument?: ProviderRegistrationDocumentInput;
  /** Yalnızca Gümrük Müşavirliği seçiliyken anlamlıdır — "Yüklediğim belge bana aittir ve günceldir." kutusu işaretlenmiş olmalıdır. */
  customsLicenseDeclarationAccepted?: boolean;
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
  const documentStorageKeys = [
    ...input.documents.map((doc) => doc.indexedDbStorageKey),
    ...(input.customsLicenseDocument ? [input.customsLicenseDocument.indexedDbStorageKey] : []),
  ];

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

  // Genel Faaliyet Belgesi/Raporu zorunluluğu (TÜM Hizmet Veren kayıtları
  // için geçerli global KYC kuralı) — yalnızca seçilen hizmet kümesi
  // TAMAMEN Gümrük Müşavirliği'nden ibaretse atlanır, çünkü o durumda kendi
  // özel "Gümrük Müşaviri İzin Belgesi" bu rolü zaten üstlenir (bkz.
  // customs-license.ts#isGeneralDocumentRequired, TEK doğruluk kaynağı).
  // Gümrük Müşavirliği başka bir kategoriyle BİRLİKTE seçiliyse (ör.
  // Gümrük + Lashing) bu kural diğer kategoriler için aynen geçerli kalır.
  const generalDocumentRequired = isGeneralDocumentRequired(validServiceIds);
  if (generalDocumentRequired && input.documents.length === 0) {
    return failWithCleanup("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.");
  }
  if (generalDocumentRequired && !input.documentDeclarationAccepted) {
    return failWithCleanup("Belge doğruluk beyanını kabul etmelisiniz.");
  }

  // Gümrük Müşavirliği ek KYC gereksinimi (bkz. customs-license.ts) — Gümrük
  // Müşavirliği seçili olduğu sürece (tek başına veya başka kategorilerle
  // birlikte) her zaman zorunludur.
  const isCustomsBrokerRegistration = isCustomsBrokerProvider(validServiceIds);
  if (isCustomsBrokerRegistration) {
    if (!input.customsLicenseDocument) {
      return failWithCleanup("Gümrük Müşaviri İzin Belgesi yüklemelisiniz.");
    }
    if (!input.customsLicenseDeclarationAccepted) {
      return failWithCleanup("Yüklediğiniz belgenin size ait ve güncel olduğunu onaylamalısınız.");
    }
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

  const documentsOk = addProviderDocuments(userId, [
    ...input.documents.map((doc) => ({
      originalFileName: doc.originalFileName,
      mimeType: doc.mimeType,
      extension: doc.extension,
      size: doc.size,
      indexedDbStorageKey: doc.indexedDbStorageKey,
    })),
    ...(input.customsLicenseDocument
      ? [
          {
            originalFileName: input.customsLicenseDocument.originalFileName,
            mimeType: input.customsLicenseDocument.mimeType,
            extension: input.customsLicenseDocument.extension,
            size: input.customsLicenseDocument.size,
            indexedDbStorageKey: input.customsLicenseDocument.indexedDbStorageKey,
            documentType: CUSTOMS_LICENSE_DOCUMENT_TYPE,
          },
        ]
      : []),
  ]);
  if (!documentsOk) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  // Genel "Belge Doğruluk Beyanı" yalnızca gerçekten bir genel belge
  // yüklendiyse kaydedilir — Gümrük Müşavirliği TEK seçiliyken (yukarıda
  // `generalDocumentRequired === false`) `input.documents` zaten boştur,
  // var olmayan bir belge için sahte bir beyan kaydı üretilmez.
  if (input.documents.length > 0 && !recordProviderDocumentConsent(userId)) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  if (isCustomsBrokerRegistration && !recordProviderDocumentConsent(userId, CUSTOMS_LICENSE_STATEMENT_ID)) {
    return rollbackUser(STORAGE_WRITE_ERROR_MESSAGE);
  }

  return { ok: true, user: userResult.user };
}
