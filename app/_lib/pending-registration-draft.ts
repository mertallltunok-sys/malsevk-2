import { isCompanyType, type CompanyType } from "./company-type";
import type { ProviderRegistrationDocumentInput } from "./provider-registration";
import type { UserRole } from "./types";

/**
 * SUPABASE AUTH GEÇİŞİ — e-posta doğrulaması gerektiğinden (bkz. login-form.tsx
 * dokümantasyonu), `signUp()` ile `complete_registration` RPC'si çağrısı
 * arasında gerçek zamanlı, dakikalar sürebilen bir boşluk vardır. Bu modül,
 * o boşluğu KAYIPSIZ kapatmanın yalnızca AYNI SEKME/TARAYICI bağlamı için
 * çalışan, en iyi çaba yoludur: kayıt formundaki HASSAS OLMAYAN
 * tamamlayıcı bilgileri (asla şifre, asla e-posta/kimlik bilgisi — yalnızca
 * kayıt formunun geri kalan alanları) `sessionStorage`a yazar.
 *
 * BİLİNÇLİ SINIRLAMA: e-posta istemcileri doğrulama linkini çoğunlukla YENİ
 * bir sekmede/pencerede açar — `sessionStorage` sekmeler arasında
 * PAYLAŞILMAZ, bu yüzden bu taslak o durumda (ve farklı bir cihazda açma,
 * tarayıcı verisi temizleme gibi durumlarda) bulunamaz. Bu YALNIZCA bir
 * kolaylık katmanıdır, tek doğruluk kaynağı DEĞİLDİR — `app/kayit-tamamla`
 * taslak bulunamadığında kullanıcıya AYNI bilgileri yeniden soran gerçek bir
 * form gösterir (bkz. o sayfanın dokümantasyonu, "en az zarar veren güvenli
 * yaklaşım" kararı için).
 */
const DRAFT_STORAGE_KEY = "malsevk.pending-registration-draft.v1";

export type PendingRegistrationDraft = {
  role: UserRole;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  companyType: CompanyType;
  province: string;
  district: string;
  providerServiceCategoryIds: string[];
  providerDocuments: ProviderRegistrationDocumentInput[];
  documentDeclarationAccepted: boolean;
  customsLicenseDocument?: ProviderRegistrationDocumentInput;
  customsLicenseDeclarationAccepted: boolean;
  legalConsentAccepted: boolean;
};

function isValidDocumentInput(value: unknown): value is ProviderRegistrationDocumentInput {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.indexedDbStorageKey === "string" &&
    typeof doc.originalFileName === "string" &&
    typeof doc.mimeType === "string" &&
    typeof doc.extension === "string" &&
    typeof doc.size === "number"
  );
}

function isValidDraft(value: unknown): value is PendingRegistrationDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    (draft.role === "hizmet-alan" || draft.role === "hizmet-veren") &&
    typeof draft.firstName === "string" &&
    typeof draft.lastName === "string" &&
    typeof draft.phone === "string" &&
    typeof draft.companyName === "string" &&
    isCompanyType(draft.companyType) &&
    typeof draft.province === "string" &&
    typeof draft.district === "string" &&
    Array.isArray(draft.providerServiceCategoryIds) &&
    draft.providerServiceCategoryIds.every((id) => typeof id === "string") &&
    Array.isArray(draft.providerDocuments) &&
    draft.providerDocuments.every(isValidDocumentInput) &&
    typeof draft.documentDeclarationAccepted === "boolean" &&
    (draft.customsLicenseDocument === undefined || isValidDocumentInput(draft.customsLicenseDocument)) &&
    typeof draft.customsLicenseDeclarationAccepted === "boolean" &&
    typeof draft.legalConsentAccepted === "boolean"
  );
}

/** Şifre/e-posta/kimlik bilgisi bilerek ASLA bu taslağın bir parçası değildir. */
export function savePendingRegistrationDraft(draft: PendingRegistrationDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // En iyi çaba: yazılamazsa (gizli sekme, kota) yalnızca aynı-sekme
    // kolaylığı kaybolur — app/kayit-tamamla yine de yedek formu gösterir.
  }
}

export function readPendingRegistrationDraft(): PendingRegistrationDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingRegistrationDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // En iyi çaba temizlik.
  }
}
