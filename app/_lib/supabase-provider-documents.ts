import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { reportSystemError } from "./system-health";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * PROFİL/PROVIDER GEÇİŞİ (tur 3) — `provider-documents` bucket'ının
 * (private, bkz. supabase/migrations/0019_storage_policies.sql) Storage
 * yazımı ARTIK gerçek metadata RPC'siyle (`create_provider_document`, bkz.
 * supabase/migrations/0023_provider_profile_and_document_write_paths.sql)
 * birlikte kullanılıyor — `uploadAndRegisterProviderDocument` ikisini "önce
 * Storage'a yükle, SONRA RPC'yi çağır" sırasıyla (0019'un kendi ilkesi) TEK
 * bir fonksiyonda birleştirir. `complete-registration.ts` bunu yerel
 * (IndexedDB + localStorage `provider-documents.ts`) yazımın YANINA ekler
 * (dual-write) — yerel yazım hâlâ bloklamayan/ana yol.
 */
const BUCKET = "provider-documents";
const MAX_DOCUMENT_SIZE_BYTES = 15 * 1024 * 1024; // Bucket'ın kendi file_size_limit'i (0019) ile birebir.

export type UploadProviderDocumentToStorageResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

/** Yalnızca Storage'a yazar — provider_documents tablosuna HİÇBİR satır yazmaz. */
export async function uploadProviderDocumentToStorage(
  blob: Blob,
  extension: string,
  mimeType: string,
): Promise<UploadProviderDocumentToStorageResult> {
  if (blob.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { ok: false, error: `Belge boyutu ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB'ı geçemez.` };
  }
  if (blob.size === 0) {
    return { ok: false, error: "Dosya boş veya bozuk." };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Belge yüklemek için giriş yapmalısınız." };
  }

  const documentId = crypto.randomUUID();
  const path = `${user.id}/${documentId}.${extension}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mimeType });
  if (error) {
    return { ok: false, error: "Belge yüklenemedi. Lütfen tekrar deneyin." };
  }
  return { ok: true, path };
}

export type RegisterProviderDocumentInput = {
  blob: Blob;
  extension: string;
  mimeType: string;
  originalFileName: string;
  sizeBytes: number;
  documentType: "genel" | "gumruk-musaviri-izin-belgesi" | "depo-hizmetleri-belgesi" | "operator-is-makinesi-belgesi";
  /** HANGİ hizmeti desteklediği (migration 0038) — belirtilmezse NULL/genel belge (mevcut/eski davranış). Belirtilirse ÇAĞIRANIN `provider_services`'ında ÖNCEDEN var olmalı (RPC'nin kendi ML124 doğrulaması) — bu yüzden hizmet seçimini yazan çağrı (`set_provider_service_categories`) her zaman bundan ÖNCE tamamlanmış olmalıdır. */
  serviceCategoryId?: string;
  /** "Depocu Faaliyet Alanları" (migration 0059) — YALNIZCA belge konteyner-depolama'yı kapsıyorsa (tekil seçim ya da "Depo Hizmetleri" grup belgesi) anlamlı; diğer belgelerde her zaman undefined/null. storage-container-catalog.ts#StorageActivityScopeId değerleri. */
  storageActivityScopes?: string[];
  /** YALNIZCA storageActivityScopes içinde "dolu-tehlikeli-konteyner-depolama" varsa anlamlı — çoklu IMO sınıfı seçimi (storage-container-catalog.ts#ImoClassCode). */
  imoClassCodes?: string[];
  /** "Kimyasal Depolama / Tehlikeli Madde Depolama Risk Grupları" görevi (migration 0068) — provider'ın belge yüklerken KENDİSİNİN talep ettiği risk grupları (storage-hazard-catalog.ts#StorageRiskGroupId). Bu seçim OTOMATİK YETKİ VERMEZ — yalnızca admin'in review_provider_document'ta AYRI ONAYLADIĞI alt küme provider_storage_risk_authorizations'a yansır. */
  requestedStorageRiskGroups?: string[];
  /** "Geri Dönüşüm & Atık Tahliye Uçtan Uca Geliştirme" görevi (migration 0069) — requestedStorageRiskGroups İLE AYNI "yalnızca bir talep, otomatik yetki vermez" ilkesi, iki BAĞIMSIZ eksen: recycling-catalog.ts#RecyclingActivityId (faaliyet) ve recycling-waste-code-catalog.ts'in resmî kodları (atık kodu). */
  requestedRecyclingActivities?: string[];
  requestedRecyclingWasteCodes?: string[];
};

export type RegisterProviderDocumentResult = { ok: true } | { ok: false; error: string };

/**
 * 0024 (belge yaşam döngüsü): `create_provider_document`in MLK81'i — aynı
 * provider+document_type için zaten bir `pending` belge varken (çift tık,
 * ağ yeniden denemesi veya gerçek eşzamanlı istek) ikinci bir tane
 * oluşturma denemesi — artık ham İngilizce RPC istisna metni yerine
 * Türkçe, anlaşılır bir mesaja çevrilir. MLK80/93/94 önceden de var olan
 * (ve normal kullanımda pratikte hiç tetiklenmeyen, savunma-derinliği)
 * kodlardır — aynı yerde tutarlılık için burada da eşlenir.
 */
function mapCreateDocumentRpcError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK81":
      return "Bu belge türü için zaten inceleme bekleyen bir belgeniz var. Yeni bir belge yüklemeden önce lütfen mevcut belgenizin sonuçlanmasını bekleyin.";
    case "MLK80":
      return "Belge yolu geçersiz. Lütfen tekrar deneyin.";
    case "MLK93":
      return "Belge yüklemek için giriş yapmalısınız.";
    case "MLK94":
      return "Geçersiz belge türü.";
    case "ML124":
      return "Bu belgeyi ilişkilendirmek istediğiniz hizmet, seçtiğiniz hizmetler arasında değil. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "MLK97":
      return "Seçilen faaliyet alanlarından biri geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "MLK86":
      return "Seçilen IMO sınıflarından biri geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "ML138":
      return "Seçilen depolama risk gruplarından biri geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "ML142":
      return "Seçilen faaliyetlerden biri geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.";
    case "ML140":
      return "Seçilen atık kodlarından biri geçersiz. Lütfen sayfayı yenileyip tekrar deneyin.";
    default:
      return error.message || "Belge kaydedilemedi. Lütfen tekrar deneyin.";
  }
}

/** Storage'a yükler VE `create_provider_document` RPC'siyle metadata satırını yazar — bkz. modülün üstündeki dokümantasyon. */
export async function uploadAndRegisterProviderDocument(
  input: RegisterProviderDocumentInput,
): Promise<RegisterProviderDocumentResult> {
  const uploadResult = await uploadProviderDocumentToStorage(input.blob, input.extension, input.mimeType);
  if (!uploadResult.ok) {
    return uploadResult;
  }

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("create_provider_document", {
    p_document_type: input.documentType,
    p_storage_path: uploadResult.path,
    p_original_file_name: input.originalFileName,
    p_mime_type: input.mimeType,
    p_extension: input.extension,
    p_size_bytes: input.sizeBytes,
    p_service_category_id: input.serviceCategoryId ?? null,
    p_storage_activity_scopes: input.storageActivityScopes ?? null,
    p_imo_class_codes: input.imoClassCodes ?? null,
    p_requested_storage_risk_groups: input.requestedStorageRiskGroups ?? null,
    p_requested_recycling_activities: input.requestedRecyclingActivities ?? null,
    p_requested_recycling_waste_codes: input.requestedRecyclingWasteCodes ?? null,
  });
  if (error) {
    // Storage'da yetim (metadata'sız) bir dosya kalmasın diye geri alınır —
    // job-store.ts#persistPhotosOrRollback ile AYNI "kısmi başarıdan geri
    // dön" ilkesi. MLK81 (aynı türde zaten bir pending belge var) dahil HER
    // RPC hatasında çalışır — bu davranış 0024'ten ÖNCE de aynıydı, hiç
    // değişmedi.
    await deleteProviderDocumentFromStorage(uploadResult.path);
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "create_provider_document", affectedScreen: "Belge Yükleme" });
    return { ok: false, error: mapCreateDocumentRpcError(error) };
  }
  return { ok: true };
}

export async function listMyProviderDocumentPathsInStorage(): Promise<string[]> {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: files } = await supabase.storage.from(BUCKET).list(user.id, { limit: 100 });
  return (files ?? []).map((file) => `${user.id}/${file.name}`);
}

/** Private bucket — okuma yalnızca kısa ömürlü (varsayılan 5 dk) imzalı URL ile (bkz. 0019'un kendi yorumu). */
export async function createSignedUrlForProviderDocument(path: string): Promise<string | null> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function deleteProviderDocumentFromStorage(path: string): Promise<boolean> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}
