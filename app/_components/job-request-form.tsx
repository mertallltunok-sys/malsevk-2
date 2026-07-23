"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useId, useMemo, useState } from "react";
import { validateJobForm, type JobFormErrors } from "../_lib/job-form-validation";
import { createJob } from "../_lib/job-store";
import { SERVICE_CATEGORIES } from "../_lib/jobs";
import { MIN_PHOTOS } from "../_lib/photo-validation";
import {
  FACILITY_TYPE_OPTIONS,
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceDistrictAndType,
  getProvinceIdByCode,
  getProvinces,
  type FacilityType,
} from "../_lib/turkey-locations";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { GuestAccessCard, PageCardShell } from "./guest-access-card";
import { JobPhotoUpload, type ReadyJobPhoto } from "./job-photo-upload";
import { SearchableSelect } from "./searchable-select";

const DESCRIPTION_MAX_LENGTH = 1000;
const OPERATION_DETAILS_MAX_LENGTH = 1000;

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
  const facilityTypeId = useId();
  const workLocationTypeId = useId();
  const workDateId = useId();
  const operationDetailsId = useId();
  const photosId = useId();

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [district, setDistrict] = useState("");
  const [facilityType, setFacilityType] = useState<FacilityType | "">("");
  const [workLocationType, setWorkLocationType] = useState("");
  const [workDate, setWorkDate] = useState("");
  const [operationDetails, setOperationDetails] = useState("");
  const [photos, setPhotos] = useState<ReadyJobPhoto[]>([]);
  const [photosProcessing, setPhotosProcessing] = useState(false);
  const [errors, setErrors] = useState<JobFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const provinces = useMemo(() => getProvinces(), []);
  const provinceName = provinces.find((item) => item.code === provinceCode)?.name ?? "";

  const districtOptions = useMemo(
    () =>
      provinceCode
        ? getDistrictsByProvinceCode(provinceCode).map((name) => ({ value: name, label: name }))
        : [],
    [provinceCode],
  );

  const workLocationOptions = useMemo(() => {
    if (!provinceCode || !district || !facilityType) return [];
    const provinceIdValue = getProvinceIdByCode(provinceCode);
    if (!provinceIdValue) return [];
    const districtIdValue = getDistrictId(district);
    return getFacilitiesByProvinceDistrictAndType(provinceIdValue, districtIdValue, facilityType).map(
      (facility) => ({
        value: facility.name,
        label: facility.name,
        keywords: facility.aliases,
      }),
    );
  }, [provinceCode, district, facilityType]);

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

  // İl değiştiğinde: ilçe, yer türü ve tesis seçimi TAMAMEN temizlenir —
  // hepsi seçilen ile bağlı olduğu için eskisi artık anlamsızdır.
  function handleProvinceChange(nextCode: string) {
    setProvinceCode(nextCode);
    setDistrict("");
    setFacilityType("");
    setWorkLocationType("");
    setErrors((current) => {
      const next = { ...current };
      delete next.province;
      delete next.district;
      delete next.facilityType;
      delete next.workLocationType;
      return next;
    });
  }

  // İlçe değiştiğinde: yer türü seçimi KORUNUR (kullanıcı "Liman" arıyorsa,
  // ilçe değiştirdiğinde bunu yeniden seçmesi gerekmez); ama tesis seçimi
  // her zaman temizlenir — eski ilçenin tesisi yeni ilçede asla kalmamalı.
  function handleDistrictChange(nextDistrict: string) {
    setDistrict(nextDistrict);
    setWorkLocationType("");
    setErrors((current) => {
      const next = { ...current };
      delete next.district;
      delete next.workLocationType;
      return next;
    });
  }

  // Yer türü değiştiğinde: eski tesis seçimi temizlenir, yeni filtre
  // sonuçları (workLocationOptions) otomatik olarak yeniden hesaplanır.
  function handleFacilityTypeChange(nextType: FacilityType | "") {
    setFacilityType(nextType);
    setWorkLocationType("");
    setErrors((current) => {
      const next = { ...current };
      delete next.facilityType;
      delete next.workLocationType;
      return next;
    });
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
      "facilityType",
      "workLocationType",
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
      facilityType: facilityTypeId,
      workLocationType: workLocationTypeId,
      operationDetails: operationDetailsId,
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
    if (submitting || photosProcessing) return;

    const fieldErrors = validateJobForm({
      category,
      title,
      description,
      province: provinceName,
      district,
      facilityType,
      workLocationType,
      workDate,
      operationDetails,
      photoCount: photos.length,
    });
    setErrors(fieldErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0) {
      focusFirstError(fieldErrors);
      return;
    }

    setSubmitting(true);
    const result = await createJob(session, {
      category,
      title,
      description,
      province: provinceName,
      district,
      workLocationType,
      workDate,
      operationDetails,
      photos,
    });
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    router.push(`/ilanlar/${result.job.id}`);
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
            {SERVICE_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
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
            errorId={errors.photoCount ? `${photosId}-error` : undefined}
          />
        </div>
        {errors.photoCount && (
          <p id={`${photosId}-error`} role="alert" className="mt-2 text-sm text-danger">
            {errors.photoCount}
          </p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
          <label htmlFor={facilityTypeId} className="text-sm font-medium text-foreground">
            İşin Yapılacağı Yer Türü
          </label>
          <select
            id={facilityTypeId}
            value={facilityType}
            onChange={(event) => handleFacilityTypeChange(event.target.value as FacilityType | "")}
            disabled={!district}
            aria-invalid={errors.facilityType ? true : undefined}
            aria-describedby={errors.facilityType ? `${facilityTypeId}-error` : undefined}
            className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${
              errors.facilityType ? "border-danger" : "border-border"
            }`}
          >
            <option value="">{district ? "Yer türü seçiniz" : "Önce ilçe seçin"}</option>
            {FACILITY_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.facilityType && (
            <p id={`${facilityTypeId}-error`} className="mt-2 text-sm text-danger">
              {errors.facilityType}
            </p>
          )}
        </div>

        <div>
          {facilityType && workLocationOptions.length === 0 ? (
            <>
              <label
                htmlFor={workLocationTypeId}
                className="text-sm font-medium text-foreground"
              >
                Tesis
              </label>
              <input
                id={workLocationTypeId}
                type="text"
                value={workLocationType}
                onChange={(event) => {
                  setWorkLocationType(event.target.value);
                  clearFieldError("workLocationType");
                }}
                maxLength={100}
                aria-invalid={errors.workLocationType ? true : undefined}
                aria-describedby={
                  errors.workLocationType ? `${workLocationTypeId}-error` : undefined
                }
                placeholder="Örnek: Liman Sahası"
                className={`mt-2 w-full rounded-md border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  errors.workLocationType ? "border-danger" : "border-border"
                }`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Bu ilçe ve yer türü için hazır bir tesis listesi henüz
                eklenmedi; yeri elle yazabilirsiniz.
              </p>
            </>
          ) : (
            <SearchableSelect
              id={workLocationTypeId}
              label="Tesis"
              options={workLocationOptions}
              value={workLocationType}
              onChange={(value) => {
                setWorkLocationType(value);
                clearFieldError("workLocationType");
              }}
              placeholder="Tesis seçiniz"
              disabled={!facilityType}
              disabledHint={!district ? "Önce ilçe seçin" : "Önce yer türü seçin"}
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
