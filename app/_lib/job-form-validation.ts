import { MIN_PHOTOS, PHOTOS_REQUIRED_MESSAGE } from "./photo-validation";

export type JobFormFields = {
  category: string;
  title: string;
  description: string;
  province: string;
  district: string;
  facilityType: string;
  workLocationType: string;
  workDate: string;
  operationDetails: string;
  photoCount: number;
};

export type JobFormErrors = Partial<Record<keyof JobFormFields, string>>;

export function validateJobForm(
  fields: JobFormFields,
  options?: { isEdit?: boolean },
): JobFormErrors {
  const errors: JobFormErrors = {};

  if (fields.category.trim().length === 0) {
    errors.category = "Hizmet kategorisi seçiniz.";
  }

  const title = fields.title.trim();
  if (title.length === 0) {
    errors.title = "İlan başlığı zorunludur.";
  } else if (title.length < 5) {
    errors.title = "İlan başlığı en az 5 karakter olmalıdır.";
  } else if (title.length > 150) {
    errors.title = "İlan başlığı en fazla 150 karakter olabilir.";
  }

  const description = fields.description.trim();
  if (description.length === 0) {
    errors.description = "İş açıklaması zorunludur.";
  } else if (description.length < 20) {
    errors.description = "İş açıklaması en az 20 karakter olmalıdır.";
  } else if (description.length > 1000) {
    errors.description = "İş açıklaması en fazla 1.000 karakter olabilir.";
  }

  const province = fields.province.trim();
  if (province.length === 0) {
    errors.province = "İl zorunludur.";
  } else if (province.length < 2) {
    errors.province = "Geçerli bir il giriniz.";
  }

  const district = fields.district.trim();
  if (district.length === 0) {
    errors.district = "İlçe zorunludur.";
  } else if (district.length < 2) {
    errors.district = "Geçerli bir ilçe giriniz.";
  }

  // Düzenlemede atlanır: Job kaydı facilityType'ı hiç saklamaz (yalnızca
  // workLocationType/tesis metni kalıcıdır, bkz. job-edit-form.tsx), bu
  // yüzden mevcut bir ilanı düzenlerken bu alan her zaman boş başlar ve
  // kullanıcı konumu hiç değiştirmese bile kaydı imkansız kılardı.
  if (!options?.isEdit && fields.facilityType.trim().length === 0) {
    errors.facilityType = "İşin yapılacağı yer türünü seçiniz.";
  }

  const workLocationType = fields.workLocationType.trim();
  if (workLocationType.length === 0) {
    errors.workLocationType = "İşin yapılacağı yeri (tesisi) belirtiniz.";
  } else if (workLocationType.length < 2) {
    errors.workLocationType = "Geçerli bir tesis giriniz.";
  }

  if (fields.workDate.trim().length === 0) {
    errors.workDate = "İş tarihini seçiniz.";
  } else if (Number.isNaN(new Date(fields.workDate).getTime())) {
    errors.workDate = "Geçerli bir tarih seçiniz.";
  }

  const operationDetails = fields.operationDetails.trim();
  if (operationDetails.length === 0) {
    errors.operationDetails = "Operasyon detaylarını giriniz.";
  } else if (operationDetails.length < 10) {
    errors.operationDetails = "Operasyon detayları en az 10 karakter olmalıdır.";
  } else if (operationDetails.length > 1000) {
    errors.operationDetails = "Operasyon detayları en fazla 1.000 karakter olabilir.";
  }

  if (fields.photoCount < MIN_PHOTOS) {
    errors.photoCount = PHOTOS_REQUIRED_MESSAGE;
  }

  return errors;
}
