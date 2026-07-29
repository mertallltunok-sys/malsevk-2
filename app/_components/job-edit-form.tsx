"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { clearJobFormErrors, validateJobForm, type JobFormErrors } from "../_lib/job-form-validation";
import { FACILITY_FREE_TEXT_VALUE, toFacilitySelectOptions } from "../_lib/job-location";
import { isJobEditable, JOB_NOT_EDITABLE_MESSAGE } from "../_lib/job-requests";
import { updateJob } from "../_lib/job-store";
import { resolveLegacyJobCategoryToId, SERVICE_CATEGORY_GROUPS } from "../_lib/service-catalog";
import type { Job, Offer, Session } from "../_lib/types";
import {
  getDistrictId,
  getDistrictsByProvinceCode,
  getFacilitiesByProvinceAndDistrict,
  getProvinceIdByCode,
  getProvinces,
} from "../_lib/turkey-locations";
import { useJobById } from "../_lib/use-jobs";
import { useAllOffers } from "../_lib/use-offers";
import { useSession } from "../_lib/use-session";
import { AuthGateNotice } from "./auth-gate-notice";
import { JobPhotoEditor } from "./job-photo-editor";
import type { ReadyJobPhoto } from "./job-photo-upload";
import { SearchableSelect } from "./searchable-select";

const DESCRIPTION_MAX_LENGTH = 1000;
const OPERATION_DETAILS_MAX_LENGTH = 1000;
const ADDRESS_MAX_LENGTH = 500;

export function JobEditForm({ jobId }: { jobId: string }) {
  const session = useSession();
  const job = useJobById(jobId);
  const offers = useAllOffers();

  if (!session) {
    return (
      <AuthGateNotice
        message="İlanınızı düzenlemek için giriş yapmalısınız."
        loginRedirect={`/panel/hizmet-taleplerim/${jobId}/duzenle`}
      />
    );
  }

  if (!job) {
    return <AuthGateNotice message="İlan bulunamadı." />;
  }

  if (session.role !== "hizmet-alan" || job.requesterId !== session.id) {
    return <AuthGateNotice message="Bu ilanı düzenleme yetkiniz yok." />;
  }

  // Teklif süreci başlamış (kabul edilmiş/devam eden/tamamlanmış/iptal
  // edilmiş) bir ilan artık düzenlenemez — job-requests-panel.tsx'teki
  // "Düzenle" linkinin görünürlüğü ve job-store.ts#updateJob'daki veri
  // katmanı koruması ile AYNI tek doğruluk kaynağını (isJobEditable)
  // kullanır, bu kural üç yerde ayrı ayrı yazılmaz.
  if (!isJobEditable(job.id, offers)) {
    return <AuthGateNotice message={JOB_NOT_EDITABLE_MESSAGE} />;
  }

  return <JobEditFormFields job={job} session={session} offers={offers} />;
}

function JobEditFormFields({ job, session, offers }: { job: Job; session: Session; offers: Offer[] }) {
  const router = useRouter();

  const categoryId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const provinceId = useId();
  const districtId = useId();
  const workLocationTypeId = useId();
  const addressTextId = useId();
  const neighborhoodId = useId();
  const locationUrlId = useId();
  const directionsNoteId = useId();
  const workDateId = useId();
  const workEndDateId = useId();
  const operationDetailsId = useId();
  const photosId = useId();

  // `job.category` eski (düz Türkçe metin) ya da yeni (katalog id'si)
  // olabilir — aşağıdaki <select>'in artık yalnızca yeni id'leri seçenek
  // olarak sunması nedeniyle, eski bir değer olduğu gibi bırakılırsa
  // hiçbir <option> ile eşleşmez ve seçim "boş" görünürdü. Bu yüzden
  // başlangıç değeri her zaman geçerli bir yeni id'ye (mümkünse) çözülür;
  // eşleşme yoksa (ör. "Depolama") kullanıcı yeni katalogdan açıkça bir
  // kategori seçmek zorunda kalır (bkz. service-catalog.ts#resolveLegacyJobCategoryToId).
  const [category, setCategory] = useState(() => resolveLegacyJobCategoryToId(job.category) ?? "");
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description);
  const [provinceCode, setProvinceCode] = useState(
    () => getProvinces().find((item) => item.name === job.province)?.code ?? "",
  );
  const [district, setDistrict] = useState(job.district);
  // Eski (facilityId'den önce oluşturulmuş) ilanlarda facilityId yoktur ama
  // workLocationType (serbest metin) doludur — bu durumda "Listede yok /
  // Diğer" seçilmiş gibi başlatılır ki kayıtlı değer kaybolmasın.
  const [facilityId, setFacilityId] = useState(
    () => job.facilityId ?? (job.workLocationType ? FACILITY_FREE_TEXT_VALUE : ""),
  );
  const [otherFacilityText, setOtherFacilityText] = useState(() => (job.facilityId ? "" : job.workLocationType));
  const [addressText, setAddressText] = useState(job.addressText ?? "");
  // Yalnızca facilityId === FACILITY_FREE_TEXT_VALUE iken gösterilir/doğrulanır
  // (bkz. job-form-validation.ts#JobFormFields.locationMode) — job.locationMode
  // henüz bu özellikten önce oluşturulmuş bir ilanda hiç yoksa bu alanlar da
  // hiç yoktur, boş string olarak başlar.
  const [neighborhood, setNeighborhood] = useState(job.neighborhood ?? "");
  const [locationUrl, setLocationUrl] = useState(job.locationUrl ?? "");
  const [directionsNote, setDirectionsNote] = useState(job.directionsNote ?? "");
  const [workDate, setWorkDate] = useState(job.workDate);
  // Bu alandan önce oluşturulmuş bir ilanda workEndDate hiç yoktur — sahte
  // bir tarih uydurmak yerine form boş başlar, kaydetmek için kullanıcının
  // (mevcut oluşturma akışıyla AYNI kuralla, bkz. job-form-validation.ts#
  // validateWorkDateRange) geçerli bir bitiş tarihi seçmesi gerekir.
  const [workEndDate, setWorkEndDate] = useState(job.workEndDate ?? "");
  const [operationDetails, setOperationDetails] = useState(job.operationDetails);
  const [photoState, setPhotoState] = useState<{ keptPhotoIds: string[]; newPhotos: ReadyJobPhoto[] }>(
    () => ({ keptPhotoIds: job.photos.map((photo) => photo.id), newPhotos: [] }),
  );
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

  const candidateFacilities = useMemo(() => {
    if (!provinceCode || !district) return [];
    const provinceIdValue = getProvinceIdByCode(provinceCode);
    if (!provinceIdValue) return [];
    return getFacilitiesByProvinceAndDistrict(provinceIdValue, getDistrictId(district));
  }, [provinceCode, district]);

  const facilityOptions = useMemo(() => toFacilitySelectOptions(candidateFacilities), [candidateFacilities]);

  function clearFieldError(field: keyof JobFormErrors) {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /** Özel tesis (custom) alanlarını temizler — İl/İlçe/Bölge-Tesis değiştiğinde, eski modun artık anlamsız kalan verisi bir sonrakine sızmasın diye. */
  function resetCustomFacilityFields() {
    setNeighborhood("");
    setLocationUrl("");
    setDirectionsNote("");
  }

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
    setErrors((current) =>
      clearJobFormErrors(current, ["workLocationType", "neighborhood", "locationUrl", "directionsNote"]),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || photosProcessing) return;

    const isCustomLocation = facilityId === FACILITY_FREE_TEXT_VALUE;
    const selectedFacility = candidateFacilities.find((facility) => facility.id === facilityId) ?? null;
    const workLocationTypeValue = isCustomLocation ? otherFacilityText.trim() : selectedFacility?.name ?? "";
    const locationMode: "catalog" | "custom" = isCustomLocation ? "custom" : "catalog";

    const photoCount = photoState.keptPhotoIds.length + photoState.newPhotos.length;
    const fieldErrors = validateJobForm({
      category,
      title,
      description,
      province: provinceName,
      district,
      workLocationType: workLocationTypeValue,
      addressText,
      locationMode,
      neighborhood,
      locationUrl,
      directionsNote,
      workDate,
      workEndDate,
      operationDetails,
      photoCount,
    });
    setErrors(fieldErrors);
    setSubmitError(null);

    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    const result = await updateJob(
      session,
      job.id,
      {
        title,
        category,
        province: provinceName,
        district,
        workLocationType: workLocationTypeValue,
        facilityId: selectedFacility?.id,
        addressText,
        locationMode,
        neighborhood,
        locationUrl,
        directionsNote,
        workDate,
        workEndDate,
        description,
        operationDetails,
        keptPhotoIds: photoState.keptPhotoIds,
        newPhotos: photoState.newPhotos,
      },
      offers,
    );
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    router.push("/panel/hizmet-taleplerim?guncellendi=1");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label htmlFor={categoryId} className="text-sm font-medium text-foreground">
            Hizmet Kategorisi
          </label>
          <select
            id={categoryId}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-invalid={errors.category ? true : undefined}
            aria-describedby={errors.category ? `${categoryId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            Başlangıç Tarihi
          </label>
          <input
            id={workDateId}
            type="date"
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
            aria-invalid={errors.workDate ? true : undefined}
            aria-describedby={errors.workDate ? `${workDateId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.workDate && (
            <p id={`${workDateId}-error`} className="mt-2 text-sm text-danger">
              {errors.workDate}
            </p>
          )}
        </div>

        <div>
          <label htmlFor={workEndDateId} className="text-sm font-medium text-foreground">
            Bitiş Tarihi
          </label>
          <input
            id={workEndDateId}
            type="date"
            value={workEndDate}
            onChange={(event) => setWorkEndDate(event.target.value)}
            aria-invalid={errors.workEndDate ? true : undefined}
            aria-describedby={errors.workEndDate ? `${workEndDateId}-error` : undefined}
            className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {errors.workEndDate && (
            <p id={`${workEndDateId}-error`} className="mt-2 text-sm text-danger">
              {errors.workEndDate}
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
          onChange={(event) => setTitle(event.target.value)}
          maxLength={150}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
          placeholder="Örnek: Fabrika Sahasında Forklift Operatörü İhtiyacı"
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          onChange={(event) => setDescription(event.target.value)}
          maxLength={DESCRIPTION_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
          placeholder="Hizmet ihtiyacınızı, iş kapsamını ve beklentilerinizi açıklayın."
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          <JobPhotoEditor
            job={job}
            onChange={setPhotoState}
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
                className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            <p id={`${workLocationTypeId}-error`} className="mt-2 text-sm text-danger">
              {errors.workLocationType}
            </p>
          )}
        </div>
      </div>

      {facilityId === FACILITY_FREE_TEXT_VALUE && (
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
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
              className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            {errors.directionsNote && (
              <p id={`${directionsNoteId}-error`} className="mt-2 text-sm text-danger">
                {errors.directionsNote}
              </p>
            )}
          </div>
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
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
          onChange={(event) => setOperationDetails(event.target.value)}
          maxLength={OPERATION_DETAILS_MAX_LENGTH}
          rows={4}
          aria-invalid={errors.operationDetails ? true : undefined}
          aria-describedby={errors.operationDetails ? `${operationDetailsId}-error` : undefined}
          placeholder="Ekipman, kişisel koruyucu donanım, saha erişimi gibi operasyon detaylarını belirtin."
          className="mt-2 w-full rounded-md border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {errors.operationDetails && (
          <p id={`${operationDetailsId}-error`} className="mt-2 text-sm text-danger">
            {errors.operationDetails}
          </p>
        )}
      </div>

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
        {submitting ? "Kaydediliyor..." : photosProcessing ? "Fotoğraflar işleniyor..." : "Kaydet"}
      </button>
    </form>
  );
}
