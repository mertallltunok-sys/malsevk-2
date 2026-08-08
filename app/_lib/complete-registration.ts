import { isCompanyType, type CompanyType } from "./company-type";
import { isCustomsBrokerProvider, isGeneralDocumentRequired } from "./customs-license";
import { getAllLegalDocuments } from "./legal-documents";
import { recordConsentForAllLegalDocuments, getLegalConsents } from "./legal-consent";
import { STORAGE_WRITE_ERROR_MESSAGE } from "./local-storage";
import {
  hasAcceptedProviderDocumentDeclaration,
  recordProviderDocumentConsent,
  CUSTOMS_LICENSE_STATEMENT_ID,
  GENERAL_DOCUMENT_STATEMENT_ID,
  PROVIDER_DOCUMENT_DECLARATION_VERSION,
  CUSTOMS_LICENSE_DECLARATION_VERSION,
} from "./provider-document-consents";
import { addProviderDocuments, getProviderDocumentsForUser, CUSTOMS_LICENSE_DOCUMENT_TYPE } from "./provider-documents";
import { getPhotoBlob } from "./photo-blob-store";
import { normalizePhoneNumber } from "./phone";
import type { ProviderRegistrationDocumentInput } from "./provider-registration";
import { setProviderServiceCategoryIds } from "./provider-services";
import { isServiceCategoryId } from "./service-catalog";
import { uploadAndRegisterProviderDocument } from "./supabase-provider-documents";
import { setMyProviderServiceCategoriesRemote } from "./supabase-provider-services";
import { createSupabaseBrowserClient } from "./supabase/browser-client";
import type { UserRole } from "./types";
import { upsertSupabaseUserMirror } from "./users";

/**
 * SUPABASE AUTH GEÇİŞİ: `provider-registration.ts#registerProviderAccount`in
 * (ESKİ akış — `crypto.randomUUID()` ile KENDİ id'sini üreten, tek adımlı,
 * senkron bir `registerUser` çağrısına dayanan) Supabase Auth SONRASI karşılığı.
 * Kayıt artık İKİ AŞAMALIDIR — `signUp()` (login-form.tsx) ve bu fonksiyon
 * (email doğrulaması SONRASI, `complete_registration` RPC'siyle) — bu yüzden
 * eski fonksiyon YERİNE değil, ONUN YANINA yazıldı; `provider-registration.ts`
 * dokunulmadan bırakıldı (bu görevin kapsamı dışı, hâlâ mevcut ama artık
 * `login-form.tsx` tarafından çağrılmıyor).
 *
 * İKİ ÇAĞIRAN vardır: `login-form.tsx` (signUp anında Supabase zaten aktif
 * bir oturum döndürdüyse — e-posta doğrulaması bu projede kapalıysa — ANINDA)
 * ve `app/kayit-tamamla` (normal akış: e-posta doğrulama linkine tıklandıktan
 * SONRA, `app/auth/confirm`in yönlendirdiği yer). İkisi de AYNI bu fonksiyonu
 * çağırır — mantık iki yerde asla tekrarlanmaz.
 *
 * TEKRAR ÇAĞRILMAYA DAYANIKLIDIR (idempotent): `complete_registration`
 * zaten tamamlanmışsa (RPC'yi yeniden ÇAĞIRMAZ — `profiles.role` doluysa
 * atlanır, ML101'i beklemez) ve provider-services/documents/consents
 * yazımları da kendi doğal "zaten varsa atla" kontrollerini kullanır — bu,
 * `/kayit-tamamla`in aynı taslağı yanlışlıkla iki kez göndermesi veya bir ağ
 * hatası sonrası kullanıcının "Tekrar Dene"ye basması gibi durumlarda hiçbir
 * yinelenmiş kayıt/hata üretmez.
 */
export type CompleteRegistrationInput = {
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  companyType: CompanyType;
  province: string;
  district: string;
  /** Yalnızca role "hizmet-veren" iken anlamlıdır. */
  providerServiceCategoryIds: string[];
  /** Yalnızca role "hizmet-veren" iken anlamlıdır — belgeler bu fonksiyon çağrılmadan ÖNCE IndexedDB'ye zaten yazılmış olmalıdır (bkz. provider-document-upload.tsx, mevcut akışla AYNI). */
  providerDocuments: ProviderRegistrationDocumentInput[];
  documentDeclarationAccepted: boolean;
  customsLicenseDocument?: ProviderRegistrationDocumentInput;
  customsLicenseDeclarationAccepted: boolean;
  legalConsentAccepted: boolean;
};

export type CompleteRegistrationResult = { ok: true } | { ok: false; error: string };

type ProfileRoleSnapshot = { role: UserRole | null };

/**
 * PROFİL/PROVIDER GEÇİŞİ (bu görev): `record_legal_consent`/
 * `record_provider_document_consent` GERÇEK, ÇALIŞAN RPC'lerdir (bkz.
 * supabase/migrations/0007/0008 — provider_services'in aksine bu ikisi
 * migration ihtiyacı bulunan alanlar DEĞİLDİR). Yerel (localStorage) yazımın
 * YANINA eklenir (dual-write): yerel yazım hâlâ ana akışı bloke eden/rollback
 * tetikleyen taraf, Supabase yazımı EN İYİ ÇABA — başarısız olursa kayıt
 * akışını KESMEZ (kullanıcı bunu tekrar deneyemez/görmez), yalnızca
 * `console.error` ile loglanır. Bu asimetri bilinçlidir: RPC'ler idempotent
 * olduğu için (ON CONFLICT DO NOTHING + var olanı döndürme) bir sonraki
 * gerçek Supabase-okuma-yazma turunda kendiliğinden tutarlı hâle gelir.
 */
async function recordLegalConsentsRemote(supabase: ReturnType<typeof createSupabaseBrowserClient>): Promise<void> {
  for (const document of getAllLegalDocuments()) {
    const { error } = await supabase.rpc("record_legal_consent", {
      p_document_id: document.id,
      p_version: document.version,
    });
    if (error) console.error(`record_legal_consent (${document.id}) başarısız:`, error.message);
  }
}

async function recordProviderDocumentConsentRemote(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  statementId: typeof GENERAL_DOCUMENT_STATEMENT_ID | typeof CUSTOMS_LICENSE_STATEMENT_ID,
  version: string,
): Promise<void> {
  const { error } = await supabase.rpc("record_provider_document_consent", {
    p_statement_id: statementId,
    p_statement_version: version,
  });
  if (error) console.error(`record_provider_document_consent (${statementId}) başarısız:`, error.message);
}

/**
 * PROFİL/PROVIDER GEÇİŞİ (tur 3): `create_provider_document` RPC'si (bkz.
 * supabase/migrations/0023_provider_profile_and_document_write_paths.sql)
 * — consent RPC'lerinin AKSİNE bu RPC idempotent DEĞİLDİR (ON CONFLICT
 * yoktur, her çağrı YENİ bir satır üretir) — bu yüzden retry güvenliği
 * ayrı, açık bir kontrolle sağlanır: uzakta bu kullanıcının ZATEN en az bir
 * `provider_documents` satırı varsa (bkz. `getProviderDocumentsForUser`in
 * yerel eşdeğeri) hiç tekrar denenmez. IndexedDB blob'u bir nedenle
 * okunamazsa (ör. bu sekmede artık erişilemiyor) o belge sessizce atlanır —
 * yerel sistem hâlâ ana/bloklamayan yol olduğu için genel sonucu etkilemez.
 */
async function registerProviderDocumentsRemote(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  documents: { doc: ProviderRegistrationDocumentInput; documentType: "genel" | "gumruk-musaviri-izin-belgesi" }[],
): Promise<void> {
  const { data: existingRemoteDocs } = await supabase
    .from("provider_documents")
    .select("id")
    .eq("provider_id", userId)
    .limit(1);
  if (existingRemoteDocs && existingRemoteDocs.length > 0) return;

  for (const { doc, documentType } of documents) {
    const blob = await getPhotoBlob(doc.indexedDbStorageKey).catch(() => null);
    if (!blob) {
      console.error(`Belge blob'u okunamadı (${doc.originalFileName}), Storage'a yüklenemedi.`);
      continue;
    }
    const result = await uploadAndRegisterProviderDocument({
      blob,
      extension: doc.extension,
      mimeType: doc.mimeType,
      originalFileName: doc.originalFileName,
      sizeBytes: doc.size,
      documentType,
    });
    if (!result.ok) console.error(`Belge merkezi depoya kaydedilemedi (${doc.originalFileName}):`, result.error);
  }
}

function mapCompleteRegistrationRpcError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "ML100":
      return "Geçersiz hesap türü.";
    case "ML102":
      return "Ad Soyad, telefon, firma adı, il ve ilçe alanlarının tümü zorunludur.";
    case "ML103":
      return "Hesabınız bulunamadı. Lütfen tekrar giriş yapmayı deneyin.";
    default:
      return error.message || "Kayıt tamamlanırken bir hata oluştu.";
  }
}

export async function finishSupabaseRegistration(
  input: CompleteRegistrationInput,
): Promise<CompleteRegistrationResult> {
  const supabase = createSupabaseBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Oturumunuz bulunamadı. Lütfen tekrar giriş yapmayı deneyin." };
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<ProfileRoleSnapshot>();

  // Normalize edilmemiş telefon (ör. "0532 111 22 33" — form/draft/metadata
  // alanı hiçbiri normalize etmez, yalnızca register-form-validation.ts
  // DOĞRULAMA amacıyla normalize eder, sonucu geri DÖNDÜRMEZ) doğrudan
  // `complete_registration`e geçilirse `profiles.phone`in "+905XXXXXXXXX"
  // CHECK kısıtını ihlal eder — users.ts#registerUser/supabase-profile-
  // update.ts İLE AYNI, buraya kadar hiç uygulanmamış desen.
  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.ok) {
    return { ok: false, error: phoneResult.error };
  }
  const normalizedPhone = phoneResult.value;

  if (!existingProfile?.role) {
    if (input.role !== "hizmet-alan" && input.role !== "hizmet-veren") {
      return { ok: false, error: "Geçersiz hesap türü." };
    }
    if (!isCompanyType(input.companyType)) {
      return { ok: false, error: "Firma tipi zorunludur." };
    }

    const { error: rpcError } = await supabase.rpc("complete_registration", {
      p_role: input.role,
      p_full_name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      p_phone: normalizedPhone,
      p_company_name: input.companyName,
      p_company_type: input.companyType,
      p_province: input.province,
      p_district: input.district,
    });
    // ML101 ("zaten tamamlanmış") bir yarış durumunda (ör. çift gönderim)
    // beklenen ve ZARARSIZDIR — aşağıdaki adımlara olduğu gibi devam edilir,
    // hata olarak raporlanmaz.
    if (rpcError && rpcError.code !== "ML101") {
      return { ok: false, error: mapCompleteRegistrationRpcError(rpcError) };
    }
  }

  // Rol her zaman veritabanındaki GERÇEK/kesinleşmiş değerden alınır — bir
  // önceki denemede farklı bir rolle tamamlanmışsa, bu formun (yeniden
  // gönderilmiş) rol seçimi sessizce göz ardı edilir; aşağıdaki hiçbir yazım
  // veritabanındaki gerçek rolle çelişmez.
  const effectiveRole: UserRole = existingProfile?.role ?? input.role;

  const mirrorOk = upsertSupabaseUserMirror({
    id: user.id,
    name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
    email: user.email ?? "",
    phone: normalizedPhone,
    role: effectiveRole,
    companyName: input.companyName,
    companyType: input.companyType,
    province: input.province,
    district: input.district,
  });
  if (!mirrorOk) {
    return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
  }

  if (effectiveRole === "hizmet-veren") {
    const validServiceIds = input.providerServiceCategoryIds.filter(isServiceCategoryId);
    if (validServiceIds.length === 0) {
      return { ok: false, error: "En az bir hizmet seçmelisiniz." };
    }

    const generalDocumentRequired = isGeneralDocumentRequired(validServiceIds);
    if (generalDocumentRequired && input.providerDocuments.length === 0) {
      return { ok: false, error: "En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz." };
    }
    if (generalDocumentRequired && !input.documentDeclarationAccepted) {
      return { ok: false, error: "Belge doğruluk beyanını kabul etmelisiniz." };
    }

    const isCustomsBrokerRegistration = isCustomsBrokerProvider(validServiceIds);
    if (isCustomsBrokerRegistration) {
      if (!input.customsLicenseDocument) {
        return { ok: false, error: "Gümrük Müşaviri İzin Belgesi yüklemelisiniz." };
      }
      if (!input.customsLicenseDeclarationAccepted) {
        return { ok: false, error: "Yüklediğiniz belgenin size ait ve güncel olduğunu onaylamalısınız." };
      }
    }

    if (!setProviderServiceCategoryIds(user.id, validServiceIds)) {
      return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
    }
    // GERÇEK provider_services yazımı (set_provider_service_categories RPC,
    // 0014) — yerel yazımın YANINDA, en iyi çaba (bkz. bu dosyanın consent
    // yardımcılarının üstündeki AYNI asimetri gerekçesi).
    const remoteServicesResult = await setMyProviderServiceCategoriesRemote(validServiceIds);
    if (!remoteServicesResult.ok) console.error("set_provider_service_categories başarısız:", remoteServicesResult.error);

    // Belgeler yalnızca hiç yoksa yazılır — tekrar çağrılmaya dayanıklılık
    // (users.ts#seedNakliyeciProviderProfileIfNeeded ile AYNI "yalnızca
    // eksikse kur" deseni).
    if (getProviderDocumentsForUser(user.id).length === 0) {
      const documentsOk = addProviderDocuments(user.id, [
        ...input.providerDocuments.map((doc) => ({
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
        return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
      }
    }

    // GERÇEK provider_documents yazımı (Storage upload + create_provider_
    // document RPC, tur 3) — yerel/IndexedDB yazımının YANINDA, en iyi çaba.
    await registerProviderDocumentsRemote(supabase, user.id, [
      ...input.providerDocuments.map((doc) => ({ doc, documentType: "genel" as const })),
      ...(input.customsLicenseDocument
        ? [{ doc: input.customsLicenseDocument, documentType: CUSTOMS_LICENSE_DOCUMENT_TYPE }]
        : []),
    ]);

    if (input.providerDocuments.length > 0) {
      if (!hasAcceptedProviderDocumentDeclaration(user.id) && !recordProviderDocumentConsent(user.id)) {
        return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
      }
      await recordProviderDocumentConsentRemote(supabase, GENERAL_DOCUMENT_STATEMENT_ID, PROVIDER_DOCUMENT_DECLARATION_VERSION);
    }
    if (isCustomsBrokerRegistration) {
      if (
        !hasAcceptedProviderDocumentDeclaration(user.id, CUSTOMS_LICENSE_STATEMENT_ID) &&
        !recordProviderDocumentConsent(user.id, CUSTOMS_LICENSE_STATEMENT_ID)
      ) {
        return { ok: false, error: STORAGE_WRITE_ERROR_MESSAGE };
      }
      await recordProviderDocumentConsentRemote(supabase, CUSTOMS_LICENSE_STATEMENT_ID, CUSTOMS_LICENSE_DECLARATION_VERSION);
    }
  }

  if (input.legalConsentAccepted) {
    if (!getLegalConsents().some((consent) => consent.userId === user.id)) {
      recordConsentForAllLegalDocuments(user.id);
    }
    await recordLegalConsentsRemote(supabase);
  }

  return { ok: true };
}
