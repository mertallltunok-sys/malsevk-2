import { CUSTOMS_LICENSE_DOCUMENT_TYPE, getProviderDocumentsForUser } from "./provider-documents";
import { GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID } from "./service-catalog";
import type { ProviderDocumentReviewStatus } from "./types";

/**
 * GÜMRÜK MÜŞAVİRLİĞİ'NE ÖZEL kayıt/belge-türü mantığı — Gümrük Müşavirliği'nin
 * kendi "Gümrük Müşaviri İzin Belgesi" (bkz. provider-documents.ts#
 * CUSTOMS_LICENSE_DOCUMENT_TYPE) genel Faaliyet Belgesi/Raporu'nun YERİNE
 * ne zaman geçtiğini belirler (kayıt formu doğrulaması için).
 *
 * TEKLİF VERME YETKİSİ artık bu modülden DEĞİL, genelleştirilmiş HİZMET
 * BAZLI YETKİLENDİRME sisteminden gelir (bkz. job-visibility.ts,
 * supabase-provider-service-authorizations.ts, migration 0038) — eski
 * `canSubmitOffersAsCustomsBroker` (yalnızca Gümrük Müşavirliği'ne özel,
 * SİTE GENELİNDE teklif engelleyen bir kapı) 0038 ile RETİRE edildi:
 * job-visibility.ts artık HER hizmet için (Gümrük Müşavirliği dahil) aynı
 * "admin onaylı yetkilendirme yoksa görünmez/teklif veremez" kuralını
 * genel olarak uyguluyor, bu yüzden ayrı/ikinci bir kapı gerekmiyordu.
 */

/** `serviceCategoryIds` çağıranın zaten okuduğu (provider-services.ts) güncel hizmet kümesidir — ikinci bir localStorage okuması yapmaz. */
export function isCustomsBrokerProvider(serviceCategoryIds: string[]): boolean {
  return serviceCategoryIds.includes(GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID);
}

/**
 * Bir Hizmet Veren kaydının seçtiği hizmet kümesi TAMAMEN ve YALNIZCA Gümrük
 * Müşavirliği'nden mi ibaret? — bu durumda kendi özel "Gümrük Müşaviri İzin
 * Belgesi" genel Faaliyet Belgesi/Raporu'nun YERİNİ alır (bkz.
 * `isGeneralDocumentRequired`). Başka en az bir kategori daha seçiliyse (ör.
 * Gümrük Müşavirliği + Lashing) bu `false` döner — o durumda genel belge
 * kuralı, DİĞER kategoriler için zaten var olan/değişmeyen global KYC
 * kuralından dolayı aynen uygulanmaya devam eder (körlemesine kaldırılmaz).
 *
 * Kayıt formu (login-form.tsx), istemci doğrulaması (register-form-validation.ts)
 * ve sunucu/veri katmanı doğrulaması (provider-registration.ts) ÜÇÜ DE bu TEK
 * fonksiyonu çağırır — aynı mantık üç yerde ayrı ayrı yazılmaz, bu yüzden
 * hangi belgenin ne zaman zorunlu olduğu asla birbirinden sapamaz.
 */
export function isCustomsOnlyRegistration(serviceCategoryIds: string[]): boolean {
  return serviceCategoryIds.length === 1 && serviceCategoryIds[0] === GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID;
}

/**
 * Genel Faaliyet Belgesi/Raporu zorunluluğunun (mevcut, TÜM Hizmet Veren
 * kayıtları için geçerli global KYC kuralı — bkz. provider-registration.ts'in
 * kendi dokümantasyonu) bu seçim için hâlâ geçerli olup olmadığı. Yalnızca
 * Gümrük Müşavirliği TEK seçiliyken `false` döner; hiçbir kategori seçilmemiş
 * olsa bile (henüz seçim yapılmamış varsayılan durum) ya da Gümrük
 * Müşavirliği DIŞINDA en az bir kategori seçiliyse `true` döner — mevcut
 * davranış (Nakliye/Lashing/Depolama/Gözetim/Forklift/vb. için) hiç değişmez.
 */
export function isGeneralDocumentRequired(serviceCategoryIds: string[]): boolean {
  return !isCustomsOnlyRegistration(serviceCategoryIds);
}

/** Bir kullanıcının Gümrük Müşaviri İzin Belgesi kaydı — birden fazla yüklenmiş olsa bile EN SON eklenen esas alınır (aynı belge türünden ikinci bir yükleme normal akışta olmaz, ama savunma amaçlı). */
export function getCustomsLicenseDocumentForUser(userId: string) {
  const documents = getProviderDocumentsForUser(userId).filter(
    (doc) => doc.documentType === CUSTOMS_LICENSE_DOCUMENT_TYPE,
  );
  return documents.length > 0 ? documents[documents.length - 1] : null;
}

/** Belge hiç yüklenmemişse (beklenmeyen bir durum — kayıt bunu zorunlu kılar) "not_submitted" döner, sahte bir "pending" uydurulmaz. */
export function getCustomsLicenseStatus(userId: string): ProviderDocumentReviewStatus | "not_submitted" {
  return getCustomsLicenseDocumentForUser(userId)?.reviewStatus ?? "not_submitted";
}

