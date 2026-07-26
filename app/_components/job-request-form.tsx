"use client";

import { ArrowLeft, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  findDuplicateServiceCategoryIds,
  SERVICE_LOCATION_ERROR_KEYS,
  validateServiceItem,
  validateSharedOperationFields,
  type ServiceItemErrors,
  type ServiceItemFields,
  type SharedOperationErrors,
} from "../_lib/job-form-validation";
import { FACILITY_FREE_TEXT_VALUE, toFacilitySelectOptions } from "../_lib/job-location";
import { FIXED_PROVINCE_LABEL } from "../_lib/job-listing-filters";
import { createJob, createJobsForOperation } from "../_lib/job-store";
import { formatJobDate } from "../_lib/jobs";
import { MIN_PHOTOS } from "../_lib/photo-validation";
import { getServiceCategoryLabel, SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceCodeByName,
  getProvinceIdByCode,
  type Facility,
} from "../_lib/turkey-locations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { GuestAccessCard, PageCardShell } from "./guest-access-card";
import { JobPhotoUpload, type ReadyJobPhoto } from "./job-photo-upload";
import { SearchableSelect } from "./searchable-select";

const OPERATION_DETAILS_MAX_LENGTH = 1000;

const PAGE_TITLE = "Hizmet Talebi Oluştur";
const PAGE_DESCRIPTION =
  "İhtiyacınızı tanımlayın; uzman hizmet verenler ilanınızı inceleyip teklif göndersin.";

/**
 * Çoklu Hizmet Operasyonu — Aşama 2.2: tek bir hizmet kartının TÜM form
 * state'i (kategori, başlık, hizmete özel açıklama, kendi tarih aralığı,
 * kendi konumu). `localId` YALNIZCA React key/hata eşleştirmesi için vardır
 * (bkz. job-photo-upload.tsx#PhotoItem.clientId ile AYNI desen,
 * crypto.randomUUID()) — dizi index'i kalıcı kimlik olarak KULLANILMAZ (bir
 * kart silindiğinde diğerlerinin index'i kayar, ama localId hiç değişmez).
 * `localId` hiçbir zaman `createJob`/`createJobsForOperation`'a gönderilmez.
 *
 * `useMainLocation` yalnızca EK hizmetler (index > 0) için anlamlıdır: true
 * ise bu hizmetin efektif konumu, kendi (boş kalan) alanları değil, ana
 * hizmetin (index 0) konumudur — bkz. getEffectiveLocation. Ana hizmette bu
 * alan hiç okunmaz, her zaman kendi konumu geçerlidir.
 */
type ServiceEntry = {
  localId: string;
  category: string;
  title: string;
  description: string;
  workDate: string;
  workEndDate: string;
  useMainLocation: boolean;
  district: string;
  facilityId: string;
  otherFacilityText: string;
  addressText: string;
  neighborhood: string;
  locationUrl: string;
  directionsNote: string;
};

type ServiceLocation = Pick<
  ServiceEntry,
  "district" | "facilityId" | "otherFacilityText" | "addressText" | "neighborhood" | "locationUrl" | "directionsNote"
>;

type ServiceFieldName =
  | "category"
  | "title"
  | "description"
  | "workDate"
  | "workEndDate"
  | "district"
  | "workLocationType"
  | "addressText"
  | "neighborhood"
  | "locationUrl"
  | "directionsNote";

function createEmptyServiceEntry(): ServiceEntry {
  return {
    localId: crypto.randomUUID(),
    category: "",
    title: "",
    description: "",
    workDate: "",
    workEndDate: "",
    useMainLocation: true,
    district: "",
    facilityId: "",
    otherFacilityText: "",
    addressText: "",
    neighborhood: "",
    locationUrl: "",
    directionsNote: "",
  };
}

/** Bir hizmet kartındaki bir alanın DOM id'si — kartlar dinamik bir dizi olduğu için `useId()` yerine (hook kuralları bunu yasaklar) zaten benzersiz olan `localId`den türetilir. */
function serviceFieldId(localId: string, field: ServiceFieldName): string {
  return `service-${field}-${localId}`;
}

/** Bir hizmetin EFEKTİF konumu — "Ana hizmetle aynı lokasyon" işaretliyse (yalnızca ek hizmetlerde anlamlı) ana hizmetin (index 0) konumu, aksi halde kendi konumu. */
function getEffectiveLocation(services: ServiceEntry[], index: number): ServiceLocation {
  const service = services[index];
  if (index > 0 && service.useMainLocation) return services[0];
  return service;
}

export function JobRequestForm() {
  const session = useSession();
  const router = useRouter();

  const operationDetailsId = useId();
  const photosId = useId();

  const [services, setServices] = useState<ServiceEntry[]>(() => [createEmptyServiceEntry()]);
  const [serviceErrors, setServiceErrors] = useState<Record<string, ServiceItemErrors>>({});
  const [operationDetails, setOperationDetails] = useState("");
  const [photos, setPhotos] = useState<ReadyJobPhoto[]>([]);
  const [photosProcessing, setPhotosProcessing] = useState(false);
  const [sharedErrors, setSharedErrors] = useState<SharedOperationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Çoklu Hizmet Operasyonu — Aşama 2.3: "form" (düzenleme) <-> "preview"
  // (Operasyon Önizleme) arasında geçiş yalnızca bu bayrakla yapılır — YENİ
  // BİR ROUTE/SAYFA YOK, aynı bileşen içinde koşullu render. Bu yüzden
  // "Düzenlemeye Dön" hiçbir state'i kaybetmez: services/operationDetails/
  // photos hiç unmount olmadan aynı component'te kalmaya devam eder.
  const [mode, setMode] = useState<"form" | "preview">("form");

  // React state (submitting) yalnızca UI'yi (buton disabled/metin) sürer —
  // aynı JS event-loop turunda art arda iki tıklama, ikisi de state commit
  // edilmeden ÖNCE handlePublish'e ulaşabilir, bu yüzden çift-gönderim
  // koruması BUNA dayanamaz. `submitLockRef` senkron, render'dan bağımsız
  // bir kilit: ilk geçerli çağrıda hemen kapanır, ikinci çağrı state
  // güncellemesini beklemeden bu kilidi görüp döner (bkz. handlePublish).
  const submitLockRef = useRef(false);
  // Kullanıcı createJob()/createJobsForOperation() sonucu beklenirken
  // sayfadan ayrılırsa component unmount olabilir; bu durumda await sonrası
  // setSubmitting/setSubmitError çağrısı React'in "unmounted component'te
  // state güncelleme" uyarısını tetikler. isMountedRef bunu engeller.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // MALSEVK şu aşamada yalnızca Kocaeli'de hizmet veriyor — İl artık
  // kullanıcı tarafından seçilemez, sabit/readonly gösterilir. `provinceCode`
  // yalnızca ilçe/tesis sorguları için dahili olarak kullanılır.
  const provinceName = FIXED_PROVINCE_LABEL;
  const provinceCode = getProvinceCodeByName(FIXED_PROVINCE_LABEL) ?? "";

  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  /**
   * Bölge/Tesis: seçilen il+ilçe kapsamındaki TÜM tesis türleri tek listede
   * sunulur (bkz. job-location.ts). Her hizmet kartı KENDİ ilçesine göre bu
   * listeyi ayrı ayrı hesaplar (dizi dinamik olduğu için üst seviye
   * `useMemo` kullanılamaz, bkz. React hook kuralları) — küçük veri
   * kümesi üzerinde basit bir filtre olduğu için performans kaygısı yoktur.
   */
  const getFacilitiesForDistrict = useCallback(
    (districtName: string): Facility[] => {
      if (!provinceCode || !districtName) return [];
      const provinceIdValue = getProvinceIdByCode(provinceCode);
      if (!provinceIdValue) return [];
      return getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(districtName));
    },
    [provinceCode],
  );

  /** Bir konumun "Bölge / Tesis" GÖRÜNEN adı — katalogdan seçilmiş bir tesisin gerçek adı, ya da özel modda kullanıcının yazdığı metin. */
  const resolveWorkLocationTypeValue = useCallback(
    (location: ServiceLocation): string => {
      if (location.facilityId === FACILITY_FREE_TEXT_VALUE) return location.otherFacilityText.trim();
      const facilities = getFacilitiesForDistrict(location.district);
      return facilities.find((facility) => facility.id === location.facilityId)?.name ?? "";
    },
    [getFacilitiesForDistrict],
  );

  // useCallback İLE KARARLI TUTULMASI ZORUNLU: JobPhotoUpload, bu prop'u
  // kendi useEffect'inin bağımlılık dizisinde tutuyor (bkz. job-photo-upload.tsx).
  const handlePhotosChange = useCallback((nextPhotos: ReadyJobPhoto[]) => {
    setPhotos(nextPhotos);
    if (nextPhotos.length >= MIN_PHOTOS) {
      setSharedErrors((current) => {
        if (!("photoCount" in current)) return current;
        const next = { ...current };
        delete next.photoCount;
        return next;
      });
    }
  }, []);

  // Aşama 2.3 önizlemesinde "ilk fotoğraf küçük thumbnail" için — fotoğraflar
  // yeniden yüklenmez, yalnızca zaten işlenmiş `photos[0].blob`'tan tek bir
  // object URL üretilir. `photos` referansı her değiştiğinde eskisi serbest
  // bırakılır (bellek sızıntısı olmasın diye).
  const previewThumbnailUrl = useMemo(() => (photos[0] ? URL.createObjectURL(photos[0].blob) : null), [photos]);
  useEffect(() => {
    return () => {
      if (previewThumbnailUrl) URL.revokeObjectURL(previewThumbnailUrl);
    };
  }, [previewThumbnailUrl]);

  function updateService(localId: string, patch: Partial<ServiceEntry>) {
    setServices((current) => current.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  }

  /** Bir hizmet kartının hata durumunu temizler — o kart düzeltildiğinde hemen kalksın diye. */
  function clearServiceFieldError(localId: string, field: keyof ServiceItemErrors) {
    setServiceErrors((current) => {
      const entry = current[localId];
      if (!entry || !(field in entry)) return current;
      const nextEntry = { ...entry };
      delete nextEntry[field];
      const next = { ...current };
      if (Object.keys(nextEntry).length === 0) delete next[localId];
      else next[localId] = nextEntry;
      return next;
    });
  }

  function handleServiceCategoryChange(localId: string, next: string) {
    updateService(localId, { category: next });
    clearServiceFieldError(localId, "category");
  }
  function handleServiceTitleChange(localId: string, next: string) {
    updateService(localId, { title: next });
    clearServiceFieldError(localId, "title");
  }
  function handleServiceDescriptionChange(localId: string, next: string) {
    updateService(localId, { description: next });
    clearServiceFieldError(localId, "description");
  }
  function handleServiceWorkDateChange(localId: string, next: string) {
    updateService(localId, { workDate: next });
    clearServiceFieldError(localId, "workDate");
  }
  function handleServiceWorkEndDateChange(localId: string, next: string) {
    updateService(localId, { workEndDate: next });
    clearServiceFieldError(localId, "workEndDate");
  }
  function handleServiceAddressChange(localId: string, next: string) {
    updateService(localId, { addressText: next });
    clearServiceFieldError(localId, "addressText");
  }
  function handleServiceNeighborhoodChange(localId: string, next: string) {
    updateService(localId, { neighborhood: next });
    clearServiceFieldError(localId, "neighborhood");
  }
  function handleServiceLocationUrlChange(localId: string, next: string) {
    updateService(localId, { locationUrl: next });
    clearServiceFieldError(localId, "locationUrl");
  }
  function handleServiceDirectionsNoteChange(localId: string, next: string) {
    updateService(localId, { directionsNote: next });
    clearServiceFieldError(localId, "directionsNote");
  }

  // İlçe değiştiğinde: Bölge/Tesis seçimi (ve özel moda özgü alanlar) her
  // zaman temizlenir — eski ilçenin tesisi yeni ilçede asla kalmamalı.
  function handleServiceDistrictChange(localId: string, nextDistrict: string) {
    updateService(localId, {
      district: nextDistrict,
      facilityId: "",
      otherFacilityText: "",
      neighborhood: "",
      locationUrl: "",
      directionsNote: "",
    });
    for (const field of ["district", "workLocationType", "neighborhood", "locationUrl", "directionsNote"] as const) {
      clearServiceFieldError(localId, field);
    }
  }

  function handleServiceFacilityChange(localId: string, nextValue: string) {
    updateService(localId, { facilityId: nextValue, otherFacilityText: "", neighborhood: "", locationUrl: "", directionsNote: "" });
    for (const field of ["workLocationType", "neighborhood", "locationUrl", "directionsNote"] as const) {
      clearServiceFieldError(localId, field);
    }
  }

  /** "Ana hizmetle aynı lokasyon" değiştiğinde, o karta ait konum hataları anlamsız kalır (alan artık gösterilmiyor/kendi konumu değil) — temizlenir. */
  function handleServiceUseMainLocationChange(localId: string, useMain: boolean) {
    updateService(localId, { useMainLocation: useMain });
    for (const field of SERVICE_LOCATION_ERROR_KEYS) clearServiceFieldError(localId, field);
  }

  /** "Ek hizmet ekle" — yeni, boş bir kart ekler. Diğer kartların seçim/tarihlerine/konumuna hiç dokunmaz. */
  function handleAddService() {
    setServices((current) => [...current, createEmptyServiceEntry()]);
  }

  /** İlk (ana) kart HİÇBİR ZAMAN silinemez — bu fonksiyon yalnızca ek kartlar için render edilen butondan çağrılır. Kalan kartların seçim/tarihleri/konumu/sırası DEĞİŞMEZ (bkz. ServiceEntry'nin localId ile, index ile DEĞİL, hedeflenmesi). */
  function handleRemoveService(localId: string) {
    setServices((current) => current.filter((s) => s.localId !== localId));
    setServiceErrors((current) => {
      if (!(localId in current)) return current;
      const next = { ...current };
      delete next[localId];
      return next;
    });
  }

  /** service.localId HARİÇ, o kategoriyi zaten seçmiş BAŞKA kartların id'lerini döndürür — bir kartın kendi mevcut seçimini kendi listesinde devre dışı bırakmamak için. */
  function otherSelectedCategoryIds(currentLocalId: string): Set<string> {
    return new Set(services.filter((s) => s.localId !== currentLocalId && s.category !== "").map((s) => s.category));
  }

  function buildServiceValidationFields(allServices: ServiceEntry[], index: number): ServiceItemFields {
    const service = allServices[index];
    const location = getEffectiveLocation(allServices, index);
    const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
    return {
      category: service.category,
      title: service.title,
      description: service.description,
      workDate: service.workDate,
      workEndDate: service.workEndDate,
      district: location.district,
      workLocationType: resolveWorkLocationTypeValue(location),
      addressText: location.addressText,
      locationMode: isCustomLocation ? "custom" : "catalog",
      neighborhood: location.neighborhood,
      locationUrl: location.locationUrl,
      directionsNote: location.directionsNote,
    };
  }

  /** İlk hatalı/eksik zorunlu paylaşılan (Operasyon Detayları/Fotoğraf) alana kaydırır ve odak verir. */
  function focusFirstSharedError(fieldErrors: SharedOperationErrors) {
    if (fieldErrors.operationDetails) {
      const target = document.getElementById(operationDetailsId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
      return;
    }
    if (fieldErrors.photoCount) {
      document.getElementById(photosId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /** Kart SIRASINA göre ilk hatalı karta (kategori > başlık > açıklama > konum > tarihler sırasıyla) kaydırır/odaklar. */
  function focusFirstServiceError(currentServices: ServiceEntry[], errorsByLocalId: Record<string, ServiceItemErrors>) {
    const fieldOrder: ServiceFieldName[] = [
      "category",
      "title",
      "description",
      "district",
      "workLocationType",
      "addressText",
      "neighborhood",
      "locationUrl",
      "directionsNote",
      "workDate",
      "workEndDate",
    ];
    for (const service of currentServices) {
      const itemErrors = errorsByLocalId[service.localId];
      if (!itemErrors) continue;
      const field = fieldOrder.find((key) => itemErrors[key]);
      if (!field) continue;
      const target = document.getElementById(serviceFieldId(service.localId, field));
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
      return;
    }
  }

  if (!session) {
    return (
      <GuestAccessCard
        pageTitle={PAGE_TITLE}
        pageDescription={PAGE_DESCRIPTION}
        cardTitle="İlan oluşturmak için giriş yapmalısınız."
        cardDescription="Hizmet talebi oluşturmak ve uzman hizmet verenlerden teklif alabilmek için hesabınıza giriş yapın veya yeni bir hesap oluşturun."
        redirectTo="/hizmet-talebi-olustur"
      />
    );
  }

  if (session.role !== "hizmet-alan") {
    return (
      <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <AuthGateNotice message="Yalnızca Hizmet Alan kullanıcılar ilan oluşturabilir." />
      </PageCardShell>
    );
  }

  /** Form gönderimi: HENÜZ HİÇBİR İLAN OLUŞTURULMAZ — yalnızca doğrular ve geçerliyse Operasyon Önizleme'ye (mode="preview") geçer. Gerçek createJob/createJobsForOperation çağrısı yalnızca önizlemenin kendi Yayınla butonundan (handlePublish) yapılır. */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (photosProcessing) return;

    const nextSharedErrors = validateSharedOperationFields({ operationDetails, photoCount: photos.length });

    const duplicateCategoryIds = findDuplicateServiceCategoryIds(services.map((s) => s.category));
    const nextServiceErrors: Record<string, ServiceItemErrors> = {};
    for (let index = 0; index < services.length; index++) {
      const service = services[index];
      const itemErrors = validateServiceItem(buildServiceValidationFields(services, index));
      // "Ana hizmetle aynı lokasyon" işaretliyse, o kartın KENDİ konum
      // alanları hiç gösterilmez/düzenlenemez — konumla ilgili bir hata
      // varsa (ör. ana hizmetin konumu eksikse) bu zaten ANA HİZMETİN
      // kendi kartında gösterilir; burada yinelenmez.
      if (index > 0 && service.useMainLocation) {
        for (const key of SERVICE_LOCATION_ERROR_KEYS) delete itemErrors[key];
      }
      if (duplicateCategoryIds.has(service.category)) {
        itemErrors.category = "Bu hizmet zaten seçildi.";
      }
      if (Object.keys(itemErrors).length > 0) nextServiceErrors[service.localId] = itemErrors;
    }

    setSharedErrors(nextSharedErrors);
    setServiceErrors(nextServiceErrors);
    setSubmitError(null);

    const hasSharedErrors = Object.keys(nextSharedErrors).length > 0;
    const hasServiceErrors = Object.keys(nextServiceErrors).length > 0;
    if (hasSharedErrors || hasServiceErrors) {
      if (hasServiceErrors) focusFirstServiceError(services, nextServiceErrors);
      else focusFirstSharedError(nextSharedErrors);
      return;
    }

    setMode("preview");
  }

  /** Operasyon Önizleme'nin "Yayınla" butonu — projede createJob/createJobsForOperation'ın İLK KEZ çağrıldığı yer budur. */
  async function handlePublish() {
    // Senkron kilit: state (submitting) commit edilmeden önce gelebilecek
    // ikinci bir çağrıyı da hemen durdurur (bkz. submitLockRef tanımı).
    if (submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (services.length === 1) {
        // Tek hizmet: bugünkü davranış BİREBİR korunur — mevcut createJob
        // yolu kullanılır, operationId hiç oluşturulmaz.
        const service = services[0];
        const location = getEffectiveLocation(services, 0);
        const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
        const result = await createJob(session, {
          category: service.category,
          title: service.title,
          description: service.description,
          province: provinceName,
          district: location.district,
          workLocationType: resolveWorkLocationTypeValue(location),
          facilityId: isCustomLocation ? undefined : location.facilityId || undefined,
          addressText: location.addressText,
          locationMode: isCustomLocation ? "custom" : "catalog",
          neighborhood: location.neighborhood,
          locationUrl: location.locationUrl,
          directionsNote: location.directionsNote,
          workDate: service.workDate,
          workEndDate: service.workEndDate,
          operationDetails,
          photos,
        });

        if (!result.ok) {
          if (isMountedRef.current) setSubmitError(result.error);
          return;
        }

        router.push(`/ilanlar/${result.job.id}`);
      } else {
        const result = await createJobsForOperation(session, {
          province: provinceName,
          operationDetails,
          photos,
          services: services.map((service, index) => {
            const location = getEffectiveLocation(services, index);
            const isCustomLocation = location.facilityId === FACILITY_FREE_TEXT_VALUE;
            return {
              category: service.category,
              title: service.title,
              description: service.description,
              workDate: service.workDate,
              workEndDate: service.workEndDate,
              district: location.district,
              workLocationType: resolveWorkLocationTypeValue(location),
              facilityId: isCustomLocation ? undefined : location.facilityId || undefined,
              addressText: location.addressText,
              locationMode: isCustomLocation ? "custom" : "catalog",
              neighborhood: location.neighborhood,
              locationUrl: location.locationUrl,
              directionsNote: location.directionsNote,
            };
          }),
        });

        if (!result.ok) {
          if (isMountedRef.current) setSubmitError(result.error);
          return;
        }

        // Yeni bir operasyon detay sayfası/route YOK — kullanıcı rastgele
        // tek bir ilan detayına değil, kendi ilanlarını topluca gördüğü
        // mevcut "Hizmet Taleplerim" sayfasına yönlendirilir. Başarı mesajı,
        // o sayfadaki mevcut "guncellendi=1" (bkz. job-edit-form.tsx) ile
        // AYNI query-param tabanlı banner deseniyle gösterilir (bkz.
        // job-requests-panel.tsx).
        router.push(`/panel/hizmet-taleplerim?operasyonIlanSayisi=${result.jobs.length}`);
      }
    } finally {
      // createJob()/createJobsForOperation() beklenmedik şekilde reddedilse/
      // hata fırlatsa bile kilit burada mutlaka açılır — takılı kalmaz.
      submitLockRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  const publishLabel = services.length === 1 ? "İlanı Yayınla" : `${services.length} Hizmet İlanını Yayınla`;
  const summaryLabel = services.length === 1 ? "1 Hizmet İlanı Yayınlanacak" : `${services.length} Hizmet İlanı Yayınlanacak`;

  if (mode === "preview") {
    return (
      <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
        <div className="flex flex-col gap-6">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">Operasyon Özeti</h2>
            <p className="mt-2 text-sm text-muted-foreground">Toplam oluşturulacak ilan:</p>
            <p className="mt-1 text-lg font-semibold text-foreground">{summaryLabel}</p>
          </div>

          {photos.length > 0 && (
            <div className="flex items-center gap-3">
              {previewThumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewThumbnailUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-md border border-border object-cover"
                />
              )}
              {photos.length > 1 && (
                <span className="text-sm font-medium text-muted-foreground">+{photos.length - 1}</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4">
            {services.map((service, index) => {
              const location = getEffectiveLocation(services, index);
              const categoryLabel = getServiceCategoryLabel(service.category) ?? service.category;
              const locationLabel = resolveWorkLocationTypeValue(location);
              return (
                <div key={service.localId} className="rounded-card border border-border bg-surface p-4">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {index === 0 ? "Ana Hizmet" : "Ek Hizmet"}
                  </span>
                  <h3 className="mt-1 text-base font-semibold text-foreground">{service.title}</h3>
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Hizmet Türü</dt>
                      <dd className="text-sm text-foreground">{categoryLabel}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">İlçe</dt>
                      <dd className="text-sm text-foreground">{location.district}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Başlangıç Tarihi</dt>
                      <dd className="text-sm text-foreground">{formatJobDate(service.workDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Bitiş Tarihi</dt>
                      <dd className="text-sm text-foreground">{formatJobDate(service.workEndDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium text-muted-foreground">Tesis / Lokasyon</dt>
                      <dd className="text-sm text-foreground">{locationLabel}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium text-muted-foreground">Adres</dt>
                      <dd className="text-sm text-foreground">{location.addressText}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium text-muted-foreground">Hizmete Özel Açıklama</dt>
                      <dd className="whitespace-pre-wrap text-sm text-foreground">{service.description}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          {operationDetails.trim().length > 0 && (
            <div className="rounded-md border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold text-foreground">Ortak Operasyon Bilgileri</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{operationDetails}</p>
            </div>
          )}

          {submitError && (
            <p role="alert" className="text-sm text-danger">
              {submitError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={() => setMode("form")}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-background px-6 py-3 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-70"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Düzenlemeye Dön
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
              {submitting ? "İlan oluşturuluyor..." : publishLabel}
            </button>
          </div>
        </div>
      </PageCardShell>
    );
  }

  return (
    <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {services.map((service, index) => {
          const itemErrors = serviceErrors[service.localId] ?? {};
          const disabledCategoryIds = otherSelectedCategoryIds(service.localId);
          const isMain = index === 0;
          const usingMainLocation = !isMain && service.useMainLocation;
          const location = getEffectiveLocation(services, index);
          const isCustomLocationForCard = location.facilityId === FACILITY_FREE_TEXT_VALUE;
          const cardFacilities = getFacilitiesForDistrict(service.district);
          const cardFacilityOptions = toFacilitySelectOptions(cardFacilities);
          const mainLocationLabel = resolveWorkLocationTypeValue(services[0] ? getEffectiveLocation(services, 0) : location);

          const categoryFieldId = serviceFieldId(service.localId, "category");
          const titleFieldId = serviceFieldId(service.localId, "title");
          const descriptionFieldId = serviceFieldId(service.localId, "description");
          const workDateFieldId = serviceFieldId(service.localId, "workDate");
          const workEndDateFieldId = serviceFieldId(service.localId, "workEndDate");
          const districtFieldId = serviceFieldId(service.localId, "district");
          const workLocationTypeFieldId = serviceFieldId(service.localId, "workLocationType");
          const addressTextFieldId = serviceFieldId(service.localId, "addressText");
          const neighborhoodFieldId = serviceFieldId(service.localId, "neighborhood");
          const locationUrlFieldId = serviceFieldId(service.localId, "locationUrl");
          const directionsNoteFieldId = serviceFieldId(service.localId, "directionsNote");

          return (
            <div key={service.localId} className="rounded-md border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {isMain ? "Ana Hizmet" : "Ek Hizmet"}
                </span>
                {!isMain && (
                  <button
                    type="button"
                    onClick={() => handleRemoveService(service.localId)}
                    aria-label="Bu hizmeti kaldır"
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Kaldır
                  </button>
                )}
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor={categoryFieldId} className="text-sm font-medium text-foreground">
                    Hizmet Kategorisi
                  </label>
                  <select
                    id={categoryFieldId}
                    value={service.category}
                    onChange={(event) => handleServiceCategoryChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.category ? true : undefined}
                    aria-describedby={itemErrors.category ? `${categoryFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.category ? "border-danger" : "border-border"
                    }`}
                  >
                    <option value="">Kategori seçiniz</option>
                    {SERVICE_CATEGORY_GROUPS.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.categories.map((item) => (
                          <option key={item.id} value={item.id} disabled={disabledCategoryIds.has(item.id)}>
                            {item.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {itemErrors.category && (
                    <p id={`${categoryFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.category}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={workDateFieldId} className="text-sm font-medium text-foreground">
                    Başlangıç Tarihi
                  </label>
                  <input
                    id={workDateFieldId}
                    type="date"
                    value={service.workDate}
                    onChange={(event) => handleServiceWorkDateChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.workDate ? true : undefined}
                    aria-describedby={itemErrors.workDate ? `${workDateFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.workDate ? "border-danger" : "border-border"
                    }`}
                  />
                  {itemErrors.workDate && (
                    <p id={`${workDateFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.workDate}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor={workEndDateFieldId} className="text-sm font-medium text-foreground">
                    Bitiş Tarihi
                  </label>
                  <input
                    id={workEndDateFieldId}
                    type="date"
                    value={service.workEndDate}
                    onChange={(event) => handleServiceWorkEndDateChange(service.localId, event.target.value)}
                    aria-invalid={itemErrors.workEndDate ? true : undefined}
                    aria-describedby={itemErrors.workEndDate ? `${workEndDateFieldId}-error` : undefined}
                    className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      itemErrors.workEndDate ? "border-danger" : "border-border"
                    }`}
                  />
                  {itemErrors.workEndDate && (
                    <p id={`${workEndDateFieldId}-error`} className="mt-2 text-sm text-danger">
                      {itemErrors.workEndDate}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor={titleFieldId} className="text-sm font-medium text-foreground">
                  İlan Başlığı
                </label>
                <input
                  id={titleFieldId}
                  type="text"
                  value={service.title}
                  onChange={(event) => handleServiceTitleChange(service.localId, event.target.value)}
                  maxLength={150}
                  aria-invalid={itemErrors.title ? true : undefined}
                  aria-describedby={itemErrors.title ? `${titleFieldId}-error` : undefined}
                  placeholder="Örnek: Fabrika Sahasında Forklift Operatörü İhtiyacı"
                  className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    itemErrors.title ? "border-danger" : "border-border"
                  }`}
                />
                {itemErrors.title && (
                  <p id={`${titleFieldId}-error`} className="mt-2 text-sm text-danger">
                    {itemErrors.title}
                  </p>
                )}
              </div>

              <div className="mt-4">
                <label htmlFor={descriptionFieldId} className="text-sm font-medium text-foreground">
                  Hizmete Özel Açıklama
                </label>
                <textarea
                  id={descriptionFieldId}
                  value={service.description}
                  onChange={(event) => handleServiceDescriptionChange(service.localId, event.target.value)}
                  maxLength={1000}
                  rows={3}
                  aria-invalid={itemErrors.description ? true : undefined}
                  aria-describedby={itemErrors.description ? `${descriptionFieldId}-error` : undefined}
                  placeholder="Bu hizmete özel iş kapsamını ve beklentilerinizi açıklayın."
                  className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    itemErrors.description ? "border-danger" : "border-border"
                  }`}
                />
                {itemErrors.description && (
                  <p id={`${descriptionFieldId}-error`} className="mt-2 text-sm text-danger">
                    {itemErrors.description}
                  </p>
                )}
              </div>

              {!isMain && (
                <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={service.useMainLocation}
                    onChange={(event) => handleServiceUseMainLocationChange(service.localId, event.target.checked)}
                    className="h-4 w-4 rounded border-border text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                  Ana hizmetle aynı lokasyon
                </label>
              )}

              {usingMainLocation ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Bu hizmet, ana hizmetin lokasyonunu kullanacak: {services[0].district || "İlçe seçilmedi"}
                  {mainLocationLabel ? ` / ${mainLocationLabel}` : ""}.
                </p>
              ) : (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <span className="text-sm font-medium text-foreground">İl</span>
                      <div
                        className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm text-muted-foreground"
                        aria-readonly="true"
                      >
                        <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate text-foreground">{FIXED_PROVINCE_LABEL}</span>
                      </div>
                    </div>

                    <div>
                      <SearchableSelect
                        id={districtFieldId}
                        label="İlçe"
                        options={districtOptions}
                        value={service.district}
                        onChange={(next) => handleServiceDistrictChange(service.localId, next)}
                        placeholder="İlçe seçiniz"
                        disabled={!provinceCode}
                        disabledHint="Önce il seçin"
                        errorId={itemErrors.district ? `${districtFieldId}-error` : undefined}
                      />
                      {itemErrors.district && (
                        <p id={`${districtFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.district}
                        </p>
                      )}
                    </div>

                    <div>
                      {isCustomLocationForCard ? (
                        <>
                          <label htmlFor={workLocationTypeFieldId} className="text-sm font-medium text-foreground">
                            Tesis / İşletme Adı
                          </label>
                          <input
                            id={workLocationTypeFieldId}
                            type="text"
                            value={service.otherFacilityText}
                            onChange={(event) => {
                              updateService(service.localId, { otherFacilityText: event.target.value });
                              clearServiceFieldError(service.localId, "workLocationType");
                            }}
                            maxLength={150}
                            aria-invalid={itemErrors.workLocationType ? true : undefined}
                            aria-describedby={itemErrors.workLocationType ? `${workLocationTypeFieldId}-error` : undefined}
                            placeholder="Örnek: ABC Metal Fabrikası"
                            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                              itemErrors.workLocationType ? "border-danger" : "border-border"
                            }`}
                          />
                          <p className="mt-2 text-xs text-muted-foreground">
                            Listede olmayan tesisin adını buraya yazabilirsiniz.{" "}
                            <button
                              type="button"
                              onClick={() => handleServiceFacilityChange(service.localId, "")}
                              className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                            >
                              Hazır listeden seçmek için tıklayın.
                            </button>
                          </p>
                        </>
                      ) : (
                        <SearchableSelect
                          id={workLocationTypeFieldId}
                          label="Bölge / Tesis"
                          options={cardFacilityOptions}
                          value={service.facilityId}
                          onChange={(next) => handleServiceFacilityChange(service.localId, next)}
                          placeholder="Bölge / tesis seçiniz"
                          disabled={!service.district}
                          disabledHint="Önce ilçe seçin"
                          errorId={itemErrors.workLocationType ? `${workLocationTypeFieldId}-error` : undefined}
                        />
                      )}
                      {itemErrors.workLocationType && (
                        <p id={`${workLocationTypeFieldId}-error`} className="mt-2 text-sm text-danger">
                          {itemErrors.workLocationType}
                        </p>
                      )}
                    </div>
                  </div>

                  {isCustomLocationForCard && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor={neighborhoodFieldId} className="text-sm font-medium text-foreground">
                          Bölge / Mahalle <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                        </label>
                        <input
                          id={neighborhoodFieldId}
                          type="text"
                          value={service.neighborhood}
                          onChange={(event) => handleServiceNeighborhoodChange(service.localId, event.target.value)}
                          maxLength={100}
                          aria-invalid={itemErrors.neighborhood ? true : undefined}
                          aria-describedby={itemErrors.neighborhood ? `${neighborhoodFieldId}-error` : undefined}
                          placeholder="Örn. Çerkeşli Mahallesi"
                          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.neighborhood ? "border-danger" : "border-border"
                          }`}
                        />
                        {itemErrors.neighborhood && (
                          <p id={`${neighborhoodFieldId}-error`} className="mt-2 text-sm text-danger">
                            {itemErrors.neighborhood}
                          </p>
                        )}
                      </div>

                      <div>
                        <label htmlFor={locationUrlFieldId} className="text-sm font-medium text-foreground">
                          Konum Bağlantısı <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                        </label>
                        <input
                          id={locationUrlFieldId}
                          type="url"
                          value={service.locationUrl}
                          onChange={(event) => handleServiceLocationUrlChange(service.localId, event.target.value)}
                          maxLength={300}
                          aria-invalid={itemErrors.locationUrl ? true : undefined}
                          aria-describedby={itemErrors.locationUrl ? `${locationUrlFieldId}-error` : undefined}
                          placeholder="Örn. https://maps.google.com/..."
                          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.locationUrl ? "border-danger" : "border-border"
                          }`}
                        />
                        {itemErrors.locationUrl && (
                          <p id={`${locationUrlFieldId}-error`} className="mt-2 text-sm text-danger">
                            {itemErrors.locationUrl}
                          </p>
                        )}
                      </div>

                      <div className="sm:col-span-2">
                        <label htmlFor={directionsNoteFieldId} className="text-sm font-medium text-foreground">
                          Adres Tarifi <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
                        </label>
                        <textarea
                          id={directionsNoteFieldId}
                          value={service.directionsNote}
                          onChange={(event) => handleServiceDirectionsNoteChange(service.localId, event.target.value)}
                          maxLength={300}
                          rows={2}
                          aria-invalid={itemErrors.directionsNote ? true : undefined}
                          aria-describedby={itemErrors.directionsNote ? `${directionsNoteFieldId}-error` : undefined}
                          placeholder="Örn. Ana kapıdan değil, B kapısından giriş yapınız."
                          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            itemErrors.directionsNote ? "border-danger" : "border-border"
                          }`}
                        />
                        {itemErrors.directionsNote && (
                          <p id={`${directionsNoteFieldId}-error`} className="mt-2 text-sm text-danger">
                            {itemErrors.directionsNote}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <label htmlFor={addressTextFieldId} className="text-sm font-medium text-foreground">
                        Açık Adres
                      </label>
                      <span className="text-xs text-muted-foreground">{service.addressText.trim().length} / 500</span>
                    </div>
                    <textarea
                      id={addressTextFieldId}
                      value={service.addressText}
                      onChange={(event) => handleServiceAddressChange(service.localId, event.target.value)}
                      maxLength={500}
                      rows={2}
                      aria-invalid={itemErrors.addressText ? true : undefined}
                      aria-describedby={itemErrors.addressText ? `${addressTextFieldId}-error` : undefined}
                      placeholder="Mahalle, cadde/sokak, kapı no ve varsa ilave tarif bilgileri."
                      className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        itemErrors.addressText ? "border-danger" : "border-border"
                      }`}
                    />
                    {itemErrors.addressText && (
                      <p id={`${addressTextFieldId}-error`} className="mt-2 text-sm text-danger">
                        {itemErrors.addressText}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {services[0].category !== "" && (
          <div className="rounded-md border border-dashed border-border p-4">
            <p className="text-sm font-medium text-foreground">
              Bu operasyon için başka bir hizmete ihtiyacınız var mı?
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              İsterseniz aynı operasyon için ek hizmet ilanları oluşturabilirsiniz. Her hizmet ayrı ilan
              olarak yayınlanır.
            </p>
            <button
              type="button"
              onClick={handleAddService}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ek hizmet ekle
            </button>
          </div>
        )}
      </div>

      <div>
        <p id={photosId} className="text-sm font-medium text-foreground">
          Operasyon Fotoğrafları *
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Operasyonun yapılacağı alanı, yükü, ekipmanı veya mevcut saha
          koşullarını gösteren güncel fotoğraflar yükleyin. Fotoğraflar,
          hizmet verenlerin işi doğru değerlendirmesine yardımcı olacaktır.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Kişisel bilgi, telefon numarası, plaka veya gizli belge içeren
          fotoğraflar yüklemeyin.
        </p>
        <div className="mt-3">
          <JobPhotoUpload
            role={session.role}
            onPhotosChange={handlePhotosChange}
            onBusyChange={setPhotosProcessing}
            disabled={submitting || photosProcessing}
            errorId={sharedErrors.photoCount ? `${photosId}-error` : undefined}
          />
        </div>
        {sharedErrors.photoCount && (
          <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {sharedErrors.photoCount}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={operationDetailsId} className="text-sm font-medium text-foreground">
            Operasyon Detayları
          </label>
          <span className="text-xs text-muted-foreground">
            {operationDetails.trim().length} / {OPERATION_DETAILS_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={operationDetailsId}
          value={operationDetails}
          onChange={(event) => {
            setOperationDetails(event.target.value);
            setSharedErrors((current) => {
              if (!("operationDetails" in current)) return current;
              const next = { ...current };
              delete next.operationDetails;
              return next;
            });
          }}
          maxLength={OPERATION_DETAILS_MAX_LENGTH}
          rows={4}
          aria-invalid={sharedErrors.operationDetails ? true : undefined}
          aria-describedby={sharedErrors.operationDetails ? `${operationDetailsId}-error` : undefined}
          placeholder="Ekipman, kişisel koruyucu donanım, saha erişimi gibi tüm operasyonu ilgilendiren ortak detayları belirtin."
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            sharedErrors.operationDetails ? "border-danger" : "border-border"
          }`}
        />
        {sharedErrors.operationDetails && (
          <p id={`${operationDetailsId}-error`} className="mt-2 text-sm text-danger">
            {sharedErrors.operationDetails}
          </p>
        )}
      </div>

      {(Object.keys(sharedErrors).length > 0 || Object.keys(serviceErrors).length > 0) && (
        <p role="alert" className="text-sm font-medium text-danger">
          Lütfen işaretlenen zorunlu alanları tamamlayın.
        </p>
      )}

      <button
        type="submit"
        disabled={photosProcessing}
        aria-disabled={photosProcessing}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {photosProcessing && <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}
        {photosProcessing ? "Fotoğraflar işleniyor..." : "İlanı Yayınla"}
      </button>
      </form>
    </PageCardShell>
  );
}
