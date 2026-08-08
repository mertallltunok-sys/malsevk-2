"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { getCompanyTypeFieldLabel, getCompanyTypeOptions, isCompanyType, type CompanyType } from "../_lib/company-type";
import { finishSupabaseRegistration, type CompleteRegistrationInput } from "../_lib/complete-registration";
import { isCustomsOnlyRegistration, isCustomsBrokerProvider, isGeneralDocumentRequired } from "../_lib/customs-license";
import { getLegalDocumentMeta, type LegalDocumentId } from "../_lib/legal-documents";
import {
  clearPendingRegistrationDraft,
  readPendingRegistrationDraft,
} from "../_lib/pending-registration-draft";
import { CUSTOMS_LICENSE_DECLARATION_TEXT, PROVIDER_DOCUMENT_DECLARATION_TEXT } from "../_lib/provider-document-consents";
import { isValidRegistrationMetadata, type RegistrationMetadataFields } from "../_lib/registration-metadata";
import { GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID, SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import { createSupabaseBrowserClient } from "../_lib/supabase/browser-client";
import type { UserRole } from "../_lib/types";
import { getDistrictsByProvinceCode, getProvinces } from "../_lib/turkey-locations";
import { LegalDocumentModal } from "./legal-document-modal";
import { MultiSelectChips } from "./multi-select-chips";
import { ProviderDocumentUpload, type ReadyProviderDocument } from "./provider-document-upload";
import { SearchableSelect } from "./searchable-select";

/**
 * SUPABASE AUTH GEÇİŞİ — bkz. complete-registration.ts'in kendi
 * dokümantasyonu. Bu bileşen, `app/kayit-tamamla`in TEK içeriğidir ve ÜÇ
 * kademeli bir öncelik sırasıyla çalışır (her biri bir öncekinin bulunamama
 * durumunda devreye girer):
 *
 * 1. **Otomatik (asıl/mutlu yol)**: aynı sekmede signUp() sonrası bırakılan
 *    `sessionStorage` taslağı (pending-registration-draft.ts) bulunursa,
 *    KULLANICIYA HİÇBİR FORM GÖSTERİLMEDEN doğrudan tamamlanır — en hızlı
 *    yol, çünkü belgeler dahil (IndexedDB) HER ŞEY zaten bu sekmede mevcuttur.
 * 2. **Ön-doldurulmuş form (registration-metadata.ts)**: `sessionStorage`
 *    taslağı bulunamazsa (e-posta bağlantısı FARKLI bir sekmede/cihazda
 *    açıldı — bkz. pending-registration-draft.ts'in "bilinçli sınırlama"
 *    notu) ama Supabase'in kendi `user_metadata`sında signUp() sırasında
 *    yazılmış hassas-olmayan alanlar varsa, form bu alanlarla ÖN-DOLDURULUR
 *    — kullanıcı OTOMATİK içeri alınmaz, yalnızca gözden geçirip kendisi
 *    "Kaydı Tamamla"ya basar (görev hedefi: sekmeler/cihazlar arası veri
 *    kaybını önlerken belgeler için hâlâ bir onay/yeniden-yükleme fırsatı
 *    bırakmak — belgeler bu kaynakta YOKTUR, bkz. registration-metadata.ts).
 * 3. **Boş yedek (fallback)**: ne taslak ne metadata bulunursa (sessionStorage
 *    VE user_metadata ikisi de yoksa — ör. çok eski bir bağlantı, farklı bir
 *    Supabase projesi/hesap durumu) AYNI bilgileri sıfırdan toplayan boş bir
 *    form gösterilir. Üç kademe birlikte, tek başına sessionStorage'a
 *    güvenmenin (e-posta istemcilerinin linki çoğunlukla YENİ sekmede açması
 *    nedeniyle gerçekçi olmaması) VE tek başına "her zaman boş form"un (aynı
 *    sekme/farklı-sekme-ama-metadata-var durumlarında gereksiz tekrar veri
 *    girişi) ikisinin de sakıncasını ortadan kaldırır.
 */

type PageStatus = "checking" | "auto-completing" | "form" | "already-complete" | "no-session";

function LegalDocumentInlineTrigger({
  documentId,
  onOpen,
}: {
  documentId: LegalDocumentId;
  onOpen: (documentId: LegalDocumentId) => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(documentId);
      }}
      className="underline decoration-dotted underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
    >
      {getLegalDocumentMeta(documentId).title}
    </button>
  );
}

export function CompleteRegistrationForm() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [status, setStatus] = useState<PageStatus>("checking");
  const [autoCompleteError, setAutoCompleteError] = useState<string | null>(null);

  const firstNameId = useId();
  const lastNameId = useId();
  const phoneId = useId();
  const companyNameId = useId();
  const companyTypeId = useId();
  const provinceId = useId();
  const districtId = useId();
  const legalConsentId = useId();
  const providerServicesId = useId();
  const documentDeclarationId = useId();
  const customsLicenseDeclarationId = useId();

  const [role, setRole] = useState<UserRole | "">("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyType, setCompanyType] = useState<CompanyType | "">("");
  const [provinceCode, setProvinceCode] = useState("");
  const [district, setDistrict] = useState("");
  const [legalConsentAccepted, setLegalConsentAccepted] = useState(false);
  const [providerServiceCategoryIds, setProviderServiceCategoryIds] = useState<string[]>([]);
  const [providerDocuments, setProviderDocuments] = useState<ReadyProviderDocument[]>([]);
  const [providerDocumentsBusy, setProviderDocumentsBusy] = useState(false);
  const [documentDeclarationAccepted, setDocumentDeclarationAccepted] = useState(false);
  const [customsLicenseDocument, setCustomsLicenseDocument] = useState<ReadyProviderDocument | null>(null);
  const [customsLicenseDocumentBusy, setCustomsLicenseDocumentBusy] = useState(false);
  const [customsLicenseDeclarationAccepted, setCustomsLicenseDeclarationAccepted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openLegalDocumentId, setOpenLegalDocumentId] = useState<LegalDocumentId | null>(null);

  const provinces = useMemo(() => getProvinces(), []);
  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  // `fields` iki kaynaktan biri olabilir: sessionStorage taslağı
  // (PendingRegistrationDraft, belge alanları FAZLADAN vardır ama burada
  // hiç okunmaz) ya da user_metadata (RegistrationMetadataFields, belge
  // alanları zaten YOKTUR) — ikisi de RegistrationMetadataFields'ın
  // alanlarını yapısal olarak (structurally) karşıladığı için TEK bir
  // fonksiyon ikisine de hizmet eder.
  function prefillFromFields(fields: RegistrationMetadataFields) {
    setRole(fields.role);
    setFirstName(fields.firstName);
    setLastName(fields.lastName);
    setPhone(fields.phone);
    setCompanyName(fields.companyName);
    setCompanyType(fields.companyType);
    setDistrict(fields.district);
    const matchedProvince = provinces.find((item) => item.name === fields.province);
    if (matchedProvince) setProvinceCode(matchedProvince.code);
    setProviderServiceCategoryIds(fields.providerServiceCategoryIds);
    setLegalConsentAccepted(fields.legalConsentAccepted);
    setDocumentDeclarationAccepted(fields.documentDeclarationAccepted);
    setCustomsLicenseDeclarationAccepted(fields.customsLicenseDeclarationAccepted);
    // NOT: providerDocuments/customsLicenseDocument (IndexedDB metadata'sı)
    // hiçbir kaynaktan formda ön-doldurulmaz — sessionStorage taslağı
    // durumunda otomatik tamamlama zaten draft'ın KENDİSİYLE (bu prefill'i
    // hiç beklemeden) çalışır; user_metadata'da bu alanlar zaten hiç yoktur
    // (bkz. registration-metadata.ts). Her iki durumda da belgeler
    // gerekiyorsa kullanıcı yeniden yüklemelidir (bkz. bu bileşenin
    // üstündeki dokümantasyon).
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setStatus("no-session");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: UserRole | null }>();
      if (cancelled) return;

      if (profile?.role) {
        setStatus("already-complete");
        return;
      }

      const draft = readPendingRegistrationDraft();
      if (!draft) {
        // Kademe 2 (registration-metadata.ts): sessionStorage taslağı bu
        // sekmede yok (farklı sekme/cihaz) — Supabase'in kendi
        // user_metadata'sında signUp() sırasında yazılmış alanlar varsa
        // formu ÖN-DOLDUR, ama OTOMATİK GÖNDERME — kullanıcı gözden geçirip
        // kendisi "Kaydı Tamamla"ya basmalı (görev hedefi).
        if (isValidRegistrationMetadata(user.user_metadata)) {
          prefillFromFields(user.user_metadata);
        }
        setStatus("form");
        return;
      }

      setStatus("auto-completing");
      const input: CompleteRegistrationInput = {
        role: draft.role,
        firstName: draft.firstName,
        lastName: draft.lastName,
        phone: draft.phone,
        companyName: draft.companyName,
        companyType: draft.companyType,
        province: draft.province,
        district: draft.district,
        providerServiceCategoryIds: draft.providerServiceCategoryIds,
        providerDocuments: draft.providerDocuments,
        documentDeclarationAccepted: draft.documentDeclarationAccepted,
        customsLicenseDocument: draft.customsLicenseDocument,
        customsLicenseDeclarationAccepted: draft.customsLicenseDeclarationAccepted,
        legalConsentAccepted: draft.legalConsentAccepted,
      };
      const result = await finishSupabaseRegistration(input);
      if (cancelled) return;
      if (result.ok) {
        clearPendingRegistrationDraft();
        router.push("/panel");
        return;
      }
      // Otomatik tamamlama başarısız oldu (ör. belgeler için IndexedDB
      // blob'ları bu sekmede artık okunamıyor) — taslak alanlarla ÖNCEDEN
      // doldurulmuş yedek formu göster, kullanıcı düzeltip elle gönderebilsin.
      setAutoCompleteError(result.error);
      prefillFromFields(draft);
      setStatus("form");
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnızca mount anında bir kez çalışmalı; supabase/router/provinces stabil referanslardır.
  }, []);

  useEffect(() => {
    if (status === "already-complete") router.push("/panel");
    if (status === "no-session") router.push("/giris-yap");
  }, [status, router]);

  function handleRoleChange(nextRole: UserRole) {
    setRole(nextRole);
    if (nextRole !== "hizmet-veren") {
      setProviderDocuments([]);
      setCustomsLicenseDocument(null);
      setCustomsLicenseDeclarationAccepted(false);
    }
  }

  function handleProviderServicesChange(next: string[]) {
    setProviderServiceCategoryIds(next);
    if (!next.includes(GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID)) {
      setCustomsLicenseDocument(null);
      setCustomsLicenseDeclarationAccepted(false);
    }
    if (isCustomsOnlyRegistration(next)) {
      setProviderDocuments([]);
      setDocumentDeclarationAccepted(false);
    }
  }

  function handleProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setDistrict("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";

    if (role === "") {
      setFormError("Devam etmek için bir hesap türü seçin.");
      return;
    }
    if (firstName.trim().length === 0 || lastName.trim().length === 0) {
      setFormError("Ad ve soyad zorunludur.");
      return;
    }
    if (phone.trim().length === 0) {
      setFormError("Telefon numarası zorunludur.");
      return;
    }
    if (companyName.trim().length === 0) {
      setFormError("Firma adı zorunludur.");
      return;
    }
    if (!isCompanyType(companyType)) {
      setFormError(role === "hizmet-veren" ? "Hizmet veren tipini seçiniz." : "Kullanıcı tipini seçiniz.");
      return;
    }
    if (provinceName.length === 0 || district.trim().length === 0) {
      setFormError("İl ve ilçe zorunludur.");
      return;
    }
    if (role === "hizmet-veren") {
      if (providerServiceCategoryIds.length === 0) {
        setFormError("En az bir hizmet seçmelisiniz.");
        return;
      }
      if (isGeneralDocumentRequired(providerServiceCategoryIds)) {
        if (providerDocuments.length === 0) {
          setFormError("En az bir faaliyet belgesi veya faaliyet raporu yüklemelisiniz.");
          return;
        }
        if (!documentDeclarationAccepted) {
          setFormError("Belge doğruluk beyanını kabul etmelisiniz.");
          return;
        }
      }
      if (isCustomsBrokerProvider(providerServiceCategoryIds)) {
        if (!customsLicenseDocument) {
          setFormError("Gümrük Müşaviri İzin Belgesi yüklemelisiniz.");
          return;
        }
        if (!customsLicenseDeclarationAccepted) {
          setFormError("Yüklediğiniz belgenin size ait ve güncel olduğunu onaylamalısınız.");
          return;
        }
      }
    }
    if (!legalConsentAccepted) {
      setFormError("Devam etmek için Gizlilik Politikası, Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmelisiniz.");
      return;
    }

    setSubmitting(true);
    const result = await finishSupabaseRegistration({
      role,
      firstName,
      lastName,
      phone,
      companyName,
      companyType,
      province: provinceName,
      district,
      providerServiceCategoryIds,
      providerDocuments: providerDocuments.map((doc) => ({
        indexedDbStorageKey: doc.indexedDbStorageKey,
        originalFileName: doc.originalFileName,
        mimeType: doc.mimeType,
        extension: doc.extension,
        size: doc.size,
      })),
      documentDeclarationAccepted,
      customsLicenseDocument: customsLicenseDocument
        ? {
            indexedDbStorageKey: customsLicenseDocument.indexedDbStorageKey,
            originalFileName: customsLicenseDocument.originalFileName,
            mimeType: customsLicenseDocument.mimeType,
            extension: customsLicenseDocument.extension,
            size: customsLicenseDocument.size,
          }
        : undefined,
      customsLicenseDeclarationAccepted,
      legalConsentAccepted,
    });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    clearPendingRegistrationDraft();
    router.push("/panel");
  }

  if (status === "checking" || status === "auto-completing" || status === "already-complete" || status === "no-session") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="h-6 w-6 motion-safe:animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {status === "auto-completing" ? "Kaydınız tamamlanıyor..." : "Kontrol ediliyor..."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {autoCompleteError && (
        <p role="alert" className="text-sm text-danger">
          Kaydınız otomatik tamamlanamadı ({autoCompleteError}). Lütfen bilgilerinizi kontrol edip tekrar gönderin —
          belge yüklediyseniz yeniden yüklemeniz gerekebilir.
        </p>
      )}

      <fieldset>
        <legend className="text-sm font-medium text-foreground">Hesap Türü</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(
            [
              { value: "hizmet-alan", label: "Hizmet Alan" },
              { value: "hizmet-veren", label: "Hizmet Veren" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-3 rounded-card border p-4 text-sm font-medium transition-colors ${
                role === option.value
                  ? "border-primary bg-accent-soft text-primary"
                  : "border-border bg-surface text-foreground hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={role === option.value}
                onChange={() => handleRoleChange(option.value)}
                className="h-4 w-4 accent-primary focus-visible:outline-none"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor={firstNameId} className="text-sm font-medium text-foreground">
            Ad
          </label>
          <input
            id={firstNameId}
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div>
          <label htmlFor={lastNameId} className="text-sm font-medium text-foreground">
            Soyad
          </label>
          <input
            id={lastNameId}
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
      </div>

      <div>
        <label htmlFor={phoneId} className="text-sm font-medium text-foreground">
          Telefon Numarası
        </label>
        <input
          id={phoneId}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="05XX XXX XX XX"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      <div>
        <label htmlFor={companyNameId} className="text-sm font-medium text-foreground">
          Firma Adı
        </label>
        <input
          id={companyNameId}
          type="text"
          autoComplete="organization"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      <div>
        <label htmlFor={companyTypeId} className="text-sm font-medium text-foreground">
          {getCompanyTypeFieldLabel(role || "hizmet-alan")}
        </label>
        <select
          id={companyTypeId}
          value={companyType}
          onChange={(event) => setCompanyType(event.target.value as CompanyType)}
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <option value="">Seçiniz</option>
          {getCompanyTypeOptions(role || "hizmet-alan").map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <SearchableSelect
          id={provinceId}
          label="İl"
          options={provinces.map((item) => ({ value: item.code, label: item.name }))}
          value={provinceCode}
          onChange={handleProvinceChange}
          placeholder="İl seçiniz"
        />
        <SearchableSelect
          id={districtId}
          label="İlçe"
          options={districtOptions}
          value={district}
          onChange={setDistrict}
          placeholder="İlçe seçiniz"
          disabled={!provinceCode}
          disabledHint="Önce il seçin"
        />
      </div>

      {role === "hizmet-veren" && (
        <>
          <fieldset>
            <legend className="text-sm font-medium text-foreground">Verdiğiniz Hizmetler</legend>
            <p className="mt-1 text-xs text-muted-foreground">Birden fazla hizmet seçebilirsiniz.</p>
            <div id={providerServicesId} className="mt-3 flex flex-col gap-5">
              {SERVICE_CATEGORY_GROUPS.map((group) => (
                <MultiSelectChips
                  key={group.id}
                  id={`${providerServicesId}-${group.id}`}
                  label={group.label}
                  options={group.categories.map((category) => ({ value: category.id, label: category.label }))}
                  selected={providerServiceCategoryIds}
                  onChange={handleProviderServicesChange}
                />
              ))}
            </div>
          </fieldset>

          {!isCustomsOnlyRegistration(providerServiceCategoryIds) && (
            <>
              <div>
                <p className="text-sm font-medium text-foreground">Faaliyet Belgesi veya Faaliyet Raporu Yükle</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Şirketinizin faaliyetini gösteren en az bir belge yükleyin (PDF, Word, Excel, ODT veya görsel biçimde).
                </p>
                <div className="mt-3">
                  <ProviderDocumentUpload
                    onDocumentsChange={setProviderDocuments}
                    onBusyChange={setProviderDocumentsBusy}
                    disabled={submitting}
                    errorId={undefined}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={documentDeclarationId}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
                >
                  <input
                    id={documentDeclarationId}
                    type="checkbox"
                    checked={documentDeclarationAccepted}
                    onChange={(event) => setDocumentDeclarationAccepted(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
                  />
                  <span className="text-sm leading-relaxed text-foreground">{PROVIDER_DOCUMENT_DECLARATION_TEXT}</span>
                </label>
              </div>
            </>
          )}

          {providerServiceCategoryIds.includes(GUMRUK_MUSAVIRLIGI_SERVICE_CATEGORY_ID) && (
            <>
              <div>
                <p className="text-sm font-medium text-foreground">Gümrük Müşaviri İzin Belgesi</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Gümrük Müşavirliği hizmeti verebilmek için izin belgenizi yükleyin (PDF, JPG veya PNG).
                </p>
                <div className="mt-3">
                  <ProviderDocumentUpload
                    onDocumentsChange={(documents) => setCustomsLicenseDocument(documents[0] ?? null)}
                    onBusyChange={setCustomsLicenseDocumentBusy}
                    disabled={submitting}
                    errorId={undefined}
                    allowedExtensions={["pdf", "jpg", "jpeg", "png"]}
                    maxFiles={1}
                    dropHintText="Gümrük Müşaviri İzin Belgenizi buraya sürükleyin veya dosya seçin."
                    formatsHintText="PDF, JPG, PNG"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={customsLicenseDeclarationId}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
                >
                  <input
                    id={customsLicenseDeclarationId}
                    type="checkbox"
                    checked={customsLicenseDeclarationAccepted}
                    onChange={(event) => setCustomsLicenseDeclarationAccepted(event.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
                  />
                  <span className="text-sm leading-relaxed text-foreground">{CUSTOMS_LICENSE_DECLARATION_TEXT}</span>
                </label>
              </div>
            </>
          )}
        </>
      )}

      <div>
        <label
          htmlFor={legalConsentId}
          className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background p-4"
        >
          <input
            id={legalConsentId}
            type="checkbox"
            checked={legalConsentAccepted}
            onChange={(event) => setLegalConsentAccepted(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none"
          />
          <span className="text-sm leading-relaxed text-foreground">
            <LegalDocumentInlineTrigger documentId="privacy_policy" onOpen={setOpenLegalDocumentId} />,{" "}
            <LegalDocumentInlineTrigger documentId="terms_of_service" onOpen={setOpenLegalDocumentId} /> ve{" "}
            <LegalDocumentInlineTrigger documentId="kvkk" onOpen={setOpenLegalDocumentId} />
            &apos;ni okudum, anladım ve kabul ediyorum.
          </span>
        </label>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}

      {(() => {
        const providerBusy = role === "hizmet-veren" && (providerDocumentsBusy || customsLicenseDocumentBusy);
        const isSubmitDisabled = submitting || providerBusy;
        return (
          <button
            type="submit"
            disabled={isSubmitDisabled}
            aria-disabled={isSubmitDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
          >
            {(submitting || providerBusy) && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
            {providerBusy ? "Belgeler doğrulanıyor..." : submitting ? "Tamamlanıyor..." : "Kaydı Tamamla"}
          </button>
        );
      })()}

      {openLegalDocumentId && (
        <LegalDocumentModal documentId={openLegalDocumentId} mode="consent" onClose={() => setOpenLegalDocumentId(null)} />
      )}
    </form>
  );
}
