import { normalizePhoneNumber } from "./phone";
import { getAccountStatusErrorMessage } from "./supabase-mutation-errors";
import { reportSystemError } from "./system-health";
import { createSupabaseBrowserClient } from "./supabase/browser-client";

/**
 * Admin "Firmalar" modülü — yalnızca `role = 'hizmet-veren'` profiller.
 * Tamamı mevcut tablo/view'lardan okunur: profiles (0003), provider_profiles
 * (0003), provider_services + service_categories (0002/0003), provider_
 * document_status_summary (0017, view). Admin RLS dalı (`is_admin()`) her
 * birinde zaten var — bu yüzden düz `select`ler yeterli, service_role veya
 * RLS'i atlayan hiçbir sorgu yok.
 *
 * MAVİ TİK/ALTIN TİK KALDIRILDI (bkz. proje raporu §K): `provider_badges`/
 * `badge_types` (0025) artık BURADA okunmuyor/gösterilmiyor — dekoratif
 * rozet göstergesi yerine gerçek HİZMET BAZLI YETKİLENDİRME (migration 0038,
 * `getServiceAuthorizationsForAdmin`/`authorizeProviderServiceAsAdmin`/
 * `revokeProviderServiceAuthorizationAsAdmin`, bu dosyanın altında) geçti.
 * `provider_badges`/`badge_types` tabloları/RPC'leri DB'de dokunulmadan
 * duruyor (bağımlılık analizi: yalnızca `scripts/test-customs-documents-
 * and-badges.mjs`in kalıcı regresyon testi onları hâlâ DOĞRUDAN çağırıyor,
 * o test hiç değiştirilmedi) — yalnızca bu UI katmanındaki kullanım kaldırıldı.
 *
 * NOT: Görev "MERSİS / vergi bilgisi mevcutsa" göster diyor — bugünkü şemada
 * (profiles/provider_profiles) böyle bir kolon YOK (doğrudan kontrol edildi).
 * Bu modül bu alanı bilerek hiç render ETMEZ — icat edilmiş bir kolon/migration
 * yok, yalnızca gerçekten var olan alanlar gösterilir.
 *
 * Askıya alma/geri açma, `admin-requesters.ts` ("Hizmet Alanlar") ile AYNI
 * zaten var olan `suspend_user`/`reinstate_user` RPC'lerini (0016) çağırır —
 * ikinci bir askıya alma sistemi/RPC/migration YOK, yalnızca aynı RPC'lerin
 * `provider_id` yerine geçen ikinci bir çağrı noktası. Hata haritalama
 * (`mapUserStatusError`) kasıtlı olarak `admin-requesters.ts`teki ile birebir
 * aynı — bu iki modül arasında paylaşılan bir yardımcı dosya yok (kod tabanının
 * mevcut deseni: her admin modülü kendi hata haritasını taşır, bkz.
 * `admin-badges.ts#mapRevokeBadgeError`), o yüzden burada da tekrarlanıyor.
 */

export type AdminCompanyListItem = {
  id: string;
  companyName: string | null;
  fullName: string | null;
  phone: string | null;
  companyType: string | null;
  province: string | null;
  district: string | null;
  accountStatus: "active" | "suspended" | "banned";
  createdAt: string;
  serviceCategoryLabels: string[];
  documentSummary: { pending: number; approved: number; rejected: number; revisionRequested: number };
};

type ProfileRow = {
  id: string;
  company_name: string | null;
  full_name: string | null;
  phone: string | null;
  company_type: string | null;
  province: string | null;
  district: string | null;
  account_status: "active" | "suspended" | "banned";
  created_at: string;
};

export async function listCompaniesForAdmin(): Promise<AdminCompanyListItem[]> {
  const supabase = createSupabaseBrowserClient();

  const { data: profileRows, error: profilesError } = await supabase
    .from("profiles")
    .select("id, company_name, full_name, phone, company_type, province, district, account_status, created_at")
    .eq("role", "hizmet-veren")
    .order("created_at", { ascending: false });
  if (profilesError || !profileRows) return [];

  const providerIds = (profileRows as ProfileRow[]).map((row) => row.id);
  if (providerIds.length === 0) return [];

  const [servicesResult, summaryResult] = await Promise.all([
    supabase
      .from("provider_services")
      .select("provider_id, service_categories(name)")
      .in("provider_id", providerIds),
    supabase
      .from("provider_document_status_summary")
      .select("provider_id, pending_count, approved_count, rejected_count, revision_requested_count")
      .in("provider_id", providerIds),
  ]);

  // NOT: bu projede üretilmiş (generated) Supabase tipleri yok (bkz. diğer
  // supabase-*.ts dosyalarının hepsindeki manuel `as unknown as ...Row[]`
  // deseni). GERÇEK ÇALIŞMA ZAMANI ŞEKLİ (yerel Docker'a karşı doğrudan
  // doğrulandı): `service_categories(name)` TEKİL bir nesne döner (dizi
  // DEĞİL) — provider_services→service_categories tek yönlü bir FK (many-
  // to-one), PostgREST bunu tekil embed eder. `unknown` üzerinden cast bunu
  // supabase-js'in generated-type'sız fallback çıkarımından (hatalı biçimde
  // diziymiş gibi tipler) bağımsızlaştırır.
  const servicesByProvider = new Map<string, string[]>();
  for (const row of (servicesResult.data ?? []) as unknown as { provider_id: string; service_categories: { name: string } | null }[]) {
    const label = row.service_categories?.name;
    if (!label) continue;
    const existing = servicesByProvider.get(row.provider_id) ?? [];
    existing.push(label);
    servicesByProvider.set(row.provider_id, existing);
  }

  const summaryByProvider = new Map<
    string,
    { pending: number; approved: number; rejected: number; revisionRequested: number }
  >();
  for (const row of (summaryResult.data ?? []) as {
    provider_id: string;
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    revision_requested_count: number;
  }[]) {
    summaryByProvider.set(row.provider_id, {
      pending: row.pending_count,
      approved: row.approved_count,
      rejected: row.rejected_count,
      revisionRequested: row.revision_requested_count,
    });
  }

  return (profileRows as ProfileRow[]).map((row) => ({
    id: row.id,
    companyName: row.company_name,
    fullName: row.full_name,
    phone: row.phone,
    companyType: row.company_type,
    province: row.province,
    district: row.district,
    accountStatus: row.account_status,
    createdAt: row.created_at,
    serviceCategoryLabels: servicesByProvider.get(row.id) ?? [],
    documentSummary: summaryByProvider.get(row.id) ?? { pending: 0, approved: 0, rejected: 0, revisionRequested: 0 },
  }));
}

export type ServiceCategoryOption = { id: string; name: string };

/**
 * Filtre seçenekleri için — service_categories herkese açık okunabilir
 * (0013), admin'e özel bir şey yok. `is_active = true` filtresi: pasifleştirilmiş
 * bir kategori (bugün: yalnızca Konteyner Dolum/Boşaltım — bkz. migration 0049)
 * hiçbir şirkette artık seçili/yetkili olamayacağı için (0049'un trigger'ı
 * yeni satır oluşumunu engelliyor) admin filtre seçeneklerinde de görünmemeli;
 * geçmiş veri varsa (bugün yok) o şirketin kendi satırı yine de görünür,
 * yalnızca bu AÇILIR LİSTE filtrelenir.
 */
export async function listServiceCategoryOptions(): Promise<ServiceCategoryOption[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("service_categories")
    .select("id, name")
    .eq("is_active", true)
    .order("sort_order");
  if (error || !data) return [];
  return data as ServiceCategoryOption[];
}

export type AdminCompanyDetail = AdminCompanyListItem & {
  bio: string | null;
  foundedYear: number | null;
  experienceRange: string | null;
  regions: string[];
  serviceFeatures: string[];
};

export async function getCompanyDetailForAdmin(providerId: string): Promise<AdminCompanyDetail | null> {
  const supabase = createSupabaseBrowserClient();

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("id, company_name, full_name, phone, company_type, province, district, account_status, created_at, role")
    .eq("id", providerId)
    .maybeSingle();
  if (profileError || !profileRow || profileRow.role !== "hizmet-veren") return null;

  const [servicesResult, summaryResult, providerProfileResult] = await Promise.all([
    supabase.from("provider_services").select("service_categories(name)").eq("provider_id", providerId),
    supabase
      .from("provider_document_status_summary")
      .select("pending_count, approved_count, rejected_count, revision_requested_count")
      .eq("provider_id", providerId)
      .maybeSingle(),
    supabase
      .from("provider_profiles")
      .select("bio, founded_year, experience_range, regions, service_features")
      .eq("user_id", providerId)
      .maybeSingle(),
  ]);

  const serviceCategoryLabels = ((servicesResult.data ?? []) as unknown as { service_categories: { name: string } | null }[])
    .map((row) => row.service_categories?.name)
    .filter((label): label is string => Boolean(label));

  const summary = summaryResult.data as {
    pending_count: number;
    approved_count: number;
    rejected_count: number;
    revision_requested_count: number;
  } | null;

  const providerProfile = providerProfileResult.data as {
    bio: string | null;
    founded_year: number | null;
    experience_range: string | null;
    regions: string[] | null;
    service_features: string[] | null;
  } | null;

  return {
    id: profileRow.id,
    companyName: profileRow.company_name,
    fullName: profileRow.full_name,
    phone: profileRow.phone,
    companyType: profileRow.company_type,
    province: profileRow.province,
    district: profileRow.district,
    accountStatus: profileRow.account_status,
    createdAt: profileRow.created_at,
    serviceCategoryLabels,
    documentSummary: summary
      ? {
          pending: summary.pending_count,
          approved: summary.approved_count,
          rejected: summary.rejected_count,
          revisionRequested: summary.revision_requested_count,
        }
      : { pending: 0, approved: 0, rejected: 0, revisionRequested: 0 },
    bio: providerProfile?.bio ?? null,
    foundedYear: providerProfile?.founded_year ?? null,
    experienceRange: providerProfile?.experience_range ?? null,
    regions: providerProfile?.regions ?? [],
    serviceFeatures: providerProfile?.service_features ?? [],
  };
}

export type CompanyActionResult = { ok: true } | { ok: false; error: string };

/** `admin-requesters.ts#mapUserStatusError`'ın AYNI deseni — `suspend_user`/`reinstate_user` (0016) her iki modülde de aynı hata kodu setini döner. 0042 (assert_active_user): çağıran adminin KENDİ hesabı askıya alınmışsa (nadir bir durum — bkz. 0042'nin dosya başlığı) ML125/126/127 da dönebilir, getAccountStatusErrorMessage'a delege edilir. */
function mapUserStatusError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK82":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK76":
      return "Kullanıcı bulunamadı.";
    case "MLK91":
      return "Sistemdeki son aktif yönetici hesabı askıya alınamaz.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

/** suspend_user (0016) — admin-only, gerekçe UI'da zorunlu tutulur (RPC'nin kendisi boş string'i reddetmez, ama denetim kaydının anlamlı olması için burada zorunlu kılınır). */
export async function suspendCompanyRemote(providerId: string, reason: string): Promise<CompanyActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("suspend_user", { p_user_id: providerId, p_reason: reason.trim() });
  if (error) return { ok: false, error: mapUserStatusError(error) };
  return { ok: true };
}

/** reinstate_user (0016) — admin-only, gerekçe parametresi yok (RPC imzasında hiç yok). */
export async function reinstateCompanyRemote(providerId: string): Promise<CompanyActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("reinstate_user", { p_user_id: providerId });
  if (error) return { ok: false, error: mapUserStatusError(error) };
  return { ok: true };
}

export type AdminProfileEditInput = {
  fullName: string;
  phone: string;
  companyName: string;
  companyType: string;
  province: string;
  district: string;
};

/** `admin-requesters.ts#mapProfileEditError`'ın AYNI deseni — `update_profile_as_admin` (0036) her iki modülde de aynı hata kodu setini döner. */
function mapProfileEditError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "ML119":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "ML120":
      return "Kullanıcı bulunamadı.";
    case "ML102":
      return "Ad Soyad, firma adı, il ve ilçe alanlarının tümü zorunludur.";
    case "ML121":
      return "Telefon numarası +905XXXXXXXXX biçiminde olmalıdır.";
    case "ML122":
      return "Firma adı en fazla 150 karakter olabilir.";
    case "ML123":
      return "Geçersiz firma türü.";
    default:
      return error.message || "Profil güncellenemedi. Lütfen tekrar deneyin.";
  }
}

/** update_profile_as_admin (0036) — admin-only; profiles_update_own RLS politikası (id = auth.uid()) yalnızca bu SECURITY DEFINER RPC ile aşılabilir, doğrudan bir .update() çağrısı admin dahil kimse için başka bir satırı değiştiremez. Telefon, supabase-profile-update.ts#updateMyProfileRemote ile AYNI şekilde `normalizePhoneNumber` ile istemci tarafında normalize edilir — RPC'nin kendi `+905XXXXXXXXX` CHECK'iyle uyumlu tek biçim. */
export async function updateCompanyProfileAsAdmin(providerId: string, input: AdminProfileEditInput): Promise<CompanyActionResult> {
  const phoneResult = normalizePhoneNumber(input.phone);
  if (!phoneResult.ok) return { ok: false, error: phoneResult.error };

  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("update_profile_as_admin", {
    p_user_id: providerId,
    p_full_name: input.fullName,
    p_phone: phoneResult.value,
    p_company_name: input.companyName,
    p_company_type: input.companyType,
    p_province: input.province,
    p_district: input.district,
  });
  if (error) return { ok: false, error: mapProfileEditError(error) };
  return { ok: true };
}

/**
 * HİZMET BAZLI PROVIDER YETKİLENDİRMESİ (migration 0038) — admin "Firmalar"
 * detay ekranının "Hizmet Yetkileri" kartı için tek okuma/yazma noktası.
 * "Kullanıcının SEÇTİĞİ hizmetler" (provider_services) ile "Admin'in
 * ONAYLADIĞI hizmetler" (provider_service_authorizations) BİLEREK ayrı
 * kaynaklardan okunup burada TEK bir satır listesinde birleştirilir — bu iki
 * kavramın veri modelinde de ayrı kalması gerektiği için (bkz. migration
 * 0038'in kendi başlığı), İKİNCİ bir "seçim" tablosu İCAT EDİLMEDİ.
 */
export type ServiceAuthorizationDocumentStatus = "approved" | "pending" | "rejected" | "revision_requested" | "none";

export type ServiceAuthorizationRow = {
  serviceCategoryId: string;
  serviceCategoryLabel: string;
  selected: boolean;
  documentId: string | null;
  documentStatus: ServiceAuthorizationDocumentStatus;
  documentReviewNote: string | null;
  documentFileName: string | null;
  authorized: boolean;
  authorizedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

type ProviderServiceRow = { service_category_id: string; service_categories: { name: string } | null };
type ProviderDocumentRow = {
  id: string;
  service_category_id: string | null;
  document_type: string;
  current_review_status: ServiceAuthorizationDocumentStatus;
  current_review_note: string | null;
  original_file_name: string;
  uploaded_at: string;
};
type ProviderServiceAuthorizationRow = {
  service_category_id: string;
  authorized_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
};

/**
 * Bir belgenin hangi hizmet(ler)i desteklediğini çözer — belge doğrudan bir
 * `service_category_id` taşıyorsa YALNIZCA o hizmeti destekler (görev bölüm
 * 41'in "yanlış belgeyle yanlış hizmetin açılmasını engelle" ilkesi); belge
 * "genel" türdeyse VE provider'ın TEK seçili (Gümrük Müşavirliği olmayan)
 * hizmeti varsa örtük olarak o hizmeti destekler (mevcut, değişmeyen "tek
 * genel belge tüm seçimi kapsar" iş kuralı — görev bölüm 25's "mevcut iş
 * kuralı açıksa destekle" maddesi); 2+ hizmet seçiliyken "genel" bir belge
 * HİÇBİRİNE otomatik bağlanmaz (admin elle karar vermeli, section 6'nın
 * "otomatik yanlış eşleşmeyi engelle" ilkesi).
 */
function resolveDocumentSupportedCategoryIds(doc: ProviderDocumentRow, selectedNonCustomsIds: string[]): string[] {
  if (doc.document_type === "gumruk-musaviri-izin-belgesi") return ["gumruk-musavirligi"];
  if (doc.service_category_id) return [doc.service_category_id];
  if (selectedNonCustomsIds.length === 1) return selectedNonCustomsIds;
  return [];
}

export async function getServiceAuthorizationsForAdmin(providerId: string): Promise<ServiceAuthorizationRow[]> {
  const supabase = createSupabaseBrowserClient();
  const [servicesResult, documentsResult, authResult] = await Promise.all([
    supabase.from("provider_services").select("service_category_id, service_categories(name)").eq("provider_id", providerId),
    supabase
      .from("provider_documents")
      .select("id, service_category_id, document_type, current_review_status, current_review_note, original_file_name, uploaded_at")
      .eq("provider_id", providerId)
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("provider_service_authorizations")
      .select("service_category_id, authorized_at, revoked_at, revoke_reason")
      .eq("provider_id", providerId)
      .order("authorized_at", { ascending: false }),
  ]);

  const serviceRows = (servicesResult.data ?? []) as unknown as ProviderServiceRow[];
  const documentRows = (documentsResult.data ?? []) as ProviderDocumentRow[];
  const authRows = (authResult.data ?? []) as ProviderServiceAuthorizationRow[];

  const selectedNonCustomsIds = serviceRows.map((row) => row.service_category_id).filter((id) => id !== "gumruk-musavirligi");

  // Her hizmet için EN İYİ (en güncel approved varsa o, yoksa en güncel her ne ise) destekleyici belgeyi seç.
  const bestDocByCategory = new Map<string, ProviderDocumentRow>();
  for (const doc of documentRows) {
    for (const categoryId of resolveDocumentSupportedCategoryIds(doc, selectedNonCustomsIds)) {
      const existing = bestDocByCategory.get(categoryId);
      if (!existing || (doc.current_review_status === "approved" && existing.current_review_status !== "approved")) {
        bestDocByCategory.set(categoryId, doc);
      }
    }
  }

  // authRows zaten authorized_at DESC sıralı — bir kategori için en son (aktif YA DA en son revoke edilmiş) satırı tut.
  const authByCategory = new Map<string, ProviderServiceAuthorizationRow>();
  for (const row of authRows) {
    const existing = authByCategory.get(row.service_category_id);
    if (!existing) authByCategory.set(row.service_category_id, row);
    else if (existing.revoked_at !== null && row.revoked_at === null) authByCategory.set(row.service_category_id, row);
  }

  const categoryIds = new Set<string>([
    ...serviceRows.map((row) => row.service_category_id),
    ...authByCategory.keys(),
  ]);

  return Array.from(categoryIds).map((categoryId) => {
    const serviceRow = serviceRows.find((row) => row.service_category_id === categoryId);
    const doc = bestDocByCategory.get(categoryId) ?? null;
    const auth = authByCategory.get(categoryId) ?? null;
    return {
      serviceCategoryId: categoryId,
      serviceCategoryLabel: serviceRow?.service_categories?.name ?? categoryId,
      selected: Boolean(serviceRow),
      documentId: doc?.id ?? null,
      documentStatus: doc?.current_review_status ?? "none",
      documentReviewNote: doc?.current_review_note ?? null,
      documentFileName: doc?.original_file_name ?? null,
      authorized: auth !== null && auth.revoked_at === null,
      authorizedAt: auth?.authorized_at ?? null,
      revokedAt: auth?.revoked_at ?? null,
      revokeReason: auth?.revoke_reason ?? null,
    };
  });
}

function mapServiceAuthorizationError(error: { code?: string; message: string }): string {
  const accountStatusMessage = getAccountStatusErrorMessage(error.code);
  if (accountStatusMessage) return accountStatusMessage;
  switch (error.code) {
    case "MLK50":
      return "Bu işlem için yönetici girişi gereklidir.";
    case "MLK94":
      return "Geçersiz hizmet kategorisi.";
    case "ML106":
      return "Bu kullanıcı bir Hizmet Veren hesabı değil.";
    case "ML107":
      return "Yetkiyi kaldırmak için bir gerekçe girilmesi zorunludur.";
    case "ML105":
      return "Bu hizmet için zaten aktif bir yetki bulunmuyor.";
    case "MLK76":
      return "Belirtilen belge bu firmaya ait değil.";
    default:
      return error.message || "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  }
}

/** authorize_provider_service (0038) — admin-only, idempotent (zaten aktif bir yetkiyi yeniden onaylamak hata VERMEZ, yalnızca teyit eder). */
export async function authorizeProviderServiceAsAdmin(
  providerId: string,
  serviceCategoryId: string,
  sourceDocumentId?: string,
  reason?: string,
): Promise<CompanyActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("authorize_provider_service", {
    p_provider_id: providerId,
    p_service_category_id: serviceCategoryId,
    p_source_document_id: sourceDocumentId ?? null,
    p_reason: reason?.trim() || null,
  });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "authorize_provider_service", affectedScreen: "Firmalar (Admin)" });
    return { ok: false, error: mapServiceAuthorizationError(error) };
  }
  return { ok: true };
}

/** revoke_provider_service_authorization (0038) — admin-only, gerekçe RPC'nin kendisi tarafından zorunlu kılınır (ML107). */
export async function revokeProviderServiceAuthorizationAsAdmin(
  providerId: string,
  serviceCategoryId: string,
  reason: string,
): Promise<CompanyActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("revoke_provider_service_authorization", {
    p_provider_id: providerId,
    p_service_category_id: serviceCategoryId,
    p_reason: reason.trim(),
  });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "revoke_provider_service_authorization", affectedScreen: "Firmalar (Admin)" });
    return { ok: false, error: mapServiceAuthorizationError(error) };
  }
  return { ok: true };
}

/** request_provider_document (0039) — admin-only, görev bölüm 31 "Belge Talep Et": provider_service_authorizations'a hiçbir satır YAZMAZ, yalnızca mevcut bildirim sistemine bir "belge yükleyin" bildirimi düşer. */
export async function requestProviderDocumentAsAdmin(
  providerId: string,
  serviceCategoryId: string,
  message?: string,
): Promise<CompanyActionResult> {
  const supabase = createSupabaseBrowserClient();
  const { error } = await supabase.rpc("request_provider_document", {
    p_provider_id: providerId,
    p_service_category_id: serviceCategoryId,
    p_message: message?.trim() || null,
  });
  if (error) {
    reportSystemError({ message: error.message, source: "server", errorCode: error.code, affectedAction: "authorize_provider_service", affectedScreen: "Firmalar (Admin)" });
    return { ok: false, error: mapServiceAuthorizationError(error) };
  }
  return { ok: true };
}
