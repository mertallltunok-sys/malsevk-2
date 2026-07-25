"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { clearJobFormErrors, validateJobForm, type JobFormErrors } from "../_lib/job-form-validation";
import { FACILITY_FREE_TEXT_VALUE, toFacilitySelectOptions } from "../_lib/job-location";
import { createJob } from "../_lib/job-store";
import { MIN_PHOTOS } from "../_lib/photo-validation";
import { SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceIdByCode,
  getProvinces,
} from "../_lib/turkey-locations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { GuestAccessCard, PageCardShell } from "./guest-access-card";
import { JobPhotoUpload, type ReadyJobPhoto } from "./job-photo-upload";
import { SearchableSelect } from "./searchable-select";

const DESCRIPTION_MAX_LENGTH = 1000;
const OPERATION_DETAILS_MAX_LENGTH = 1000;
const ADDRESS_MAX_LENGTH = 500;

const PAGE_TITLE = "Hizmet Talebi Oluştur";
const PAGE_DESCRIPTION =
  "İhtiyacınızı tanımlayın; uzman hizmet verenler ilanınızı inceleyip teklif göndersin.";

export function JobRequestForm() {
  const session = useSession();
  const router = useRouter();

  const categoryId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const provinceId = useId();
  const districtId = useId();
  const workLocationTypeId = useId();
  const companyOrFactoryNameId = useId();
  const addressTextId = useId();
  const neighborhoodId = useId();
  const locationUrlId = useId();
  const directionsNoteId = useId();
  const workDateId = useId();
  const operationDetailsId = useId();
  const photosId = useId();

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [district, setDistrict] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [otherFacilityText, setOtherFacilityText] = useState("");
  const [companyOrFactoryName, setCompanyOrFactoryName] = useState("");
  const [addressText, setAddressText] = useState("");
  // Yalnızca facilityId === FACILITY_FREE_TEXT_VALUE ("Listede yok — tesis
  // bilgilerini kendim gireceğim") seçiliyken gösterilir/doğrulanır, bkz.
  // job-form-validation.ts#JobFormFields.locationMode.
  const [neighborhood, setNeighborhood] = useState("");
  const [locationUrl, setLocationUrl] = useState("");
  const [directionsNote, setDirectionsNote] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [operationDetails, setOperationDetails] = useState("");
  const [photos, setPhotos] = useState<ReadyJobPhoto[]>([]);
  const [photosProcessing, setPhotosProcessing] = useState(false);
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // React state (submitting) yalnızca UI'yi (buton disabled/metin) sürer —
  // aynı JS event-loop turunda art arda iki tıklama, ikisi de state commit
  // edilmeden ÖNCE handleSubmit'e ulaşabilir, bu yüzden çift-gönderim
  // koruması BUNA dayanamaz. `submitLockRef` senkron, render'dan bağımsız
  // bir kilit: ilk geçerli submit anında hemen kapanır, ikinci çağrı state
  // güncellemesini beklemeden bu kilidi görüp döner (bkz. handleSubmit).
  const submitLockRef = useRef(false);
  // Kullanıcı createJob() sonucu beklenirken sayfadan ayrılırsa (ör. bir
  // linke tıklarsa) component unmount olabilir; bu durumda await sonrası
  // setSubmitting/setSubmitError çağrısı React'in "unmounted component'te
  // state güncelleme" uyarısını tetikler. isMountedRef bunu engeller.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const provinces = useMemo(() => getProvinces(), []);
  const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";

  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  // Bölge/Tesis: seçilen il+ilçe kapsamındaki TÜM tesis türleri tek listede
  // sunulur (bkz. job-location.ts) — Aktif İlanlar ekranındaki Bölge/Tesis
  // filtresiyle (job-listing-filters.ts) AYNI merkezi kaynak ve AYNI
  // il/ilçe anahtar şeması kullanılır, ayrı bir "yer türü" ön adımı yoktur.
  const candidateFacilities = useMemo(() => {
    if (!provinceCode || !district) return [];
    const provinceIdValue = getProvinceIdByCode(provinceCode);
    if (!provinceIdValue) return [];
    return getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(district));
  }, [provinceCode, district]);

  const facilityOptions = useMemo(() => toFacilitySelectOptions(candidateFacilities), [candidateFacilities]);

  /** Kullanıcı bir alanı düzelttiğinde o alanın hata durumu hemen kalksın diye. */
  function clearFieldError(field: keyof JobFormErrors) {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  // useCallback İLE KARARLI TUTULMASI ZORUNLU: JobPhotoUpload, bu prop'u
  // kendi useEffect'inin bağımlılık dizisinde tutuyor (bkz. job-photo-upload.tsx).
  // Burada her render'da yeni bir ok fonksiyonu oluşturulsaydı (ör. `errors`
  // state'i her değiştiğinde bu bileşen yeniden render olduğunda), o effect
  // sonsuz döngüye girerdi (setPhotos -> yeniden render -> yeni referans ->
  // effect tekrar çalışır -> setPhotos -> ...) — "Maximum update depth
  // exceeded" hatasının kök nedeni buydu.
  const handlePhotosChange = useCallback((nextPhotos: ReadyJobPhoto[]) => {
    setPhotos(nextPhotos);
    if (nextPhotos.length >= MIN_PHOTOS) {
      setErrors((current) => {
        if (!("photoCount" in current)) return current;
        const next = { ...current };
        delete next.photoCount;
        return next;
      });
    }
  }, []);

  /** Özel tesis (custom) alanlarını temizler — İl/İlçe/Bölge-Tesis değiştiğinde, eski modun artık anlamsız kalan verisi bir sonrakine sızmasın diye. */
  function resetCustomFacilityFields() {
    setNeighborhood("");
    setLocationUrl("");
    setDirectionsNote("");
  }

  // İl değiştiğinde: ilçe ve Bölge/Tesis seçimi TAMAMEN temizlenir — ikisi
  // de seçilen ile bağlı olduğu için eskisi artık anlamsızdır.
  function handleProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setDistrict("");
    setFacilityId("");
    setOtherFacilityText("");
    resetCustomFacilityFields();
    setErrors((current) =>
      clearJobFormErrors(current, [
        "province",
        "district",
        "workLocationType",
        "neighborhood",
        "locationUrl",
        "directionsNote",
      ]),
    );
  }

  // İlçe değiştiğinde: Bölge/Tesis seçimi her zaman temizlenir — eski
  // ilçenin tesisi yeni ilçede asla kalmamalı.
  function handleDistrictChange(nextDistrict: string) {
    setDistrict(nextDistrict);
    setFacilityId("");
    setOtherFacilityText("");
    resetCustomFacilityFields();
    setErrors((current) =>
      clearJobFormErrors(current, ["district", "workLocationType", "neighborhood", "locationUrl", "directionsNote"]),
    );
  }

  function handleFacilityChange(nextValue: string) {
    setFacilityId(nextValue);
    setOtherFacilityText("");
    resetCustomFacilityFields();
    // Özel tesis moduna girilirken, katalog moduna özgü Firma/Fabrika Adı
    // alanı da temizlenir — "eski moda ait gereksiz alanlar temizlenmeli"
    // kuralı burada da geçerli. Tersi yönde (özel -> katalog) BİLEREK
    // temizlenmez: eski (bu özellikten önce oluşturulmuş) bir ilanı hiç
    // dokunmadan düzenlerken mevcut companyOrFactoryName'i kaybetmemeli.
    if (nextValue === FACILITY_FREE_TEXT_VALUE) {
      setCompanyOrFactoryName("");
      clearFieldError("companyOrFactoryName");
    }
    setErrors((current) =>
      clearJobFormErrors(current, ["workLocationType", "neighborhood", "locationUrl", "directionsNote"]),
    );
  }

  /** İlk hatalı/eksik zorunlu alana kaydırır ve odak verir (bkz. FIELD_ORDER). */
  function focusFirstError(fieldErrors: JobFormErrors) {
    const fieldOrder: (keyof JobFormErrors)[] = [
      "category",
      "workDate",
      "title",
      "description",
      "photoCount",
      "province",
      "district",
      "workLocationType",
      "companyOrFactoryName",
      "addressText",
      "neighborhood",
      "locationUrl",
      "directionsNote",
      "operationDetails",
    ];
    const fieldIds: Record<keyof JobFormErrors, string> = {
      category: categoryId,
      workDate: workDateId,
      title: titleId,
      description: descriptionId,
      photoCount: photosId,
      province: provinceId,
      district: districtId,
      workLocationType: workLocationTypeId,
      companyOrFactoryName: companyOrFactoryNameId,
      addressText: addressTextId,
      neighborhood: neighborhoodId,
      locationUrl: locationUrlId,
      directionsNote: directionsNoteId,
      operationDetails: operationDetailsId,
      // locationMode kullanıcının doğrudan doldurduğu bir alan değil (dahili
      // olarak facilityId'den türetilir, bkz. handleSubmit) — validateJobForm
      // bu alan için hiçbir zaman hata üretmez, ama JobFormErrors'ın tüm
      // JobFormFields anahtarlarını kapsaması TypeScript tarafından
      // zorunlu kılındığı için burada en yakın ilişkili alana yönlendirilir.
      locationMode: workLocationTypeId,
    };
    const firstErrorField = fieldOrder.find((field) => fieldErrors[field]);
    if (!firstErrorField) return;
    const target = document.getElementById(fieldIds[firstErrorField]);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.focus({ preventScroll: true });
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Senkron kilit: state (submitting) commit edilmeden önce gelebilecek
    // ikinci bir çağrıyı da hemen durdurur (bkz. submitLockRef tanımı).
    if (submitLockRef.current || photosProcessing) return;

    const isCustomLocation = facilityId === FACILITY_FREE_TEXT_VALUE;
    const selectedFacility = candidateFacilities.find((facility) => facility.id === facilityId) ?? null;
    const workLocationTypeValue = isCustomLocation ? otherFacilityText.trim() : selectedFacility?.name ?? "";
    const locationMode: "catalog" | "custom" = isCustomLocation ? "custom" : "catalog";

    const fieldErrors = validateJobForm({
      category,
      title,
      description,
      province: provinceName,
      district,
      workLocationType: workLocationTypeValue,
      companyOrFactoryName,
      addressText,
      locationMode,
      neighborhood,
      locationUrl,
      directionsNote,
      workDate,
      operationDetails,
      photoCount: photos.length,
    });
    setErrors(fieldErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0) {
      // Doğrulama hatası varsa kilit hiç kapatılmadan akış sonlanır.
      focusFirstError(fieldErrors);
      return;
    }

    // İlk geçerli submit anında kilit SENKRON olarak kapanır — aynı anda
    // gelen ikinci bir çağrı, henüz bir sonraki render gerçekleşmemiş olsa
    // bile bu satırı görüp yukarıdaki guard'da döner.
    submitLockRef.current = true;
    setSubmitting(true);
    try {
      const result = await createJob(session, {
        category,
        title,
        description,
        province: provinceName,
        district,
        workLocationType: workLocationTypeValue,
        facilityId: selectedFacility?.id,
        companyOrFactoryName,
        addressText,
        locationMode,
        neighborhood,
        locationUrl,
        directionsNote,
        workDate,
        operationDetails,
        photos,
      });

      if (!result.ok) {
        if (isMountedRef.current) setSubmitError(result.error);
        return;
      }

      router.push(`/ilanlar/${result.job.id}`);
    } finally {
      // createJob() beklenmedik şekilde reddedilse/hata fırlatsa bile kilit
      // burada mutlaka açılır — takılı kalmaz.
      submitLockRef.current = false;
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  return (
    <PageCardShell title={PAGE_TITLE} description={PAGE_DESCRIPTION}>
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor={categoryId} className="text-sm font-medium text-foreground">
            Hizmet Kategorisi
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              clearFieldError("category");
            }}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? `${categoryId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.category ? "border-danger" : "border-border"
            }`}
          >
            <option value="">Kategori seçiniz</option>
            {SERVICE_CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.category && (
            <p id={`${categoryId}-error`} className="mt-2 text-sm text-danger">
              {errors.category}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={workDateId} className="text-sm font-medium text-foreground">
            İş Tarihi
          </label>
          <input
            id={workDateId}
            type="date"
            value={workDate}
            onChange={(event) => {
              setWorkDate(event.target.value);
              clearFieldError("workDate");
            }}
            aria-invalid={errors.workDate ? true : undefined}
            aria-describedby={errors.workDate ? `${workDateId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.workDate ? "border-danger" : "border-border"
            }`}
          />
          {errors.workDate && (
            <p id={`${workDateId}-error`} className="mt-2 text-sm text-danger">
              {errors.workDate}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor={titleId} className="text-sm font-medium text-foreground">
          İlan Başlığı
        </label>
        <input
          id={titleId}
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            clearFieldError("title");
          }}
          maxLength={150}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
          placeholder="Örnek: Fabrika Sahasında Forklift Operatörü İhtiyacı"
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            errors.title ? "border-danger" : "border-border"
          }`}
        />
        {errors.title && (
          <p id={`${titleId}-error`} className="mt-2 text-sm text-danger">
            {errors.title}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={descriptionId} className="text-sm font-medium text-foreground">
            İş Açıklaması
          </label>
          <span className="text-xs text-muted-foreground">
            {description.trim().length} / {DESCRIPTION_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={descriptionId}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
            clearFieldError("description");
          }}
          maxLength={DESCRIPTION_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
          placeholder="Hizmet ihtiyacınızı, iş kapsamını ve beklentilerinizi açıklayın."
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            errors.description ? "border-danger" : "border-border"
          }`}
        />
        {errors.description && (
          <p id={`${descriptionId}-error`} className="mt-2 text-sm text-danger">
            {errors.description}
          </p>
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
            errorId={errors.photoCount ? `${photosId}-error` : undefined}
          />
        </div>
        {errors.photoCount && (
          <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {errors.photoCount}
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <SearchableSelect
            id={provinceId}
            label="İl"
            options={provinces.map((item) => ({ value: item.code, label: item.name }))}
            value={provinceCode}
            onChange={handleProvinceChange}
            placeholder="İl seçiniz"
            errorId={errors.province ? `${provinceId}-error` : undefined}
          />
          {errors.province && (
            <p id={`${provinceId}-error`} className="mt-2 text-sm text-danger">
              {errors.province}
            </p>
          )}
        </div>

        <div>
          <SearchableSelect
            id={districtId}
            label="İlçe"
            options={districtOptions}
            value={district}
            onChange={handleDistrictChange}
            placeholder="İlçe seçiniz"
            disabled={!provinceCode}
            disabledHint="Önce il seçin"
            errorId={errors.district ? `${districtId}-error` : undefined}
          />
          {errors.district && (
            <p id={`${districtId}-error`} className="mt-2 text-sm text-danger">
              {errors.district}
            </p>
          )}
        </div>

        <div>
          {facilityId === FACILITY_FREE_TEXT_VALUE ? (
            <>
              <label htmlFor={workLocationTypeId} className="text-sm font-medium text-foreground">
                Tesis / İşletme Adı
              </label>
              <input
                id={workLocationTypeId}
                type="text"
                value={otherFacilityText}
                onChange={(event) => {
                  setOtherFacilityText(event.target.value);
                  clearFieldError("workLocationType");
                }}
                maxLength={150}
                aria-invalid={errors.workLocationType ? true : undefined}
                aria-describedby={
                  errors.workLocationType ? `${workLocationTypeId}-error` : undefined
                }
                placeholder="Örnek: ABC Metal Fabrikası"
                className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  errors.workLocationType ? "border-danger" : "border-border"
                }`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Listede olmayan tesisin adını buraya yazabilirsiniz.{" "}
                <button
                  type="button"
                  onClick={() => handleFacilityChange("")}
                  className="font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
                >
                  Hazır listeden seçmek için tıklayın.
                </button>
              </p>
            </>
          ) : (
            <SearchableSelect
              id={workLocationTypeId}
              label="Bölge / Tesis"
              options={facilityOptions}
              value={facilityId}
              onChange={handleFacilityChange}
              placeholder="Bölge / tesis seçiniz"
              disabled={!district}
              disabledHint="Önce ilçe seçin"
              errorId={errors.workLocationType ? `${workLocationTypeId}-error` : undefined}
            />
          )}
          {errors.workLocationType && (
            <p
              id={`${workLocationTypeId}-error`}
              className="mt-2 text-sm text-danger"
            >
              {errors.workLocationType}
            </p>
          )}
        </div>
      </div>

      {facilityId === FACILITY_FREE_TEXT_VALUE ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor={neighborhoodId} className="text-sm font-medium text-foreground">
              Bölge / Mahalle <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
            </label>
            <input
              id={neighborhoodId}
              type="text"
              value={neighborhood}
              onChange={(event) => {
                setNeighborhood(event.target.value);
                clearFieldError("neighborhood");
              }}
              maxLength={100}
              aria-invalid={errors.neighborhood ? true : undefined}
              aria-describedby={errors.neighborhood ? `${neighborhoodId}-error` : undefined}
              placeholder="Örn. Çerkeşli Mahallesi"
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.neighborhood ? "border-danger" : "border-border"
              }`}
            />
            {errors.neighborhood && (
              <p id={`${neighborhoodId}-error`} className="mt-2 text-sm text-danger">
                {errors.neighborhood}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={locationUrlId} className="text-sm font-medium text-foreground">
              Konum Bağlantısı <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
            </label>
            <input
              id={locationUrlId}
              type="url"
              value={locationUrl}
              onChange={(event) => {
                setLocationUrl(event.target.value);
                clearFieldError("locationUrl");
              }}
              maxLength={300}
              aria-invalid={errors.locationUrl ? true : undefined}
              aria-describedby={errors.locationUrl ? `${locationUrlId}-error` : undefined}
              placeholder="Örn. https://maps.google.com/..."
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.locationUrl ? "border-danger" : "border-border"
              }`}
            />
            {errors.locationUrl && (
              <p id={`${locationUrlId}-error`} className="mt-2 text-sm text-danger">
                {errors.locationUrl}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor={directionsNoteId} className="text-sm font-medium text-foreground">
              Adres Tarifi <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>
            </label>
            <textarea
              id={directionsNoteId}
              value={directionsNote}
              onChange={(event) => {
                setDirectionsNote(event.target.value);
                clearFieldError("directionsNote");
              }}
              maxLength={300}
              rows={2}
              aria-invalid={errors.directionsNote ? true : undefined}
              aria-describedby={errors.directionsNote ? `${directionsNoteId}-error` : undefined}
              placeholder="Örn. Ana kapıdan değil, B kapısından giriş yapınız."
              className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                errors.directionsNote ? "border-danger" : "border-border"
              }`}
            />
            {errors.directionsNote && (
              <p id={`${directionsNoteId}-error`} className="mt-2 text-sm text-danger">
                {errors.directionsNote}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor={companyOrFactoryNameId} className="text-sm font-medium text-foreground">
            Firma / Fabrika Adı
          </label>
          <input
            id={companyOrFactoryNameId}
            type="text"
            value={companyOrFactoryName}
            onChange={(event) => {
              setCompanyOrFactoryName(event.target.value);
              clearFieldError("companyOrFactoryName");
            }}
            maxLength={150}
            aria-invalid={errors.companyOrFactoryName ? true : undefined}
            aria-describedby={errors.companyOrFactoryName ? `${companyOrFactoryNameId}-error` : undefined}
            placeholder="Örn. ABC Metal Sanayi A.Ş."
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              errors.companyOrFactoryName ? "border-danger" : "border-border"
            }`}
          />
          {errors.companyOrFactoryName && (
            <p id={`${companyOrFactoryNameId}-error`} className="mt-2 text-sm text-danger">
              {errors.companyOrFactoryName}
            </p>
          )}
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={addressTextId} className="text-sm font-medium text-foreground">
            Açık Adres
          </label>
          <span className="text-xs text-muted-foreground">
            {addressText.trim().length} / {ADDRESS_MAX_LENGTH}
          </span>
        </div>
        <textarea
          id={addressTextId}
          value={addressText}
          onChange={(event) => {
            setAddressText(event.target.value);
            clearFieldError("addressText");
          }}
          maxLength={ADDRESS_MAX_LENGTH}
          rows={3}
          aria-invalid={errors.addressText ? true : undefined}
          aria-describedby={errors.addressText ? `${addressTextId}-error` : undefined}
          placeholder="Mahalle, cadde/sokak, kapı no ve varsa ilave tarif bilgileri."
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            errors.addressText ? "border-danger" : "border-border"
          }`}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Açık adres yalnızca siz ve teklifi kabul edilen hizmet veren
          tarafından görülebilir.
        </p>
        {errors.addressText && (
          <p id={`${addressTextId}-error`} className="mt-2 text-sm text-danger">
            {errors.addressText}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label
            htmlFor={operationDetailsId}
            className="text-sm font-medium text-foreground"
          >
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
            clearFieldError("operationDetails");
          }}
          maxLength={OPERATION_DETAILS_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.operationDetails ? true : undefined}
          aria-describedby={
            errors.operationDetails ? `${operationDetailsId}-error` : undefined
          }
          placeholder="Ekipman, kişisel koruyucu donanım, saha erişimi gibi operasyon detaylarını belirtin."
          className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            errors.operationDetails ? "border-danger" : "border-border"
          }`}
        />
        {errors.operationDetails && (
          <p id={`${operationDetailsId}-error`} className="mt-2 text-sm text-danger">
            {errors.operationDetails}
          </p>
        )}
      </div>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm font-medium text-danger">
          Lütfen işaretlenen zorunlu alanları tamamlayın.
        </p>
      )}

      {submitError && (
        <p role="alert" className="text-sm text-danger">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || photosProcessing}
        aria-disabled={submitting || photosProcessing}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        {(submitting || photosProcessing) && (
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
        )}
        {submitting
          ? "İlan oluşturuluyor..."
          : photosProcessing
            ? "Fotoğraflar işleniyor..."
            : "İlanı Yayınla"}
      </button>
      </form>
    </PageCardShell>
  );
}
