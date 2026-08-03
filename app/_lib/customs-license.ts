import { CUSTOMS_LICENSE_DOCUMENT_TYPE, getProviderDocumentsForUser } from "./provider-documents";
import { getProviderServiceCategoryIds } from "./provider-services";
import { GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID } from "./service-catalog";
import type { ProviderDocumentReviewStatus } from "./types";

/**
 * GÜMRÜK MÜŞAVİRLİĞİ'NE ÖZEL ek ruhsat/lisans doğrulama kapısı — TEK
 * doğruluk kaynağı. Diğer hiçbir hizmete (Nakliye dahil) UYGULANMAZ; bu
 * bilerek böyledir (görev gereksinimi: yalnızca Gümrük Müşavirliği için
 * "Gümrük Müşaviri İzin Belgesi" onayı, teklif verme yetkisini açıp kapatır).
 *
 * Kural: `provider-services.ts` üzerinde kayıtlı hizmetleri arasında Gümrük
 * Müşavirliği BULUNAN bir Hizmet Veren, kendi "gumruk-musaviri-izin-belgesi"
 * türündeki belgesi (bkz. provider-documents.ts#CUSTOMS_LICENSE_DOCUMENT_TYPE)
 * `reviewStatus === "approved"` olana kadar HİÇBİR teklif veremez — belge
 * "pending" (inceleniyor) ya da "rejected" (reddedildi) iken de aynı şekilde
 * engellenir (görev gereksinimi ikisini de aynı şekilde ele alır). Gümrük
 * Müşavirliği seçili DEĞİLSE bu fonksiyon her zaman `true` döner — mevcut
 * hiçbir hizmetin (Nakliye/Lashing/Depolama/Gözetim/Forklift/vb.) teklif
 * verme davranışı bu modülle HİÇ etkileşmez.
 *
 * Giriş yapma/profil düzenleme/ilan görüntüleme bu kapıdan bağımsızdır —
 * bunlar zaten TÜM Hizmet Veren hesapları için belge onay durumundan
 * bağımsız olarak açıktır (görev gereksinimi), bu modül yalnızca teklif
 * verme eylemini (offers.ts#canProviderSubmitNewOffer/createOffer) kısıtlar.
 * İlan GÖRÜNÜRLÜĞÜ (hangi ilanları görebildiği) ayrı, bağımsız bir kuraldır
 * — bkz. job-visibility.ts; belge onay durumundan hiç etkilenmez.
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

/**
 * Teklif vermenin GÜMRÜK MÜŞAVİRLİĞİ'NE özel ek kapısı — offers.ts#
 * canProviderSubmitNewOffer/createOffer içinde, MEVCUT tüm kontrollerin
 * (görünürlük/kapasite/cooldown/vb.) YANINA eklenir, hiçbirinin YERİNE
 * geçmez. Gümrük Müşavirliği seçili olmayan bir Hizmet Veren için her zaman
 * `true` döner (davranış hiç değişmez).
 */
export function canSubmitOffersAsCustomsBroker(userId: string): boolean {
  const serviceCategoryIds = getProviderServiceCategoryIds(userId);
  if (!isCustomsBrokerProvider(serviceCategoryIds)) return true;
  return getCustomsLicenseStatus(userId) === "approved";
}
